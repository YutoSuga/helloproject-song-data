// Optional Chromium regression. Start site:preview and make Playwright available via NODE_PATH.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdir, readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const base = process.env.PUBLIC_SITE_URL || 'http://localhost:4173';
const output = process.env.PUBLIC_SITE_SCREENSHOTS;
const G = 'G00001';
const search = '/search/?artist_id=' + G;
const analysis = '/analysis/?artist_id=' + G;
const read = file => readFile(resolve(__dirname, '../site', file), 'utf8').then(JSON.parse);

async function check() {
  const [ranking, catalog] = await Promise.all([read('data/rankings/G00001.json'), read('data/songs/G00001.json')]);
  const { selectWorks, selectSongs } = await import('../site/song-catalog-model.js');
  const { findCreators } = await import('../site/creator-catalog-model.js');
  const { rankVisiblePairs } = await import('../site/pair-analysis.js');
  const { analyzeCollaborators } = await import('../site/collaborators.js');
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox']
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const work = catalog.works.find(work => work.songs.length > 1);
    const creator = ranking.categories.all.entries[0];
    const workUrl = '/songs/detail/?artist_id=' + G + '&work_id=';
    const creatorUrl = '/creators/detail/?artist_id=' + G + '&creator_id=';
    const pages = {
      home: ['/', '#dashboard'],
      ranking: ['/ranking/', '#ranking li'],
      songs: [search, '#results li'],
      'creator-search': [search + '&tab=creators', '#results li'],
      pairs: [analysis, '#results li'],
      collaborators: [analysis + '&tab=creator&creator_id=' + creator.creator_id, '#results li'],
      more: ['/more/', '#site-updates .about-content li'],
      creator: [creatorUrl + creator.creator_id, '#creator-content'],
      work: [workUrl + work.work_id, '#work-content'],
      videos: ['/videos/', 'main a']
    };

    async function open(url, ready) {
      const response = await page.goto(base + url);
      assert.equal(response.status(), 200, url);
      if (ready) await page.locator(ready).first().waitFor();
    }

    if (output) await mkdir(output, { recursive: true });
    for (const width of [320, 390, 768, 1023, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, [url, ready]] of Object.entries(pages)) {
        await open(url, ready);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${name}: overflow`);
        assert.equal(await page.locator('nav:visible').count(), name === 'videos' ? 0 : 1);
        assert.equal(await page.locator('nav:visible [aria-current]').count(), name === 'videos' ? 0 : 1);
        if (width < 1024 && name !== 'videos') {
          assert.equal(await page.locator('.sp-brand').evaluate(e => getComputedStyle(e).position), 'fixed');
          assert.equal(await page.locator('nav.mobile').evaluate(e => getComputedStyle(e).position), 'fixed');
        }
        const ids = await page.locator('[id]').evaluateAll(es => es.map(e => e.id));
        assert.equal(new Set(ids).size, ids.length, name);
        if (output && [390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `${name}-${width}.png`) });
      }
    }

    await open('/', '#dashboard');
    assert.deepEqual(await page.locator('#summary dd').allTextContents(), [
      ranking.summary.target_work_count, ranking.summary.primary_song_count, ranking.categories.all.entries.length
    ].map(value => value.toLocaleString('ja-JP')));
    const rowValues = selector => page.locator(selector).evaluateAll(rows => rows.map(row => [
      parseInt(row.querySelector('.lab-rank-number').textContent),
      [...row.querySelectorAll('a')].map(link => link.textContent).join(' × '),
      parseInt(row.querySelector('.lab-count').textContent)
    ]));
    const expectedCreators = rows => rows.map(row => [row.rank, row.creator_name, row.work_count]);
    const expectedPairs = rows => rows.map(row => [row.rank, row.lyricist_name + ' × ' + row.composer_name, row.work_count]);
    const publishedPairs = ranking.lyrics_composition_pairs.entries;
    const offPairs = rankVisiblePairs(publishedPairs);
    assert.deepEqual(await rowValues('#top-creators li'), expectedCreators(ranking.categories.all.entries.filter(row => row.rank <= 3)));
    assert.deepEqual(await rowValues('#top-pairs li'), expectedPairs(offPairs.filter(row => row.rank <= 3)));
    await page.locator('main a[href^="/analysis/"], main a[href*="/analysis/?"]').click();
    await page.locator('#results li').first().waitFor();
    assert.deepEqual(await rowValues('#results li'), expectedPairs(offPairs));
    await page.locator('#include-self').check();
    assert.deepEqual(await rowValues('#results li'), expectedPairs(publishedPairs));

    await open('/ranking/', '#ranking li');
    for (const [id, category] of Object.entries(ranking.categories)) {
      await page.locator('#category-' + id).click();
      await page.locator('#ranking li').first().waitFor();
      assert.deepEqual(await rowValues('#ranking li'), expectedCreators(category.entries));
    }
    await page.locator('#category-arrangement').press('Home');
    await page.waitForURL('**category=all');
    await page.goBack();
    assert.equal(await page.locator('#category-arrangement').getAttribute('aria-selected'), 'true');

    await open(search, '#results li');
    for (const sort of ['new', 'old', 'title']) {
      await page.locator('#song-sort').selectOption(sort);
      assert.deepEqual(await page.locator('#results li > a').allTextContents(), selectWorks(catalog.works, '', sort).map(work => work.title));
    }
    const query = work.title;
    await page.locator('#query').fill(query);
    assert.deepEqual(await page.locator('#results li > a').allTextContents(), selectWorks(catalog.works, query, 'title').map(row => row.title));
    const before = page.url();
    await page.locator('#results a').first().click();
    await page.locator('#work-content').waitFor();
    await page.locator('#detail-back').click();
    await page.waitForURL(before);
    await page.locator('#results a').first().waitFor();
    assert.equal(await page.locator('#query').inputValue(), query);
    assert.equal(await page.locator('#song-sort').inputValue(), 'title');
    assert.equal(await page.locator('#results a').first().evaluate(el => el === document.activeElement), true);
    await page.locator('#tab-creators').click();
    await page.locator('#query').fill(creator.creator_name);
    assert.deepEqual(await page.locator('#results a').allTextContents(), findCreators(ranking.categories.all.entries, creator.creator_name).map(row => row.creator_name));
    await page.locator('#query').fill(creator.creator_id);
    assert.equal(await page.locator('#results li').count(), 0);
    await page.goBack();
    assert.equal(await page.locator('#query').inputValue(), query);

    // Verify every real Work and Song against the independent published catalog.
    for (const item of catalog.works) {
      await open(workUrl + item.work_id, '#work-content');
      assert.equal(await page.locator('#work-title').innerText(), item.title);
      assert.deepEqual(await page.locator('#work-content section').evaluateAll(es => es.map(e => e.id)),
        selectSongs(item.songs).map(song => 'song-' + song.song_id));
      for (const song of item.songs) {
        const section = page.locator('#song-' + song.song_id);
        const text = await section.innerText();
        assert(text.includes(song.release_date ?? '確認中'));
        for (const credit of song.credits) {
          const href = creatorUrl + credit.creator_id;
          assert(await section.locator(`a[href^="${href}"]`).count(), `${song.song_id}: ${credit.credit_name}`);
          assert(text.includes(credit.credit_name));
        }
      }
    }
    await open(workUrl + work.work_id + '#song-' + work.songs.at(-1).song_id, '#work-content');
    await page.locator('#work-content section a').first().click();
    await page.locator('#creator-content').waitFor();
    await page.locator('#creator-work-list a').first().waitFor();
    await page.locator('[data-role="lyrics"]').click();
    const detailUrl = page.url();
    await page.reload();
    await page.locator('#creator-content').waitFor();
    assert.equal(await page.locator('[data-role="lyrics"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#creator-analyze').click();
    await page.locator('#summary').getByText(/担当作品数/).waitFor();
    const id = new URL(detailUrl).searchParams.get('creator_id');
    const collaboration = analyzeCollaborators(catalog.works, id);
    assert.deepEqual(await rowValues('#results li'), expectedCreators(collaboration.entries));

    await open(analysis + '&include_self=1&creator_id=' + creator.creator_id, '#results li');
    await page.locator('#pair-lyrics').check();
    await page.locator('#pair-composition').check();
    assert.deepEqual(await rowValues('#results li'), expectedPairs(rankVisiblePairs(publishedPairs, {
      include_self: '1', lyrics: '1', composition: '1', creator_id: creator.creator_id
    })));
    await page.locator('#include-self').uncheck();
    await page.getByText(/条件に一致する組み合わせがありません/).waitFor();
    await page.goBack();
    assert.equal(await page.locator('#include-self').isChecked(), true);
    const evidence = page.locator('#results button').first();
    await evidence.click();
    const modal = page.locator('dialog[open]');
    await modal.waitFor();
    assert.equal(await page.locator('#evidence-close').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.matches('dialog a')), true);
    const modalUrl = page.url();
    await modal.getByRole('link', { name: /根拠音源/ }).first().click();
    await page.locator('#work-content').waitFor();
    await page.locator('#detail-back').click();
    await page.waitForURL(modalUrl);
    await modal.waitFor();
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await evidence.evaluate(el => el === document.activeElement), true);
    await open(analysis, '#results li');
    await page.locator('#pair-creator').fill(creator.creator_name);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).searchParams.has('creator_id'), true);

    for (const [old, target] of [
      ['/songs/index.html?q=juice&sort=old', /\/search\/.*tab=songs.*sort=old/],
      ['/creators/?view=ranking&category=lyrics', /\/ranking\/.*category=lyrics/],
      ['/creators/index.html?view=pairs', /\/analysis\/.*tab=pairs/],
      ['/creators/?q=abc', /\/search\/.*tab=creators.*q=abc/]
    ]) {
      await open(old);
      await page.waitForURL(target);
    }
    await open(creatorUrl + creator.creator_id + '&view=ranking&category=composition', '#creator-content');
    assert.match(await page.locator('#creator-back').getAttribute('href'), /\/ranking\/.*category=composition/);
    await open(workUrl + work.work_id + '&from=' + encodeURIComponent('//outside.test/'), '#work-content');
    assert.match(await page.locator('#detail-back').getAttribute('href'), /^\/search\//);
    await open('/ranking/?artist_id=G00001&artist_id=G00002', '#ranking li');
    assert.match(await page.locator('#artist-notice').innerText(), /指定のアーティスト/);
    await open(workUrl + 'invalid');
    assert.match(await page.locator('#data-status').innerText(), /表示できません/);
    await open(analysis + '&include_self=1&include_self=1', '#results li');
    assert.equal(await page.locator('#include-self').isChecked(), false);

    await page.route('**/data/rankings/*.json', route => route.fulfill({ status: 503 }));
    await open('/', '#data-status');
    await page.getByText('データを表示できません。時間をおいて再読み込みしてください。').waitFor();
    assert.equal(await page.locator('.lab-shortcuts a').count(), 2);
    await page.unroute('**/data/rankings/*.json');

    const noStorage = await browser.newPage();
    await noStorage.addInitScript(() => {
      for (const storage of ['localStorage', 'sessionStorage']) Object.defineProperty(window, storage, {
        get() { throw new Error('storage unavailable'); }
      });
    });
    await noStorage.goto(base + '/');
    await noStorage.locator('#dashboard').waitFor();
    assert.equal(await noStorage.locator('#artist-select').inputValue(), G);
    await noStorage.close();

    const twoArtists = await browser.newPage();
    const fixtureArtist = 'G99999';
    const stateSource = await readFile(resolve(__dirname, '../site/site-state.js'), 'utf8');
    await twoArtists.route('**/site-state.js', route => route.fulfill({
      contentType: 'text/javascript',
      body: stateSource.replace("{ [publishedArtistId]: 'Juice=Juice' }", "{ [publishedArtistId]: 'Juice=Juice', G99999: 'Fixture' }")
    }));
    await twoArtists.route('**/search/**', async route => {
      if (!route.request().isNavigationRequest()) return route.continue();
      const actual = await route.fetch();
      const html = (await actual.text()).replace('</select>', '<option value="G99999">Fixture</option></select>');
      await route.fulfill({ response: actual, body: html });
    });
    const fixture = structuredClone(catalog);
    fixture.artist = { artist_id: fixtureArtist, name: 'Fixture' };
    fixture.works = [{ ...fixture.works[0], title: '長い作品名'.repeat(50) }];
    let releaseFirst;
    const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
    await twoArtists.route('**/data/songs/G00001.json', async route => {
      await firstHeld;
      await route.fulfill({ json: catalog }).catch(() => {});
    });
    await twoArtists.route('**/data/songs/G99999.json', route => route.fulfill({ json: fixture }));
    await twoArtists.goto(base + '/search/?sort=old', { waitUntil: 'domcontentloaded' });
    await twoArtists.locator('#artist-select').selectOption(fixtureArtist);
    const fixtureTitle = twoArtists.locator('#results li a');
    await fixtureTitle.waitFor();
    releaseFirst();
    assert.equal(await fixtureTitle.innerText(), fixture.works[0].title);
    assert.equal(await twoArtists.locator('#song-sort').inputValue(), 'old');
    await twoArtists.setViewportSize({ width: 320, height: 800 });
    assert(await twoArtists.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await twoArtists.goBack();
    await twoArtists.locator('#results li').first().waitFor();
    assert.equal(await twoArtists.locator('#artist-select').inputValue(), G);
    await twoArtists.goForward();
    await fixtureTitle.waitFor();
    assert.equal(await twoArtists.locator('#artist-select').inputValue(), fixtureArtist);
    await twoArtists.goto(base + '/search/');
    await fixtureTitle.waitFor();
    assert.equal(await twoArtists.locator('#artist-select').inputValue(), fixtureArtist);
    await twoArtists.goto(base + '/search/?artist_id=' + G);
    assert.equal(await twoArtists.locator('#artist-select').inputValue(), G);
    await twoArtists.close();

    await open(search, '#results a');
    const scrolled = page.locator('#results a').nth(35);
    await scrolled.scrollIntoViewIfNeeded();
    const previousScroll = await page.evaluate(() => scrollY);
    await scrolled.click();
    await page.locator('#work-content').waitFor();
    await page.goBack();
    await scrolled.waitFor();
    assert(Math.abs(await page.evaluate(() => scrollY) - previousScroll) < 32);
    const details = await scrolled.getAttribute('href');
    const separate = await page.context().newPage();
    await separate.goto(base + details);
    await separate.locator('#work-content').waitFor();
    await separate.locator('#detail-back').click();
    await separate.locator('#results a').first().waitFor();
    assert.match(separate.url(), /\/search\//);
    await separate.close();

    const staticPage = await browser.newPage({ javaScriptEnabled: false });
    await staticPage.goto(base + '/creators/');
    assert.equal(await staticPage.locator('main a').getAttribute('href'), '/search/?tab=creators');
    await staticPage.close();

    for (const [asset, width, height] of [
      ['assets/ogp.png', 1200, 630], ['assets/favicon.png', 32, 32], ['apple-touch-icon.png', 180, 180]
    ]) {
      const response = await page.request.get(base + '/' + asset);
      assert.equal(response.status(), 200);
      assert.match(response.headers()['content-type'], /image\/png/);
      const bytes = await response.body();
      assert.equal(bytes.readUInt32BE(16), width);
      assert.equal(bytes.readUInt32BE(20), height);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: 60 responsive cases, ${catalog.works.length} works and all recordings; rankings, search, detail/analysis, history, compatibility, errors and brand assets`);
  } finally {
    await browser.close();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
