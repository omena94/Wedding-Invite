"""喜餅實際操作：只連隔離 preview_local，不接受正式站網址。"""
import json
from pathlib import Path
import tempfile
import time

from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:8010"


def pick(page, scope, label, option):
    scope.get_by_role("combobox", name=label, exact=True).click()
    page.get_by_role("option", name=option, exact=True).click()


def main():
    output = Path(tempfile.mkdtemp(prefix="wedding-gifts-qa-"))
    suffix = str(int(time.time()))
    name, product = "測試不出席阿姨 " + suffix, "測試綜合喜餅 " + suffix
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, locale="zh-TW")
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE + "/planner/gifts")
        page.locator("body").aria_snapshot()
        page.get_by_placeholder("請輸入密碼").fill("preview-wedding-only")
        page.get_by_role("button", name="進入後台").click()
        expect(page.get_by_role("heading", name="喜餅", exact=True)).to_be_visible()
        headers = {"Authorization": "Bearer " + page.evaluate("localStorage.getItem('wedding_admin_token')")}
        before = page.request.get(BASE + "/api/admin/rsvps", headers=headers).json()
        vendor = page.request.post(BASE + "/api/planner/vendors", headers=headers, data={"name": "測試喜餅廠商 " + suffix, "category": "喜餅"}).json()
        page.reload()
        page.get_by_role("button", name="訂購與費用", exact=True).click()
        page.get_by_role("button", name="新增款式", exact=True).click()
        dialog = page.get_by_role("dialog", name="新增喜餅款式", exact=True)
        dialog.get_by_label("款式名稱", exact=True).fill(product)
        pick(page, dialog, "款式廠商", vendor["name"])
        dialog.get_by_label("參考單價", exact=True).fill("600")
        dialog.get_by_label("備用盒數", exact=True).fill("5")
        dialog.get_by_role("button", name="儲存", exact=True).click()
        expect(dialog).to_have_count(0)

        page.get_by_role("button", name="送餅名單", exact=True).click()
        page.get_by_role("button", name="新增送禮對象", exact=True).click()
        dialog = page.get_by_role("dialog", name="新增送禮對象", exact=True)
        dialog.get_by_label("送禮對象", exact=True).fill(name)
        if dialog.get_by_role("combobox", name="款式 1", exact=True).count() == 0:
            dialog.get_by_role("button", name="加入一款", exact=True).click()
        pick(page, dialog, "款式 1", product)
        dialog.get_by_label("送餅盒數 1", exact=True).fill("2")
        pick(page, dialog, "交付方式", "寄送")
        dialog.get_by_label("負責人", exact=True).fill("測試媽媽")
        dialog.get_by_role("button", name="儲存", exact=True).click()
        expect(dialog).to_have_count(0)
        card = page.locator(".gift-recipient").filter(has=page.get_by_role("heading", name=name, exact=True))
        expect(card).to_contain_text("寄送地址尚未填妥")
        expect(card).to_contain_text("未關聯婚宴回覆")
        assert page.request.get(BASE + "/api/admin/rsvps", headers=headers).json() == before
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({"width": width, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"overflow at {width}"
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(output / "gift-recipients-mobile.png"), full_page=True)

        card.get_by_role("button", name="登記交付", exact=True).click()
        dialog = page.get_by_role("dialog", name="登記交付 — " + name, exact=True)
        dialog.get_by_label(product + " 本次盒數", exact=True).fill("1")
        dialog.get_by_role("button", name="確認已寄出", exact=True).click()
        expect(dialog.get_by_role("alert")).to_contain_text("寄送寄出前請填收件地址")
        dialog.get_by_label("本次收件地址", exact=True).fill("測試縣測試路 1 號")
        dialog.get_by_label("實際收件／代領人", exact=True).fill("阿姨的家人代收")
        dialog.get_by_role("button", name="確認已寄出", exact=True).click()
        expect(dialog).to_have_count(0)
        expect(card).to_contain_text("尚欠 1 盒")
        card.get_by_role("button", name="登記交付", exact=True).click()
        dialog = page.get_by_role("dialog", name="登記交付 — " + name, exact=True)
        dialog.get_by_label(product + " 本次盒數", exact=True).fill("9")
        dialog.get_by_label("本次收件地址", exact=True).fill("測試縣測試路 1 號")
        dialog.get_by_role("button", name="確認已寄出", exact=True).click()
        expect(dialog.get_by_role("alert")).to_contain_text("超過尚未交付")
        dialog.get_by_role("button", name="取消", exact=True).click()
        card.get_by_role("button", name="交付紀錄 1", exact=True).click()
        history = page.get_by_role("dialog", name="交付紀錄 — " + name, exact=True)
        expect(history).to_contain_text("阿姨的家人代收")
        history.get_by_role("button", name="確認今天已收到", exact=True).click()
        expect(history).to_have_count(0)

        page.get_by_role("button", name="訂購與費用", exact=True).click()
        page.get_by_role("button", name="新增訂購", exact=True).click()
        dialog = page.get_by_role("dialog", name="新增喜餅訂購", exact=True)
        pick(page, dialog, "訂購廠商", vendor["name"])
        dialog.get_by_role("button", name="加入一款", exact=True).click()
        pick(page, dialog, "款式 1", product)
        dialog.get_by_label("購買盒數 1", exact=True).fill("90")
        dialog.get_by_label("廠商贈盒 1", exact=True).fill("5")
        dialog.get_by_label("成交單價 1", exact=True).fill("600")
        dialog.get_by_label("本訂購運費", exact=True).fill("1500")
        dialog.get_by_label("額外折扣", exact=True).fill("1000")
        dialog.get_by_label("訂購名稱", exact=True).fill("測試訂購 " + suffix)
        expect(dialog.locator(".gift-order-total")).to_contain_text("54,500")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=str(output / "gift-order-form-mobile.png"), full_page=True)
        dialog.get_by_role("button", name="確認訂購並記帳", exact=True).click()
        expect(dialog).to_have_count(0)
        order = page.locator(".gift-order").filter(has=page.get_by_role("heading", name="測試訂購 " + suffix, exact=True))
        expect(order).to_contain_text("54,500")
        order.get_by_role("button", name="新增訂金／尾款", exact=True).click()
        payment = page.get_by_role("dialog").filter(has=page.get_by_placeholder("定金 / 拍攝當日 / 尾款"))
        payment.get_by_placeholder("定金 / 拍攝當日 / 尾款").fill("訂金")
        payment.locator("input[inputmode=numeric]").fill("20000")
        payment.get_by_role("button", name="未付", exact=True).click()
        payment.get_by_role("button", name="今天", exact=True).click()
        payment.get_by_role("button", name="儲存", exact=True).click()
        expect(payment).to_have_count(0)
        expect(order).to_contain_text("34,500")
        order.scroll_into_view_if_needed()
        page.screenshot(path=str(output / "gift-orders-mobile.png"), full_page=True)
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.screenshot(path=str(output / "gift-orders-desktop.png"), full_page=True)
        state = page.request.get(BASE + "/api/planner/gifts", headers=headers).json()
        this_order = next(o for o in state["orders"] if o["title"] == "測試訂購 " + suffix)
        assert this_order["paid"] == 20000 and this_order["balance"] == 34500
        assert this_order["unscheduled"] == 34500
        data = page.request.get(BASE + "/api/planner/expenses", headers=headers).json()
        assert next(e for e in data if e["id"] == this_order["expense_id"])["unpaid_total"] == 34500
        assert page.request.get(BASE + "/api/admin/rsvps", headers=headers).json() == before

        page.get_by_role("button", name="送餅名單", exact=True).click()
        with page.expect_download() as download:
            page.get_by_role("button", name="匯出 CSV", exact=True).click()
        download.value.save_as(str(output / "gift-list.csv"))
        assert name in (output / "gift-list.csv").read_text(encoding="utf-8-sig")
        page.get_by_role("button", name="從賓客加入", exact=True).click()
        dialog = page.get_by_role("dialog", name="從賓客加入送餅名單", exact=True)
        dialog.get_by_role("checkbox", name="預覽賓客 · 出席 · 0912345678", exact=True).click()
        expect(dialog.get_by_label("送禮對象", exact=True)).to_have_value("預覽賓客")
        dialog.get_by_role("button", name="取消", exact=True).click()
        assert not errors, errors
        context.close(); browser.close()
    print(json.dumps({"status": "passed", "output": str(output), "checks": "independent recipient, partial delivery, mail validation, quantity guard, order, payment, CSV, guest linking, responsive widths"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
