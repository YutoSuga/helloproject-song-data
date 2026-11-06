import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersistence} from '../src/persistence.js';
import {acquireGate,releaseGate} from '../src/fn004-gate.js';
import {publishSuccessfulHistory} from '../src/fn004-history-publication.js';
import {applyHistoryPath} from '../src/fn004-history-directory.js';
import {historyFixture,syntheticSuccess} from './fixtures/history-success.js';
import {hashCanonicalJson} from '../src/canonical-hash.js';
import {validateHistoryRecord} from '../src/fn004-history-record.js';

async function setup(t) {
  const root=await fs.mkdtemp(join(tmpdir(),'fn004-success-publish-'));
  const gate=await acquireGate({root,operation:'apply'}),record=syntheticSuccess(historyFixture(),[]).record;
  t.after(async()=>{await releaseGate(gate);await fs.rm(root,{recursive:true,force:true});});
  return {root,gate,record,path:applyHistoryPath(record.payload.apply_id)};
}
const eio=()=>Object.assign(new Error('injected success publication failure'),{code:'EIO'});

test('successful History retry preserves exact record bytes and inode; conflicting display metadata cannot replace it',async t=>{
  const {root,gate,record,path}=await setup(t),store=await createPersistence(root);
  await publishSuccessfulHistory(store,fs,gate,record);
  const raw=await fs.readFile(join(root,path)),stat=await fs.stat(join(root,path));
  await publishSuccessfulHistory(store,fs,gate,structuredClone(record));
  assert.equal((await fs.stat(join(root,path))).ino,stat.ino);
  const conflict=structuredClone(record);conflict.metadata.published_at='2026-10-26T00:00:00Z';
  await assert.rejects(publishSuccessfulHistory(store,fs,gate,conflict));
  assert.equal((await fs.readFile(join(root,path))).equals(raw),true);
});

for(const kind of ['chain','Plan-prefix'])test(`History ${kind}: independently valid rehashed record cannot publish over an invalid prefix`,async t=>{
  const {root,gate,record,path}=await setup(t);
  if(kind==='chain')record.payload.previous_history_hash='f'.repeat(64);
  else {
    record.plan_snapshot.payload.history_precondition.semantic_hash='f'.repeat(64);
    record.plan_snapshot.plan_hash=hashCanonicalJson(record.plan_snapshot.payload);
    record.plan_snapshot.plan_id=`ap_${record.plan_snapshot.plan_hash}`;
    record.payload.plan={plan_id:record.plan_snapshot.plan_id,plan_hash:record.plan_snapshot.plan_hash};
  }
  record.record_hash=hashCanonicalJson(record.payload);validateHistoryRecord(record);
  await assert.rejects(publishSuccessfulHistory(await createPersistence(root),fs,gate,record),{code:'HISTORY_CHAIN_MISMATCH'});
  await assert.rejects(fs.stat(join(root,path)),{code:'ENOENT'});
});

for(const mode of ['partial_write','file_sync','link_before','link_after','directory_sync','temp_cleanup','readback'])test(`History ${mode}: typed failure and exact restart policy`,async t=>{
  const {root,gate,record,path}=await setup(t);let fired=false,linked=false;
  const cause=eio(),target=join(root,path),directory=join(root,'staging/apply-history');
  const io={...fs,
    open:async(p,...args)=>{
      const h=await fs.open(p,...args),temp=String(p).includes('/.fn004-');
      return new Proxy(h,{get(o,k){
        if(k==='writeFile'&&temp&&mode==='partial_write')return async bytes=>{await o.writeFile(bytes.subarray(0,8));fired=true;throw cause;};
        if(k==='sync'&&!fired&&(mode==='file_sync'&&temp||mode==='directory_sync'&&linked&&p===directory))return async()=>{fired=true;throw cause;};
        const v=o[k];return typeof v==='function'?v.bind(o):v;
      }});
    },
    link:async(from,to)=>{if(to===target&&mode==='link_before'){fired=true;throw cause;}await fs.link(from,to);if(to===target){linked=true;if(mode==='link_after'){fired=true;throw cause;}}},
    unlink:async p=>{if(mode==='temp_cleanup'&&linked&&!fired&&String(p).includes('/.fn004-')){fired=true;throw cause;}return fs.unlink(p);},
    readFile:async(p,...args)=>{if(mode==='readback'&&linked&&!fired&&p===target){fired=true;throw cause;}return fs.readFile(p,...args);}
  };
  await assert.rejects(publishSuccessfulHistory(await createPersistence(root,{io}),io,gate,record),error=>{
    assert.equal(fired,true);assert.equal(error.cause,cause);assert.equal(error.path,path);
    assert.equal(error.published,['link_after','directory_sync','temp_cleanup','readback'].includes(mode));
    assert.equal(error.phase,({partial_write:'temp_write',file_sync:'file_sync',link_before:'publish',link_after:'publish',directory_sync:'directory_sync',temp_cleanup:'temp_cleanup',readback:null})[mode]);
    return true;
  });
  const clean=await createPersistence(root);
  if(mode==='partial_write')await assert.rejects(publishSuccessfulHistory(clean,fs,gate,record),{code:'PERSISTENCE_PARSE_FAILED'});
  else assert.deepEqual(await publishSuccessfulHistory(clean,fs,gate,record),record);
});

for(const mode of ['before','after','unknown'])test(`atomic success state rename ${mode} preserves publication observation`,async t=>{
  const {root}=await setup(t),path='staging/test-state.json',cause=eio();
  await fs.writeFile(join(root,path),'{}');let thrown=false;
  const io={...fs,rename:async(a,b)=>{if(mode!=='before')await fs.rename(a,b);thrown=true;throw cause;},
    readFile:async(p,...args)=>{if(mode==='unknown'&&thrown)throw eio();return fs.readFile(p,...args);}};
  await assert.rejects((await createPersistence(root,{io})).writeJsonAtomic(path,{generation:2}),error=>{
    assert.equal(error.cause,cause);assert.equal(error.path,path);assert.equal(error.phase,'publish');
    assert.equal(error.published,mode==='unknown'?null:mode==='after');return true;
  });
});
