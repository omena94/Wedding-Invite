"""資料表：兩階段設計。
Phase 1（意願調查）先建立紀錄；Phase 2（詳細調查）用 Email/電話找到同一筆再補上細節。
"""
import json
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


class Rsvp(Base):
    __tablename__ = "rsvps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(32), default=_uuid, unique=True, index=True)

    # ===== Phase 1：意願調查（先統計人數）=====
    name: Mapped[str] = mapped_column(String(100))
    side: Mapped[str] = mapped_column(String(10))              # 'groom' 男方 / 'bride' 女方
    email: Mapped[str] = mapped_column(String(200), default="", index=True)
    phone: Mapped[str] = mapped_column(String(50), default="", index=True)
    attending: Mapped[bool] = mapped_column(Boolean, default=True)
    date_preference: Mapped[str] = mapped_column(String(10), default="both")  # both / 0306 / 0313
    adult_count: Mapped[int] = mapped_column(Integer, default=1)
    child_count: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(Text, default="")     # 想說的話

    # ===== Phase 2：詳細調查（日期確定後才填）=====
    details_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    baby_chair_count: Mapped[int] = mapped_column(Integer, default=0)
    veg_count: Mapped[int] = mapped_column(Integer, default=0)      # 由主餐「素食」份數帶入
    veg_type: Mapped[str] = mapped_column(String(30), default="無")
    dietary_note: Mapped[str] = mapped_column(String(300), default="")
    main_course_json: Mapped[str] = mapped_column(Text, default="{}")  # 主餐份數 {"牛排":2,...}
    kids_meal_count: Mapped[int] = mapped_column(Integer, default=0)   # 兒童餐點份數
    remark: Mapped[str] = mapped_column(String(500), default="")       # 賓客備註

    @property
    def main_course(self) -> dict:
        try:
            data = json.loads(self.main_course_json or "{}")
            return {k: int(v) for k, v in data.items() if v}
        except (ValueError, TypeError):
            return {}

    # ===== 後台管理 =====
    manage_status: Mapped[str] = mapped_column(String(20), default="new")  # new/contacted/seated
    table_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    admin_note: Mapped[str] = mapped_column(String(300), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    details_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
