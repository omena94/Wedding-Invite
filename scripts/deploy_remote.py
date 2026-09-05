"""在 EC2 以 sudo python3 執行；先備份，再替換 app/dist，失敗自動還原程式。

參數：部署 tar.gz、版本標記。部署包只包含 backend/app、requirements.txt、frontend/dist。
正式機根目錄由環境變數 WEDDING_DEPLOY_ROOT 指定，不讀取或輸出任何密碼。
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from datetime import datetime, timezone


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    root = Path(os.environ['WEDDING_DEPLOY_ROOT']).resolve(strict=True)
    bundle = Path(sys.argv[1]).resolve(strict=True)
    revision = sys.argv[2]
    if not re.fullmatch(r'[a-zA-Z0-9._-]{1,80}', revision):
        raise ValueError('Invalid revision')
    targets = [root/'backend/app', root/'frontend/dist']
    requirements = root/'backend/requirements.txt'
    python = root/'backend/.venv/bin/python'
    for target in [*targets, requirements]:
        if not target.resolve(strict=True).is_relative_to(root):
            raise ValueError('Target escapes deployment directory')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+revision
    release = root.parent/(root.name+'-releases')/stamp
    release.mkdir(parents=True, mode=0o700)
    release.chmod(0o700)
    staged = release/'staged'
    staged.mkdir()
    with tarfile.open(bundle) as archive:
        for item in archive.getmembers():
            if not (item.name.startswith('backend/app/') or item.name=='backend/app' or item.name=='backend/requirements.txt' or item.name.startswith('frontend/dist/') or item.name=='frontend/dist'):
                raise ValueError('Unexpected deployment file: '+item.name)
        archive.extractall(staged, filter='data')
    for expected in ['backend/app/main.py', 'frontend/dist/index.html', 'frontend/dist/seat.html', 'frontend/dist/planner.html']:
        if not (staged/expected).is_file():
            raise ValueError('Incomplete release: '+expected)
    run(str(python), '-m', 'compileall', '-q', str(staged/'backend/app'))
    run(str(python), '-m', 'pip', 'install', '-q', '-r', str(staged/'backend/requirements.txt'))
    with tarfile.open(release/'code-and-uploads.tar.gz', 'w:gz') as backup:
        for relative in ['backend/app', 'backend/requirements.txt', 'frontend/dist', 'backend/uploads']:
            backup.add(root/relative, arcname=relative)
    with (release/'database.dump').open('wb') as output:
        run('sudo', '-u', 'postgres', 'pg_dump', '-Fc', 'wedding', stdout=output)
    old_requirements = requirements.read_bytes()
    changed = []
    run('systemctl', 'stop', 'wedding')
    try:
        # 不含新驗證碼表；比較既有資料，確認程式更新沒有更改賓客與座位。
        fingerprint = "from app.database import engine; from sqlalchemy import MetaData,select; import hashlib,json; m=MetaData(); m.reflect(engine); c=engine.connect(); print(hashlib.sha256(json.dumps({t.name:[dict(r) for r in c.execute(select(t).order_by(*t.primary_key.columns)).mappings()] for t in m.sorted_tables if t.name!='guest_verifications'},default=str,sort_keys=True).encode()).hexdigest())"
        before = run(str(python), '-c', fingerprint, cwd=root/'backend', capture_output=True, text=True).stdout.strip()
        for target in targets:
            previous = release/('previous-'+target.name)
            target.rename(previous)
            changed.append((target, previous))
            (staged/target.relative_to(root)).rename(target)
            run('chown', '-R', 'ubuntu:ubuntu', str(target))
        shutil.copyfile(staged/'backend/requirements.txt', requirements)
        run('chown', 'ubuntu:ubuntu', str(requirements))
        run('systemctl', 'start', 'wedding')
        for attempt in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2) as response:
                    if json.load(response).get('status')=='ok':
                        break
            except (OSError, ValueError):
                time.sleep(1)
        else:
            raise RuntimeError('Health check failed')
        after = run(str(python), '-c', fingerprint, cwd=root/'backend', capture_output=True, text=True).stdout.strip()
        manifest = dict(revision=revision, bundle_sha256=hashlib.sha256(bundle.read_bytes()).hexdigest(), health='ok', existing_data_unchanged=before==after)
        (release/'release.json').write_text(json.dumps(manifest, indent=2)+'\n')
        print(json.dumps({**manifest, 'backup': str(release)}))
    except BaseException:
        run('systemctl', 'stop', 'wedding')
        for target, previous in reversed(changed):
            if target.exists():
                target.rename(release/('failed-'+target.name))
            previous.rename(target)
        requirements.write_bytes(old_requirements)
        run('systemctl', 'start', 'wedding')
        raise


if __name__=='__main__':
    main()
