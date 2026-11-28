"""Chromium checks on search and detail using the same prefixed preview as creators.py."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4173'
ROOT = Path(__file__).resolve().parents[2]
RANKINGS = json.loads((ROOT / 'site/data/rankings/G00001.json').read_text())
SONGS = json.loads((ROOT / 'site/data/songs/G00001.json').read_text())
DATES = {w['work_id']: w['first_release_date'] for w in SONGS['works']}
CATEGORIES = RANKINGS['categories']
LABELS = {'lyrics': '作詞', 'composition': '作曲', 'arrangement': '編曲',
          'english_lyrics': '英語詞', 'brass_arrangement': 'ブラス編曲'}
CREATORS = ['つんく', '平田祥一郎', '山崎あおい', '星部ショウ', '鈴木桃子', '鈴木俊介']
LIST = BASE + '/site/creators/'
DETAIL = LIST + 'detail/'


def assert_detail(page, entry):
    page.wait_for_selector('#creator-content:visible')
    assert page.locator('h1').inner_text() == entry['creator_name']
    assert page.locator('#creator-overview').inner_text() == f"Juice=Juice・総担当 {entry['work_count']}曲"
    expected_ranks = []
    for category in CATEGORIES.values():
        other = next((e for e in category['entries'] if e['creator_id'] == entry['creator_id']), None)
        expected_ranks.append([category['label'], f"{other['rank']}位" if other else '順位なし',
                               f"{other['work_count'] if other else 0}曲"])
    rank_rows = page.locator('#creator-ranks tr')
    assert [row.locator('th,td').all_text_contents() for row in rank_rows.all()] == expected_ranks
    works = sorted(entry['works'], key=lambda w: (DATES[w['work_id']] or '9999-99-99', w['work_id']))
    assert len(works) == entry['work_count'] == len({w['work_id'] for w in works})
    assert page.locator('[data-role="all"]').get_attribute('aria-pressed') == 'true'
    counts = {}
    for role in ['all', 'lyrics', 'composition', 'arrangement', 'other']:
        page.locator(f'[data-role="{role}"]').click()
        expected = [
            w for w in works if role == 'all' or role in w['roles']
            or (role == 'other' and set(w['roles']) - {'lyrics', 'composition', 'arrangement'})
        ]
        assert page.locator('#creator-work-list li > span:first-child').all_text_contents() == [w['title'] for w in expected]
        badges = page.locator('#creator-work-list li').evaluate_all(
            "(rows) => rows.map(row => [...row.querySelectorAll('.role-badge')].map(b => b.textContent))")
        assert badges == [[label for value, label in LABELS.items() if value in w['roles']] for w in expected]
        assert page.locator('#creator-work-status').inner_text() == (
            f'{len(expected)}曲' if expected else '該当する担当楽曲がありません。')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        counts[role] = len(expected)
    return {'creator': entry['creator_name'], 'ranks': expected_ranks, 'filters': counts,
            'oldest': works[0]['title'], 'last': works[-1]['title']}


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    for width in [320, 390, 1440]:
        page = browser.new_page(viewport={'width': width, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(LIST)
        page.wait_for_selector('#ranking-content:visible')
        assert page.locator('.view-tab').all_text_contents() == ['作家検索', '曲数ランキング', '組み合わせランキング']
        assert page.locator('#view-search-tab').get_attribute('aria-selected') == 'true'
        results = page.locator('#creator-search-results a')
        names = CATEGORIES['all']['entries']
        assert results.count() == len(names)
        expected_ids = page.evaluate("""entries => entries.sort((a, b) =>
          new Intl.Collator('ja', {sensitivity:'variant'}).compare(a.creator_name.normalize('NFKC'), b.creator_name.normalize('NFKC'))
          || a.creator_id.localeCompare(b.creator_id, 'en')).map(e => e.creator_id)""", names)
        assert results.evaluate_all("(links) => links.map(a => new URL(a.href).searchParams.get('creator_id'))") == expected_ids
        search = page.locator('#creator-search')
        search.fill('C00028')
        assert page.locator('#creator-search-empty').is_visible()
        search.fill('桃子')
        assert results.all_text_contents() == ['鈴木桃子']
        results.first.click()
        page.wait_for_selector('#creator-content:visible')
        assert page.locator('h1').inner_text() == '鈴木桃子'
        page.go_back()
        page.wait_for_selector('#creator-search:visible')
        assert search.input_value() == '桃子'
        results.first.click()
        page.locator('#creator-back').click()
        page.wait_for_selector('#creator-search:visible')
        assert search.input_value() == '桃子'
        page.locator('#view-ranking-tab').click()
        page.locator('#category-composition').click()
        page.locator('#ranking a.name').first.click()
        page.wait_for_selector('#creator-content:visible')
        page.go_back()
        page.wait_for_selector('#category-composition')
        assert page.locator('#category-composition').get_attribute('aria-selected') == 'true'
        page.locator('#ranking a.name').first.click()
        page.locator('#creator-back').click()
        page.wait_for_selector('#category-composition')
        assert page.locator('#category-composition').get_attribute('aria-selected') == 'true'
        page.locator('#view-search-tab').click()
        assert search.input_value() == '桃子'
        for name in CREATORS:
            entry = next(e for e in names if e['creator_name'] == name)
            page.goto(DETAIL + f"?creator_id={entry['creator_id']}&artist_id=G00001")
            report = assert_detail(page, entry)
            page.reload()
            page.wait_for_selector('#creator-content:visible')
            assert page.locator('h1').inner_text() == name
            assert page.locator('#creator-work-list li').count() == entry['work_count']
            if width == 1440:
                print(json.dumps(report, ensure_ascii=False))
        page.locator('#creator-back').click()
        page.wait_for_selector('#creator-search:visible')
        assert search.input_value() == ''
        for query in ['', '?creator_id=C00028', '?artist_id=G00001',
                      '?creator_id=C00028&artist_id=G99999', '?creator_id=invalid&artist_id=G00001',
                      '?creator_id=C99999&artist_id=G00001', '?creator_id=C00018&artist_id=G00001']:
            page.goto(DETAIL + query)
            page.wait_for_function("!document.querySelector('#creator-status').textContent.includes('読み込み中')")
            assert page.locator('#creator-status').is_visible()
            assert page.locator('#creator-content').is_hidden()
        assert not errors, errors
        page.close()
        print(f'{width}px search, detail, routes and browser back passed')
    for width in [390, 1440]:
        page = browser.new_page(viewport={'width': width, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        mock = BASE + '/docs/design/screens/mockups/creators.html'
        page.goto(mock)
        page.locator('#mock-creator-search').fill('作家Ａ')
        page.locator('#mock-search-results a:visible').click()
        assert page.locator('#creator-heading').inner_text() == 'サンプル作家A'
        assert page.locator('#creator-work-list li:visible').count() == 8
        page.locator('[data-role="other"]').click()
        assert page.locator('#creator-work-list .role-badge:visible').all_text_contents() == ['英語詞']
        page.locator('#creator-back').click()
        assert page.locator('#mock-creator-search').input_value() == '作家Ａ'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        for path in ['', 'songs/', 'videos/']:
            response = page.goto(BASE + '/site/' + path)
            assert response.ok and page.locator('main h1').is_visible()
        page.goto(BASE + '/site/songs/')
        page.locator('#song-search').fill('微炭酸')
        page.locator('#works button').first.click()
        assert page.locator('#song-dialog').is_visible()
        page.keyboard.press('Escape')
        assert page.locator('#song-dialog').is_hidden()
        assert not errors, errors
        page.close()
        print(f'{width}px mock and home/song/video smoke checks passed')
    browser.close()
