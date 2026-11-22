import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readSongCatalog, selectWorks } from '../site/song-catalog-model.js';
const data=JSON.parse(await readFile(new URL('../site/data/songs/G00001.json',import.meta.url),'utf8'));
test('real public JSON meets screen consumption contract; bad required fields fail',()=>{
  assert.equal(readSongCatalog(data),data);
  for (const mutate of [d=>d.schema_version=2,d=>delete d.works,d=>d.artist.artist_id='G00002',d=>d.works[0].title=null,d=>d.works[0].songs=[],d=>d.works[0].songs[0].credits[0].credit_name=null,d=>d.works[0].songs[0].version_name=42]) {
    const copy=structuredClone(data);mutate(copy);assert.throws(()=>readSongCatalog(copy));
  }
  assert.deepEqual(readSongCatalog({...data,works:[]}).works,[]);
});
test('NFKC, case folding, whitespace AND across credit names; excludes song-only titles',()=>{
  const works=[{work_id:'W00001',title:'ＡＢＣ 楽曲',first_release_date:null,search_creator_names:['掲載 作家','正規名'],songs:[{title:'別音源タイトル'}]}];
  assert.equal(selectWorks(works,' abc　正規名 掲載 ').length,1);
  assert.equal(selectWorks(works,'作家 楽曲').length,1);
  assert.equal(selectWorks(works,'別音源タイトル').length,0);
  assert.equal(selectWorks(works,'不存在').length,0);
  assert.equal(selectWorks(works,'[.*').length,0);
  assert.equal(selectWorks(works,' ').length,1);
});
test('three sorts: dates null last in both directions, ID ties, Japanese Collator',()=>{
  const works=[['W00003','い','2020-01-01'],['W00004','あ',null],['W00002','ア','2020-01-01'],['W00001','う','2022-01-01']].map(([work_id,title,first_release_date])=>({work_id,title,first_release_date,search_creator_names:[]}));
  assert.deepEqual(selectWorks(works,'','new').map(w=>w.work_id),['W00001','W00002','W00003','W00004']);
  assert.deepEqual(selectWorks(works,'','old').map(w=>w.work_id),['W00002','W00003','W00001','W00004']);
  const compare=new Intl.Collator('ja',{sensitivity:'variant'});
  const sorted=selectWorks(works,'','title');
  assert(sorted.every((w,i)=>i===0||compare.compare(sorted[i-1].title,w.title)<=0));
  assert.equal(works[0].work_id,'W00003');
});
