import importlib.util
import json
import os
import tempfile
import unittest
import threading
import time
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gateway', os.path.join(os.path.dirname(__file__), 'gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class GatewayTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'posix', 'Linux pseudo UART test')
    def test_fragmented_uart_messages_are_committed(self):
        import serial
        master, slave = os.openpty()
        worker = None
        try:
            with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__)) as state, patch.object(gateway, 'STATE', state), patch.object(gateway, 'CHANNELS', {('esp32_001','current_1')}):
                gateway.STOP.clear()
                worker = threading.Thread(target=gateway.serial_worker, args=(os.ttyname(slave),))
                worker.start()
                time.sleep(0.3)
                payload = json.dumps(dict(protocol='scada-uart-v1',device_id='esp32_001',channel='current_1',value=12.0)).encode()+b'\n'
                os.write(master, b'ESP boot log\n'+payload[:20])
                time.sleep(0.1)
                os.write(master, payload[20:]+payload)
                db = gateway.database()
                deadline=time.monotonic()+5
                while time.monotonic()<deadline:
                    if db.execute('SELECT COUNT(*) FROM queue').fetchone()[0] == 2: break
                    time.sleep(0.05)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM queue').fetchone()[0],2)
                gateway.STOP.set(); worker.join(3); self.assertFalse(worker.is_alive())
                db.close()
        finally:
            gateway.STOP.set()
            if worker: worker.join(3)
            os.close(master); os.close(slave)
            gateway.STOP.clear()

    def test_esp32_identity_validation(self):
        line = dict(protocol='scada-uart-v1', device_id='esp32_001', channel='current_1', value=12.3)
        self.assertEqual(gateway.parse_line(json.dumps(line))[:3], ('esp32_001','current_1',12.3))
        for value in (True, float('nan'), float('inf'), '12'):
            with self.assertRaises(ValueError):
                gateway.parse_line(json.dumps({**line,'value':value}))
        with self.assertRaises(ValueError):
            gateway.parse_line(json.dumps({**line,'device_id':'../etc/passwd'}))

    def test_retry_restart_ack_and_rejected_retention(self):
        with tempfile.TemporaryDirectory(dir=os.path.dirname(__file__)) as state, patch.object(gateway, 'STATE', state):
            db = gateway.database()
            gateway.enqueue(db,'esp32_001','current_1',12)
            original = db.execute('SELECT payload FROM queue').fetchone()[0]
            with patch.object(gateway, 'request', side_effect=OSError('offline')):
                with self.assertRaises(OSError): gateway.send_batch(db,'https://example.test','key')
            db.close()
            db = gateway.database()
            self.assertEqual(db.execute('SELECT payload FROM queue').fetchone()[0],original)
            record_id=json.loads(original)['record_id']
            with patch.object(gateway,'request',return_value={'ack':[],'rejected':[{'record_id':record_id,'reason':'unassigned'}]}):
                gateway.send_batch(db,'https://example.test','key')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM queue WHERE rejected IS NOT NULL').fetchone()[0],1)
            db.execute('UPDATE queue SET rejected=NULL'); db.commit()
            with patch.object(gateway,'request',return_value={'ack':[record_id]}):
                gateway.send_batch(db,'https://example.test','key')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM queue').fetchone()[0],0)
            db.close()

if __name__=='__main__': unittest.main()
