import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const pages = ['','songs/','videos/','creators/','more/'];
const read = path => readFile(resolve(root, path), 'utf8');

test('public pages have consistent static navigation, canonical URLs and assets', async () => {
  for (const page of pages) {
    const html = await read(`site/${page}index.html`);
    assert.match(html, new RegExp(`rel="canonical" href="https://hellosongdb.com/${page}"`));
    assert.match(html, /meta name="description"/);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 2);
    for (const nav of html.matchAll(/<nav class="(?:desktop|mobile)"[^>]*>([\s\S]*?)<\/nav>/g)) {
      const links = [...nav[1].matchAll(/href="([^"]+)"/g)].map(m => m[1]);
      assert.equal(links.length, 5);
      assert.deepEqual(links.map(link => resolve(root, `site/${page}`, link)), pages.map(p => resolve(root, `site/${p}`)));
    }
    const assets = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png))"/g)];
    for (const [, path] of assets) await readFile(resolve(root, `site/${page}`, path));
    assert.doesNotMatch(html, /data-item-|review-state|show-numbers|サンプル|仮データ|mock\.js|mock\.css/);
    const artists = html.match(/<section class="artists body-artists"[\s\S]*?<\/section>/)?.[0];
    if (page.startsWith('more/')) assert.equal(artists, undefined);
    else {
      assert.equal((artists.match(/class="artist(?: artist-link)?"/g) ?? []).length, 8);
      assert.equal((artists.match(/ disabled/g) ?? []).length, 7);
      assert.equal((artists.match(/aria-pressed="true"/g) ?? []).length, page ? 1 : 0);
      const colors = [...artists.matchAll(/--group:(#[0-9A-F]+)/g)].map(m => m[1]);
      assert.deepEqual(colors, ['#D92C1B','#1D91CD','#7263AA','#EF93BB','#20A239','#F1881A','#F5D11F','#92C75B']);
      assert(html.indexOf('</h1>') < html.indexOf(artists));
    }
  }
});

test('songs catalog and existing ranking data remain independently connected', async () => {
  const songs = await read('site/songs/index.html');
  assert.match(songs, /id="song-search"/);
  assert.match(songs, /id="song-sort"/);
  assert.match(songs, /<dialog id="song-dialog"/);
  assert.match(songs, /src="..\/songs.js"/);
  assert.doesNotMatch(songs, /楽曲一覧・検索機能を準備中/);
  const creators = await read('site/creators/index.html');
  assert.doesNotMatch(creators, /同じ曲に複数のバージョンがある場合も、1曲として数えています。/);
  assert.match(creators, /role="combobox"/);
  assert.match(creators, /id="view-search-tab"[^>]+aria-selected="true"/);
  assert.doesNotMatch(creators, /creators-combo-status|pair-detail-role/);
  assert.match(await read('site/app.js'), /new URL\("\.\/data\/rankings\/G00001.json", import.meta.url\)/);
  assert.match(await read('.github/workflows/deploy-pages.yml'), /path: site\//);
});

test('home shows artist selection and More orders the combined information', async () => {
  const home = await read('site/index.html');
  const more = await read('site/more/index.html');
  assert.match(home, /<a class="artist artist-link"[^>]+href="\.\/songs\/"/);
  const homeMock = await read('docs/design/screens/mockups/index.html');
  for (const html of [home, homeMock]) {
    assert.match(html, /<\/section>\s*<\/main>/);
    assert.doesNotMatch(html, /site-updates|サイト更新履歴|about-data\.js|class="cards"/);
  }
  const mock = await read('docs/design/screens/mockups/more.html');
  for (const html of [more, mock]) {
    assert.doesNotMatch(html, /<details\b|href="#contact"|データの誤りを連絡する|data-recent/);
    assert.match(html, /href="https:\/\/x\.com\/MELON6SODA4" target="_blank" rel="noopener noreferrer"/);
    const ids = ['data-policy', 'artist-coverage', 'site-updates', 'disclaimer', 'contact'];
    const content = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(content.filter(id => ids.includes(id)), ids);
    assert.match(html, /class="card about-section site-information">\s*<section aria-labelledby="disclaimer">[\s\S]*?免責事項<\/h2>[\s\S]*?掲載されている名称・商標等[\s\S]*?<\/section>\s*<section aria-labelledby="contact">[\s\S]*?ご意見・ご要望<\/h2>[\s\S]*?<\/section>\s*<\/div>\s*<\/main>/);
  }
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
  const html = await read('site/creators/index.html');
  assert.doesNotMatch(html, /pair-direction/);
  for (const id of ['pair-lyrics', 'pair-composition']) {
    assert.match(html, new RegExp(`id="${id}" type="checkbox" disabled`));
  }
  assert.match(html, /id="pair-clear" type="button">クリア/);
  assert.match(html, /role="combobox"[^>]+aria-controls="pair-creator-options"/);
  const app = await read('site/app.js');
  assert.match(app, /event.isComposing/);
  assert.match(app, /name.href = creatorUrl\(entry.creator_id\)/);
});


test('creator UI keeps only useful headings and orders condition before result count', async () => {
  for (const file of ['site/creators/index.html', 'docs/design/screens/mockups/creators.html']) {
    const html = await read(file);
    assert.doesNotMatch(html, /自作詞・自作曲：|id="(?:pair-self-count|self-count)"|全順位|class="eyebrow"/);
    assert.match(html, /aria-label="作家名またはIDで検索"/);
    assert(html.indexOf('id="pair-condition"') < html.indexOf('id="pair-summary"'));
    assert(html.indexOf('クリア</button>') < html.indexOf('id="pair-condition"'));
  }
});
