"""Provision one board key on the VPS and transfer it directly to DietPi."""
from pathlib import Path
import json
import paramiko

root = Path(__file__).resolve().parents[1]
def connect(host, key, known):
    c = paramiko.SSHClient()
    c.load_host_keys(str(root / '.server-access' / known))
    c.set_missing_host_key_policy(paramiko.RejectPolicy())
    c.connect(host, username='root', key_filename=str(root / '.server-access' / key),
              look_for_keys=False, allow_agent=False, timeout=15)
    return c

vps = connect('147.45.238.163', 'scada-deploy', 'known_hosts')
pi = connect('192.168.3.32', 'raspberry-deploy', 'pi_known_hosts')
try:
    with pi.open_sftp() as files:
        try:
            files.stat('/etc/scada-gateway/gateway.env')
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError('Board already provisioned; preserve its existing key')
    source = r'''
const mysql=require('mysql2/promise'), crypto=require('node:crypto');
(async()=>{
 const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 const name='Raspberry Pi 2 DietPi (192.168.3.32)';
 const [prior]=await db.execute('SELECT id FROM collectors WHERE name=?',[name]);
 if(prior.length) throw new Error('Collector name already exists; do not rotate its key automatically');
 const token=crypto.randomBytes(32).toString('hex');
 const [row]=await db.execute('INSERT INTO collectors(name,token_hash) VALUES (?,?)',[name,crypto.createHash('sha256').update(token).digest('hex')]);
 console.log(JSON.stringify({id:row.insertId,token}));
 await db.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
'''
    stdin, stdout, stderr = vps.exec_command('/usr/local/bin/scada exec -T backend node', timeout=30)
    stdin.write(source); stdin.flush(); stdin.channel.shutdown_write()
    result = stdout.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError(stderr.read().decode())
    data = json.loads(result)
    config = ('SCADA_URL=https://scada.lut1x1337.ru:9443\n'
              f'COLLECTOR_KEY={data["token"]}\nUART_PORTS=/dev/serial0\n')
    for client, location in [(pi, '/root/scada-install/gateway.env')]:
        with client.open_sftp() as files:
            with files.open(location, 'w') as out:
                out.write(config)
            files.chmod(location, 0o600)
    # Protected key backup lives on the VPS; no secrets are printed to the chat.
    _, out, _ = vps.exec_command('install -d -m 700 /root/scada-collectors')
    if out.channel.recv_exit_status():
        raise RuntimeError('Could not prepare protected VPS key backup')
    with vps.open_sftp() as files:
        with files.open('/root/scada-collectors/pi2-dietpi.env', 'w') as out:
            out.write(config)
        files.chmod('/root/scada-collectors/pi2-dietpi.env', 0o600)
    print(f'Created collector id={data["id"]}; key transferred directly to DietPi and backed up privately on VPS')
finally:
    pi.close(); vps.close()
