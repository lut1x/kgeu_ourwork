"""Hardware-hosted pseudo-UART -> SQLite -> verified HTTPS -> VPS MySQL check.

Uses a temporary collector/group/sensor, cleaned in finally. No real readings
are synthesized into production sensor channels. Requires local Paramiko.
"""
from pathlib import Path
import json
import paramiko

ROOT = Path(__file__).resolve().parents[1]
def connect(address, key, known):
    c = paramiko.SSHClient()
    c.load_host_keys(str(ROOT / '.server-access' / known))
    c.set_missing_host_key_policy(paramiko.RejectPolicy())
    c.connect(address, username='root', key_filename=str(ROOT / '.server-access' / key), look_for_keys=False, allow_agent=False, timeout=15)
    return c

def run(c, command, source):
    stdin, stdout, stderr = c.exec_command(command, timeout=60)
    stdin.write(source); stdin.flush(); stdin.channel.shutdown_write()
    out = stdout.read().decode()
    error = stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error or out)
    return out

vps = connect('147.45.238.163', 'scada-deploy', 'known_hosts')
pi = connect('192.168.3.32', 'raspberry-deploy', 'pi_known_hosts')
db_prelude = """
const mysql=require('mysql2/promise'),crypto=require('node:crypto');
(async()=>{
const db=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,timezone:'Z'});
"""
db_end = "await db.end();})().catch(e=>{console.error(e.message);process.exit(1)});"
def sql(source):
    return run(vps, '/usr/local/bin/scada exec -T backend node', db_prelude + source + db_end)

fixture = None
try:
    fixture = json.loads(sql("""
const suffix=crypto.randomBytes(8).toString('hex'),token=crypto.randomBytes(32).toString('hex');
await db.beginTransaction();
const [g]=await db.execute('INSERT INTO sensor_groups(name) VALUES (?)',['Installation self-test '+suffix]);
const [s]=await db.execute('INSERT INTO sensors(group_id,sensor_key,name,kind,unit,min_value,max_value) VALUES (?,?,?,?,?,?,?)',[g.insertId,'selftest_'+suffix,'Temporary test','pressure','bar',0,10]);
const [c]=await db.execute('INSERT INTO collectors(name,token_hash) VALUES (?,?)',['Temporary installation test '+suffix,crypto.createHash('sha256').update(token).digest('hex')]);
await db.execute('INSERT INTO collector_channels VALUES (?,?,?,?,?,?)',[c.insertId,'selftest_esp32','current_1',s.insertId,4,20]);
await db.commit();
console.log(JSON.stringify({group:g.insertId,sensor:s.insertId,collector:c.insertId,token}));
"""))
    source = 'fixture=' + repr(fixture) + '\n' + r'''
import sys,os,tempfile,threading,time,json
sys.path.insert(0,'/opt/scada-gateway')
import gateway,serial
base='https://scada.lut1x1337.ru:9443'
config=gateway.request(base,fixture['token'],'sync',dict(devices=[],ports=[],queued=0,version='installation-test'))
assert config['channels']==[{'device_id':'selftest_esp32','channel':'current_1'}]
master,slave=os.openpty()
worker=None
try:
 with tempfile.TemporaryDirectory() as state:
  gateway.STATE=state
  gateway.CHANNELS={('selftest_esp32','current_1')}
  opened=threading.Event()
  original_serial=serial.Serial
  def tracked_serial(*args,**kwargs):
   uart=original_serial(*args,**kwargs)
   opened.set()
   return uart
  serial.Serial=tracked_serial
  worker=threading.Thread(target=gateway.serial_worker,args=(os.ttyname(slave),))
  worker.start()
  assert opened.wait(20),'UART did not open'
  line=json.dumps(dict(protocol='scada-uart-v1',device_id='selftest_esp32',channel='current_1',value=12.0)).encode()+b'\n'
  os.write(master,b'ESP boot log'+bytes([10])+line[:24]);time.sleep(.1);os.write(master,line[24:])
  db=gateway.database()
  deadline=time.monotonic()+8
  while time.monotonic()<deadline:
   rows=db.execute('SELECT payload FROM queue').fetchall()
   if rows: break
   time.sleep(.05)
  assert len(rows)==1,rows
  payload=json.loads(rows[0][0])
  try:
   gateway.send_batch(db,'https://127.0.0.1:1',fixture['token'])
  except OSError: pass
  else: raise AssertionError('Offline endpoint unexpectedly accepted data')
  db.close();db=gateway.database()
  assert db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]==1
  assert gateway.send_batch(db,base,fixture['token'])
  assert db.execute('SELECT COUNT(*) FROM queue').fetchone()[0]==0
  ack=gateway.request(base,fixture['token'],'batches',{'records':[payload]})
  assert ack['ack']==[payload['record_id']]
  db.close()
  print(json.dumps({'record':payload['record_id'],'observed_at':payload['observed_at'],'uart':True,'offline_retention':True,'sqlite_reopen':True,'https_ack':True,'duplicate_retry':True}))
finally:
 gateway.STOP.set()
 if worker: worker.join(4)
 os.close(master);os.close(slave)
'''
    result = json.loads(run(pi, 'python3 -', source))
    check = json.loads(sql(f"""
const [rows]=await db.execute('SELECT value,created_at FROM sensor_samples WHERE sensor_id=?',[{fixture['sensor']}]);
if(rows.length!==1 || rows[0].value!==5 || rows[0].created_at.toISOString()!=={json.dumps(result['observed_at'])}) throw Error('VPS sample, scaling, timestamp or deduplication mismatch');
console.log(JSON.stringify({{sample_count:rows.length,value_bar:rows[0].value,original_time:rows[0].created_at.toISOString()}}));
"""))
    print(json.dumps({'raspberry':result,'vps':check}))
finally:
    if fixture:
        sql(f"""
const cid={fixture['collector']},sid={fixture['sensor']},gid={fixture['group']};
await db.beginTransaction();
for(const table of ['collector_records','collector_channels','collector_devices']) await db.execute('DELETE FROM '+table+' WHERE collector_id=?',[cid]);
await db.execute('DELETE FROM collectors WHERE id=?',[cid]);
await db.execute('DELETE FROM sensor_samples WHERE sensor_id=?',[sid]);
await db.execute('DELETE FROM sensors WHERE id=?',[sid]);
await db.execute('DELETE FROM sensor_groups WHERE id=?',[gid]);
await db.commit();
""")
        print('Temporary test collector, sensor, group and samples removed')
    pi.close();vps.close()
