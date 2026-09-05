"""Isolated, temporary preview. Login at /admin: preview-wedding-only.
Run backend/.venv/Scripts/python.exe scripts/preview_local.py after frontend build.
Only binds loopback, uses fictional guests and disables all outgoing notifications.
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))

def main():
    with tempfile.TemporaryDirectory(prefix='wedding-preview-') as folder:
        os.environ.update(DATABASE_URL='sqlite:///'+(Path(folder)/'preview.sqlite3').as_posix(), REDIS_URL='redis://127.0.0.1:1/0', SECRET_KEY='local-preview-isolated-secret-key-2026-only', ADMIN_PASSWORD='preview-wedding-only', HELPER_PASSWORD='preview-helper-only', TELEGRAM_BOT_TOKEN='',TELEGRAM_CHAT_ID='',SMTP_USER='',SMTP_PASSWORD='',UPLOAD_DIR=folder)
        from app.database import init_db,SessionLocal,engine
        from app.models import Rsvp,SeatObject,SeatAssignment
        from app.stage import set_setting
        init_db()
        with SessionLocal() as db:
            guest=Rsvp(name='預覽賓客',side='groom',email='preview@example.test',phone='0912345678',adult_count=2)
            db.add(guest);db.flush()
            for x,label in [(850,'中央入口'),(150,'左側入口'),(1550,'右側入口')]:
                db.add(SeatObject(kind='entrance',label=label,x=x,y=900,w=140,h=60,seats=0))
            db.add(SeatObject(kind='stage',label='LED 舞台',x=680,y=10,w=540,h=90,seats=0))
            for i,(x,y) in enumerate([(240,230),(550,230),(1150,230),(1460,230),(240,550),(550,550),(1150,550),(1460,550)]):
                table=SeatObject(kind='round',label=f'{i+1:02d} 桌',x=x,y=y,w=110,h=110,seats=10)
                db.add(table);db.flush()
                if i==1:
                    for n in (1,2):db.add(SeatAssignment(object_id=table.id,seat_index=n+3,rsvp_id=guest.id,person_no=n))
            db.add(SeatObject(kind='zone',label='不可通行',x=830,y=370,w=150,h=170,seats=0,meta_json='{"blocked":true}'))
            for key,value in [('seating_canvas_w','1900'),('seating_canvas_h','1000'),('seating_clearance','23')]:set_setting(db,key,value)
            db.commit()
        import uvicorn
        try:uvicorn.run('app.main:app',host='127.0.0.1',port=8010)
        finally:engine.dispose()

if __name__=='__main__':main()
