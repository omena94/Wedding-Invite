"""以手機觸控與動畫時間點檢查開場，避免喜帖和首頁同時透字。
僅操作隔離預覽；截圖寫入暫存目錄供逐格檢視。
"""
import json
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:8010'


def main():
    output = Path(tempfile.mkdtemp(prefix='wedding-invitation-frames-'))
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(**pw.devices['iPhone 12'])
        page = context.new_page()
        for moment in (0, 90, 180, 450, 750, 1050):
            page.goto(BASE)
            page.get_by_role('button', name='翻到喜帖內頁').click()  # 兩頁喜帖：先翻到內頁再量開啟動畫
            page.get_by_role('button', name='打開婚禮喜帖').wait_for()
            # 暫停真正的 CSS 動畫，以相同時間點比較改版前後，不靠截圖耗時猜進度。
            page.evaluate("""async (moment) => {
          document.querySelector('[aria-label="打開婚禮喜帖"]').click();
          await new Promise(requestAnimationFrame);
          document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = moment; });
        }""", moment)
            opacity = page.locator('.invitation-intro').evaluate('(el) => Number(getComputedStyle(el).opacity)')
            page.screenshot(path=str(output / f'{moment:04d}ms.png'), scale='css')
            assert opacity == 1, 'Opening fades the entire invitation, allowing its text to overlap homepage text'
            if moment >= 180:
                assert page.locator('.invitation-content').evaluate('(el) => Number(getComputedStyle(el).opacity)') == 0, 'Cover text must clear before the homepage is uncovered'
                assert page.locator('.wedding-home').evaluate("el => el.classList.contains('invitation-opened')"), 'Homepage must be ready before the paper moves away'

        for width, height in ((320, 568), (360, 640), (390, 664), (430, 932), (844, 390)):
            page.set_viewport_size({'width': width, 'height': height})
            page.goto(BASE)
            cover = page.get_by_role('dialog')
            expect(cover).to_be_focused()
            # 封面頁：按鈕不被裁切、整張喜帖不需捲動
            first = page.get_by_role('button', name='翻到喜帖內頁')
            rect = first.bounding_box()
            assert rect['y'] > 44 and rect['y'] + rect['height'] < height - 12, f'Flip action clipped at {width}x{height}'
            assert cover.evaluate('(el) => el.scrollHeight <= el.clientHeight'), f'Cover clipped at {width}x{height}'
            first.tap()
            button = page.get_by_role('button', name='打開婚禮喜帖')
            rect = button.bounding_box()
            assert rect['y'] > 44 and rect['y'] + rect['height'] < height - 12, f'Action clipped at {width}x{height}'
            assert rect['height'] >= 44
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert cover.evaluate('(el) => el.scrollHeight <= el.clientHeight'), f'Invitation clipped at {width}x{height}'
            page.screenshot(path=str(output / f'cover-{width}x{height}.png'), scale='css')
            button.tap()
            # 快速連點不應提早移除紙頁或重複完成。
            button.dispatch_event('click')
            expect(cover).to_have_count(0, timeout=1800)
            expect(page.locator('h1')).to_be_focused()
            assert not page.locator('#root').evaluate('(el) => el.inert')
            page.evaluate("localStorage.removeItem('wedding-invitation-visit-v1')")

        # 動畫途中改為減少動態效果，立即結束，不留下透明遮罩擋住首頁。
        page.goto(BASE)
        page.get_by_role('button', name='翻到喜帖內頁').tap()
        page.get_by_role('button', name='打開婚禮喜帖').tap()
        page.emulate_media(reduced_motion='reduce')
        expect(page.get_by_role('dialog')).to_have_count(0, timeout=600)
        assert not page.locator('#root').evaluate('(el) => el.inert')
        print(json.dumps({'result': 'PASS', 'screenshots': str(output), 'checks': '6 transition frames, 5 mobile sizes, no ghost text, visible action, touch, repeated taps, reduced motion during opening'}))
        browser.close()


if __name__ == '__main__':
    main()
