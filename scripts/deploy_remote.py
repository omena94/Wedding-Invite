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
    # 大螢幕歌單的音檔（uploads/wall/，整份歌單約 300 MB）不放進每次部署的備份：主機硬碟只有 7 GB，
    # 每部署一次就多一份很快會滿。歌名、歌詞、節拍分析都在資料庫裡（下面的 pg_dump 會備份），音檔可以重新上傳。
    skip_wall = lambda info: None if info.name == 'backend/uploads/wall' or info.name.startswith('backend/uploads/wall/') else info
    with tarfile.open(release/'code-and-uploads.tar.gz', 'w:gz') as backup:
        for relative in ['backend/app', 'backend/requirements.txt', 'frontend/dist', 'backend/uploads']:
            backup.add(root/relative, arcname=relative, filter=skip_wall)
    with (release/'database.dump').open('wb') as output:
        run('sudo', '-u', 'postgres', 'pg_dump', '-Fc', 'wedding', stdout=output)
    old_requirements = requirements.read_bytes()
    changed = []
    run('systemctl', 'stop', 'wedding')
    try:
        # 固定部署前的資料表與欄位集合：新功能建表、既有的表加欄位（init_db 的 ADD COLUMN），都不應被誤判為既有資料異動；
        # 部署前就有的欄位只要有一格被改到就擋下來還原。欄位被刪掉或改名時 select 會失敗，一樣還原。
        fingerprint = "from app.database import engine; from sqlalchemy import MetaData,select; import hashlib,json,sys; m=MetaData(); m.reflect(engine); spec=json.loads(sys.argv[1]) if len(sys.argv)>1 else {t.name:sorted(col.name for col in t.columns) for t in m.sorted_tables if t.name!='guest_verifications'}; c=engine.connect(); data={name:[dict(r) for r in c.execute(select(*[m.tables[name].c[col] for col in cols]).order_by(*m.tables[name].primary_key.columns)).mappings()] for name,cols in sorted(spec.items())}; print(json.dumps({'tables':spec,'hash':hashlib.sha256(json.dumps(data,default=str,sort_keys=True).encode()).hexdigest()}))"
        before = json.loads(run(str(python), '-c', fingerprint, cwd=root/'backend', capture_output=True, text=True).stdout)
        for target in targets:
            previous = release/('previous-'+target.name)
            target.rename(previous)
            changed.append((target, previous))
            (staged/target.relative_to(root)).rename(target)
            run('chown', '-R', 'ubuntu:ubuntu', str(target))
        shutil.copyfile(staged/'backend/requirements.txt', requirements)
        run('chown', 'ubuntu:ubuntu', str(requirements))
        run(str(python), '-c', 'from app.database import init_db; init_db()', cwd=root/'backend', capture_output=True, text=True)
        # 尚未恢復流量前比較，避免把真正賓客剛送出的回覆誤認為部署改動。
        after = json.loads(run(str(python), '-c', fingerprint, json.dumps(before['tables']), cwd=root/'backend', capture_output=True, text=True).stdout)
        if before != after:
            raise RuntimeError('Existing data changed during deployment; restoring previous code')
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
