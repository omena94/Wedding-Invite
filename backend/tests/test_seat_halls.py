"""座位圖分廳：每一廳各自排位、賓客只看正式使用的那一廳、萬福廳範本可載入。只用記憶體 SQLite。"""
import os

os.environ.update(DATABASE_URL='sqlite://', SECRET_KEY='local-test-secret-key-not-for-deployment-2026',
                  TELEGRAM_BOT_TOKEN='', TELEGRAM_CHAT_ID='', SMTP_USER='', SMTP_PASSWORD='')

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Rsvp, SeatAssignment, SeatObject
from app.security import create_token
from app.seating import ensure_halls
from app.stage import set_setting


@pytest.fixture
def setup(monkeypatch, tmp_path):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    from app import config
    monkeypatch.setattr(config.settings, 'upload_dir', str(tmp_path))
    client = TestClient(app)
    yield client, db
    app.dependency_overrides.clear()
    db.close()
    engine.dispose()


def _guest(db, name='分廳賓客', phone='0912000111'):
    r = Rsvp(name=name, side='groom', phone=phone, email=f'{phone}@example.test', attending=True, adult_count=1, child_count=0)
    db.add(r)
    db.commit()
    return r


def test_old_layout_moves_into_first_hall_and_keeps_canvas(setup):
    client, db = setup
    # 模擬升級前的資料：桌子沒有 hall_id、畫布大小存在 settings
    set_setting(db, 'seating_canvas_w', '1900')
    set_setting(db, 'seating_canvas_h', '1000')
    set_setting(db, 'seating_clearance', '23')
    r = _guest(db)
    o = SeatObject(kind='round', label='舊桌', seats=10)
    db.add(o)
    db.flush()
    db.add(SeatAssignment(object_id=o.id, seat_index=0, rsvp_id=r.id, person_no=1))
    db.commit()
    hall = ensure_halls(db)
    assert hall.is_active and hall.canvas_w == 1900 and hall.clearance == 23
    db.refresh(o)
    assert o.hall_id == hall.id
    assert db.query(SeatAssignment).one().hall_id == hall.id
    headers = {'Authorization': 'Bearer ' + create_token()}
    layout = client.get('/api/planner/seating', headers=headers).json()
    assert layout['hall']['id'] == hall.id and layout['canvas']['w'] == 1900
    assert layout['summary']['assigned'] == 1


def test_each_hall_seats_separately_and_guest_sees_active_hall(setup):
    client, db = setup
    headers = {'Authorization': 'Bearer ' + create_token()}
    r = _guest(db)
    first = client.get('/api/planner/seating', headers=headers).json()['hall']
    t1 = client.post('/api/planner/seating/objects', json={'kind': 'round', 'label': '原本 1', 'seats': 10}, headers=headers).json()
    second = client.post('/api/planner/seating/halls', json={'name': '萬福廳（空白）'}, headers=headers).json()
    assert second['hall']['name'] == '萬福廳（空白）' and not second['hall']['is_active']
    assert [h['id'] for h in second['halls']] == [first['id'], second['hall']['id']]
    t2 = client.post('/api/planner/seating/objects', json={'kind': 'rect', 'label': 'A1', 'seats': 6, 'hall_id': second['hall']['id']}, headers=headers).json()
    # 同一個人在兩廳各有一個位子，互不影響
    l1 = client.put('/api/planner/seating/assign', json={'object_id': t1['id'], 'seat_index': 0, 'rsvp_id': r.id, 'person_no': 1}, headers=headers).json()
    assert l1['summary']['assigned'] == 1
    l2 = client.put('/api/planner/seating/assign', json={'object_id': t2['id'], 'seat_index': 2, 'rsvp_id': r.id, 'person_no': 1}, headers=headers).json()
    assert l2['hall']['id'] == second['hall']['id'] and l2['summary']['assigned'] == 1
    assert client.get('/api/planner/seating', params={'hall': first['id']}, headers=headers).json()['summary']['assigned'] == 1
    # 賓客查桌看的是正式使用的第一廳
    set_setting(db, 'seat_open', '1')
    db.commit()
    view = client.post('/api/seat/lookup', json={'query': '分廳賓客'}).json()
    assert view['found'] and view['seats'][0]['table_label'] == '原本 1'
    # 改成正式使用第二廳後，賓客看到的就換成 A1
    client.patch(f"/api/planner/seating/halls/{second['hall']['id']}", json={'is_active': True}, headers=headers)
    view = client.post('/api/seat/lookup', json={'query': '分廳賓客'}).json()
    assert view['seats'][0]['table_label'] == 'A1' and view['seats'][0]['seat_no'] == 3
    # 一鍵安排只動指定的廳；清空也是
    cleared = client.delete('/api/planner/seating/assignments', params={'hall': first['id']}, headers=headers).json()
    assert cleared['summary']['assigned'] == 0
    assert client.get('/api/planner/seating', params={'hall': second['hall']['id']}, headers=headers).json()['summary']['assigned'] == 1
    # 不能刪到剩零廳；刪掉正式使用的廳會換成另一廳
    assert client.delete(f"/api/planner/seating/halls/{second['hall']['id']}", headers=headers).json()['hall']['id'] == first['id']
    assert client.delete(f"/api/planner/seating/halls/{first['id']}", headers=headers).status_code == 400


def test_wanfu_preset_has_twenty_segments_and_background(setup):
    client, db = setup
    headers = {'Authorization': 'Bearer ' + create_token()}
    before = client.get('/api/planner/seating', headers=headers).json()
    layout = client.post('/api/planner/seating/halls/preset', json={'key': 'wanfu'}, headers=headers).json()
    assert layout['hall']['name'] == '萬福廳' and layout['hall']['has_bg'] and not layout['hall']['is_active']
    tables = [o for o in layout['objects'] if o['kind'] == 'rect']
    assert len(tables) == 20 and all(o['seats'] == 6 for o in tables)
    assert layout['summary']['seats_total'] == 120
    assert {o['kind'] for o in layout['objects']} >= {'stage', 'entrance', 'wall', 'column', 'zone', 'label'}
    # 原本的廳沒被動到
    assert client.get('/api/planner/seating', params={'hall': before['hall']['id']}, headers=headers).json()['summary']['tables'] == before['summary']['tables']
    bg = client.get(f"/api/planner/seating/halls/{layout['hall']['id']}/background", headers=headers)
    assert bg.status_code == 200 and bg.headers['content-type'].startswith('image/')
    # 幫手看不到後台的廳管理，但能讀唯讀版
    helper = {'Authorization': 'Bearer ' + create_token('helper')}
    assert client.get('/api/admin/seating', params={'hall': layout['hall']['id']}, headers=helper).json()['hall']['name'] == '萬福廳'
    assert client.post('/api/planner/seating/halls/preset', json={'key': 'wanfu'}, headers=helper).status_code == 403
