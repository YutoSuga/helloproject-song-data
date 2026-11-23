"""Optional Chromium checks: python test/browser/creators.py [repository HTTP URL].
Requires Python Playwright and Chromium; no application dependency is added.
Serve the repository root (not only site/) to include the HTML mock.
"""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173'
ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads((ROOT / 'site/data/rankings/G00001.json').read_text())
WIDTHS = [320, 375, 390, 768, 1024, 1440]

def check(condition, message):
    assert condition, message

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    for mock in [False, True]:
        url = '/docs/design/screens/mockups/creators.html' if mock else '/site/creators/'
        query = '#creator-query' if mock else '#pair-creator'
        lyrics = '#filter-lyrics' if mock else '#pair-lyrics'
        composition = '#filter-composition' if mock else '#pair-composition'
        clear = '#filter-clear' if mock else '#pair-clear'
        cards = '#pair-cards article:visible' if mock else '#pair-ranking article'
        summary = '#pair-summary'
        modal = '#evidence-dialog' if mock else '#creator-detail'
        works = '#evidence-works' if mock else '#work-list'
        page.goto(BASE + url)
        if not mock:
            page.wait_for_selector('#ranking-content:visible')
        page.locator('[data-view="pair"]' if mock else '#view-pairs-tab').click()
        total = page.locator(cards).count()
        check(total == (3 if mock else 68), 'initial all pairs')
        check(page.locator(lyrics).is_disabled() and page.locator(composition).is_disabled(), 'initial disabled')
        def select(id):
            page.locator(query).fill(id)
            page.locator(query).press('ArrowDown')
            page.locator(query).press('Enter')
        select('C99991' if mock else 'C00001')
        check(page.locator(lyrics).is_enabled(), 'selected enabled')
        page.locator(lyrics).check()
        page.locator(composition).check()
        check(page.locator(cards).count() == 1, 'self pair AND')
        select('C99992' if mock else 'C00002')
        check(page.locator(lyrics).is_checked() and page.locator(composition).is_checked(), 'change keeps checks')
        check(page.locator(cards).count() == 0, 'non-self AND empty')
        check('条件に一致する組み合わせがありません' in page.locator(summary).inner_text(), 'result empty message')
        page.locator(query).fill('不存在の作家')
        check('該当する作家がありません' in page.locator('#combo-live').inner_text(), 'candidate empty message')
        check(page.locator(cards).count() == 0, 'draft preserves selection')
        page.locator(query).press('Escape')
        check('C99992' in page.locator(query).input_value() if mock else 'C00002' in page.locator(query).input_value(), 'escape restores label')
        page.locator(query).fill('')
        check(page.locator(lyrics).is_disabled() and not page.locator(lyrics).is_checked(), 'empty clears selection')
        check(page.locator(cards).count() == total, 'empty shows all')
        select('C99991' if mock else 'C00001')
        page.locator(query).fill('draft')
        page.locator(clear).click()
        check(page.locator(query).input_value() == '' and page.locator(cards).count() == total, 'clear draft and results')
        check(page.locator(query).get_attribute('aria-expanded') == 'false', 'clear closes list')
        # Synthetic composition verifies the guard; this is not an OS IME test.
        page.locator(query).fill('C99991' if mock else 'C00001')
        page.locator(query).press('ArrowDown')
        page.locator(query).dispatch_event('compositionstart')
        page.locator(query).dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
        check(page.locator(lyrics).is_disabled(), 'composition Enter must not commit')
        page.locator(query).dispatch_event('compositionend')
        page.locator(query).press('Enter')
        check(page.locator(lyrics).is_enabled(), 'Enter after composition commits')
        page.locator(query).fill(' サンプル ' if mock else ' ｃ００００１ ')
        options = page.locator('#creator-options [role=option]' if mock else '#pair-creator-options [role=option]')
        check(options.count() > 0, 'normalized substring search')
        options.first.click()
        check(page.locator(query).evaluate('(el) => el === document.activeElement'), 'pointer selection keeps focus')
        page.locator(query).click()
        page.locator('#pair-panel h2').click()
        check(page.locator(query).get_attribute('aria-expanded') == 'false', 'outside closes options')
        page.reload()
        if not mock: page.wait_for_selector('#ranking-content:visible')
        page.locator('[data-view="pair"]' if mock else '#view-pairs-tab').click()
        check(page.locator(lyrics).is_disabled() and page.locator(query).input_value() == '', 'reload resets')
        for width in WIDTHS:
            page.set_viewport_size({'width': width, 'height': 900})
            page.locator(query).click()
            page.locator(query).fill('C99991' if mock else 'C00001')
            page.locator(query).press('ArrowUp')
            check(page.locator(query).get_attribute('aria-activedescendant'), 'active option ARIA')
            page.locator(query).press('Enter')
            page.locator(lyrics).check()
            page.locator(composition).uncheck()
            check(page.locator(cards).count() > 0, 'lyrics filter')
            page.locator(lyrics).uncheck()
            page.locator(composition).check()
            check(page.locator(cards).count() > 0, 'composition filter')
            page.locator(cards).first.locator('button.name').click()
            check(page.locator(modal).is_visible(), 'pair modal')
            check(page.locator(modal + ' .role-badge').count() == 0, 'no pair badges')
            page.keyboard.press('Escape')
            check(page.evaluate('document.activeElement.classList.contains("name")'), 'modal focus returns')
            page.locator('[data-view="ranking"]' if mock else '#view-ranking-tab').click()
            if not mock: page.locator('#category-lyrics_or_composition').click()
            opener = page.locator('#ranking-cards button.name' if mock else '#ranking button.name').first
            opener.click()
            check(page.evaluate('document.activeElement.classList.contains("dialog-close")'), 'initial modal focus')
            check(page.locator(works + ' .role-badge').count() > 0, 'creator badges')
            if not mock:
                entry = DATA['categories']['lyrics_or_composition']['entries'][0]
                check(page.locator(works + ' li > span:first-child').all_text_contents() == [w['title'] for w in entry['works']], 'work list/count/order unchanged')
            # Stress long text and all three badges without changing canonical data.
            page.locator(works + ' li').first.evaluate('''li => {
              li.firstElementChild.textContent = '長い作品名'.repeat(30);
              const badges = li.querySelector('.role-badges');
              badges.replaceChildren(...['作詞','作曲','編曲'].map(text => {const s=document.createElement('span');s.className='role-badge';s.textContent=text;return s}));
            }''')
            check(page.locator(modal).evaluate('(el) => el.scrollWidth <= el.clientWidth'), 'modal no horizontal overflow')
            page.keyboard.press('Escape')
            page.locator('[data-view="pair"]' if mock else '#view-pairs-tab').click()
            page.locator(query).fill('C99991' if mock else 'C00001')
            page.locator(query).press('ArrowDown')
            page.locator('#creator-options [role=option]' if mock else '#pair-creator-options [role=option]').first.evaluate("el => el.textContent = '長い作家名'.repeat(30)")
            check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'page/candidate no horizontal overflow')
            page.keyboard.press('Tab')
            page.wait_for_function('(selector) => document.querySelector(selector).getAttribute("aria-expanded") === "false"', arg=query)
            page.locator(clear).click()
        print(('mock' if mock else 'production') + ': interactions and 6 widths passed')
    # Every category keeps its own first creator's works and renders exactly
    # the union from the three ordinary categories, in fixed Japanese order.
    page.goto(BASE + '/site/creators/')
    page.wait_for_selector('#ranking-content:visible')
    labels = {'lyrics': '作詞', 'composition': '作曲', 'arrangement': '編曲'}
    for category, definition in DATA['categories'].items():
        page.locator('#category-' + category).click()
        entry = definition['entries'][0]
        page.locator('#ranking button.name').first.click()
        check(page.locator('#work-list li > span:first-child').all_text_contents() == [w['title'] for w in entry['works']], 'category works preserved')
        for row, work in enumerate(entry['works']):
            expected = []
            for role, label in labels.items():
                if any(e['creator_id'] == entry['creator_id'] and any(w['work_id'] == work['work_id'] for w in e['works']) for e in DATA['categories'][role]['entries']):
                    expected.append(label)
            check(page.locator('#work-list li').nth(row).locator('.role-badge').all_text_contents() == expected, 'exact ordered badge union')
        page.keyboard.press('Escape')
    print('all five categories: work lists, counts, order and exact badge unions passed')
    # Bad role evidence must use the existing load-error UI.
    invalid = json.loads(json.dumps(DATA))
    invalid['categories']['lyrics']['entries'][0]['works'][0]['work_id'] = None
    page.route('**/data/rankings/G00001.json', lambda route: route.fulfill(json=invalid))
    page.goto(BASE + '/site/creators/')
    page.wait_for_function('document.querySelector("#data-status").textContent.includes("データを表示できません")')
    check(not errors, str(errors))
    print('invalid role evidence: load error passed; no JavaScript errors')
    page.unroute('**/data/rankings/G00001.json')
    for name in ['index', 'songs', 'videos', 'more']:
        page.goto(BASE + '/docs/design/screens/mockups/' + name + '.html')
        if name == 'songs':
            page.locator('#song-search').fill('サンプル')
            page.locator('.work-open').first.click()
            check(page.locator('#song-dialog').is_visible(), 'shared song mock modal')
            page.keyboard.press('Escape')
    check(not errors, str(errors))
    print('other four mock pages: no JavaScript errors; songs search/dialog passed')
    browser.close()
