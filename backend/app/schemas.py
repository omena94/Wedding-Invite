"""Pydantic 資料驗證模型（API 進出格式）。"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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


# ===== Phase 2：用 Email/電話找到自己的紀錄 =====
class LookupIn(BaseModel):
    contact: str = Field(min_length=1, max_length=200)  # Email 或 電話


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


# ===== Phase 2：詳細調查送出 =====
class Phase2Details(BaseModel):
    contact: str = Field(min_length=1, max_length=200)  # 對應 Phase 1 的 Email 或 電話
    adult_count: int = Field(default=1, ge=0, le=50)     # 再次確認人數
    child_count: int = Field(default=0, ge=0, le=50)
    main_course: dict[str, int] = {}                     # {"牛排":2,"雞腿排":1,...}
    kids_meal_count: int = Field(default=0, ge=0, le=50)
    baby_chair_count: int = Field(default=0, ge=0, le=50)
    veg_type: str = Field(default="無", max_length=30)
    dietary_note: str = Field(default="", max_length=300)
    remark: str = Field(default="", max_length=500)


# ===== 後台更新（可修正賓客填錯的任何欄位）=====
class RsvpAdminUpdate(BaseModel):
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


class SeatLookupOut(BaseModel):
    found: bool
    name: str = ""
    table_no: int | None = None


# =====================================================================
# 籌備後台
# =====================================================================
VendorStatus = Literal["candidate", "quoted", "signed", "done", "rejected"]
PaidBy = Literal["groom", "bride", "shared", "family"]
Assignee = Literal["groom", "bride", "both"]
TaskKind = Literal["task", "milestone"]
FileKind = Literal["doc", "receipt", "photo"]


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


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: TaskKind = "task"
    due_date: date | None = None
    done: bool = False
    assignee: Assignee = "both"
    vendor_id: int | None = None
    note: str = Field(default="", max_length=5000)
    sort_order: int = 0


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    kind: TaskKind | None = None
    due_date: date | None = None
    clear_due_date: bool = False
    done: bool | None = None
    assignee: Assignee | None = None
    vendor_id: int | None = None
    clear_vendor: bool = False
    note: str | None = Field(default=None, max_length=5000)
    sort_order: int | None = None


class FilePatch(BaseModel):
    kind: FileKind | None = None
    is_public: bool | None = None
    vendor_id: int | None = None
    expense_id: int | None = None
    payment_id: int | None = None
    clear_links: bool = False
    note: str | None = Field(default=None, max_length=300)
