"""資料表。

賓客：rsvps（兩階段設計。Phase 1 意願調查先建立紀錄；Phase 2 詳細調查用 Email/電話找到同一筆再補上細節）
設定：settings（key-value：第二階段開放時間、婚禮資訊文案、桌次查詢開關…）
籌備：vendors 廠商、quotes 報價、expenses 花費、payments 付款期程、files 檔案、tasks 待辦
"""
import json
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


class Setting(Base):
    """系統設定（key-value）。"""
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


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
    is_test: Mapped[bool] = mapped_column(Boolean, default=False)  # 測試資料，不計入統計/匯出

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    details_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# =====================================================================
# 籌備後台（只有新人看得到）
# =====================================================================

class Vendor(Base):
    """廠商：攝影、禮服、場地、喜餅…"""
    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(30), default="其他", index=True)
    contact_name: Mapped[str] = mapped_column(String(100), default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    line_id: Mapped[str] = mapped_column(String(100), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    website: Mapped[str] = mapped_column(String(300), default="")
    # candidate 候選 / quoted 已報價 / signed 已簽約 / done 已完成 / rejected 放棄
    status: Mapped[str] = mapped_column(String(20), default="candidate", index=True)
    rating: Mapped[int] = mapped_column(Integer, default=0)  # 0~5
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    quotes: Mapped[list["Quote"]] = relationship(
        back_populates="vendor", cascade="all, delete-orphan", order_by="Quote.sort_order"
    )
    expenses: Mapped[list["Expense"]] = relationship(back_populates="vendor")
    files: Mapped[list["FileAsset"]] = relationship(back_populates="vendor")
    tasks: Mapped[list["Task"]] = relationship(back_populates="vendor")


class Quote(Base):
    """廠商報價項目（比價用）。一家禮服工作室 = 三筆：5 小時方案、9 小時方案、宴客款。"""
    __tablename__ = "quotes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("vendors.id", ondelete="CASCADE"), index=True)
    item: Mapped[str] = mapped_column(String(100))
    price: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(String(300), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    vendor: Mapped["Vendor"] = relationship(back_populates="quotes")


class Expense(Base):
    """花費項目。有預算與合約金額；實付由 payments 加總。"""
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vendor_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    category: Mapped[str] = mapped_column(String(30), default="其他", index=True)
    title: Mapped[str] = mapped_column(String(150))
    budget_amount: Mapped[int] = mapped_column(Integer, default=0)
    contract_amount: Mapped[int] = mapped_column(Integer, default=0)
    paid_by: Mapped[str] = mapped_column(String(20), default="shared")  # groom/bride/shared/family
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    vendor: Mapped["Vendor | None"] = relationship(back_populates="expenses")
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="expense", cascade="all, delete-orphan", order_by="Payment.sort_order"
    )


class Payment(Base):
    """付款期程：定金、拍攝當日、尾款… paid_date 為空 = 未付。"""
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(100))
    amount: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    paid_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    method: Mapped[str] = mapped_column(String(30), default="")   # ATM / 現金 / 信用卡 / LINE Pay…
    payer: Mapped[str] = mapped_column(String(20), default="")    # groom / bride / shared / family
    note: Mapped[str] = mapped_column(String(300), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    expense: Mapped["Expense"] = relationship(back_populates="payments")


class FileAsset(Base):
    """上傳檔案：合約、報價單、收據、婚紗照。實體檔存在 upload_dir，DB 只記 metadata。"""
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))       # 原始檔名
    stored_name: Mapped[str] = mapped_column(String(80), unique=True)  # 磁碟上的檔名（uuid + 副檔名）
    mime: Mapped[str] = mapped_column(String(100), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(20), default="doc")  # doc 文件 / receipt 收據 / photo 照片
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)  # 只有婚紗照分享頁會用到
    vendor_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    expense_id: Mapped[int | None] = mapped_column(
        ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    payment_id: Mapped[int | None] = mapped_column(
        ForeignKey("payments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    note: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    vendor: Mapped["Vendor | None"] = relationship(back_populates="files")


class Task(Base):
    """待辦與里程碑。"""
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="task")  # task 待辦 / milestone 里程碑
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    assignee: Mapped[str] = mapped_column(String(20), default="both")  # groom / bride / both
    vendor_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    note: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    vendor: Mapped["Vendor | None"] = relationship(back_populates="tasks")
