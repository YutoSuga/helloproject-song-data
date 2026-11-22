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
    if (page === 'more/') assert.equal(artists, undefined);
    else {
      assert.equal((artists.match(/class="artist"/g) ?? []).length, 8);
      assert.equal((artists.match(/ disabled/g) ?? []).length, 7);
      assert.equal((artists.match(/aria-pressed="true"/g) ?? []).length, 1);
      const colors = [...artists.matchAll(/--group:(#[0-9A-F]+)/g)].map(m => m[1]);
      assert.deepEqual(colors, ['#D92C1B','#1D91CD','#7263AA','#EF93BB','#20A239','#F1881A','#F5D11F','#92C75B']);
      assert(html.indexOf('</h1>') < html.indexOf(artists));
    }
  }
});

test('PR 1 keeps songs provisional and ranking data at its existing location', async () => {
  const songs = await read('site/songs/index.html');
  assert.match(songs, /<h2>Coming Soon\.\.\.<\/h2>\s*<p>楽曲一覧・検索機能を準備中です。<\/p>/);
  assert.doesNotMatch(songs, /<section class="card">/);
  assert.doesNotMatch(songs, /type="search"|song-search|song-sort|<dialog/);
  const creators = await read('site/creators/index.html');
  assert.match(creators, /同じ曲に複数のバージョンがある場合も、1曲として数えています。/);
  assert.match(creators, /role="combobox"/);
  assert.doesNotMatch(creators, /creators-combo-status|pair-detail-role/);
  assert.match(await read('site/app.js'), /new URL\("\.\/data\/rankings\/G00001.json", import.meta.url\)/);
  assert.match(await read('.github/workflows/deploy-pages.yml'), /path: site\//);
});
