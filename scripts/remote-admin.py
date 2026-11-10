"""SSH deployment helper. Credentials stay in .server-access, never in source."""
import argparse
from pathlib import Path
import sys
import paramiko

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('host', choices=['pi', 'vps'])
p.add_argument('--command')
p.add_argument('--script')
p.add_argument('--upload', nargs=2, action='append', default=[])
p.add_argument('--download', nargs=2, action='append', default=[])
args = p.parse_args()
c = paramiko.SSHClient()
known = ROOT / '.server-access' / ('pi_known_hosts' if args.host == 'pi' else 'known_hosts')
if known.exists():
    c.load_host_keys(str(known))
# The Pi key was pinned during initial, user-authorized setup.
c.set_missing_host_key_policy(paramiko.RejectPolicy())
address = '192.168.3.32' if args.host == 'pi' else '147.45.238.163'
key = ROOT / '.server-access' / ('raspberry-deploy' if args.host == 'pi' else 'scada-deploy')
c.connect(address, username='root', key_filename=str(key), look_for_keys=False, allow_agent=False, timeout=15)
c.get_transport().set_keepalive(15)
try:
    if args.upload or args.download:
        with c.open_sftp() as sftp:
            for local, remote in args.upload:
                sftp.put(local, remote)
            for remote, local in args.download:
                sftp.get(remote, local)
    command = args.command
    if args.script:
        command = 'sh -se'
    if command:
        stdin, stdout, stderr = c.exec_command(command, timeout=900)
        if args.script:
            stdin.write(Path(args.script).read_text(encoding='utf8'))
            stdin.flush()
            stdin.channel.shutdown_write()
        # Continuously drain both streams, including lengthy package installs.
        import time
        channel = stdout.channel
        while True:
            while channel.recv_ready():
                sys.stdout.buffer.write(channel.recv(16384)); sys.stdout.buffer.flush()
            while channel.recv_stderr_ready():
                sys.stderr.buffer.write(channel.recv_stderr(16384)); sys.stderr.buffer.flush()
            if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                break
            time.sleep(0.05)
        sys.exit(channel.recv_exit_status())
finally:
    c.close()
