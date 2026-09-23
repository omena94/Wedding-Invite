"""Isolated guest integration checks. Never connects to the configured wedding DB."""
import os
import re
from datetime import datetime, timedelta

os.environ.update(DATABASE_URL='sqlite://', SECRET_KEY='local-test-secret-key-not-for-deployment-2026',
                  TELEGRAM_BOT_TOKEN='', TELEGRAM_CHAT_ID='', SMTP_USER='', SMTP_PASSWORD='')

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.main import app
from app.models import Rsvp, GuestVerification, SeatObject
from app.routers import rsvp
from app.security import create_token
from app.stage import set_setting
from app.contacts import normalize_phone, phone_column
from app.guest_access import access_token, new_challenge, verify_challenge


@pytest.fixture
def setup(monkeypatch):
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db=Session(engine,expire_on_commit=False)
    app.dependency_overrides[get_db]=lambda:db
    monkeypatch.setattr(rsvp.cache,'invalidate_stats',lambda:None)
    monkeypatch.setattr(rsvp,'send_telegram',lambda *args:None)
    client=TestClient(app)
    yield client,db
    app.dependency_overrides.clear();db.close();engine.dispose()


def create(client,**kwargs):
    return client.post('/api/rsvp',json={'name':'測試賓客','side':'groom','phone':'+886 912-345-678','email':'guest@example.test',**kwargs})


def open_details(db):
    set_setting(db,'phase2_open_at','2020-01-01T00:00:00+08:00');db.commit()


def test_phone_variants_match_existing_data(setup):
    client,db=setup
    for p in ['0912345678','+886 912-345-678','886(912)345678']:
        assert normalize_phone(p)=='0912345678'
    db.add(Rsvp(name='舊紀錄',side='bride',email='legacy@example.test',phone='+886 912-345-678'));db.commit()
    assert db.scalar(select(phone_column(Rsvp.phone)))=='0912345678'
    assert create(client,phone='0912345678').status_code==409


def test_receipt_private_data_and_verification_required(setup):
    client,db=setup
    response=create(client);assert response.status_code==201,response.text
    receipt=response.json()
    assert set(receipt)=={'name','attending','adult_count','child_count','main_course','details_completed','access_token'}
    assert client.post('/api/rsvp/lookup',json={'access_token':receipt['access_token']}).status_code==403
    open_details(db)
    assert client.post('/api/rsvp/lookup',json={'contact':'0912345678'}).status_code==401
    assert client.post('/api/rsvp/details',json={'contact':'0912345678','main_course':{'牛排':1}}).status_code==401
    found=client.post('/api/rsvp/lookup',json={'access_token':receipt['access_token']})
    assert found.json()['name']=='測試賓客'
    assert 'admin_note' not in found.json()
    assert client.post('/api/rsvp/lookup',json={'access_token':'forged'}).status_code==401


def test_exact_meals_and_no_partial_update(setup):
    client,db=setup;receipt=create(client).json();open_details(db)
    for mains in ({},{'牛排':2},{'牛排':-1},{'未知主餐':1}):
        assert client.post('/api/rsvp/details',json={'access_token':receipt['access_token'],'adult_count':1,'main_course':mains}).status_code==400
    response=client.post('/api/rsvp/details',json={'access_token':receipt['access_token'],'adult_count':2,'child_count':1,'children':[{'height':99,'pricing':'free'}],'main_course':{'牛排':1,'素食':1},'kids_meal_count':1})
    assert response.status_code==200,response.text
    assert response.json()['details_completed'] is True
    record=db.scalar(select(Rsvp));assert record.veg_count==1
    assert record.children==[{'height':99,'pricing':'auto'}]


def test_otp_one_time_attempt_limits_and_expiration(setup):
    client,db=setup;create(client);record=db.scalar(select(Rsvp))
    challenge,code=new_challenge(db,record,'test-ip')
    with pytest.raises(Exception) as err:new_challenge(db,record,'test-ip')
    assert err.value.status_code==429
    for i in range(5):
        with pytest.raises(Exception):verify_challenge(db,challenge.id,'999999' if code!='999999' else '000000')
    assert challenge.attempts==5
    with pytest.raises(Exception):verify_challenge(db,challenge.id,code)
    challenge.attempts=0;challenge.expires_at=datetime.utcnow()-timedelta(seconds=1);db.commit()
    with pytest.raises(Exception):verify_challenge(db,challenge.id,code)
    challenge.expires_at=datetime.utcnow()+timedelta(minutes=1);db.commit()
    assert verify_challenge(db,challenge.id,code)==record.id
    with pytest.raises(Exception):verify_challenge(db,challenge.id,code)


def test_email_verification_end_to_end_without_sending(setup,monkeypatch):
    client,db=setup;create(client);open_details(db);sent=[]
    monkeypatch.setattr(rsvp,'smtp_ready',lambda:True)
    monkeypatch.setattr(rsvp,'send_one',lambda to,subject,body:sent.append((to,body)))
    response=client.post('/api/rsvp/verification',json={'contact':'0912345678'})
    assert response.status_code==200,response.text
    assert sent[0][0]=='guest@example.test'
    code=re.search(r'<strong>(\d{6})</strong>',sent[0][1])[1]
    verified=client.post('/api/rsvp/verify',json={'challenge_id':response.json()['challenge_id'],'code':code})
    token=verified.json()['access_token']
    assert client.post('/api/rsvp/lookup',json={'access_token':token}).json()['found']


def test_same_name_requires_phone_and_staff_preview_keeps_gates(setup):
    client,db=setup;create(client)
    db.add(Rsvp(name='測試賓客',side='bride',phone='0987654321',email='another@example.test'));db.commit()
    assert client.post('/api/seat/lookup',json={'query':'測試賓客'}).status_code==403
    headers={'Authorization':'Bearer '+create_token('helper')}
    response=client.post('/api/seat/lookup',json={'query':'測試賓客'},headers=headers)
    assert response.json()['needs_phone'] and not response.json()['found']
    response=client.post('/api/seat/lookup',json={'query':'測試賓客','phone':'+886 912345678'},headers=headers)
    assert response.json()['found']
    assert client.get('/api/stage').json()['seat_open'] is False
    assert client.get('/api/planner/settings',headers=headers).status_code==403


def test_obstacles_and_clearance_persist_and_no_private_notes(setup):
    client,db=setup;headers={'Authorization':'Bearer '+create_token()}
    response=client.patch('/api/planner/seating/canvas',json={'w':1900,'h':1000,'clearance':23},headers=headers)
    assert response.status_code==200
    assert client.get('/api/planner/seating',headers=headers).json()['canvas']['clearance']==23
    for kind in ['wall','column','zone','entrance']:
        response=client.post('/api/planner/seating/objects',json={'kind':kind,'seats':10,'note':'private','meta':{'blocked':True,'private':'secret'}},headers=headers)
        assert response.status_code==201 and response.json()['seats']==0
    from app.seating import public_map
    for obj in public_map(db)['objects']:
        assert 'note' not in obj and 'private' not in obj['meta']


def test_static_path_cannot_escape_build(setup):
    client,_=setup
    response=client.get('/%2e%2e%5cpackage.json')
    assert response.status_code==404


def test_personal_note_only_with_phone_or_email(setup):
    """2026-09-23 當天給賓客的話：後台可寫；賓客用電話或 Email 查才看得到，用姓名查只提示。"""
    client,db=setup;create(client)
    headers={'Authorization':'Bearer '+create_token()}
    rid=client.get('/api/admin/rsvps',headers=headers).json()[0]['id']
    r=client.patch(f'/api/admin/rsvps/{rid}',json={'personal_note':'謝謝你來'},headers=headers)
    assert r.status_code==200 and r.json()['personal_note']=='謝謝你來'
    staff={'Authorization':'Bearer '+create_token('helper')}
    by_name=client.post('/api/seat/lookup',json={'query':'測試賓客'},headers=staff).json()
    assert by_name['found'] and by_name['message']=='' and by_name['message_locked'] is True
    by_phone=client.post('/api/seat/lookup',json={'query':'0912-345-678'},headers=staff).json()
    assert by_phone['found'] and by_phone['message']=='謝謝你來' and by_phone['message_locked'] is False
    by_email=client.post('/api/seat/lookup',json={'query':'GUEST@example.test'},headers=staff).json()
    assert by_email['found'] and by_email['message']=='謝謝你來'
    # 同名時補電話也算驗證
    db.add(Rsvp(name='測試賓客',side='bride',phone='0987654321',email='another@example.test'));db.commit()
    both=client.post('/api/seat/lookup',json={'query':'測試賓客','phone':'0912345678'},headers=staff).json()
    assert both['found'] and both['message']=='謝謝你來'
    # 沒寫的戶：不提示
    client.patch(f'/api/admin/rsvps/{rid}',json={'personal_note':''},headers=headers)
    none=client.post('/api/seat/lookup',json={'query':'0912345678'},headers=staff).json()
    assert none['message']=='' and none['message_locked'] is False
