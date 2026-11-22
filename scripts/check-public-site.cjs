// Optional browser regression: install Playwright in the execution environment,
// run site:preview, then node scripts/check-public-site.cjs (no production dependency).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const base = process.env.PUBLIC_SITE_URL || 'http://localhost:4173';
(async () => {
  const data = JSON.parse(await readFile(resolve(__dirname, '../site/data/rankings/G00001.json'), 'utf8'));
  const { analyzeCreatorPairs } = await import('../site/pair-analysis.js');
  const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const paths = ['/', '/songs/', '/videos/', '/creators/', '/more/'];
    for (const width of [320,375,390,768,1024,1440]) {
      for (const path of paths) {
        await page.setViewportSize({width,height:900});
        const response = await page.goto(base+path);
        assert.equal(response.status(),200);
        if (path === '/creators/') await page.locator('#ranking-content').waitFor({state:'visible'});
        await page.waitForTimeout(30);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),`${width} ${path}: overflow`);
        assert.equal(await page.locator('.sidebar .artists').count(),0);
        assert.equal(await page.locator('nav.desktop:visible,nav.mobile:visible').count(),1);
        assert.equal(await page.locator('nav:visible [aria-current=page]').count(),1);
        const ids = await page.locator('[id]').evaluateAll(es=>es.map(e=>e.id));
        assert.equal(new Set(ids).size,ids.length);
        assert.equal(await page.locator('[data-item-no],#review-state,#show-numbers').count(),0);
        if (path === '/more/') { assert.equal(await page.locator('.artists').count(),0); continue; }
        assert.equal(await page.locator('.artist').count(),8);
        assert.equal(await page.locator('.artist:disabled').count(),7);
        assert(await page.evaluate(()=>document.querySelector('main>h1').nextElementSibling.matches('.artists')));
        if (path === '/') {
          assert.equal(await page.locator('.artist').evaluateAll(es=>new Set(es.map(e=>e.getBoundingClientRect().top)).size),width===1440?2:4);
        } else {
          assert(await page.locator('.artist-strip').evaluate(s=>{const r=s.getBoundingClientRect(),j=s.querySelector('[aria-pressed]').getBoundingClientRect();return s.scrollWidth>s.clientWidth&&j.left>=r.left&&j.right<=r.right}));
        }
        for (const button of await page.locator('.artist:disabled').all()) {
          await button.evaluate(x=>{const s=x.closest('.artist-strip');if(getComputedStyle(s).display==='flex')s.scrollLeft=x.offsetLeft-s.offsetLeft-10});
          assert(await button.evaluate(x=>{const s=x.closest('.artist-strip').getBoundingClientRect(),l=x.querySelector('.soon').getBoundingClientRect(),n=x.querySelector('span:last-child').getBoundingClientRect();return l.top>=s.top&&l.bottom<=s.bottom&&l.left>=s.left&&l.right<=s.right&&l.bottom<=n.top}));
        }
        // Layout reserves space for the fixed mobile navigation after the footer.
        if(width<1024) assert(await page.locator('.content').evaluate(e=>parseFloat(getComputedStyle(e).paddingBottom)>=88));
      }
    }
    await page.goto(base+'/index.html');
    assert.match(await page.locator('h1').innerText(),/ハロプロ楽曲/);
    await page.locator('main a[href="./creators/"]').click();
    await page.locator('#ranking-content').waitFor({state:'visible'});
    await page.reload(); await page.goBack(); await page.goForward();
    await page.locator('#ranking-content').waitFor({state:'visible'});
    const snapshot = selector => page.locator(`${selector} article`).evaluateAll(es=>es.map(e=>({rank:parseInt(e.querySelector('.rank').textContent),name:e.querySelector('.name').textContent,count:Number(e.querySelector('.count strong').textContent),id:e.querySelector('.creator-id').textContent})));
    for (const [id,category] of Object.entries(data.categories)) {
      await page.locator(`[data-category="${id}"]`).click();
      assert.deepEqual(await snapshot('#ranking'),category.entries.map(e=>({rank:e.rank,name:e.creator_name,count:e.work_count,id:e.creator_id})));
      const button = page.locator('#ranking .name').first();
      await button.click();
      assert.deepEqual(await page.locator('#work-list li').allTextContents(),category.entries[0].works.map(w=>w.title));
      assert(!/\b(?:W\d{5}|J\d{5}|lyrics|composition)\b/.test(await page.locator('#creator-detail').innerText()));
      for(const key of ['Tab','Shift+Tab']) { await page.keyboard.press(key); assert(await page.locator('#creator-detail').evaluate(d=>d.contains(document.activeElement))); }
      await page.keyboard.press('Escape');
      assert(await button.evaluate(x=>x===document.activeElement));
      await button.click(); await page.locator('#close-detail').click();
      assert(await button.evaluate(x=>x===document.activeElement));
    }
    await page.locator('#view-pairs-tab').click();
    const checkPairs = async (direction,id) => {
      const expected=analyzeCreatorPairs(data.lyrics_composition_pairs.entries,id,direction);
      assert.deepEqual(await snapshot('#pair-ranking'),expected.entries.map(e=>({rank:e.rank,name:`${e.lyricist_name} × ${e.composer_name}`,count:e.work_count,id:`${e.lyricist_creator_id} × ${e.composer_creator_id}`})));
      if(direction!=='all') assert.match(await page.locator('#pair-self-count').innerText(),new RegExp(`：${expected.self_work_count}作品`));
      if(expected.entries.length){await page.locator('#pair-ranking .name').first().click();assert.deepEqual(await page.locator('#work-list li').allTextContents(),expected.entries[0].works.map(w=>w.title));await page.keyboard.press('Escape');}
    };
    await checkPairs('all','');
    for(const direction of ['lyricist','composer']) {
      await page.locator('#pair-direction').selectOption(direction);
      if (direction==='lyricist') assert.match(await page.locator('#pair-summary').innerText(),/作家を検索・選択/);
      const entry=data.lyrics_composition_pairs.entries[0],id=direction==='lyricist'?entry.lyricist_creator_id:entry.composer_creator_id;
      await page.locator('#pair-creator').fill(id);
      await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
      assert.equal(await page.locator('#pair-creator').getAttribute('aria-expanded'),'false');
      await checkPairs(direction,id);
      await page.locator('#pair-creator').fill(id);
      await page.locator('#pair-creator-options [role=option]').first().click();
      assert.equal(await page.locator('#pair-creator').getAttribute('aria-expanded'),'false');
      await checkPairs(direction,id);
      const before=await snapshot('#pair-ranking');
      await page.locator('#pair-creator').fill('存在しない作家');
      assert.match(await page.locator('#pair-creator-options').innerText(),/該当する作家/);
      await page.keyboard.press('Enter');assert.deepEqual(await snapshot('#pair-ranking'),before);
      await page.keyboard.press('Escape');assert.match(await page.locator('#pair-creator').inputValue(),new RegExp(id));
    }
    // Hold the response to observe the actual loading state before successful data.
    const loading = await browser.newPage();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await loading.route('**/data/rankings/G00001.json', async route => {
      await held;
      await route.fulfill({contentType:'application/json', body:JSON.stringify(data)});
    });
    await loading.goto(base+'/creators/', {waitUntil:'domcontentloaded'});
    assert.equal(await loading.locator('#data-status').innerText(),'読み込み中…');
    assert(!await loading.locator('#ranking-content').isVisible());
    release();
    await loading.locator('#ranking-content').waitFor({state:'visible'});
    await loading.close();
    const states = [
      ['failure',null,503], ['malformed','{',200],
      ['empty',{...data,categories:Object.fromEntries(Object.entries(data.categories).map(([k,v])=>[k,{...v,entries:[]}]))},200],
      ['missing-pairs',{...data,lyrics_composition_pairs:undefined},200],
      ['invalid-pairs',{...data,lyrics_composition_pairs:{entries:[null]}},200]
    ];
    for(const [name,body,status] of states){
      const p=await browser.newPage();
      await p.route('**/data/rankings/G00001.json',route=>route.fulfill({status,contentType:'application/json',body:typeof body==='string'?body:JSON.stringify(body)}));
      await p.goto(base+'/creators/');
      if(name==='failure'||name==='malformed'){await p.locator('#data-status').filter({hasText:'データを表示できません'}).waitFor();assert(!await p.locator('#ranking-content').isVisible());}
      else{await p.locator('#ranking-content').waitFor({state:'visible'});if(name==='empty')assert.match(await p.locator('#summary').innerText(),/表示できるデータがありません/);else{assert(await p.locator('#ranking article').count()>0);await p.locator('#view-pairs-tab').click();assert.match(await p.locator('#pair-summary').innerText(),name==='invalid-pairs'?/表示できません/:/まだ生成/);assert(!await p.locator('.pair-controls').isVisible());}}
      await p.close();
    }
    assert.equal((await page.request.get(base+'/does-not-exist/')).status(),404);
    const more=await page.request.get(base+'/more/');assert.match(await more.text(),/rel="noopener noreferrer"/);
    assert.deepEqual(errors,[]);
    console.log('PASS: 30 responsive cases; direct URLs/history/404; five full ranking categories, pair directions/self counts and evidence compared to unchanged JSON; combobox/dialog keyboard; failure/empty/missing pairs.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
