"""UI refinement checks; serve site and mock files at the supplied preview root."""
import sys
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:4175'
out=Path(os.environ.get('SCREENSHOT_DIR','/tmp/creator-ui-images'));out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
 page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 for mock in [False,True]:
  for width in [320,375,390,768,1024,1440]:
   page.set_viewport_size({'width':width,'height':1000})
   page.goto(base+('/docs/design/screens/mockups/creators.html' if mock else '/site/creators/'))
   page.locator('[data-view="pair"]' if mock else '#view-pairs-tab').click()
   q=page.locator('#creator-query' if mock else '#pair-creator');l=page.locator('#filter-lyrics' if mock else '#pair-lyrics');c=page.locator('#filter-composition' if mock else '#pair-composition');clear=page.locator('#filter-clear' if mock else '#pair-clear');condition=page.locator('#pair-condition')
   assert q.get_attribute('aria-label')=='作家名またはIDで検索'
   assert condition.inner_text()=='すべての作詞・作曲ペアを表示しています。'
   def choose(id):
    q.fill(id);q.press('ArrowDown');q.press('Enter')
   choose('C99991' if mock else 'C00001');name='サンプル作家A' if mock else '山崎あおい'
   for lyrics,composition,role in [(False,False,'作詞、または作曲'),(True,False,'作詞'),(False,True,'作曲'),(True,True,'作詞・作曲の両方')]:
    l.set_checked(lyrics);c.set_checked(composition)
    assert condition.inner_text()==name+'が'+role+'を担当した組み合わせ'
   choose('C99992' if mock else 'C00002')
   expected=('サンプル作家B' if mock else 'KOUGA')+'が作詞・作曲の両方を担当した組み合わせ'
   assert condition.inner_text()==expected
   assert '条件に一致する' in page.locator('#pair-summary').inner_text()
   q.fill('未確定');assert condition.inner_text()==expected;q.press('Escape')
   clear.click();assert condition.inner_text()=='すべての作詞・作曲ペアを表示しています。'
   boxes=[x.bounding_box() for x in [l,c,clear]]
   assert max(x['y'] for x in boxes)-min(x['y'] for x in boxes)<25
   assert boxes[2]['width']<width/2
   assert condition.bounding_box()['y']<page.locator('#pair-summary').bounding_box()['y']
   choose('C99991' if mock else 'C00001')
   q.fill('long draft');assert '未確定' not in condition.inner_text();q.press('Escape')
   condition.evaluate("el=>el.textContent='とても長い作家名'.repeat(20)+'が作詞を担当した組み合わせ'")
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   clear.click()
   if width in [375,1440]:
    page.locator('#pair-panel').scroll_into_view_if_needed();page.screenshot(path=str(out/f'{"mock" if mock else "site"}-{width}.png'))
  print(('mock' if mock else 'site')+': condition states, layout and six widths passed',flush=True)
 assert not errors,errors
 b.close()
