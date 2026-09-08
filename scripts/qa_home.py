"""首頁互動回歸：只連隔離預覽，使用獨立的無頭瀏覽器設定檔。
先啟動 scripts/preview_local.py，安裝 playwright 後執行本檔。
相簿與開放階段由瀏覽器攔截提供，不更動任何資料庫或使用者瀏覽器。
"""
import json
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:8010'
ROOT = Path(__file__).resolve().parents[1]


def check_width(page, width):
    page.set_viewport_size({'width': width, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow at {width}'


def main():
    output = Path(tempfile.mkdtemp(prefix='wedding-home-qa-'))
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 390, 'height': 844}, locale='zh-TW')
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        photo_requests = []
        page.on('request', lambda request: photo_requests.append(request.url) if '/api/photos' in request.url else None)
        page.goto(BASE)
        dialog = page.get_by_role('dialog', name='宣文與孟庭的婚禮喜帖')
        expect(dialog).to_be_visible()
        expect(dialog).to_be_focused()
        assert page.locator('#root').evaluate('(el) => el.inert')
        page.keyboard.press('Tab')
        expect(page.get_by_role('button', name='略過開場')).to_be_focused()
        for width in (320, 390, 768, 1440):
            check_width(page, width)
        check_width(page, 390)
        page.screenshot(path=str(output / 'invitation-mobile.png'))
        page.get_by_role('button', name='打開婚禮喜帖').click()
        expect(dialog).to_have_count(0, timeout=4000)
        expect(page.locator('h1')).to_be_focused()
        assert not page.locator('#root').evaluate('(el) => el.inert')
        expect(page.locator('.home-primary')).to_have_attribute('href', '/rsvp')
        for width in (320, 390, 768, 1440):
            check_width(page, width)
        check_width(page, 390)
        page.get_by_role('button', name='重看喜帖').click()
        expect(dialog).to_be_visible()
        page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)
        expect(page.get_by_role('button', name='重看喜帖')).to_be_focused()
        page.get_by_role('button', name='重看喜帖').click()
        page.get_by_role('button', name='略過開場').click()
        expect(dialog).to_have_count(0)
        page.reload()
        expect(page.locator('.home-greeting')).to_contain_text('歡迎回來')
        expect(dialog).to_have_count(0)
        saved = page.evaluate("JSON.parse(localStorage.getItem('wedding-invitation-visit-v1'))")
        assert sorted(saved) == ['chapter', 'openedAt']
        page.locator('.home-signoff').scroll_into_view_if_needed()
        assert not photo_requests, 'guest must not request a closed album'
        page.evaluate('scrollTo(0,0)')
        page.wait_for_timeout(1000)
        page.screenshot(path=str(output / 'home-mobile.png'))

        # 真實登入隔離後台，再驗證相簿預覽需要 Authorization。
        page.goto(BASE + '/admin')
        page.get_by_placeholder('請輸入密碼').fill('preview-wedding-only')
        page.get_by_role('button', name='進入後台').click()
        expect(page.locator('.lock-overlay')).to_have_count(0)
        authenticated = []

        def photos(route):
            authenticated.append(bool(route.request.headers.get('authorization', '').startswith('Bearer ')))
            if route.request.url.endswith('/api/photos'):
                route.fulfill(json=[{'id': 901, 'caption': '隔離測試插畫', 'has_thumb': True, 'album': ''}])
            else:
                route.fulfill(body=(ROOT / 'frontend/public/hero.webp').read_bytes(), content_type='image/webp')

        page.route(BASE + '/api/photos**', photos)
        page.goto(BASE)
        expect(page.locator('.preview-banner')).to_be_visible()
        expect(page.locator('.home-primary')).to_have_attribute('href', '/rsvp')
        page.locator('.story-album').scroll_into_view_if_needed()
        expect(page.locator('.story-photo-grid img')).to_be_visible()
        assert authenticated and all(authenticated)
        assert page.locator('.story-photo-grid img').get_attribute('src').startswith('blob:')
        page.goto(BASE + '/photos')
        expect(page.locator('.photo-grid img')).to_be_visible()
        page.locator('.photo-cell').click()
        expect(page.locator('.photo-lightbox img')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.locator('.photo-lightbox')).to_have_count(0)

        # 僅攔截此測試分頁的階段，確認回訪新消息，不修改正式或預覽設定。
        page.route(BASE + '/api/stage', lambda route: route.fulfill(json={'phase2_open': True, 'seat_open': True, 'photos_open': False, 'preview': False}))
        page.goto(BASE)
        expect(page.locator('.home-primary')).to_have_attribute('href', '/seat')
        expect(page.locator('.home-next-label')).to_contain_text('有新消息')
        assert page.locator('.home-next .btn').bounding_box()['y'] < 740, 'returning guest should see the latest action immediately'
        page.reload()
        expect(page.locator('.home-next-label')).to_contain_text('座位查詢已開放')
        page.emulate_media(reduced_motion='reduce')
        page.get_by_role('button', name='重看喜帖').click()
        page.get_by_role('button', name='打開婚禮喜帖').click()
        expect(dialog).to_have_count(0, timeout=600)
        assert page.locator('.hero-color-reveal').evaluate('(el) => getComputedStyle(el).animationName') == 'none'
        page.set_viewport_size({'width': 1440, 'height': 1000})
        page.evaluate('scrollTo(0,0)')
        page.screenshot(path=str(output / 'home-desktop.png'), full_page=True)

        # 瀏覽器停用 localStorage 時仍能拆封與讀取公開資訊。
        private = browser.new_context(viewport={'width': 320, 'height': 740}, reduced_motion='reduce')
        private.add_init_script("Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('blocked', 'SecurityError')}})")
        blocked = private.new_page()
        blocked.on('pageerror', lambda error: errors.append(str(error)))
        blocked.goto(BASE)
        blocked.get_by_role('button', name='略過開場').click()
        expect(blocked.locator('h1')).to_be_visible()
        expect(blocked.locator('.home-primary')).to_have_attribute('href', '/rsvp')
        assert not errors, errors
        browser.close()
    print(json.dumps({'result': 'PASS', 'checks': 'first visit, invitation, skip, replay, focus, revisit, breakpoints, scroll, closed album, admin, authorized images, lightbox, stage change, reduced motion, disabled storage', 'screenshots': str(output)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
