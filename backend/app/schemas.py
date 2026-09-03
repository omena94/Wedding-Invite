"""Pydantic 資料驗證模型（API 進出格式）。"""
from datetime import datetime
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


# ===== 截止日期設定 =====
class DeadlinesIn(BaseModel):
    phase1_deadline: str = Field(default="", max_length=10)  # "YYYY-MM-DD" 或空字串=不設限
    phase2_deadline: str = Field(default="", max_length=10)


# ===== 群發通知 =====
class BroadcastIn(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=5000)
    target: Literal["pending", "attending_all"] = "pending"  # 尚未填詳細 / 所有出席者
    test_to: str = Field(default="", max_length=200)  # 有值 = 只寄一封測試信到此信箱


# ===== 登入 =====
class LoginIn(BaseModel):
    password: str


class LoginOut(BaseModel):
    token: str


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
