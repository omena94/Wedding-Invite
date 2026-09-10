"""Pydantic 資料驗證模型（API 進出格式）。"""
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .contacts import normalize_phone


# ===== Phase 1：意願調查送出 =====
class Phase1Create(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    side: Literal["groom", "bride"]
    attending: bool = True
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=50)
    date_preference: Literal["both", "0306", "0313"] = "both"
    adult_count: int = Field(default=1, ge=0, le=50)
    child_count: int = Field(default=0, ge=0, le=50)
    message: str = Field(default="", max_length=2000)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v):
        if not v.strip():
            raise ValueError("請填寫姓名")
        return v.strip()

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, v):
        return normalize_phone(v)

    @field_validator("email")
    @classmethod
    def clean_email(cls, v):
        return v.strip().lower()

    @model_validator(mode="after")
    def attending_contact(self):
        import re
        if self.attending and (not re.fullmatch(r"09\d{8}", self.phone) or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}", self.email) or self.adult_count < 1):
            raise ValueError("出席時請填寫有效的 Email、手機號碼及大人人數")
        return self


# ===== 小孩：身高（賓客填）與計價方式（新人在後台可手動指定）=====
class ChildIn(BaseModel):
    height: int | None = Field(default=None, ge=40, le=200)
    pricing: Literal["auto", "free", "half", "full"] = "auto"


# ===== Phase 2：用 Email/電話找到自己的紀錄 =====
class LookupIn(BaseModel):
    contact: str = Field(default="", max_length=200)
    access_token: str = Field(default="", max_length=1000)


class VerificationIn(BaseModel):
    contact: str = Field(min_length=1, max_length=200)


class VerifyCodeIn(BaseModel):
    challenge_id: str = Field(min_length=1, max_length=64)
    code: str = Field(pattern=r"^\d{6}$")


class GuestReceipt(BaseModel):
    name: str
    attending: bool
    adult_count: int
    child_count: int
    details_completed: bool
    main_course: dict[str, int] = {}
    access_token: str


class LookupOut(BaseModel):
    found: bool
    name: str = ""
    attending: bool = True
    details_completed: bool = False
    public_id: str = ""
    # 供 Phase 2 預填
    adult_count: int = 1
    child_count: int = 0
    baby_chair_count: int = 0
    veg_type: str = "無"
    dietary_note: str = ""
    main_course: dict[str, int] = {}
    kids_meal_count: int = 0
    remark: str = ""
    children: list[dict] = []
    access_token: str = ""


# ===== Phase 2：詳細調查送出 =====
class Phase2Details(BaseModel):
    contact: str = Field(default="", max_length=200)
    access_token: str = Field(default="", max_length=1000)
    adult_count: int = Field(default=1, ge=1, le=50)
    child_count: int = Field(default=0, ge=0, le=50)
    main_course: dict[str, int] = {}                     # {"牛排":2,"雞腿排":1,...}
    kids_meal_count: int = Field(default=0, ge=0, le=50)
    baby_chair_count: int = Field(default=0, ge=0, le=50)
    veg_type: str = Field(default="無", max_length=30)
    dietary_note: str = Field(default="", max_length=300)
    remark: str = Field(default="", max_length=500)
    children: list[ChildIn] = []  # 每個小孩的身高（依 child_count 順序）


# ===== 後台更新（可修正賓客填錯的任何欄位）=====
class RsvpAdminCreate(BaseModel):
    """後台手動新增賓客（2026-09-08）：沒有 Email 或電話的長輩也能算進喜宴人數；有填才檢查重複。"""
    name: str = Field(min_length=1, max_length=100)
    side: Literal["groom", "bride"]
    attending: bool = True
    adult_count: int = Field(default=1, ge=0, le=50)
    child_count: int = Field(default=0, ge=0, le=50)
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=50)
    admin_note: str = Field(default="", max_length=2000)

    @field_validator("name")
    @classmethod
    def clean_name(cls, v):
        if not v.strip():
            raise ValueError("請填寫姓名")
        return v.strip()

    @field_validator("phone", "email")
    @classmethod
    def clean_contact(cls, v, info):
        v = (v or "").strip()
        if not v:
            return ""
        return normalize_phone(v) if info.field_name == "phone" else v.lower()


class RsvpAdminUpdate(BaseModel):
    @field_validator('phone','email')
    @classmethod
    def clean_contact(cls,v,info):
        if v is None:
            return v
        return normalize_phone(v) if info.field_name=='phone' else v.strip().lower()

    # 基本資料
    name: str | None = Field(default=None, min_length=1, max_length=100)
    side: Literal["groom", "bride"] | None = None
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    attending: bool | None = None
    adult_count: int | None = Field(default=None, ge=0, le=50)
    child_count: int | None = Field(default=None, ge=0, le=50)
    message: str | None = Field(default=None, max_length=2000)
    # 詳細調查
    details_completed: bool | None = None
    main_course: dict[str, int] | None = None
    kids_meal_count: int | None = Field(default=None, ge=0, le=50)
    baby_chair_count: int | None = Field(default=None, ge=0, le=50)
    veg_type: str | None = Field(default=None, max_length=30)
    dietary_note: str | None = Field(default=None, max_length=300)
    remark: str | None = Field(default=None, max_length=500)
    children: list[ChildIn] | None = None
    # 後台管理
    manage_status: Literal["new", "contacted", "seated"] | None = None
    table_no: int | None = Field(default=None, ge=0, le=999)
    admin_note: str | None = Field(default=None, max_length=300)
    is_test: bool | None = None  # 標記為測試資料（不計入統計）


# ===== 回傳給前端 =====
class RsvpOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: str
    name: str
    side: str
    email: str
    phone: str
    attending: bool
    date_preference: str
    adult_count: int
    child_count: int
    message: str
    details_completed: bool
    baby_chair_count: int
    veg_count: int
    veg_type: str
    dietary_note: str
    main_course: dict[str, int]
    kids_meal_count: int
    remark: str
    children: list[dict]
    manage_status: str
    table_no: int | None
    admin_note: str
    is_test: bool
    created_at: datetime
    updated_at: datetime
    details_updated_at: datetime | None


# ===== 登入 =====
class LoginIn(BaseModel):
    password: str


class LoginOut(BaseModel):
    token: str
    role: str = "couple"  # couple 新人 / helper 幫手


# ===== 統計 =====
class SideBreakdown(BaseModel):
    groom: int = 0
    bride: int = 0


class DatePref(BaseModel):
    both: int = 0
    d0306: int = 0
    d0313: int = 0


class Stats(BaseModel):
    # Phase 1
    total_responses: int = 0
    attending_responses: int = 0
    declined_responses: int = 0
    total_guests: int = 0          # 大人 + 幼童
    total_adults: int = 0
    total_children: int = 0
    people_by_side: SideBreakdown = SideBreakdown()
    date_pref_responses: DatePref = DatePref()   # 各日期偏好「回覆組數」
    date_pref_people: DatePref = DatePref()       # 各日期偏好「人數」
    # Phase 2
    details_done: int = 0          # 已完成詳細調查的組數
    details_pending: int = 0       # 尚待填詳細（出席但未填）
    total_baby_chairs: int = 0
    total_veg: int = 0
    veg_types: dict[str, int] = {}
    main_course_totals: dict[str, int] = {}   # 各主餐總份數
    total_kids_meals: int = 0                  # 兒童餐點總份數


# ===== 賓客端：桌次查詢 =====
class SeatLookupIn(BaseModel):
    query: str = Field(min_length=1, max_length=100)  # 姓名或電話
    phone: str = Field(default="", max_length=50)


class SeatLookupOut(BaseModel):
    found: bool
    needs_phone: bool = False
    name: str = ""
    table_no: int | None = None
    seats: list[dict] = []          # [{object_id, table_label, seat_no, display_name, neighbors:[{seat_no,name}]}]
    tables: list[dict] = []         # 自己坐的每張桌：[{object_id, label, seats_total, mates:[{seat_no,name,mine}]}]
    map: dict | None = None         # {canvas, objects}（形狀與桌名）
    map_names: dict = {}            # 只有自己那幾桌的名字 {object_id: {seat_index: {name, mine}}}


# =====================================================================
# 籌備後台
# =====================================================================
VendorStatus = Literal["candidate", "quoted", "signed", "done", "rejected"]
PaidBy = Literal["groom", "bride", "shared", "family"]
Assignee = Literal["groom", "bride", "both"]
TaskKind = Literal["task", "milestone"]
FileKind = Literal["doc", "receipt", "photo"]


SeatKind = Literal["round", "rect", "chair", "zone", "label", "stage", "entrance", "wall", "column"]


class SeatHallIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    w: int = Field(default=1600, ge=400, le=6000)
    h: int = Field(default=1000, ge=400, le=6000)
    clearance: int = Field(default=20, ge=4, le=100)
    copy_from: int | None = None  # 複製這一廳的桌椅（不含誰坐哪）


class SeatHallPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    w: int | None = Field(default=None, ge=400, le=6000)
    h: int | None = Field(default=None, ge=400, le=6000)
    clearance: int | None = Field(default=None, ge=4, le=100)
    bg_opacity: int | None = Field(default=None, ge=10, le=100)
    is_active: bool | None = None  # True = 設為正式使用（賓客查桌用這一廳）


class SeatPresetIn(BaseModel):
    key: Literal["wanfu"]


class SeatObjectIn(BaseModel):
    hall_id: int | None = None  # 放在哪一廳；不填 = 正式使用的那一廳
    kind: SeatKind = "round"
    label: str = Field(default="", max_length=50)
    x: float = 0
    y: float = 0
    w: float = Field(default=120, ge=10, le=4000)
    h: float = Field(default=120, ge=10, le=4000)
    rotation: float = 0
    seats: int = Field(default=0, ge=0, le=60)
    meta: dict = {}
    z_order: int = 0
    note: str = Field(default="", max_length=300)


class SeatObjectPatch(BaseModel):
    kind: SeatKind | None = None
    label: str | None = Field(default=None, max_length=50)
    x: float | None = None
    y: float | None = None
    w: float | None = Field(default=None, ge=10, le=4000)
    h: float | None = Field(default=None, ge=10, le=4000)
    rotation: float | None = None
    seats: int | None = Field(default=None, ge=0, le=60)
    meta: dict | None = None
    z_order: int | None = None
    note: str | None = Field(default=None, max_length=300)


class SeatObjectMove(BaseModel):
    id: int
    x: float
    y: float


class SeatAssignIn(BaseModel):
    object_id: int
    seat_index: int = Field(ge=0)
    rsvp_id: int
    person_no: int = Field(default=1, ge=1)
    display_name: str | None = Field(default=None, max_length=60)
    force: bool = False  # 位子已有人時，把原本的人移走（設成未安排）


class SeatAssignGroupIn(BaseModel):
    object_id: int
    rsvp_id: int


class SeatRenameIn(BaseModel):
    display_name: str = Field(default="", max_length=60)


class SeatAutoAssignIn(BaseModel):
    keep_groups: bool = True    # 同一組盡量坐同一桌
    by_side: bool = True        # 男方從第一桌往後填、女方從最後一桌往前填
    clear_first: bool = False   # 先清空目前的安排


class SeatCanvasIn(BaseModel):
    w: int = Field(ge=400, le=6000)
    h: int = Field(ge=400, le=6000)
    clearance: int = Field(default=20, ge=4, le=100)


class BanquetPatch(BaseModel):
    adult_price: int | None = Field(default=None, ge=0, le=1_000_000)
    service_pct: int | None = Field(default=None, ge=0, le=100)
    child_mode: Literal["free", "half", "full", "custom", "manual"] | None = None  # 沒填身高的小孩怎麼算；manual = 手動填人數
    child_free_count: int | None = Field(default=None, ge=0, le=500)  # manual：110 以下人數（免費）
    child_half_count: int | None = Field(default=None, ge=0, le=500)  # manual：130 以下人數（半價）
    child_price: int | None = Field(default=None, ge=0, le=1_000_000)
    child_free_below: int | None = Field(default=None, ge=0, le=250)  # 身高低於此免費
    child_half_below: int | None = Field(default=None, ge=0, le=250)  # 身高低於此半價（以上全價）
    veg_price: int | None = Field(default=None, ge=0, le=1_000_000)  # 素食每位；0 = 同大人


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=30)


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=30)
    sort_order: int | None = None


class CategoryReorder(BaseModel):
    ids: list[int]


class VendorIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(default="其他", max_length=30)
    contact_name: str = Field(default="", max_length=100)
    phone: str = Field(default="", max_length=50)
    line_id: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=300)
    website: str = Field(default="", max_length=300)
    status: VendorStatus = "candidate"
    rating: int = Field(default=0, ge=0, le=5)
    note: str = Field(default="", max_length=5000)


class VendorPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    category: str | None = Field(default=None, max_length=30)
    contact_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    line_id: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    website: str | None = Field(default=None, max_length=300)
    status: VendorStatus | None = None
    rating: int | None = Field(default=None, ge=0, le=5)
    note: str | None = Field(default=None, max_length=5000)


class QuoteIn(BaseModel):
    item: str = Field(min_length=1, max_length=100)
    price: int = Field(default=0, ge=0)
    note: str = Field(default="", max_length=300)
    sort_order: int = 0


class QuotePatch(BaseModel):
    item: str | None = Field(default=None, min_length=1, max_length=100)
    price: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=300)
    sort_order: int | None = None


class ExpenseIn(BaseModel):
    vendor_id: int | None = None
    category: str = Field(default="其他", max_length=30)
    title: str = Field(min_length=1, max_length=150)
    budget_amount: int = Field(default=0, ge=0)
    contract_amount: int = Field(default=0, ge=0)
    paid_by: PaidBy = "shared"
    note: str = Field(default="", max_length=5000)


class ExpensePatch(BaseModel):
    vendor_id: int | None = None
    clear_vendor: bool = False  # 因為 None 也代表「不變」，要解除廠商連結時把這個設 true
    category: str | None = Field(default=None, max_length=30)
    title: str | None = Field(default=None, min_length=1, max_length=150)
    budget_amount: int | None = Field(default=None, ge=0)
    contract_amount: int | None = Field(default=None, ge=0)
    paid_by: PaidBy | None = None
    note: str | None = Field(default=None, max_length=5000)


class PaymentIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    amount: int = Field(default=0, ge=0)
    due_date: date | None = None
    paid_date: date | None = None
    method: str = Field(default="", max_length=30)
    payer: str = Field(default="", max_length=20)
    note: str = Field(default="", max_length=300)
    sort_order: int = 0


class PaymentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    amount: int | None = Field(default=None, ge=0)
    due_date: date | None = None
    clear_due_date: bool = False
    paid_date: date | None = None
    clear_paid_date: bool = False  # 標回「未付」
    method: str | None = Field(default=None, max_length=30)
    payer: str | None = Field(default=None, max_length=20)
    note: str | None = Field(default=None, max_length=300)
    sort_order: int | None = None


DueTime = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$|^$")]  # HH:MM 或空白


class TaskIn(BaseModel):
    """行事曆的一件事。kind / assignee / vendor_id 是舊欄位，前端已不送。"""
    title: str = Field(min_length=1, max_length=200)
    topic: str = Field(default="", max_length=50)
    due_date: date | None = None
    due_time: DueTime = ""
    done: bool = False
    note: str = Field(default="", max_length=5000)
    sort_order: int = 0
    kind: TaskKind = "task"
    assignee: Assignee = "both"
    vendor_id: int | None = None


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    topic: str | None = Field(default=None, max_length=50)
    due_date: date | None = None
    clear_due_date: bool = False
    due_time: DueTime | None = None
    done: bool | None = None
    note: str | None = Field(default=None, max_length=5000)
    sort_order: int | None = None
    kind: TaskKind | None = None
    assignee: Assignee | None = None
    vendor_id: int | None = None
    clear_vendor: bool = False


class MemoIn(BaseModel):
    """筆記（2026-09-10 起）：標題、內容、主題、已處理、釘選。資料表欄位仍叫 question / answer / confirmed。"""
    topic: str = Field(default="其他", min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=2000)
    content: str = Field(default="", max_length=5000)
    done: bool = False
    pinned: bool = False
    task_id: int | None = None  # 排進行事曆後對應的那一筆
    sort_order: int = 0

    @field_validator("topic", "title", "content")
    @classmethod
    def _strip(cls, v: str, info) -> str:
        v = v.strip()
        if not v and info.field_name != "content":  # 長度限制在去空白前檢查，這裡再擋「只有空格」
            raise ValueError("不可空白")
        return v


class MemoPatch(BaseModel):
    topic: str | None = Field(default=None, min_length=1, max_length=50)
    title: str | None = Field(default=None, min_length=1, max_length=2000)
    content: str | None = Field(default=None, max_length=5000)
    done: bool | None = None
    pinned: bool | None = None
    task_id: int | None = None
    clear_task: bool = False
    sort_order: int | None = None

    @field_validator("topic", "title", "content")
    @classmethod
    def _strip(cls, v: str | None, info) -> str | None:
        if not isinstance(v, str):
            return v
        v = v.strip()
        if not v and info.field_name != "answer":
            raise ValueError("不可空白")
        return v


SegmentStatus = Literal["draft", "confirmed"]
IdeaStatus = Literal["idea", "adopted", "dropped"]
_TIME_RE = r"^([01]\d|2[0-3]):[0-5]\d$"


class SegmentIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    start_time: str = Field(default="", pattern=_TIME_RE + "|^$")
    duration_min: int = Field(default=0, ge=0, le=1440)
    host: str = Field(default="", max_length=100)
    note: str = Field(default="", max_length=10000)
    status: SegmentStatus = "draft"
    sort_order: int = 0

    @field_validator("title", "host", "note")
    @classmethod
    def _strip(cls, v: str, info) -> str:
        v = v.strip()
        if not v and info.field_name == "title":
            raise ValueError("不可空白")
        return v


class SegmentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    start_time: str | None = Field(default=None, pattern=_TIME_RE + "|^$")
    duration_min: int | None = Field(default=None, ge=0, le=1440)
    host: str | None = Field(default=None, max_length=100)
    note: str | None = Field(default=None, max_length=10000)
    status: SegmentStatus | None = None
    sort_order: int | None = None

    @field_validator("title", "host", "note")
    @classmethod
    def _strip(cls, v: str | None, info) -> str | None:
        if not isinstance(v, str):
            return v
        v = v.strip()
        if not v and info.field_name == "title":
            raise ValueError("不可空白")
        return v


class SegmentReorder(BaseModel):
    ids: list[int]  # 由上到下的環節 id


class IdeaIn(BaseModel):
    content: str = Field(min_length=1, max_length=5000)
    status: IdeaStatus = "idea"
    segment_id: int | None = None
    sort_order: int = 0

    @field_validator("content")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("不可空白")
        return v


class IdeaPatch(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=5000)
    status: IdeaStatus | None = None
    segment_id: int | None = None
    clear_segment: bool = False
    sort_order: int | None = None

    @field_validator("content")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        if not isinstance(v, str):
            return v
        v = v.strip()
        if not v:
            raise ValueError("不可空白")
        return v


class GameIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rules: str = Field(default="", max_length=10000)
    content: str = Field(default="", max_length=10000)
    prize: str = Field(default="", max_length=2000)
    host: str = Field(default="", max_length=100)
    judge: str = Field(default="", max_length=100)
    duration_min: int = Field(default=0, ge=0, le=1440)
    props: str = Field(default="", max_length=5000)
    segment_id: int | None = None
    sort_order: int = 0

    @field_validator("name", "rules", "content", "prize", "host", "judge", "props")
    @classmethod
    def _strip(cls, v: str, info) -> str:
        v = v.strip()
        if not v and info.field_name == "name":
            raise ValueError("不可空白")
        return v


class GamePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    rules: str | None = Field(default=None, max_length=10000)
    content: str | None = Field(default=None, max_length=10000)
    prize: str | None = Field(default=None, max_length=2000)
    host: str | None = Field(default=None, max_length=100)
    judge: str | None = Field(default=None, max_length=100)
    duration_min: int | None = Field(default=None, ge=0, le=1440)
    props: str | None = Field(default=None, max_length=5000)
    segment_id: int | None = None
    clear_segment: bool = False
    sort_order: int | None = None

    @field_validator("name", "rules", "content", "prize", "host", "judge", "props")
    @classmethod
    def _strip(cls, v: str | None, info) -> str | None:
        if not isinstance(v, str):
            return v
        v = v.strip()
        if not v and info.field_name == "name":
            raise ValueError("不可空白")
        return v


class FilePatch(BaseModel):
    kind: FileKind | None = None
    is_public: bool | None = None
    vendor_id: int | None = None
    expense_id: int | None = None
    payment_id: int | None = None
    clear_links: bool = False
    note: str | None = Field(default=None, max_length=300)
    # 照片專用
    caption: str | None = Field(default=None, max_length=200)
    album: str | None = Field(default=None, max_length=50)
    sort_order: int | None = None


class PhotoReorderIn(BaseModel):
    ids: list[int]


class PhotoPublishIn(BaseModel):
    ids: list[int]
    is_public: bool = True
