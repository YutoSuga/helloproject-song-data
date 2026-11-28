"""Verify the shared responsive header and creator presentation in Chromium."""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173'
WIDTHS = [320, 375, 390, 430, 768, 1023, 1024, 1440]
DETAIL_QUERY = '?creator_id=C00028&artist_id=G00001'

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    for width in WIDTHS:
        page = browser.new_page(viewport={'width': width, 'height': 600})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        for mock in [False, True]:
            root = BASE + ('/docs/design/screens/mockups/' if mock else '/site/')
            paths = (['index.html', 'songs.html', 'videos.html', 'creators.html', 'creator-detail.html', 'more.html']
                     if mock else ['', 'songs/', 'videos/', 'creators/', 'creators/detail/' + DETAIL_QUERY, 'more/'])
            for path in paths:
                assert page.goto(root + path).ok
                mobile = width <= 1023
                header = page.locator('.sp-brand')
                assert header.is_visible() == mobile
                assert page.locator('.sidebar').is_visible() != mobile
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                if mobile:
                    assert header.evaluate("""e => {
                      const s = getComputedStyle(e);
                      return s.position === 'sticky' && s.backgroundColor === 'rgb(127, 22, 69)'
                        && s.color === 'rgb(255, 255, 255)' && getComputedStyle(e.querySelector('small')).color === s.color;
                    }""")
                    box = header.bounding_box()
                    assert box['y'] == 0 and box['width'] == width and box['height'] == 56, (path, mock, width, box)
                    assert page.locator('main').bounding_box()['y'] >= 72
                    page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
                    assert abs(header.bounding_box()['y']) <= 1
                    nav = page.locator('.mobile').bounding_box()
                    assert nav['y'] + nav['height'] == 600 and nav['y'] > box['height']
                    assert header.evaluate("(e) => new URL(e.href).pathname.endsWith('/site/') || e.href.endsWith('/index.html')")
            page.goto(root + paths[3])
            tabs = page.locator('#creator-views button')
            tabs.first.wait_for()
            assert tabs.all_text_contents() == ['作家検索', '曲数ランキング', '組み合わせ分析']
            assert tabs.first.get_attribute('aria-selected') == 'true'
            assert tabs.evaluate_all("""tabs => tabs.every((e, i) => {
              const r = e.getBoundingClientRect();
              const previous = tabs[i - 1]?.getBoundingClientRect();
              return r.top === tabs[0].getBoundingClientRect().top && r.right <= innerWidth
                && r.height >= 44 && (!previous || previous.right <= r.left)
                && e.scrollWidth <= e.clientWidth && (!matchMedia('(max-width:1023px)').matches
                  || getComputedStyle(e).whiteSpace === 'nowrap');
            })""")
            if not mock:
                assert page.locator('#creator-search-count').inner_text() == '88作家'
                row = page.locator('#creator-search-results li').first
                row_style = row.evaluate("""e => {
                  const s = getComputedStyle(e);
                  return [s.padding, s.borderTopWidth, s.borderBottom, s.borderRadius, e.offsetWidth];
                }""")
                assert row_style[:4] == ['12px 0px', '0px', '1px solid rgb(221, 204, 211)', '0px']
                assert row.locator('a').evaluate("(e) => getComputedStyle(e).textDecorationLine") == 'none'
                page.goto(root + 'songs/')
                work = page.locator('#works .work-card').first
                work.wait_for()
                assert work.evaluate("""e => {
                  const s = getComputedStyle(e);
                  return [s.padding, s.borderTopWidth, s.borderBottom, s.borderRadius, e.offsetWidth];
                }""") == row_style
                page.goto(root + paths[3])
                tabs.first.wait_for()
            tabs.nth(1).click()
            assert page.locator('#ranking-panel').is_visible()
            tabs.nth(2).click()
            assert page.locator('#pair-panel').is_visible()
            page.locator('#pair-panel button.name:visible').first.click()
            dialog = page.locator('dialog[open]')
            assert dialog.is_visible() and dialog.evaluate("(e) => e.matches(':modal')")
            dialog.locator('.dialog-close').click()
            assert dialog.count() == 0
            page.goto(root + paths[4] + ('?sample=3' if mock else ''))
            page.locator('#creator-ranks tr').first.wait_for()
            assert page.locator('#creator-ranks tr').last.locator('td').all_text_contents() == ['ー', '0曲']
            back = page.locator('#creator-back')
            assert back.locator('[aria-hidden="true"]').inner_text() == '‹'
            assert back.bounding_box()['height'] >= 44
            if mobile:
                assert back.bounding_box()['y'] - 56 >= 16
                header.click()
                assert page.locator('main h1').is_visible()
                assert page.url.endswith('/site/') or page.url.endswith('/index.html')
                page.locator('.mobile a').nth(1).click()
                assert page.url.endswith('/songs/') or page.url.endswith('/songs.html')
        assert not errors, errors
        print(f'{width}px public pages and mocks passed')
        page.close()
    browser.close()
