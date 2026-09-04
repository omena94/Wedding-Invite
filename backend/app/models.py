"""資料表。

賓客：rsvps（兩階段設計。Phase 1 意願調查先建立紀錄；Phase 2 詳細調查用 Email/電話找到同一筆再補上細節）
設定：settings（key-value：第二階段開放時間、婚禮資訊文案、桌次查詢開關…）
籌備：vendors 廠商、quotes 報價、expenses 花費、payments 付款期程、files 檔案、tasks 待辦
"""
import json
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
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
    # 每個小孩的資料：[{"height": 95, "pricing": "auto"}, ...]
    #   height  身高（公分），賓客在第二階段填；None = 沒填
    #   pricing auto = 依身高分級 / free / half / full = 新人在後台手動指定
    children_json: Mapped[str] = mapped_column(Text, default="[]")

    @property
    def main_course(self) -> dict:
        try:
            data = json.loads(self.main_course_json or "{}")
            return {k: int(v) for k, v in data.items() if v}
        except (ValueError, TypeError):
            return {}

    @property
    def children(self) -> list[dict]:
        """依 child_count 對齊：多的截掉、少的補空白。"""
        try:
            raw = json.loads(self.children_json or "[]")
            raw = raw if isinstance(raw, list) else []
        except (ValueError, TypeError):
            raw = []
        out = []
        for i in range(int(self.child_count or 0)):
            c = raw[i] if i < len(raw) and isinstance(raw[i], dict) else {}
            h = c.get("height")
            out.append({
                "height": int(h) if isinstance(h, (int, float)) and 40 <= h <= 200 else None,
                "pricing": c.get("pricing") if c.get("pricing") in ("auto", "free", "half", "full") else "auto",
            })
        return out

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

class VendorCategory(Base):
    """廠商／花費的類別（可在後台增刪改、排序）。廠商與花費用名稱參照，改名時一併更新。"""
    __tablename__ = "vendor_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(30), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


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
    # 照片專用：說明、相簿、排序、縮圖檔名（沒有縮圖時為空字串）
    caption: Mapped[str] = mapped_column(String(200), default="")
    album: Mapped[str] = mapped_column(String(50), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    thumb_name: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    vendor: Mapped["Vendor | None"] = relationship(back_populates="files")


# =====================================================================
# 座位圖：桌椅物件 + 誰坐哪個位子
# =====================================================================

class SeatObject(Base):
    """平面圖上的物件：round 圓桌 / rect 長桌 / chair 單張椅子 / zone 區域 / stage 舞台 / entrance 入口 / label 文字。
    舞台與入口是獨立的種類：賓客頁靠它們算「怎麼走」與入口到桌子的路線。
    座標與尺寸是畫布單位（1 = 1px @ 100%）。圓桌的 w 是直徑。
    meta_json 放各類型的額外設定，例如長桌每邊幾張椅子 {"sides":{"top":4,"bottom":4,"left":1,"right":1}}。
    """
    __tablename__ = "seat_objects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), default="round")
    label: Mapped[str] = mapped_column(String(50), default="")
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    w: Mapped[float] = mapped_column(Float, default=120)
    h: Mapped[float] = mapped_column(Float, default=120)
    rotation: Mapped[float] = mapped_column(Float, default=0)
    seats: Mapped[int] = mapped_column(Integer, default=0)
    meta_json: Mapped[str] = mapped_column(Text, default="{}")
    z_order: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(String(300), default="")

    assignments: Mapped[list["SeatAssignment"]] = relationship(
        back_populates="obj", cascade="all, delete-orphan"
    )

    @property
    def meta(self) -> dict:
        try:
            data = json.loads(self.meta_json or "{}")
            return data if isinstance(data, dict) else {}
        except (ValueError, TypeError):
            return {}


class SeatAssignment(Base):
    """某個物件的第 seat_index 個座位（0 起算）坐的是哪組賓客的第 person_no 位（1 = 填表人本人）。"""
    __tablename__ = "seat_assignments"
    __table_args__ = (
        UniqueConstraint("object_id", "seat_index", name="uq_seat_position"),
        UniqueConstraint("rsvp_id", "person_no", name="uq_seat_person"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    object_id: Mapped[int] = mapped_column(ForeignKey("seat_objects.id", ondelete="CASCADE"), index=True)
    seat_index: Mapped[int] = mapped_column(Integer, default=0)
    rsvp_id: Mapped[int] = mapped_column(ForeignKey("rsvps.id", ondelete="CASCADE"), index=True)
    person_no: Mapped[int] = mapped_column(Integer, default=1)
    display_name: Mapped[str] = mapped_column(String(60), default="")  # 空 = 用自動產生的名字

    obj: Mapped["SeatObject"] = relationship(back_populates="assignments")
    rsvp: Mapped["Rsvp"] = relationship()


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
