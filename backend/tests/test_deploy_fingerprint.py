"""驗證部署前固定資料表集合，新增功能建表不會誤報、既有資料變更仍會被抓到。"""
import ast
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys


def test_deploy_fingerprint_ignores_only_new_tables(tmp_path):
    root = Path(__file__).resolve().parents[2]
    module = ast.parse((root / "scripts/deploy_remote.py").read_text(encoding="utf-8"))
    script = next(ast.literal_eval(n.value) for n in ast.walk(module) if isinstance(n, ast.Assign)
                  and any(isinstance(t, ast.Name) and t.id == "fingerprint" for t in n.targets))
    dbfile = tmp_path / "deployment.sqlite3"
    with sqlite3.connect(dbfile) as db:
        db.execute("CREATE TABLE existing_rows (id INTEGER PRIMARY KEY, note TEXT)")
        db.execute("INSERT INTO existing_rows VALUES (1, 'unchanged')")
    env = {**os.environ, "DATABASE_URL": "sqlite:///" + dbfile.as_posix(),
           "SECRET_KEY": "isolated-deployment-fingerprint-test-only"}
    def fingerprint(tables=None):
        args = [sys.executable, "-c", script]
        if tables is not None:
            args.append(json.dumps(tables))
        return json.loads(subprocess.check_output(args, cwd=root / "backend", env=env, text=True))
    before = fingerprint()
    with sqlite3.connect(dbfile) as db:
        db.execute("CREATE TABLE new_gift_feature (id INTEGER PRIMARY KEY)")
    assert fingerprint(before["tables"]) == before
    with sqlite3.connect(dbfile) as db:
        db.execute("UPDATE existing_rows SET note = 'changed'")
    assert fingerprint(before["tables"])["hash"] != before["hash"]
