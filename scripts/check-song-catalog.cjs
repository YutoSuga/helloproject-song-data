// Optional Chromium checks. Run site:preview first; Playwright is environment-only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const base = process.env.PUBLIC_SITE_URL || 'http://localhost:4173';
async function checkWorkSeparators(page) {
  const borders=await page.locator('.work-card').evaluateAll(rows=>rows.map(row=>{
    const style=getComputedStyle(row);return {width:style.borderBottomWidth,style:style.borderBottomStyle};
  }));
  borders.forEach((border,index)=>{
    const last=index===borders.length-1;
    assert.equal(border.width,last?'0px':'1px',`work ${index}: separator width`);
    assert.equal(border.style,last?'none':'solid',`work ${index}: separator style`);
  });
  assert.equal(await page.locator('footer').evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
}

(async()=>{
  const real=JSON.parse(await readFile(resolve(__dirname,'../site/data/songs/G00001.json'),'utf8'));
  const {selectWorks}=await import('../site/song-catalog-model.js');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const errors=[];
  try {
    const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    for(const width of [320,375,390,768,1024,1440]) {
      await page.setViewportSize({width,height:900});await page.goto(base+'/songs/');
      await page.locator('.work-open').first().waitFor();
      assert.equal(await page.locator('.work-card').count(),real.works.length);
      assert.equal(await page.locator('#song-summary').innerText(),`${real.works.length}作品`);
      await checkWorkSeparators(page);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(await page.locator('#song-sort option').allTextContents(),['発売日が新しい順','発売日が古い順','曲名順']);
      assert(await page.locator('.work-card').first().evaluate(e=>{
        const s=getComputedStyle(e);return s.borderTopWidth==='0px'&&s.borderLeftWidth==='0px'&&s.borderRightWidth==='0px'&&s.borderBottomWidth==='1px'&&s.borderRadius==='0px'&&s.paddingTop==='12px';
      }));
      assert(await page.locator('.work-open').first().evaluate(e=>e.getBoundingClientRect().height>=44));
      const noct=page.locator('.work-card').filter({has:page.getByRole('button',{name:'ノクチルカ',exact:true})});
      assert.equal(await noct.locator('p').innerText(),'音源初出日：確認中');
      await noct.locator('button').click();
      const noctSong=page.locator('.song-detail-card').filter({hasText:'song ID：J00021'});
      assert.equal(await noctSong.getByText('音源初出日：確認中',{exact:true}).count(),1);
      await page.locator('#song-close').click();
      for(const sort of ['new','old','title']) {
        await page.locator('#song-sort').selectOption(sort);
        assert.deepEqual(await page.locator('.work-open').allTextContents(),selectWorks(real.works,'',sort).map(w=>w.title));
        await checkWorkSeparators(page);
      }
      for(const query of [real.works[0].title,real.works[0].search_creator_names[0],`${real.works[0].title} ${real.works[0].search_creator_names[0]}`,'見つからない検索語']) {
        await page.locator('#song-search').fill(query);
        assert.deepEqual(await page.locator('.work-open').allTextContents(),selectWorks(real.works,query,'title').map(w=>w.title));
        await checkWorkSeparators(page);
      }
      assert.equal(await page.locator('#songs-status').innerText(),'検索結果は0件です。');
      assert.equal(await page.locator('#song-summary').innerText(),'0作品');
      assert.equal(await page.locator('.work-card').count(),0);
      assert(await page.locator('#songs-status').isVisible());
      const single=real.works.find(w=>selectWorks(real.works,w.title).length===1);
      assert(single,'real data must have a unique title for the one-result check');
      await page.locator('#song-search').fill(single.title);
      assert.equal(await page.locator('.work-card').count(),1);
      for(const sort of ['new','old','title']) {
        await page.locator('#song-sort').selectOption(sort);
        await checkWorkSeparators(page);
      }
      const multiple=real.works.flatMap(w=>w.search_creator_names).find(name=>selectWorks(real.works,name).length>1);
      assert(multiple,'real data must have a creator shared by multiple works');
      await page.locator('#song-search').fill(multiple);
      assert(await page.locator('.work-card').count()>1);
      for(const sort of ['new','old','title']) {
        await page.locator('#song-sort').selectOption(sort);
        assert.deepEqual(await page.locator('.work-open').allTextContents(),selectWorks(real.works,multiple,sort).map(w=>w.title));
        await checkWorkSeparators(page);
      }
      await page.locator('#song-search').fill('');
      await checkWorkSeparators(page);
      // Every real work and every version/credit is checked against generated JSON.
      let songs=0;
      for(const work of real.works) {
        const button=page.getByRole('button',{name:work.title,exact:true});
        await button.click();
        assert.equal(await page.locator('#song-dialog-title').innerText(),work.title);
        assert.equal(await page.locator('#song-detail .song-detail-card').count(),work.songs.length);
        for(const [index,song] of work.songs.entries()) {
          const card=page.locator('.song-detail-card').nth(index);
          assert.equal(await card.locator('h3').innerText(),song.title);
          assert(await card.evaluate(e=>{
            const s=getComputedStyle(e);return s.borderTopWidth==='1px'&&s.borderLeftWidth==='0px'&&s.borderRightWidth==='0px'&&s.borderBottomWidth==='0px'&&s.borderRadius==='0px'&&s.paddingTop==='12px';
          }));
          const text=await card.innerText();
          for(const credit of song.credits)assert(text.includes(credit.credit_name));
          assert(text.includes(`音源初出日：${song.release_date ?? '確認中'}`));
          songs++;
        }
        assert.equal(await page.locator('#song-close').evaluate(e=>e===document.activeElement),true);
        await page.keyboard.press('Tab');assert.equal(await page.locator('#song-close').evaluate(e=>e===document.activeElement),true);
        await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#song-close').evaluate(e=>e===document.activeElement),true);
        assert(await page.locator('#song-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));
        await page.keyboard.press('Escape');assert(!await page.locator('#song-dialog').isVisible());assert(await button.evaluate(e=>e===document.activeElement));
      }
      assert.equal(songs,real.works.reduce((n,w)=>n+w.songs.length,0));
      if(width===390||width===1440)await page.screenshot({path:`/tmp/song-catalog-${width}.png`,fullPage:false});
    }
    const fixture=structuredClone(real);fixture.works=fixture.works.slice(0,3);
    fixture.works[0].title='ＡＢＣ 作品';fixture.works[0].search_creator_names=['掲載名','正規名'];fixture.works[0].songs[0].title='音源タイトル専用語';
    fixture.works[1].first_release_date=null;fixture.works[1].songs.forEach(s=>s.release_date=null);
    fixture.works[2].first_release_date=fixture.works[0].first_release_date;
    await page.route('**/data/songs/G00001.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fixture)}));
    await page.goto(base+'/songs/');await page.locator('.work-open').first().waitFor();
    for(const query of ['abc　正規名 掲載名','音源タイトル専用語']) {
      await page.locator('#song-search').fill(query);
      assert.equal(await page.locator('.work-card').count(),query.startsWith('abc')?1:0);
    }
    await page.locator('#song-search').fill('');
    for(const sort of ['new','old']) {
      await page.locator('#song-sort').selectOption(sort);
      assert.equal(await page.locator('.work-open').last().innerText(),fixture.works[1].title);
    }
    const missingDateCard=page.locator('.work-card').filter({has:page.getByRole('button',{name:fixture.works[1].title,exact:true})});
    assert.equal(await missingDateCard.locator('p').innerText(),'音源初出日：確認中');
    await missingDateCard.locator('button').click();assert.equal(await page.locator('#song-detail').getByText('音源初出日：確認中',{exact:true}).count(),fixture.works[1].songs.length);
    await page.locator('#song-close').click();assert(!await page.locator('#song-dialog').isVisible());
    await page.unroute('**/data/songs/G00001.json');
    const ordering=structuredClone(real);ordering.works=ordering.works.slice(0,1);
    const template=ordering.works[0].songs[0];
    ordering.works[0].songs=[['J99905',null],['J99903','2025-01-01'],['J99902','2020-01-01'],['J99904',null],['J99901','2020-01-01']].map(([song_id,release_date])=>({...template,song_id,release_date}));
    await page.route('**/data/songs/G00001.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(ordering)}));
    await page.goto(base+'/songs/');await page.locator('.work-open').click();
    assert.deepEqual(await page.locator('.song-detail-card > p:first-child').allTextContents(),['J99901','J99902','J99903','J99904','J99905'].map(id=>`song ID：${id}`));
    await page.keyboard.press('Escape');await page.unroute('**/data/songs/G00001.json');
    const badVersion=structuredClone(real);badVersion.schema_version=2;
    const missing=structuredClone(real);delete missing.works[0].songs;
    const type=structuredClone(real);type.works[0].songs[0].credits[0].credit_name=42;
    for(const [name,body,status] of [['failure',null,503],['malformed','{',200],['version',badVersion,200],['missing',missing,200],['type',type,200],['empty',{...real,works:[]},200]]) {
      const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
      await p.route('**/data/songs/G00001.json',r=>r.fulfill({status,contentType:'application/json',body:typeof body==='string'?body:JSON.stringify(body)}));
      await p.goto(base+'/songs/');await p.locator('#songs-status').filter({hasText:name==='empty'?'表示できるデータがありません':'データを表示できません'}).waitFor();
      assert.equal(await p.locator('.work-card').count(),0);
      assert.equal(await p.locator('#song-summary').innerText(),name==='empty'?'0作品':'');
      await p.close();
    }
    const inconsistent=await browser.newPage();await inconsistent.goto(base+'/songs/');await inconsistent.locator('.work-open').first().waitFor();
    await inconsistent.evaluate(async input=>{
      const {mountSongCatalog}=await import('/songs.js');
      await mountSongCatalog(document,async()=>({ok:true,json:async()=>input}));
      input.works[0].songs=null;
    },structuredClone(real));
    await inconsistent.getByRole('button',{name:real.works[0].title,exact:true}).click();
    assert.match(await inconsistent.locator('#songs-status').innerText(),/楽曲詳細を表示できません/);
    assert(!await inconsistent.locator('#song-dialog').isVisible());await inconsistent.close();
    const loading=await browser.newPage();let release;
    const held=new Promise(r=>release=r);
    await loading.route('**/data/songs/G00001.json',async route=>{await held;await route.fulfill({contentType:'application/json',body:JSON.stringify(real)});});
    await loading.goto(base+'/songs/',{waitUntil:'domcontentloaded'});
    assert.match(await loading.locator('#songs-status').innerText(),/読み込んでいます/);assert(await loading.locator('#song-search').isDisabled());
    release();await loading.locator('.work-open').first().waitFor();await loading.close();
    assert.deepEqual(errors,[]);
    console.log(`PASS: 6 widths; ${real.works.length} real works / ${real.works.reduce((n,w)=>n+w.songs.length,0)} songs at each width; search, 3 sorts, every version and credit, unknown-date labels including J00021, shuffled detail date/ID/null order, separators/spacing/tap targets, last-work no border for all/single/multiple/zero results after search/sort, footer border intact, modal keyboard/focus, failure/malformed/version/fields/empty/loading`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
