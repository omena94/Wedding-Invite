"""將賓客輸入與舊資料都轉成相同的電話格式。"""
import re
from sqlalchemy import case, func, literal


def normalize_phone(value: str) -> str:
    p = re.sub(r"[\s\-()]", "", value or "")
    if re.fullmatch(r"\+?8869\d{8}", p):
        return "0" + p.lstrip("+")[3:]
    return p


def phone_column(column):
    p = column
    for char in (" ", "-", "(", ")", "\t", "\n", "\r"):
        p = func.replace(p, char, "")
    return case((p.like("+8869%"), literal("0").concat(func.substr(p, 5))), (p.like("8869%"), literal("0").concat(func.substr(p, 4))), else_=p)
