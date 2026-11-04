import test from 'node:test';
import assert from 'node:assert/strict';
import { commitFixture, append, recoveryDiscovery, exitedProbe, rollbackFixture } from './fixtures/transaction-evidence.js';
import { sha256 } from '../src/canonical-hash.js';
import { prepareRecoverySnapshot } from '../src/fn004-recovery-snapshot.js';
import { classifyRecoverySnapshot } from '../src/fn004-recovery-classifier.js';
function replace(d, path, bytes) {
  d.rawBytes[path] = bytes;
  Object.assign(d.files.find(file => file.path === path), { byte_length: bytes.length, sha256: sha256(bytes) });
}
async function classify(f, d) {
  return classifyRecoverySnapshot(await prepareRecoverySnapshot({ binding: f.binding, discovery: d, git_audit: f.git_audit, probe: exitedProbe(f.process) }));
}
function partial(f, through, rollback = false, lag = false) {
  const P = f.intent.payload.changed_paths.slice(0, f.intent.payload.changed_paths.indexOf(through) + 1);
  let head = append(f.consumed, { replaced_paths: P });
  const journal = [...f.journal.slice(0, 4), head];
  if (rollback) {
    head = append(head, { phase: 'ROLLING_BACK' }); journal.push(head);
    if (!lag) { head = append(head, { restored_paths: [through] }); journal.push(head); }
  }
  const d = recoveryDiscovery(f, { journal, intent: f.intent, state: f.intent.payload.expected_consumed_state,
    omit: P.map(path => `staging/transactions/${f.binding.transaction_id}/temp/${path}`) });
  for (const path of P.filter(path => !rollback || path !== through)) replace(d, path, f.targetRawBytes[path]);
  return d;
}
for (const [id, path, rollback, lag, invalid] of [
  ['KM-02', 'data/song_artists.csv', false, false, false],
  ['KM-03/KM-04', 'data/songs.csv', false, false, true],
  ['KM-05', 'data/song_artists.csv', true, false, true],
  ['KM-05 checkpoint lag', 'data/song_artists.csv', true, true, true]
]) test(`${id}: exact known intermediate retains validation evidence and permits rollback`, async () => {
  const f = commitFixture({ newEntities: true }), d = partial(f, path, rollback, lag);
  const r = await classify(f, d);
  assert.deepEqual(r.allowed_actions, ['rollback']); assert.equal(r.readiness, 'recovery_required');
  assert.equal(r.diagnostics.some(d => d.code === 'CANONICAL_INVALID'), invalid);
  if (invalid) assert.ok(r.diagnostics.some(d => d.code === 'PRIMARY_ARTIST_MISSING'));
  assert.deepEqual(await classify(f, { ...d, files: [...d.files].reverse() }), r);
});
for (const kind of ['unknown', 'state-before', 'state-after', 'nonprefix', 'backup-missing']) {
  test(`KM-06/07/11: ${kind} never authorizes restore`, async () => {
    const f = commitFixture({ newEntities: true }), d = partial(f, 'data/songs.csv');
    if (kind === 'unknown') replace(d, 'data/songs.csv', Buffer.concat([d.rawBytes['data/songs.csv'], Buffer.from('\n')]));
    if (kind === 'state-before') replace(d, 'staging/fn004-state.json', Buffer.from(JSON.stringify(f.state)));
    if (kind === 'state-after') {
      const rb = rollbackFixture({ newEntities: true });
      replace(d, 'staging/fn004-state.json', Buffer.from(JSON.stringify(rb.after)));
    }
    if (kind === 'nonprefix') replace(d, 'data/works.csv', f.snapshot.rawBytes['data/works.csv']);
    if (kind === 'backup-missing') {
      const path = `staging/transactions/${f.binding.transaction_id}/backup/data/works.csv`;
      delete d.rawBytes[path]; d.files = d.files.filter(file => file.path !== path);
    }
    const r = await classify(f, d); assert.deepEqual(r.allowed_actions, []); assert.equal(r.readiness, 'blocked');
  });
}

test('KM-01: all-original consumed transaction is rollbackable',async()=>{
  const f=commitFixture({newEntities:true});
  const r=await classify(f,recoveryDiscovery(f,{journal:f.journal.slice(0,4),intent:f.intent,state:f.intent.payload.expected_consumed_state}));
  assert.deepEqual(r.allowed_actions,['rollback']);
});
for(const kind of ['COMMIT_DECIDED','History','Proof'])test(`KM-08/09/10: ${kind} excludes known-mixed rollback`,async()=>{
  const f=commitFixture({newEntities:true}),d=partial(f,'data/song_artists.csv');
  const add=(path,value)=>{
    const raw=Buffer.from(JSON.stringify(value));d.rawBytes[path]=raw;
    const old=d.files.find(file=>file.path===path);if(old)Object.assign(old,{kind:'file',byte_length:raw.length,sha256:sha256(raw)});
    else d.files.push({path,kind:'file',byte_length:raw.length,sha256:sha256(raw)});
  };
  if(kind==='COMMIT_DECIDED'){
    const root=`staging/transactions/${f.binding.transaction_id}/journal/`;
    for(const entry of f.journal.slice(4,6))add(`${root}${String(entry.payload.sequence).padStart(6,'0')}.json`,entry);
  }else if(kind==='History')add(`staging/apply-history/${f.binding.apply_id}.json`,f.record);
  else add(`staging/transaction-proofs/${f.binding.transaction_id}.json`,f.proof);
  const r=await classify(f,d);assert.deepEqual(r.allowed_actions,[]);assert.equal(r.readiness,'blocked');
});

test('KM-12: even a claimed all-original endpoint cannot bypass full validation',async()=>{
  const { validateCanonicalProvenance }=await import('../src/fn004-canonical-provenance.js');
  const { readCanonicalSnapshotFromAdapter }=await import('../src/canonical-snapshot.js');
  const f=commitFixture({newEntities:true}),raw={...f.snapshot.rawBytes};
  raw['data/song_artists.csv']=Buffer.from(raw['data/song_artists.csv'].toString().split('\n')[0]+'\n');
  const bad=await readCanonicalSnapshotFromAdapter({list:()=>Object.keys(raw).map(p=>p.slice(5)),read:p=>raw[p]});
  assert.equal(bad.validation.ok,false);
  await assert.rejects(validateCanonicalProvenance({owner:f.owner,intent:f.intent,inputs:f.inputs,original:bad,
    canonical:bad,rawBytes:raw,chain:{head:f.consumed,entries:f.journal.slice(0,4),decision:null},
    state:f.intent.payload.expected_consumed_state,bootstrap:f.bootstrap,git_audit:f.git_audit}),{code:'INTEGRITY_CONFLICT'});
});
