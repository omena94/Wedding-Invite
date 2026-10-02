"""資料表。

賓客：rsvps（兩階段設計。Phase 1 意願調查先建立紀錄；Phase 2 詳細調查用 Email/電話找到同一筆再補上細節）
設定：settings（key-value：第二階段開放時間、婚禮資訊文案、桌次查詢開關…）
籌備：vendors 廠商、quotes 報價、expenses 花費、payments 付款期程、files 檔案、tasks 待辦
婚禮當天：guest_photos 賓客上傳的照片、wall_messages 現場留言、wall_songs 大螢幕歌單
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


class GuestVerification(Base):
    __tablename__ = "guest_verifications"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    rsvp_id: Mapped[int] = mapped_column(ForeignKey("rsvps.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    ip_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


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
    # 2026-09-23 新人當天留給這一戶的一段話：只在賓客用電話或 Email 查座位時顯示，可留空
    personal_note: Mapped[str] = mapped_column(Text, default="")
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
    # ===== 排座位（只給能排座位的人看，幫手帶位的畫面不帶出去）=====
    # 圈子：大學同學、公司同事、爸爸的朋友…同一圈子盡量同桌、至少坐隔壁桌，檢查時才找得出「同桌沒有認識的人」
    circle: Mapped[str] = mapped_column(String(30), default="")
    # 座位需求：main 主桌 / front 靠近舞台（重要長輩）/ door 靠近入口（行動不便、帶小嬰兒、要早走）；空 = 沒有
    seat_need: Mapped[str] = mapped_column(String(10), default="")

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
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # 整筆的應付款日期（2026-09-10 新增；分期另有各自的應付日）
    pay_method: Mapped[str] = mapped_column(String(30), default="")    # 支付方式（ATM／現金／信用卡…；2026-09-10 新增）
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    vendor: Mapped["Vendor | None"] = relationship(back_populates="expenses")
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="expense", cascade="all, delete-orphan", order_by="Payment.sort_order"
    )
    gift_order: Mapped["GiftOrder | None"] = relationship(foreign_keys="GiftOrder.expense_id", passive_deletes="all")


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

class SeatHall(Base):
    """一個「廳」就是一整套座位圖：自己的畫布大小、桌椅、誰坐哪，以及飯店給的平面圖底圖。
    廳別還沒定案前可以同時保留好幾套（原本的、萬福廳…）各自排位；is_active 的那一廳才是賓客查桌看到的。"""
    __tablename__ = "seat_halls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), default="")
    canvas_w: Mapped[int] = mapped_column(Integer, default=1600)
    canvas_h: Mapped[int] = mapped_column(Integer, default=1000)
    clearance: Mapped[int] = mapped_column(Integer, default=20)
    bg_image: Mapped[str] = mapped_column(String(80), default="")    # uploads/ 裡的檔名；空 = 沒有底圖
    bg_opacity: Mapped[int] = mapped_column(Integer, default=55)      # 底圖透明度 10～100
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)   # 賓客查桌、幫手帶位用這一廳
    preset_key: Mapped[str] = mapped_column(String(30), default="")    # 由哪個範本載入（wanfu / grand），放回固定物件時要知道；空 = 自己畫的
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    objects: Mapped[list["SeatObject"]] = relationship(back_populates="hall", cascade="all, delete-orphan")


class SeatObject(Base):
    """平面圖上的物件：round 圓桌 / rect 長桌 / chair 單張椅子 / zone 區域 / stage 舞台 / entrance 入口 / label 文字。
    舞台與入口是獨立的種類：賓客頁靠它們算「怎麼走」與入口到桌子的路線。
    座標與尺寸是畫布單位（1 = 1px @ 100%）。圓桌的 w 是直徑。
    meta_json 放各類型的額外設定，例如長桌每邊幾張椅子 {"sides":{"top":4,"bottom":4,"left":1,"right":1}}。
    """
    __tablename__ = "seat_objects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 屬於哪一廳；舊資料啟動時會補上第一廳（見 seating.ensure_halls）
    hall_id: Mapped[int | None] = mapped_column(ForeignKey("seat_halls.id", ondelete="CASCADE"), nullable=True, index=True)
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
    hall: Mapped["SeatHall | None"] = relationship(back_populates="objects")

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
        # 同一個人在同一廳只能有一個位子；不同廳各自排（廳別未定時兩套座位圖並存）
        UniqueConstraint("hall_id", "rsvp_id", "person_no", name="uq_seat_person_hall"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hall_id: Mapped[int | None] = mapped_column(ForeignKey("seat_halls.id", ondelete="CASCADE"), nullable=True, index=True)
    object_id: Mapped[int] = mapped_column(ForeignKey("seat_objects.id", ondelete="CASCADE"), index=True)
    seat_index: Mapped[int] = mapped_column(Integer, default=0)
    rsvp_id: Mapped[int] = mapped_column(ForeignKey("rsvps.id", ondelete="CASCADE"), index=True)
    person_no: Mapped[int] = mapped_column(Integer, default=1)
    display_name: Mapped[str] = mapped_column(String(60), default="")  # 空 = 用自動產生的名字

    obj: Mapped["SeatObject"] = relationship(back_populates="assignments")
    rsvp: Mapped["Rsvp"] = relationship()


class SeatRule(Base):
    """排位規則：幾組賓客之間 together 一定同桌 / apart 不要同桌 / near 坐附近（同桌或隔壁桌）/ far 離遠一點。
    規則跟著人走、不分廳：訂婚宴與結婚宴各排一廳時都要遵守。成員存 rsvp id 清單，賓客被刪掉時讀取端會清掉；
    備註常是「前任」「兩家有心結」這種私事，只給能排座位的人看。"""
    __tablename__ = "seat_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), default="together")
    rsvp_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    note: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def rsvp_ids(self) -> list[int]:
        try:
            data = json.loads(self.rsvp_ids_json or "[]")
        except (ValueError, TypeError):
            return []
        out: list[int] = []
        for x in data if isinstance(data, list) else []:
            if isinstance(x, int) and x not in out:
                out.append(x)
        return out


class Task(Base):
    """行事曆上的一件事（2026-09-10 起「籌備進度」改為行事曆：只有標題、日期、時間、主題、備註、完成）。
    kind / assignee / vendor_id 是舊欄位，畫面已不用，保留只為了舊資料。"""
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="task")  # 舊欄位：task / milestone，已不顯示
    topic: Mapped[str] = mapped_column(String(50), default="")     # 主題（婚紗攝影、喜餅…），跟筆記共用，決定月曆上的顏色
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_time: Mapped[str] = mapped_column(String(5), default="")   # HH:MM，空 = 整天
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


class Memo(Base):
    """備忘：要向飯店、婚紗店、喜餅店…確認的問題與得到的答案。
    可獨立存在（依主題分區），也可掛在某筆待辦或花費底下；三處看到的是同一份資料。
    待辦或花費被刪時只解除連結（SET NULL），備忘本身留著。"""
    __tablename__ = "memos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    topic: Mapped[str] = mapped_column(String(50), default="其他")  # 飯店 / 婚紗 / 喜餅…自由輸入
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default="")
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)  # 2026-09-10 起意思是「已處理」
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)     # 釘選：排在最上面
    # task_id：這則筆記「排進行事曆」後對應的那一筆；expense_id 是舊功能（掛在花費底下），已不用
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    expense_id: Mapped[int | None] = mapped_column(
        ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    task: Mapped["Task | None"] = relationship()
    expense: Mapped["Expense | None"] = relationship()


class ProgramSegment(Base):
    """婚禮活動環節（進場、致詞、敬酒、遊戲…）：依時間／順序排，每個環節有自己的細節紀錄。"""
    __tablename__ = "program_segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    start_time: Mapped[str] = mapped_column(String(5), default="")  # "12:30"，空 = 未定
    duration_min: Mapped[int] = mapped_column(Integer, default=0)   # 0 = 未定
    host: Mapped[str] = mapped_column(String(100), default="")      # 主持／負責的人
    note: Mapped[str] = mapped_column(Text, default="")             # 流程細節、需要的道具、紀錄
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft 規劃中 / confirmed 已確定
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProgramIdea(Base):
    """活動點子：先把想法記下來，決定了再標採用並指到某個環節。環節刪掉時只解除連結。"""
    __tablename__ = "program_ideas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="idea")  # idea 想法 / adopted 採用 / dropped 不採用
    segment_id: Mapped[int | None] = mapped_column(
        ForeignKey("program_segments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    segment: Mapped["ProgramSegment | None"] = relationship()


class ProgramGame(Base):
    """婚禮遊戲：名稱、規則、內容、獎品、主持人、裁判、時長、道具；可指定在哪個環節玩（環節刪掉只解除連結）。"""
    __tablename__ = "program_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    rules: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    prize: Mapped[str] = mapped_column(Text, default="")
    host: Mapped[str] = mapped_column(String(100), default="")
    judge: Mapped[str] = mapped_column(String(100), default="")
    duration_min: Mapped[int] = mapped_column(Integer, default=0)
    props: Mapped[str] = mapped_column(Text, default="")
    segment_id: Mapped[int | None] = mapped_column(
        ForeignKey("program_segments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    segment: Mapped["ProgramSegment | None"] = relationship()


# 喜餅需求與出席分開：未填婚宴表單的親友也能送餅，且不影響餐點／座位。
class GiftProduct(Base):
    __tablename__ = "gift_products"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    reference_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reserve_qty: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    __mapper_args__ = {"version_id_col": version}


class GiftRecipient(Base):
    __tablename__ = "gift_recipients"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_key: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(20), default="household")
    side: Mapped[str] = mapped_column(String(20), default="other")
    contact_name: Mapped[str] = mapped_column(String(100), default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    owner: Mapped[str] = mapped_column(String(60), default="")
    method: Mapped[str] = mapped_column(String(20), default="venue")
    state: Mapped[str] = mapped_column(String(20), default="confirmed")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(String(1000), default="")
    # 2026-09-27 這一戶要送幾盒（跟款式分開存，預設 1）：款式還沒定也看得到盒數，批次或編輯選了款式就套用到那款
    box_count: Mapped[int] = mapped_column(Integer, default=1)
    version: Mapped[int] = mapped_column(Integer, default=1)
    __mapper_args__ = {"version_id_col": version}


class GiftRsvpLink(Base):
    __tablename__ = "gift_rsvp_links"
    rsvp_id: Mapped[int] = mapped_column(ForeignKey("rsvps.id", ondelete="CASCADE"), primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("gift_recipients.id", ondelete="CASCADE"), index=True)


class GiftPlan(Base):
    __tablename__ = "gift_plans"
    __table_args__ = (UniqueConstraint("recipient_id", "product_id", name="uq_gift_recipient_product"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("gift_recipients.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("gift_products.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)


class GiftDelivery(Base):
    __tablename__ = "gift_deliveries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("gift_recipients.id", ondelete="RESTRICT"), index=True)
    request_key: Mapped[str] = mapped_column(String(64), unique=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    items_json: Mapped[str] = mapped_column(Text)
    method: Mapped[str] = mapped_column(String(20))
    receiver: Mapped[str] = mapped_column(String(100))
    handler: Mapped[str] = mapped_column(String(60), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    tracking: Mapped[str] = mapped_column(String(100), default="")
    note: Mapped[str] = mapped_column(String(500), default="")
    delivered_on: Mapped[date] = mapped_column(Date)
    received_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    void_reason: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    version: Mapped[int] = mapped_column(Integer, default=1)
    __mapper_args__ = {"version_id_col": version}


class GiftOrder(Base):
    __tablename__ = "gift_orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_key: Mapped[str] = mapped_column(String(64), unique=True)
    # 2026-09-10 後台已不顯示廠商，訂購不必再指定廠商；舊資料的廠商保留
    vendor_id: Mapped[int | None] = mapped_column(ForeignKey("vendors.id", ondelete="RESTRICT"), index=True, nullable=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id", ondelete="RESTRICT"), unique=True)
    title: Mapped[str] = mapped_column(String(150))
    items_json: Mapped[str] = mapped_column(Text)
    shipping: Mapped[int] = mapped_column(Integer, default=0)
    other_cost: Mapped[int] = mapped_column(Integer, default=0)
    discount: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(String(1000), default="")
    history_json: Mapped[str] = mapped_column(Text, default="[]")
    version: Mapped[int] = mapped_column(Integer, default=1)
    __mapper_args__ = {"version_id_col": version}


class GuestPhoto(Base):
    """婚禮當天賓客上傳的照片（2026-09-27）：原檔存 upload_dir/guest/，另有縮圖；只有新人在後台看得到。"""
    __tablename__ = "guest_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stored_name: Mapped[str] = mapped_column(String(80), unique=True)   # 磁碟上的檔名（uuid + 副檔名）
    original_name: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(Integer, default=0)
    content_type: Mapped[str] = mapped_column(String(80), default="")
    uploader: Mapped[str] = mapped_column(String(60), default="")      # 賓客自填的名字，可空
    thumb_name: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WallMessage(Base):
    """婚禮當天現場留言：賓客在 /wish 寫、新人也能自己加，status=show 的會出現在會場大螢幕（/wall）。"""
    __tablename__ = "wall_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), default="")          # 賓客自填，可空（螢幕顯示匿名）
    text: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), default="show")   # show 上螢幕 / hide 隱藏 / pending 等審核
    source: Mapped[str] = mapped_column(String(10), default="guest")  # guest 賓客 / couple 新人自己加
    # 限流用：同一支手機（/wish 自己產生的隨機代號）與同一個 IP 一分鐘內寫幾則。都只存雜湊
    device_hash: Mapped[str] = mapped_column(String(64), default="", index=True)
    ip_hash: Mapped[str] = mapped_column(String(64), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class WallSong(Base):
    """大螢幕的背景歌單：音檔存 upload_dir/wall/；節拍分析在瀏覽器算好後整包存回來（analysis_json）。"""
    __tablename__ = "wall_songs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    artist: Mapped[str] = mapped_column(String(200), default="")
    stored_name: Mapped[str] = mapped_column(String(80), unique=True)   # 磁碟上的檔名（uuid + 副檔名）
    original_name: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(Integer, default=0)
    content_type: Mapped[str] = mapped_column(String(80), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    duration: Mapped[float] = mapped_column(Float, default=0)
    bpm: Mapped[float] = mapped_column(Float, default=0)
    analysis_json: Mapped[str] = mapped_column(Text, default="")        # 可能到 200 KB，列表不回傳
    analysis_version: Mapped[int] = mapped_column(Integer, default=0)    # 分析演算法改版時用來判斷要不要重算
    lyrics_lrc: Mapped[str] = mapped_column(Text, default="")           # LRC 歌詞，可能含逐字 <mm:ss.xx> 標記
    lyrics_source: Mapped[str] = mapped_column(String(20), default="")  # lrclib / manual / none
    lyrics_offset: Mapped[float] = mapped_column(Float, default=0)      # 整首歌詞往前後挪幾秒
    instrumental: Mapped[bool] = mapped_column(Boolean, default=False)
    # 新人自己標「這首歌詞對好了」（2026-09-30）：歌單上才分得出哪些還要修；只是標記，不影響大螢幕播放
    lyrics_done: Mapped[bool] = mapped_column(Boolean, default=False)
    # 中文翻譯（2026-09-30，韓文歌）：另一份 LRC，照順序一句對一句配到原文；大螢幕中文大字、原文小字放在下面。
    # 時間一律跟原文走（原文改時間翻譯自動跟著），這份的時間只拿來在句數對不上時找最接近的句子。
    lyrics_trans: Mapped[str] = mapped_column(Text, default="")
    theme: Mapped[str] = mapped_column(String(20), default="")          # 大螢幕配色；空 = 自動挑（gold / rose / champagne / coral / lilac / sage）
    # 只播中間一段（秒）：前奏、尾奏太長時剪掉；0 = 從頭／播到完
    start_at: Mapped[float] = mapped_column(Float, default=0)
    end_at: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
class WallCommand(Base):
    """大螢幕遙控（2026-09-30）：手機後台按的指令排在這裡，大螢幕每秒來拿一次。
    正式站有好幾個 uvicorn worker，所以放資料庫、不放記憶體；一小時前的會被清掉。"""
    __tablename__ = "wall_commands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String(20))
    args_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class WallScreen(Base):
    """開著的大螢幕分頁（2026-09-30）：一個分頁一列，存它最近一次回報的播放狀態。
    原本只存一列（舊表 wall_remote_state 已不用），開了兩台時狀態會互相蓋掉、手機指令兩台都做；
    改成每台分開記，才能選出「接收遙控」的那一台（最後按「開始播放」或按了「改由這台接收遙控」的），其他台當備用。"""
    __tablename__ = "wall_screens"

    client: Mapped[str] = mapped_column(String(40), primary_key=True)  # 大螢幕分頁打開時隨機產生，重新整理就換一個
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lead_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # 按「開始播放」或搶過遙控的時間
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    state_json: Mapped[str] = mapped_column(Text, default="{}")


class MenuItem(Base):
    """婚宴菜單（2026-09-29）：跟飯店討論中的菜色，只給新人看。一道一列，可標討論中／確定／要更換並寫備註。"""
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(50), default="其他")   # 精選冷盤、熱食類、甜點類…
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(120))
    name_en: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(String(20), default="discussing")  # discussing / confirmed / change
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PackingItem(Base):
    """婚禮當天要帶的東西（2026-10-01）：一樣東西一列，分類、數量、誰負責帶、備註，前一晚收好就勾「已備妥」。
    只是給自己對照的清單，不跟花費、喜餅等其他資料連動。"""
    __tablename__ = "packing_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(50), default="其他")   # 新娘、新郎、證件與禮金…自由輸入
    name: Mapped[str] = mapped_column(String(120))
    qty: Mapped[int] = mapped_column(Integer, default=1)
    owner: Mapped[str] = mapped_column(String(50), default="")         # 誰負責帶（伴娘、媽媽…），空 = 還沒指定
    note: Mapped[str] = mapped_column(String(500), default="")
    packed: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
