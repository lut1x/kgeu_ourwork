#!/usr/bin/env python3
"""UART JSON discovery and durable HTTPS collector. Python 3.9+, pyserial."""
import datetime as dt
import glob
import json
import logging
import math
import os
import re
import signal
import socket
import sqlite3
import threading
import time
import urllib.request
import uuid

VERSION = '1.0.1'
STOP = threading.Event()
LOCK = threading.Lock()
DEVICES = {}
PORTS = []
ERROR = ''
BAUD = 115200
CHANNELS = set()
STATE = os.environ.get('GATEWAY_STATE', '/var/lib/scada-gateway')


def watchdog():
    """Feed systemd only while the main delivery loop is making progress."""
    address = os.environ.get('NOTIFY_SOCKET')
    if not address:
        return
    if address.startswith('@'):
        address = '\0' + address[1:]
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as notify:
        notify.sendto(b'WATCHDOG=1', address)


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def parse_line(line):
    obj = json.loads(line)
    if obj.get('protocol') != 'scada-uart-v1':
        raise ValueError('unknown protocol')
    device = obj.get('device_id', '')
    channel = obj.get('channel', '')
    value = obj.get('value')
    if not isinstance(device, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', device):
        raise ValueError('device_id')
    if not isinstance(channel, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,32}', channel):
        raise ValueError('channel')
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e9:
        raise ValueError('value')
    name = re.sub(r'[\x00-\x1f]', '_', str(obj.get('name', device)))[:100].strip() or device
    return device, channel, float(value), name


def database():
    db = sqlite3.connect(os.path.join(STATE, 'queue.sqlite'), timeout=15)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=FULL')
    db.execute('CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL, rejected TEXT)')
    return db


def enqueue(db, device, channel, value):
    if db.execute('SELECT COUNT(*) FROM queue').fetchone()[0] >= 250000:
        raise RuntimeError('Очередь заполнена: требуется восстановить связь или выгрузить архив')
    payload = dict(record_id=str(uuid.uuid4()), device_id=device, channel=channel, value=value, observed_at=utc())
    db.execute('INSERT INTO queue (payload) VALUES (?)', (json.dumps(payload),))
    db.commit()


def request(base, token, endpoint, body):
    data = json.dumps(body, separators=(',', ':')).encode()
    if len(data) > 16000:
        raise ValueError('request too large')
    req = urllib.request.Request(base + '/api/collector/v1/' + endpoint, data=data,
                                 headers={'Content-Type': 'application/json', 'X-Collector-Key': token})
    # No redirect following: never forward the collector credential to another URL.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
        return json.load(response)


def send_batch(db, base, token):
    rows = db.execute('SELECT id,payload FROM queue WHERE rejected IS NULL ORDER BY id LIMIT 30').fetchall()
    if not rows:
        return False
    records = [json.loads(p) for _, p in rows]
    result = request(base, token, 'batches', {'records': records})
    acks = set(result['ack'])
    rejects = {r['record_id']: r['reason'] for r in result.get('rejected', [])}
    for local_id, payload in rows:
        record_id = json.loads(payload)['record_id']
        if record_id in acks:
            db.execute('DELETE FROM queue WHERE id=?', (local_id,))
        elif record_id in rejects:
            # Keep a recoverable local archive rather than blocking later records.
            db.execute('UPDATE queue SET rejected=? WHERE id=?', (rejects[record_id], local_id))
    db.commit()
    return bool(acks or rejects)


def serial_worker(port):
    global ERROR
    import serial
    db = database()
    try:
        while not STOP.is_set() and os.path.exists(port):
            try:
                with LOCK:
                    baud = BAUD
                with serial.Serial(port, baud, timeout=1, exclusive=True) as uart:
                    data = b''
                    while not STOP.is_set():
                        with LOCK:
                            if baud != BAUD:
                                break
                        data += uart.read(min(uart.in_waiting or 1, 4096))
                        while b'\n' in data:
                            line, data = data.split(b'\n', 1)
                            try:
                                if len(line) > 2048:
                                    continue
                                device, channel, value, name = parse_line(line)
                            except (ValueError, TypeError, AttributeError, UnicodeError):
                                continue
                            with LOCK:
                                identity = (device, channel)
                                if identity in DEVICES or len(DEVICES) < 64:
                                    DEVICES[identity] = dict(device_id=device, channel=channel, name=name, port=port, last_seen=utc())
                                enabled = identity in CHANNELS
                            if enabled:
                                try:
                                    enqueue(db, device, channel, value)
                                except Exception as exc:
                                    ERROR = str(exc)[:200]
                                    logging.error('Queue failure: %s', ERROR)
                        if len(data) > 2048:
                            data = b''
            except (serial.SerialException, OSError) as exc:
                ERROR = str(exc)[:200]
                logging.warning('Serial unavailable: %s', port)
                STOP.wait(5)
    finally:
        db.close()


def discover_ports():
    # Prefer stable USB identities and avoid opening the same underlying port twice.
    candidates = glob.glob('/dev/serial/by-id/*') + glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*')
    candidates += [p for p in os.environ.get('UART_PORTS', '/dev/serial0').split(',') if p]
    found = {}
    for p in candidates:
        if os.path.exists(p) and os.path.realpath(p) not in found:
            found[os.path.realpath(p)] = p
    return list(found.values())[:32]


def serial_manager():
    global PORTS
    workers = {}
    while not STOP.is_set():
        ports = discover_ports()
        with LOCK:
            PORTS = ports
        for port in ports:
            if port not in workers or not workers[port].is_alive():
                workers[port] = threading.Thread(target=serial_worker, args=(port,), daemon=True)
                workers[port].start()
        STOP.wait(5)


def main():
    global BAUD, CHANNELS
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    base = os.environ['SCADA_URL'].rstrip('/')
    token = os.environ['COLLECTOR_KEY']
    if not base.startswith('https://') or not re.fullmatch('[a-f0-9]{64}', token):
        raise ValueError('HTTPS SCADA_URL and collector key required')
    os.makedirs(STATE, exist_ok=True)
    db = database()
    cache_path = os.path.join(STATE, 'config.json')
    def apply(config):
        global BAUD, CHANNELS
        baud = config['baud_rate']
        if baud not in (9600,19200,38400,57600,115200):
            raise ValueError('baud rate')
        with LOCK:
            BAUD = baud
            CHANNELS = {(c['device_id'], c['channel']) for c in config['channels']}
    if os.path.exists(cache_path):
        with open(cache_path, encoding='utf8') as f:
            apply(json.load(f))
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    manager = threading.Thread(target=serial_manager, daemon=True)
    manager.start()
    next_sync = 0
    inventory_cursor = 0
    while not STOP.is_set():
        if not manager.is_alive():
            raise RuntimeError('Serial manager stopped; restarting gateway')
        watchdog()
        try:
            if time.monotonic() >= next_sync:
                with LOCK:
                    devices = list(DEVICES.values())
                    # Rotate bounded inventory pages so all 64 devices fit the 16 KiB API limit.
                    page = devices[inventory_cursor:inventory_cursor+20]
                    inventory_cursor = inventory_cursor+20 if inventory_cursor+20 < len(devices) else 0
                    status = dict(devices=page, ports=PORTS[:], error=ERROR, version=VERSION)
                status['queued'] = db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]
                config = request(base, token, 'sync', status)
                apply(config)
                tmp = cache_path + '.tmp'
                with open(tmp, 'w', encoding='utf8') as f:
                    json.dump(config, f)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, cache_path)
                # Channels restored in the panel can recover previously rejected data.
                for device, channel in CHANNELS:
                    db.execute("UPDATE queue SET rejected=NULL WHERE rejected IS NOT NULL AND json_extract(payload,'$.device_id')=? AND json_extract(payload,'$.channel')=?", (device,channel))
                db.commit()
                next_sync = time.monotonic() + 15
            if not send_batch(db, base, token):
                STOP.wait(0.5)
        except Exception as exc:
            logging.warning('Delivery postponed (%s); data retained locally', type(exc).__name__)
            STOP.wait(5)
    db.close()


if __name__ == '__main__':
    main()
