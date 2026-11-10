#!/usr/bin/env python3
"""Consistent local recovery snapshots, including WAL data. Run as root."""
import datetime
from pathlib import Path
import os
import sqlite3
import tarfile
import tempfile

os.umask(0o077)
target = Path('/var/backups/scada-gateway')
target.mkdir(mode=0o700, parents=True, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
output = target / f'gateway-{stamp}.tar.gz'
partial = output.with_suffix('.partial')
with tempfile.TemporaryDirectory(dir=target) as work:
    snapshot = Path(work) / 'queue.sqlite'
    with sqlite3.connect('file:/var/lib/scada-gateway/queue.sqlite?mode=ro', uri=True, timeout=30) as source:
        with sqlite3.connect(snapshot) as dest:
            source.backup(dest)
            if dest.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('SQLite snapshot integrity check failed')
    with tarfile.open(partial, 'w:gz') as archive:
        archive.add(snapshot, arcname='var/lib/scada-gateway/queue.sqlite')
        for name in ('etc/scada-gateway/gateway.env', 'var/lib/scada-gateway/config.json',
                     'opt/scada-gateway/gateway.py', 'etc/systemd/system/scada-gateway.service'):
            path = Path('/') / name
            if path.is_file():
                archive.add(path, arcname=name)
    os.replace(partial, output)
# Keep only our own completed snapshots, never remove unrelated files.
for expired in sorted(target.glob('gateway-????????-??????.tar.gz'))[:-7]:
    expired.unlink()
print(f'Gateway recovery snapshot: {output}')
