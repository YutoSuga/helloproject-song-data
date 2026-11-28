import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const primary = ['/', '/ranking/', '/search/', '/analysis/', '/more/'];
const detail = ['/creators/detail/', '/songs/detail/', '/analysis/detail/'];
const legacy = ['/creators/', '/songs/', '/videos/'];
const read = path => readFile(resolve(root, path), 'utf8');

test('public pages have consistent static navigation, canonical URLs and assets', async () => {
  for (const page of [...primary, ...detail, ...legacy]) {
    const html = await read(`site${page}index.html`);
    const canonical = ['/creators/', '/songs/'].includes(page) ? '/search/' : page;
    assert(html.includes(`rel="canonical" href="https://hellosongdb.com${canonical}"`));
    assert.match(html, /meta name="description"/);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    const navs = [...html.matchAll(/<nav class="(?:desktop|mobile)"[^>]*>([\s\S]*?)<\/nav>/g)];
    assert.equal(navs.length, legacy.includes(page) ? 0 : 2);
    for (const [, nav] of navs) {
      assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]), primary);
      assert.equal((nav.match(/aria-current=/g) ?? []).length, 1);
    }
    assert.equal(/name="robots" content="noindex"/.test(html), [...detail, ...legacy].includes(page));
    for (const property of ['site_name','title','description','url','type','image','image:width','image:height','image:alt']) {
      assert(html.includes(`property="og:${property}"`));
    }
    assert.match(html, /content="https:\/\/hellosongdb.com\/assets\/ogp\.png"/);
    for (const [, asset] of html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css|png))(?:\?[^"]*)?"/g)) await readFile(resolve(root, `site${asset}`));
    assert.doesNotMatch(html, /data-item-|review-state|show-numbers|サンプル|仮データ|mock\.js|mock\.css|Hello! Project Song Database/);
    const artists = html.match(/<select id="artist-select">([\s\S]*?)<\/select>/)?.[1];
    if (!primary.slice(0, 4).includes(page)) assert.equal(artists, undefined);
    else {
      assert.equal((artists.match(/<option /g) ?? []).length, 8);
      assert.equal((artists.match(/ disabled/g) ?? []).length, 7);
      assert.match(artists, /value="G00001" selected>Juice=Juice/);
    }
  }
});

test('catalog, work detail and publications remain independently connected', async () => {
  const search = await read('site/search/index.html');
  assert.match(search, /id="query"/);
  assert.match(search, /id="song-sort"/);
  assert.doesNotMatch(search, /<dialog/);
  assert.match(await read('site/songs/detail/index.html'), /id="work-content"/);
  for (const tab of ['songs','creators']) {
    const html = await read(`site/${tab}/index.html`);
    assert(html.includes(`href="/search/?tab=${tab}"`));
    assert.match(html, /src="\/legacy.js"/);
  }
  assert.match(await read('site/videos/index.html'), /href="\/">ホームへ戻る/);
  assert.match(await read('.github/workflows/deploy-pages.yml'), /path: site\//);
});

test('brand PNG files declare the expected dimensions', async () => {
  for (const [file, width, height] of [['assets/ogp.png',1200,630], ['assets/favicon.png',32,32], ['apple-touch-icon.png',180,180]]) {
    const png = await readFile(resolve(root, 'site', file));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});

test('home shows artist selection and More orders the combined information', async () => {
  const home = await read('site/index.html');
  const more = await read('site/more/index.html');
  assert.match(home, /id="artist-select"/);
  const homeMock = await read('docs/design/screens/mockups/index.html');
  assert.match(home, /id="top-creators"[\s\S]*?id="top-pairs"[\s\S]*?tab=songs[\s\S]*?tab=creators/);
  for (const html of [home, homeMock]) {
    assert.doesNotMatch(html, /site-updates|サイト更新履歴|about-data\.js|class="cards"/);
  }
  const dashboardItems = ['ハロプロ楽曲を、作家から知る。', '<select>', '作品数', '作家ランキング TOP3',
    '組み合わせランキング TOP3', 'songs.html?tab=songs', 'songs.html?tab=creators'];
  const dashboardPositions = dashboardItems.map(item => homeMock.indexOf(item));
  assert(dashboardPositions.every((position, index) => position >= 0 &&
    (index === 0 || position > dashboardPositions[index - 1])));
  const mock = await read('docs/design/screens/mockups/more.html');
  for (const html of [more, mock]) {
    assert.doesNotMatch(html, /<details\b|href="#contact"|データの誤りを連絡する|data-recent/);
    assert.match(html, /href="https:\/\/x\.com\/MELON6SODA4" target="_blank" rel="noopener noreferrer"/);
    const ids = ['data-policy', 'artist-coverage', 'site-updates', 'disclaimer', 'contact'];
    const content = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(content.filter(id => ids.includes(id)), ids);
  }
  assert.match(more, /class="card about-section site-information">\s*<section aria-labelledby="disclaimer">[\s\S]*?免責事項<\/h2>[\s\S]*?掲載されている名称・商標等[\s\S]*?<\/section>\s*<section aria-labelledby="contact">[\s\S]*?ご意見・ご要望<\/h2>[\s\S]*?<\/section>\s*<\/div>\s*<\/main>/);
  assert.match(mock, /id="aggregation-method"/);
  assert.match(more, /type="module" src="[^"]*about-data\.js"/);
});

test('More mock mirrors the data-driven policy without repeating the recording exclusions', async () => {
  const policy = JSON.parse(await read('site/data/about/policy.json'));
  const mock = await read('docs/design/screens/mockups/more.html');
  const section = mock.slice(mock.indexOf('id="data-policy"'), mock.indexOf('id="artist-coverage"'));
  const paragraphs = [...section.matchAll(/<p>([^<]+)<\/p>/g)].map(match => match[1]);
  assert.deepEqual(paragraphs, policy.sections.flatMap(item => item.paragraphs));
  const worksAndAudio = policy.sections.find(item => item.title === '作品と音源');
  assert.equal(worksAndAudio.paragraphs.length, 4);
  assert.equal(paragraphs.filter(paragraph => paragraph.includes('Instrumental')).length, 1);
  assert.doesNotMatch(section, /<h3>収録対象<\/h3>|商品（release）/);
});


test('creator filter controls preserve accessible combobox and explicit checkbox state', async () => {
  const html = await read('site/analysis/index.html');
  assert.doesNotMatch(html, /pair-direction/);
  for (const id of ['pair-lyrics', 'pair-composition']) {
    assert.match(html, new RegExp(`id="${id}" type="checkbox" disabled`));
  }
  assert.match(html, /<button type="button" id="pair-clear">クリア/);
  assert.match(html, /role="combobox"[^>]+aria-controls="pair-creator-options"/);
  assert.match(await read('site/creator-picker.js'), /event.isComposing/);
});


test('creator UI keeps only useful headings and orders condition before result count', async () => {
  const html = await read('site/analysis/index.html');
  assert.doesNotMatch(html, /自作詞・自作曲：|id="(?:pair-self-count|self-count)"|全順位|class="eyebrow"/);
  assert.match(html, /aria-label="作家名または読み仮名で検索"/);
  assert(html.indexOf('id="pair-condition"') < html.indexOf('id="summary"'));
  assert(html.indexOf('クリア</button>') < html.indexOf('id="pair-condition"'));
});

test('design mock locates pair analysis and collaborator analysis in their own tabs', async () => {
  const ranking = await read('docs/design/screens/mockups/creators.html');
  const analysis = await read('docs/design/screens/mockups/analysis.html');
  assert.doesNotMatch(ranking, /組み合わせランキング|共同制作楽曲/);
  assert.match(analysis, /aria-controls="pairs"[^>]*>組み合わせランキング<\/button>/);
  assert.match(analysis, /aria-controls="creator"[^>]*>作家指定分析<\/button>/);
  assert.doesNotMatch(analysis, /<dialog/);
  assert.match(analysis, /href="collaboration-detail\.html\?pair=/);
});

test('pair mocks share all tied top ranks and illustrate the opt-in ranking', async () => {
  const home = await read('docs/design/screens/mockups/index.html');
  const analysis = await read('docs/design/screens/mockups/analysis.html');
  const pairRows = (html, id) => {
    const list = html.match(new RegExp(`<ol[^>]* id="${id}"[^>]*>([\\s\\S]*?)</ol>`));
    assert(list, id);
    return [...list[1].matchAll(/data-pair="([^"]+)" data-rank="(\d+)" data-count="(\d+)"/g)]
      .map(([, pair, rank, count]) => [pair, Number(rank), Number(count)]);
  };
  // The design snapshots use the public JSON at the PR #119 merge commit.
  const expectedTop = [
    ['C00006/C00008', 1, 3],
    ['C00001/C00002', 2, 2],
    ['C00001/C00076', 2, 2],
    ['C00027/C00010', 2, 2]
  ];
  assert.deepEqual(pairRows(home, 'home-pairs'), expectedTop);
  assert.deepEqual(pairRows(analysis, 'pairs-different'), expectedTop);
  assert.deepEqual(pairRows(analysis, 'pairs-all').map(([, rank, count]) => [rank, count]),
    [[1, 25], [2, 5], [3, 4]]);
  assert.match(analysis, /id="include-self" type="checkbox" aria-controls="pairs-different pairs-all"> 同一作家の組み合わせを含む/);
  assert.match(analysis, /id="pairs-all" data-pair-view="self" hidden/);
  assert.doesNotMatch(home, /include.self/);
});

test('design-only brand asset and retired video mock reflect the review', async () => {
  const svg = await read('docs/design/screens/mockups/ogp.svg');
  assert.match(svg, /width="1200" height="630"/);
  for (const text of ['#f8edf2', '#7f1645', 'ハロプロ作家研究所', 'Hello! Project Creator Lab',
    'ハロプロ楽曲を、作家から知る。', 'hellosongdb.com']) assert(svg.includes(text), text);
  const videos = await read('docs/design/screens/mockups/videos.html');
  assert.match(videos, /name="robots" content="noindex"/);
  assert.match(videos, /href="index.html">ホームへ戻る/);
});
