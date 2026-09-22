"""喜餅表單的界線：盒數與金額均為整數，每次更新帶上讀取時的版本。"""
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Qty = Annotated[int, Field(ge=0, le=10000)]
Money = Annotated[int, Field(ge=0, le=100000000)]
Key = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[a-zA-Z0-9-]+$")]
Method = Literal["venue", "mail"]  # 2026-09-08 新人決定只用「婚宴當天領取」與「寄送」
PlanMethod = Literal["tbd", "venue", "mail", "personal"]  # 送餅安排可先「尚未決定」，帶入賓客時不預設


class Form(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    version: int = Field(default=1, ge=1)


class ProductIn(Form):
    name: str = Field(min_length=1, max_length=100)
    vendor_id: int | None = None
    reference_price: Money | None = None
    reserve_qty: Qty = 0
    active: bool = True


class GiftVendorIn(BaseModel):
    """喜餅廠商（2026-09-22 起可以不只一家）：沿用 vendors 表，類別固定「喜餅」，注意事項放 note。"""
    name: str = Field(min_length=1, max_length=100)
    contact_name: str = Field(default="", max_length=100)
    phone: str = Field(default="", max_length=50)
    line_id: str = Field(default="", max_length=100)
    website: str = Field(default="", max_length=300)
    note: str = Field(default="", max_length=8000)


class PlanIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1, le=10000)


class RecipientIn(Form):
    request_key: Key
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["person", "household", "group"] = "household"
    side: Literal["groom", "bride", "other"] = "other"
    contact_name: str = Field(default="", max_length=100)
    phone: str = Field(default="", max_length=50)
    address: str = Field(default="", max_length=300)
    owner: str = Field(default="", max_length=60)
    method: PlanMethod = "tbd"
    state: Literal["draft", "confirmed", "cancelled"] = "confirmed"
    due_date: date | None = None
    note: str = Field(default="", max_length=1000)
    rsvp_ids: list[int] = Field(default_factory=list, max_length=50)
    items: list[PlanIn] = Field(default_factory=list, max_length=50)


class DeliveryIn(Form):
    request_key: Key
    items: list[PlanIn] = Field(min_length=1, max_length=50)
    method: Method
    receiver: str = Field(min_length=1, max_length=100)
    handler: str = Field(default="", max_length=60)
    address: str = Field(default="", max_length=300)
    tracking: str = Field(default="", max_length=100)
    note: str = Field(default="", max_length=500)
    delivered_on: date


class DeliveryUpdate(Form):
    received_on: date | None = None
    void_reason: str = Field(default="", max_length=300)


class OrderItem(BaseModel):
    product_id: int
    paid_qty: Qty
    gift_qty: Qty = 0
    unit_price: Money


class OrderIn(Form):
    request_key: Key
    vendor_id: int | None = None  # 2026-09-10 起後台不顯示廠商，可不填
    expense_id: int | None = None
    title: str = Field(min_length=1, max_length=150)
    items: list[OrderItem] = Field(min_length=1, max_length=50)
    shipping: Money = 0
    other_cost: Money = 0
    discount: Money = 0
    budget_amount: Money = 0
    due_date: date | None = None
    received_on: date | None = None
    note: str = Field(default="", max_length=1000)
