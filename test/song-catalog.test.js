import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateSongCatalog, loadSongTables, SONG_TABLES } from '../src/song-catalog.js';
import { validateSongCatalog } from '../src/song-catalog-contract.js';
import { CANONICAL_SCHEMA } from '../src/canonical-schema.js';
const root = resolve(import.meta.dirname, '..');
function row(table, values) {
  return Object.fromEntries(CANONICAL_SCHEMA[table].columns.map(c => [c.name, values[c.name] ?? ({ source_url:'https://example.com', created_at:'2026-01-01T00:00:00Z', updated_at:'2026-01-01T00:00:00Z' }[c.name] ?? '')]));
}
function fixture() {
  const artists = ['G00001','G00002','G00003'].map(artist_id => row('artists', {artist_id,name:artist_id,type:'group'}));
  const works = ['W00001','W00002','W00003'].map(work_id => row('works',{work_id,title:work_id}));
  const songs = ['J00001','J00002','J00003','J00004','J00005'].map((song_id,i) => row('songs',{song_id, work_id:i<3?'W00001':i===3?'W00002':'W00003',title:`音源${i}`,version_type:i===1?'new_vocal':'original',release_date:i===0?'2020-02-29':i===2?'1999-01-01':''}));
  const song_artists = songs.map((s,i) => row('song_artists',{song_id:s.song_id,artist_id:i===2?'G00002':'G00001',role:i===4?'featured':'primary',credit_order:'1'}));
  song_artists.push(row('song_artists',{song_id:'J00001',artist_id:'G00002',role:'primary',credit_order:'2'}),row('song_artists',{song_id:'J00005',artist_id:'G00002',role:'primary',credit_order:'2'}));
  const creators = ['C00001','C00002'].map((creator_id,i) => row('creators',{creator_id,name:`正規名${i}`}));
  const song_creators = [row('song_creators',{song_id:'J00001',creator_id:'C00001',role:'lyrics',credit_name:'掲載名',credit_order:'1'}),row('song_creators',{song_id:'J00001',creator_id:'C00002',role:'lyrics',credit_name:'共同',credit_order:'2'}),row('song_creators',{song_id:'J00002',creator_id:'C00002',role:'brass_arrangement',credit_name:'特殊名'})];
  return {artists,works,songs,song_artists,creators,song_creators};
}
test('primary/multiple-primary, featured exclusion, work grouping, versions, credits and null dates', () => {
  const data=generateSongCatalog(fixture());
  assert.equal(data.works.length,2);
  const [w,empty]=data.works;
  assert.equal(w.title,'W00001'); assert.deepEqual(w.songs.map(s=>s.song_id),['J00001','J00002']);
  assert.equal(w.songs[1].version_type,'new_vocal'); assert.equal(w.first_release_date,'2020-02-29'); assert.equal(w.date_incomplete,true);
  assert.equal(w.songs[0].credits.length,2); assert.equal(w.songs[1].credits[0].role,'brass_arrangement');
  assert.deepEqual(w.search_creator_names,['共同','掲載名','正規名0','正規名1','特殊名'].sort());
  assert.equal(empty.first_release_date,null); assert.equal(empty.date_incomplete,true); assert.deepEqual(empty.songs[0].credits,[]); assert.equal(empty.title_kana,null);
  assert.deepEqual(generateSongCatalog(fixture(),'G00003').works,[]);
});
test('generation independent of input row order and repeatable', () => {
  const t=fixture(), before=JSON.stringify(t), expected=generateSongCatalog(t);
  assert.equal(JSON.stringify(t),before);
  const reversed=Object.fromEntries(Object.entries(t).map(([k,v])=>[k,[...v].reverse()]));
  assert.deepEqual(generateSongCatalog(reversed),expected); assert.deepEqual(generateSongCatalog(t),expected);
});
test('invalid canonical values, references, duplicate keys/order and missing tables fail with diagnostics', () => {
  for (const [table,field,value] of [['songs','work_id','W99999'],['songs','release_date','2025-02-29'],['songs','version_type','unknown'],['song_creators','credit_name',''],['song_creators','role','unknown'],['song_creators','creator_id','C99999'],['song_creators','credit_order','0'],['artists','artist_id','invalid']]) {
    const t=fixture(); t[table][0][field]=value;
    assert.throws(()=>generateSongCatalog(t),error=>error.message.includes(`${table}.csv`)&&error.message.includes(field)&&error.message.includes('ID='));
  }
  const t=fixture(); t.songs.push({...t.songs[0]}); assert.throws(()=>generateSongCatalog(t),/duplicate primary key/);
  const o=fixture(); o.song_artists[5].credit_order='1'; assert.throws(()=>generateSongCatalog(o),/duplicate order/);
  assert.throws(()=>generateSongCatalog(fixture(),'G99999'),/artist not found/);
  const missing=fixture();delete missing.creators;assert.throws(()=>generateSongCatalog(missing),/missing table/);
});
test('strict JSON contract rejects keys, types, enum, null, ordering and derived inconsistencies', () => {
  for (const mutate of [d=>delete d.schema_version,d=>d.schema_version=2,d=>d.works[0].title=null,d=>d.works[0].songs[0].credits[0].credit_order=0,d=>d.works[0].songs[0].version_type='bad',d=>d.works[0].songs[0].release_date='2020-02-30',d=>d.works.reverse(),d=>d.works[0].songs.reverse(),d=>d.works[0].songs[0].credits.reverse(),d=>d.works[0].first_release_date=null,d=>d.works[0].date_incomplete=false,d=>d.works[0].search_creator_names=[],d=>d.works[0].extra=1]) {
    const d=generateSongCatalog(fixture());mutate(d);assert.throws(()=>validateSongCatalog(d),/Song JSON contract/);
  }
});
test('strict CSV reader rejects missing files, empty/malformed header and corrupt records', async () => {
  const dir=await mkdtemp(join(tmpdir(),'songs-reader-'));
  try {
    await mkdir(join(dir,'data'));
    for(const name of SONG_TABLES) await writeFile(join(dir,'data',`${name}.csv`),CANONICAL_SCHEMA[name].columns.map(c=>c.name).join(',')+'\n');
    assert.deepEqual((await loadSongTables(dir)).songs,[]);
    for (const text of ['', 'song_id,title\n',CANONICAL_SCHEMA.songs.columns.map(c=>c.name).join(',')+'\n"unclosed']) {
      await writeFile(join(dir,'data/songs.csv'),text);await assert.rejects(loadSongTables(dir),/songs.csv/);
    }
    await rm(join(dir,'data/artists.csv'));await assert.rejects(loadSongTables(dir),/artists.csv/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('actual canonical catalog matches committed JSON and target set', async () => {
  const tables=await loadSongTables(root), data=generateSongCatalog(tables);
  const ids=new Set(tables.song_artists.filter(a=>a.artist_id==='G00001'&&a.role==='primary').map(a=>a.song_id));
  assert.equal(data.works.reduce((n,w)=>n+w.songs.length,0),ids.size);
  assert.deepEqual(new Set(data.works.flatMap(w=>w.songs.map(s=>s.song_id))),ids);
  assert.equal(await readFile(join(root,'site/data/songs/G00001.json'),'utf8'),JSON.stringify(data,null,2)+'\n');
});

test('CLI generates atomically, validates drift, rejects arguments and preserves output on invalid CSV', async()=>{
  const { cp, readdir }=await import('node:fs/promises');
  const { promisify }=await import('node:util');
  const { execFile }=await import('node:child_process');
  const exec=promisify(execFile),dir=await mkdtemp(join(tmpdir(),'songs-cli-'));
  try {
    await cp(join(root,'src'),join(dir,'src'),{recursive:true});
    await cp(join(root,'site/song-catalog-model.js'),join(dir,'site/song-catalog-model.js'));
    await mkdir(join(dir,'scripts'),{recursive:true});await mkdir(join(dir,'data'));
    await writeFile(join(dir,'package.json'),'{"type":"module"}');
    for(const file of ['generate-songs.js','validate-songs.js'])await cp(join(root,'scripts',file),join(dir,'scripts',file));
    for(const name of SONG_TABLES)await cp(join(root,'data',`${name}.csv`),join(dir,'data',`${name}.csv`));
    const run=script=>exec(process.execPath,[join(dir,'scripts',script)]);
    await run('generate-songs.js');const output=join(dir,'site/data/songs/G00001.json'),before=await readFile(output,'utf8');
    await run('validate-songs.js');await run('generate-songs.js');assert.equal(await readFile(output,'utf8'),before);
    await writeFile(output,before+' ');await assert.rejects(run('validate-songs.js'),e=>e.stderr.includes('differs from canonical'));
    await writeFile(output,before);
    for(const args of [['--unknown'],['G00001','G00002'],['G99999']])await assert.rejects(exec(process.execPath,[join(dir,'scripts/generate-songs.js'),...args]));
    const csv=await readFile(join(dir,'data/songs.csv'),'utf8');await writeFile(join(dir,'data/songs.csv'),csv.replace(/W\d{5}/,'W99999'));
    await assert.rejects(run('generate-songs.js'),e=>e.stderr.includes('songs.csv')&&e.stderr.includes('work_id'));
    assert.equal(await readFile(output,'utf8'),before);
    assert.deepEqual(await readdir(join(dir,'site/data/songs')),['G00001.json']);
  } finally {await rm(dir,{recursive:true,force:true});}
});
