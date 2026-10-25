import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { completeDraft, revision, next, seal, storeOf, source } from './fixtures/decision-lifecycle.js';
import { buildDecisionRegistry, proposeDecisionRevision, decisionContent, decisionIdentity, createDecisionId, getDecisionHead } from '../src/fn004-decision-lifecycle.js';
import { createDecisionScope } from '../src/fn004-decision-core.js';
const copy = structuredClone;
const candidates = { schema_version: 1, candidates: [{ ...source, candidate_id: 'candidate-1' }] };
const command = (r, head = null) => ({ decision_id: r.decision_id, base_revision: head?.revision ?? null, base_content_hash: head?.content_hash ?? null, source_revision: null, content: decisionContent(r), cancellation: null, actor: r.actor, mutation_key: randomUUID() });
const propose = (store, action, input, options = {}) => proposeDecisionRevision(store, action, input, { candidates, ...options });
const ordered = (...records) => storeOf(...records.flat().sort((a,b) => a.decision_id < b.decision_id ? -1 : a.decision_id > b.decision_id ? 1 : a.revision-b.revision));
function confirmation(store, head) { const c = command(head, head); c.source_revision = decisionIdentity(head); return propose(store, 'confirm', c); }
function cancellation(store, head, target = head) { const c = command(head, head); c.source_revision = decisionIdentity(head); c.cancellation = { target: decisionIdentity(target), reason: 'Withdraw judgment' }; return propose(store, 'cancel', c, { candidates: undefined }); }
test('new draft and updated draft append immutable snapshots and bind the formal head', () => {
  const original = completeDraft(), c = command(original);
  const a = propose(storeOf(), 'save_draft', c); assert.equal(a.revision.revision, 1); assert.equal(a.revision.status, 'draft');
  const saved = JSON.stringify(a.store); const update = command(a.revision, a.revision); update.content.human_note = 'Edited';
  const b = propose(a.store, 'save_draft', update); assert.equal(b.revision.revision, 2); assert.equal(JSON.stringify(a.store), saved); assert.deepEqual(b.store.revisions[0], a.revision);
  assert.deepEqual(getDecisionHead(b.store, a.revision.decision_id), b.revision);
  for (const patch of [{ base_revision: 1 }, { base_content_hash: '0'.repeat(64) }]) assert.throws(() => propose(b.store, 'save_draft', { ...command(b.revision, b.revision), ...patch }), { code: 'DECISION_HEAD_CONFLICT' });
  assert.match(createDecisionId(), /^dec_/);
});
test('mutation retries precede OCC and cannot change payload, action or actor', () => {
  const c = command(completeDraft()), a = propose(storeOf(), 'save_draft', c);
  const b = propose(a.store, 'save_draft', command(a.revision, a.revision));
  const replay = propose(b.store, 'save_draft', c, { candidates: undefined }); assert.equal(replay.replayed, true); assert.equal(replay.revision.revision, 1); assert.equal(replay.store.revisions.length, 2);
  for (const changed of [{ ...c, actor: { id: 'local:other', assurance: 'local_process' } }, { ...c, content: { ...c.content, human_note: 'changed' } }]) assert.throws(() => propose(b.store, 'save_draft', changed), { code: 'INTEGRITY_CONFLICT' });
  assert.throws(() => propose(b.store, 'confirm', c), { code: 'INTEGRITY_CONFLICT' });
});
test('scope changes need a new Decision and changed candidate facts require explicit adoption', () => {
  const a = propose(storeOf(), 'save_draft', command(completeDraft()));
  const c = command(a.revision, a.revision); c.content.scope = createDecisionScope(['other']);
  assert.throws(() => propose(a.store, 'save_draft', c), { code: 'DECISION_INVALID' });
  assert.throws(() => propose(storeOf(), 'save_draft', command(completeDraft()), { candidates: { ...candidates, candidates: [{ ...candidates.candidates[0], title: 'changed' }] } }), { code: 'CANDIDATE_FINGERPRINT_MISMATCH' });
});
test('confirm binds head/source and copies saved content into a complete immutable revision', () => {
  const a = propose(storeOf(), 'save_draft', command(completeDraft())); const b = confirmation(a.store, a.revision);
  assert.equal(b.revision.status, 'confirmed'); assert.equal(b.revision.revision, 2); assert.deepEqual(decisionContent(b.revision), decisionContent(a.revision)); assert.equal(a.revision.status, 'draft');
  const c = command(a.revision, a.revision); c.source_revision = { ...decisionIdentity(a.revision), content_hash: '0'.repeat(64) };
  assert.throws(() => propose(a.store, 'confirm', c), { code: 'DECISION_HEAD_CONFLICT' });
  assert.throws(() => propose(b.store, 'confirm', { ...c, source_revision: decisionIdentity(a.revision) }), { code: 'DECISION_HEAD_CONFLICT' });
  c.source_revision = decisionIdentity(a.revision); c.content.human_note = 'not saved'; assert.throws(() => propose(a.store, 'confirm', c), { code: 'INTEGRITY_CONFLICT' });
  const incomplete = propose(storeOf(), 'save_draft', command(revision())); assert.throws(() => confirmation(incomplete.store, incomplete.revision), { code: 'DECISION_INCOMPLETE' });
});
test('later drafts preserve confirmation; cancellation targets that effective confirmation and ignores current candidates', () => {
  const a = completeDraft(), b = next(a, 'confirmed'), c = next(b);
  const store = storeOf(a,b,c), before = buildDecisionRegistry(store);
  assert.deepEqual(before.projection.active_confirmed[0].identity, decisionIdentity(b));
  const cancelled = cancellation(store,c,b); assert.equal(cancelled.revision.revision,4); assert.equal(buildDecisionRegistry(cancelled.store).projection.active_confirmed.length,0);
  assert.throws(() => cancellation(store,c,c), { code: 'INTEGRITY_CONFLICT' });
  assert.throws(() => cancellation(cancelled.store,cancelled.revision,b), { code: 'DECISION_INVALID' });
  const draft = revision(); assert.equal(cancellation(storeOf(draft), draft).revision.status,'cancelled');
});
test('registry rejects illegal transitions and semantic tampering, not just bad hashes', () => {
  const a = completeDraft(), b = next(a,'confirmed');
  const edited = copy(b); edited.human_note = 'tampered'; seal(edited);
  assert.throws(() => buildDecisionRegistry(storeOf(a,edited)), { code: 'DECISION_INVALID' });
  const direct = next(b,'confirmed'); assert.throws(() => buildDecisionRegistry(storeOf(a,b,direct)), { code: 'DECISION_INVALID' });
  const cancel = next(b,'cancelled'); cancel.cancellation.target = decisionIdentity(a); seal(cancel); assert.throws(() => buildDecisionRegistry(storeOf(a,b,cancel)), { code: 'DECISION_INVALID' });
});
test('registry hash ignores drafts/metadata and changes with confirmations/cancellations', () => {
  const a = completeDraft(), b = next(a,'confirmed'), c = next(b);
  const empty = buildDecisionRegistry(storeOf()).registry_hash;
  assert.equal(buildDecisionRegistry(storeOf(a)).registry_hash,empty);
  const hash = buildDecisionRegistry(storeOf(a,b)).registry_hash;
  assert.notEqual(hash,empty); assert.equal(buildDecisionRegistry(storeOf(a,b,c)).registry_hash,hash);
  const other = revision(); assert.equal(buildDecisionRegistry(ordered(a,b,c,other)).registry_hash,hash);
  assert.equal(buildDecisionRegistry(storeOf(a,b,next(b,'cancelled'))).registry_hash,empty);
  assert.equal(buildDecisionRegistry(storeOf(a,b)).registry_hash,hash);
});
test('competing confirmed claims block; cancelling previous claim allows another Decision', () => {
  const a = completeDraft(), b = next(a,'confirmed'), other = completeDraft();
  const store = ordered(a,b,other); assert.throws(() => confirmation(store,other), { code: 'COMPETING_CONFIRMED_DECISION' });
  const cancelled = cancellation(store,b); const allowed = confirmation(cancelled.store,other); assert.equal(buildDecisionRegistry(allowed.store).projection.active_confirmed.length,1);
});
function withCandidate(r, id) {
  r.scope = createDecisionScope([id]); r.candidate_bindings[0].candidate_id = id;
  r.evidence[0].candidate_ids = [id]; r.evidence[0].source_fingerprints[0].candidate_id = id; return seal(r);
}
test('multiple replacements permanently retire claims even after replacing Decision is cancelled', () => {
  const a = completeDraft(), ac = next(a,'confirmed');
  const b = withCandidate(completeDraft(),'candidate-2'), bc = next(b,'confirmed');
  const replacement = withCandidate(completeDraft(),'candidate-3'); replacement.replaces = [ac,bc].map(r => ({ target: decisionIdentity(r), reason: 'Merge scope', evidence_refs: ['ev_source'] })).sort((x,y) => x.target.decision_id < y.target.decision_id ? -1 : 1); seal(replacement);
  const source3 = { schema_version:1,candidates:[{...source,candidate_id:'candidate-3'}] };
  const old = ordered(a,ac,b,bc);
  const saved = propose(old,'save_draft',command(replacement),{candidates:source3});
  assert.equal(buildDecisionRegistry(saved.store).projection.active_confirmed.length,2);
  const c = command(saved.revision,saved.revision); c.source_revision = decisionIdentity(saved.revision);
  const confirmed = propose(saved.store,'confirm',c,{candidates:source3});
  assert.equal(buildDecisionRegistry(confirmed.store).projection.active_confirmed.length,1);
  const edit = propose(confirmed.store,'save_draft',command(confirmed.revision,confirmed.revision),{candidates:source3});
  assert.equal(buildDecisionRegistry(edit.store).projection.active_confirmed.length,1);
  const cancelled = cancellation(edit.store,edit.revision,confirmed.revision);
  assert.equal(buildDecisionRegistry(cancelled.store).projection.active_confirmed.length,0);
  assert.throws(() => propose(cancelled.store,'save_draft',command(ac,ac)),{code:'DECISION_INVALID'});
});
test('replacement target CAS rejects changed hashes and stale effective confirmations', () => {
  const a = completeDraft(), ac = next(a,'confirmed'); const replacement = withCandidate(completeDraft(),'candidate-2');
  replacement.replaces = [{target:decisionIdentity(ac),reason:'Split scope',evidence_refs:['ev_source']}]; seal(replacement);
  const opts={candidates:{schema_version:1,candidates:[{...source,candidate_id:'candidate-2'}]}};
  const saved = propose(storeOf(a,ac),'save_draft',command(replacement),opts);
  const cancelled = cancellation(saved.store,ac); const c=command(saved.revision,saved.revision); c.source_revision=decisionIdentity(saved.revision);
  assert.throws(()=>propose(cancelled.store,'confirm',c,opts),{code:'DECISION_HEAD_CONFLICT'});
  const bad=command(replacement);bad.content.replaces[0].target.content_hash='0'.repeat(64);
  assert.throws(()=>propose(storeOf(a,ac),'save_draft',bad,opts),{code:'DECISION_HEAD_CONFLICT'});
});

import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { CANONICAL_TABLES } from '../src/canonical-schema.js';
import { DECLARATION_STATEMENT } from '../src/fn004-state.js';
import { emptyMaxima } from '../src/fn004-id-audit.js';
import { checkBootstrap, initializeBootstrap } from '../src/fn004-bootstrap.js';
import { createDecisionService } from '../src/fn004-decision-application.js';
import { createFn004Repository } from '../src/fn004-repository.js';
const execute = promisify(execFile);
async function applicationFixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(),'fn004-lifecycle-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(join(root,'data')); await fs.mkdir(join(root,'staging'));
  const stamp='2026-10-25T01:02:03Z', url=source.source_url;
  const rows={works:[{work_id:'W00001',title:'曲',source_url:url}],artists:[{artist_id:'G00001',name:'Artist',type:'group'}],songs:[{song_id:'J00001',work_id:'W00001',title:'曲',version_type:'original',source_url:url}],song_artists:[{song_id:'J00001',artist_id:'G00001',role:'primary',source_url:url}],releases:[{release_id:'L00001',title:'盤',release_type:'single',source_url:url}]};
  for(const table of CANONICAL_TABLES) await fs.writeFile(join(root,table.path),[table.columns.map(c=>c.name).join(','),...(rows[table.name]??[]).map(row=>table.columns.map(c=>({created_at:stamp,updated_at:stamp,...row}[c.name]??'')).join(','))].join('\n')+'\n');
  await execute('git',['init','-q','-b','main',root]);
  await execute('git',['-C',root,'add','data']);
  await execute('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','canonical']);
  await execute('git',['-C',root,'update-ref','refs/remotes/origin/main','HEAD']);
  const external_declaration={schema_version:1,namespaces:{...emptyMaxima(),W:1,G:1,J:1,L:1},statement:DECLARATION_STATEMENT,evidence:[]};
  const checked=await checkBootstrap({root,external_declaration});
  await initializeBootstrap({root,external_declaration,expected_audit_hash:checked.audit_hash,actor:{id:'local:test',assurance:'local_process'}});
  await fs.writeFile(join(root,'staging/song-candidates.json'),JSON.stringify(candidates));
  return {root,service:createDecisionService({root})};
}
async function history(root) { return (await createFn004Repository(root)).readDecisionStore(); }
function resultRevision(result) {return result.revision;}
test('application publishes draft/confirmation/cancellation atomically with no successful-operation residuals', async t=>{
  const {root,service}=await applicationFixture(t);
  const a=resultRevision(await service.saveDecisionDraft(command(completeDraft())));
  const c=command(a,a);c.source_revision=decisionIdentity(a);
  const b=resultRevision(await service.confirmDecision(c));assert.equal(b.status,'confirmed');
  const cancel=command(b,b);cancel.source_revision=decisionIdentity(b);cancel.cancellation={target:decisionIdentity(b),reason:'Withdraw'};
  await fs.unlink(join(root,'staging/song-candidates.json'));
  const d=resultRevision(await service.cancelDecision(cancel));assert.equal(d.status,'cancelled');
  const stored=await history(root);assert.equal(stored.revisions.length,3);assert.deepEqual(stored.revisions[0],a);assert.deepEqual(stored.revisions[1],b);
  assert.deepEqual((await fs.readdir(join(root,'staging'))).filter(n=>n.startsWith('.fn004-')),[]);
  assert.equal((await service.buildDecisionRegistry()).projection.active_confirmed.length,0);
});
test('concurrent draft writers serialize through one gate and stale writer gets head conflict',async t=>{
  const {root,service}=await applicationFixture(t);const a=resultRevision(await service.saveDecisionDraft(command(completeDraft())));
  const one=command(a,a),two=command(a,a);one.content.human_note='one';two.content.human_note='two';
  const outcomes=await Promise.allSettled([service.saveDecisionDraft(one),createDecisionService({root}).saveDecisionDraft(two)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'DECISION_HEAD_CONFLICT');
  assert.equal((await history(root)).revisions.length,2);
});
test('draft/confirm and confirm/cancel races cannot lose an update',async t=>{
  const {root,service}=await applicationFixture(t);const a=resultRevision(await service.saveDecisionDraft(command(completeDraft())));
  const draft=command(a,a),confirm=command(a,a);confirm.source_revision=decisionIdentity(a);
  const outcomes=await Promise.allSettled([service.saveDecisionDraft(draft),service.confirmDecision(confirm)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'DECISION_HEAD_CONFLICT');
  let head=(await history(root)).revisions.at(-1);
  if(head.status==='confirmed') head=resultRevision(await service.saveDecisionDraft(command(head,head)));
  const yes=command(head,head);yes.source_revision=decisionIdentity(head);
  const effective=buildDecisionRegistry(await history(root)).active_confirmed.find(r=>r.decision_id===head.decision_id)??head;
  const cancel=command(head,head);cancel.source_revision=decisionIdentity(head);cancel.cancellation={target:decisionIdentity(effective),reason:'withdraw'};
  const race=await Promise.allSettled([service.confirmDecision(yes),service.cancelDecision(cancel)]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.code,'DECISION_HEAD_CONFLICT');
  assert.deepEqual((await fs.readdir(join(root,'staging'))).filter(n=>n.startsWith('.fn004-')),[]);
});
test('current canonical assertion changes and source changes block save/confirm',async t=>{
  const {root,service}=await applicationFixture(t);const a=resultRevision(await service.saveDecisionDraft(command(completeDraft())));
  const c=command(a,a);c.source_revision=decisionIdentity(a);
  await fs.writeFile(join(root,'staging/song-candidates.json'),JSON.stringify({schema_version:1,candidates:[{...candidates.candidates[0],title:'changed'}]}));
  await assert.rejects(service.confirmDecision(c),{code:'CANDIDATE_FINGERPRINT_MISMATCH'});
  const bad=command(a,a);bad.content.candidate_bindings[0].work.assertions.title='wrong';
  await fs.writeFile(join(root,'staging/song-candidates.json'),JSON.stringify(candidates));
  await assert.rejects(service.saveDecisionDraft(bad),{code:'EXISTING_IDENTITY_CONFLICT'});
  assert.equal((await history(root)).revisions.length,1);
});
test('failed atomic publication preserves complete old store and releases gate without automatic retry',async t=>{
  const {root,service}=await applicationFixture(t);const a=resultRevision(await service.saveDecisionDraft(command(completeDraft())));
  const original=await fs.readFile(join(root,'staging/decisions.json'));
  const broken=createDecisionService({root,io:{...fs,rename:async()=>{throw new Error('injected rename failure');}}});
  await assert.rejects(broken.saveDecisionDraft(command(a,a)),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&e.phase==='publish'&&!e.published);
  assert.deepEqual(await fs.readFile(join(root,'staging/decisions.json')),original);
  await assert.rejects(fs.stat(join(root,'staging/.fn004.lock')),{code:'ENOENT'});
  assert.equal((await fs.readdir(join(root,'staging'))).filter(n=>n.includes('.tmp-')).length,1);
});

test('post-rename durability failure is reported as published and retry returns the original revision',async t=>{
  const {root,service}=await applicationFixture(t);const a=resultRevision(await service.saveDecisionDraft(command(completeDraft())));
  const c=command(a,a);
  const broken=createDecisionService({root,io:{...fs,open:async(path,...args)=>{
    const h=await fs.open(path,...args);return new Proxy(h,{get(target,name){if(name==='sync'&&path===join(root,'staging'))return async()=>{throw new Error('directory sync failed');};const v=target[name];return typeof v==='function'?v.bind(target):v;}});
  }}});
  await assert.rejects(broken.saveDecisionDraft(c),e=>e.code==='PERSISTENCE_WRITE_FAILED'&&e.phase==='directory_sync'&&e.published);
  const retry=await service.saveDecisionDraft(c);assert.equal(retry.replayed,true);assert.equal(retry.revision.revision,2);assert.equal((await history(root)).revisions.length,2);
  assert.deepEqual((await fs.readdir(join(root,'staging'))).filter(n=>n.startsWith('.fn004-')),[]);
});
test('reconfirmation of replacement preserves its original permanent invalidation edges',()=>{
  const a=completeDraft(),ac=next(a,'confirmed'),r=withCandidate(completeDraft(),'candidate-2');r.replaces=[{target:decisionIdentity(ac),reason:'Split',evidence_refs:['ev_source']}];seal(r);
  const rc=next(r,'confirmed'),rd=next(rc),again=next(rd,'confirmed');
  const registry=buildDecisionRegistry(ordered(a,ac,r,rc,rd,again));assert.equal(registry.projection.active_confirmed.length,1);assert.deepEqual(registry.projection.active_confirmed[0].identity,decisionIdentity(again));
});
test('new draft after cancellation is allowed, while cancel target hash and source revision must match',()=>{
  const a=completeDraft(),b=next(a,'confirmed'),cancelled=next(b,'cancelled');
  const c=command(cancelled,cancelled);const reopened=propose(storeOf(a,b,cancelled),'save_draft',c);assert.equal(reopened.revision.status,'draft');assert.equal(buildDecisionRegistry(reopened.store).projection.active_confirmed.length,0);
  const bad=command(b,b);bad.source_revision=decisionIdentity(b);bad.cancellation={target:{...decisionIdentity(b),content_hash:'0'.repeat(64)},reason:'withdraw'};
  assert.throws(()=>propose(storeOf(a,b),'cancel',bad),{code:'INTEGRITY_CONFLICT'});
});
test('registry reader rejects noncanonical store ordering and invalid semantic hashes',()=>{
  const a=completeDraft(),b=next(a,'confirmed');assert.throws(()=>buildDecisionRegistry(storeOf(b,a)),{code:'DECISION_INVALID'});
  const bad=copy(b);bad.content_hash='0'.repeat(64);assert.throws(()=>buildDecisionRegistry(storeOf(a,bad)),{code:'DECISION_INVALID'});
});

test('invalid draft is never published and READY guard blocks uninitialized repositories',async t=>{
  const {root,service}=await applicationFixture(t);const bad=command(completeDraft());bad.content.entities.extra=[];
  await assert.rejects(service.saveDecisionDraft(bad));await assert.rejects(fs.stat(join(root,'staging/decisions.json')),{code:'ENOENT'});
  await fs.unlink(join(root,'staging/fn004-state.json'));
  await assert.rejects(service.saveDecisionDraft(command(completeDraft())),{code:'BOOTSTRAP_INCOMPLETE'});
  await assert.rejects(fs.stat(join(root,'staging/.fn004.lock')),{code:'ENOENT'});
});
test('same-scope replacement is invalid and replaced lineages cannot gain later confirmed events',()=>{
  const a=completeDraft(),b=next(a,'confirmed');const other=completeDraft();other.replaces=[{target:decisionIdentity(b),reason:'same scope',evidence_refs:['ev_source']}];seal(other);
  assert.throws(()=>buildDecisionRegistry(ordered(a,b,other)),{code:'DECISION_INVALID'});
  withCandidate(other,'candidate-2');const confirmed=next(other,'confirmed'),draft=next(b),reconfirmed=next(draft,'confirmed');
  assert.throws(()=>buildDecisionRegistry(ordered(a,b,draft,reconfirmed,other,confirmed)),{code:'DECISION_INVALID'});
});
test('normalization sorts only semantic arrays and duplicate semantic entries still fail',()=>{
  const r=completeDraft();r.candidate_bindings[0].evidence_refs=['ev_source','ev_source'];seal(r);
  assert.throws(()=>propose(storeOf(),'save_draft',command(r)));
  const bad=command(completeDraft());bad.content.entities=null;assert.throws(()=>propose(storeOf(),'save_draft',bad),{code:'DECISION_INVALID'});
});

test('registry excludes confirmation metadata while binding semantic evidence and actor',()=>{
  const a=completeDraft(),b=next(a,'confirmed');const expected=buildDecisionRegistry(storeOf(a,b)).registry_hash;
  const other=copy(b);other.metadata.saved_at='2026-10-26T00:00:00Z';other.metadata.confirmed_at=other.metadata.saved_at;other.metadata.mutation.key=randomUUID();
  assert.equal(buildDecisionRegistry(storeOf(a,other)).registry_hash,expected);
});

test('head OCC and mutation replay are checked before attempting current source reads',async t=>{
  const {root,service}=await applicationFixture(t);const first=command(completeDraft());const a=resultRevision(await service.saveDecisionDraft(first));
  await service.saveDecisionDraft(command(a,a));await fs.unlink(join(root,'staging/song-candidates.json'));
  await assert.rejects(service.saveDecisionDraft(command(a,a)),{code:'DECISION_HEAD_CONFLICT'});
  assert.equal((await service.saveDecisionDraft(first)).replayed,true);
});

test('confirm requires distinct evidence against same-name canonical masters without allocating IDs',async t=>{
  const {service}=await applicationFixture(t);const draft=completeDraft();const refs=['ev_source'];
  draft.entities.works.push({local_ref:'work:w1',evidence_refs:refs,title:'曲',title_kana:null,notes:null,source_url:source.source_url,distinct_from:[]});
  draft.entities.songs.push({local_ref:'song:s1',evidence_refs:refs,work:{local_ref:'work:w1'},title:'別音源',version_name:null,version_type:'cover',release_date:null,notes:null,source_url:source.source_url,song_id_prefix:'J',distinct_from:[]});
  const b=draft.candidate_bindings[0];b.work={local_ref:'work:w1'};b.song={local_ref:'song:s1'};b.audio_identity='distinct_recording';b.accepted_version_type='cover';
  draft.relations.release_tracks[0].song={local_ref:'song:s1'};
  draft.relations.song_artists.push({local_ref:'song_artist:sa1',evidence_refs:refs,song:{local_ref:'song:s1'},artist:{existing_id:'G00001',assertions:{name:'Artist',type:'group'},evidence_refs:refs},role:'primary',credit_order:1,source_url:source.source_url});seal(draft);
  const a=resultRevision(await service.saveDecisionDraft(command(draft)));const confirm=command(a,a);confirm.source_revision=decisionIdentity(a);
  await assert.rejects(service.confirmDecision(confirm),{code:'DECISION_INCOMPLETE'});
  const edited=command(a,a);edited.content.entities.works[0].distinct_from=[{target:{existing_id:'W00001'},evidence_refs:refs,reason:'Different composition with identical title'}];
  const newer=resultRevision(await service.saveDecisionDraft(edited));const c=command(newer,newer);c.source_revision=decisionIdentity(newer);
  assert.equal((await service.confirmDecision(c)).revision.status,'confirmed');
});
