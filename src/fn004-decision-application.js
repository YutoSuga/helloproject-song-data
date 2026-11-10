import {validateCandidates} from './prepare-reviews.js';
import {randomUUID} from 'node:crypto';
import {candidateSourceProjection,candidateFingerprint,createDecisionScope,validateCandidateSource} from './fn004-decision-core.js';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson } from './canonical-hash.js';
import { CANONICAL_SCHEMA, ID_PATTERNS } from './canonical-schema.js';
import { createPersistence, RepositoryError } from './persistence.js';
import { createFn004Repository } from './fn004-repository.js';
import { withCanonicalGate, assertGateOwnership } from './fn004-gate.js';
import { inspectRuntimeState, validatedSnapshot } from './fn004-runtime-state.js';
import { createDecisionId, decisionContent, decisionIdentity, getDecisionHead, proposeDecisionRevision, inspectDecisionMutation, buildDecisionRegistry } from './fn004-decision-lifecycle.js';
const fail = (code, message) => { throw new RepositoryError(code, message); };
const key = ref => ref?.existing_id ?? ref?.local_ref ?? null;
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
const singular = { works:'work',songs:'song',creators:'creator',artists:'artist',releases:'release',members:'member' };

// Readonly identity assertions and constraints against one gate-protected
// canonical snapshot. No ID allocation, hypothetical rows or canonical writes.
export function validateDecisionCanonicalContext(revision, tables) {
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (Object.hasOwn(v,'existing_id')) {
      const table = Object.keys(ID_PATTERNS).find(t => ID_PATTERNS[t].test(v.existing_id));
      const schema = CANONICAL_SCHEMA[table];
      const row = tables[table]?.find(r => r[schema.primaryKey[0]] === v.existing_id);
      if (!row) fail('EXISTING_IDENTITY_CONFLICT','Referenced canonical entity is missing');
      if (v.assertions) for (const [field,expected] of Object.entries(v.assertions)) {
        let actual;
        if (field === 'primary_artist_ids') actual = tables.song_artists.filter(r => r.song_id === v.existing_id && r.role === 'primary').map(r => r.artist_id).sort();
        else actual = row[field] === '' ? null : row[field];
        if (!same(expected,actual)) fail('EXISTING_IDENTITY_CONFLICT','Canonical assertions changed');
      }
    }
    Object.values(v).forEach(walk);
  }
  walk(revision.candidate_bindings); walk(revision.entities); walk(revision.relations);
  if (revision.status !== 'confirmed') return;
  for (const [table,judgments] of Object.entries(revision.entities)) for (const j of judgments) {
    const field = table === 'works' || table === 'songs' || table === 'releases' ? 'title' : 'name';
    for (const row of tables[table]) {
      if (row[field] !== j[field] || (table === 'songs' && row.work_id !== key(j.work))) continue;
      if (!j.distinct_from.some(d => d.target.existing_id === row[`${singular[table]}_id`] && d.evidence_refs.length > 0)) fail('DECISION_INCOMPLETE','Same-name entity requires explicit distinct evidence');
    }
  }
  for (const [table,judgments] of Object.entries(revision.relations)) {
    const schema = CANONICAL_SCHEMA[table], pk = new Set(), orders = new Set();
    const value = (row,col,canonical) => {
      const spec = schema.columns.find(c => c.name === col);
      if (!canonical) return spec.type === 'id' ? key(row[singular[spec.target]]) : row[col];
      if (row[col] === '') return null;
      if (spec.type !== 'integer') return row[col];
      const n = Number(row[col]); if (!Number.isSafeInteger(n)) fail('DECISION_INCOMPLETE','Canonical integer exceeds safe JSON representation'); return n;
    };
    for (const [rows,canonical] of [[tables[table],true],[judgments,false]]) for (const row of rows) {
      const tuple = schema.primaryKey.map(col => value(row,col,canonical));
      const id = canonicalJson(tuple); if (pk.has(id)) fail('DECISION_INCOMPLETE','Relation already exists'); pk.add(id);
      for (const order of schema.orders ?? []) {
        const tuple = [...order.scope.map(col => value(row,col,canonical)), value(row,order.column,canonical)];
        if (tuple.includes(null)) continue;
        const id = canonicalJson([order.column,...tuple]); if (orders.has(id)) fail('DECISION_INCOMPLETE','Relation order conflicts with canonical'); orders.add(id);
      }
    }
  }
}

// Competing processes hold the same exclusive gate. A briefly busy gate is
// retried before reading any state; once acquired, OCC decides stale requests.
// Existing stale/corrupt locks are never removed or treated as successful work.
async function gated(root, operation, fn) {
  const deadline = Date.now()+5000;
  for (;;) {
    let entered = false;
    try { return await withCanonicalGate({root,operation,fn: async gate => { entered=true; return fn(gate); }}); }
    catch (error) { if (entered || error.code !== 'GATE_BUSY' || Date.now() >= deadline) throw error; await delay(10); }
  }
}
export function createDecisionService({ root = process.cwd(), io, clock = () => new Date().toISOString() } = {}) {
  async function mutate(action, command, build = null) {
    // Freeze caller input before any await; no buffer mutation during gate wait.
    const captured = JSON.parse(canonicalJson(command));
    const repository = await createFn004Repository(root, io ? {io} : {});
    const persistence = await createPersistence(root, io ? {io} : {});
    return gated(repository.root, `decision_${action}`, async gate => {
      const snapshot = await validatedSnapshot(persistence);
      const ready = await inspectRuntimeState(persistence,{snapshot,gate});
      if (ready.status !== 'READY' || ready.readiness !== 'initialized') fail(ready.status === 'READY' ? 'RECOVERY_REQUIRED' : ready.status,'Runtime blocks Decision mutation');
      const current = await repository.readDecisionStore({gate});
      const input = build ? build(current,captured) : captured;
      const preflight = inspectDecisionMutation(current,action,input);
      if (preflight.replay) return {revision:preflight.replay,replayed:true};
      const candidates = action === 'cancel' ? undefined : await persistence.readJson('staging/song-candidates.json',{strict:true});
      const result = proposeDecisionRevision(current,action,input,{now:clock(),candidates});
      if (result.replayed) return {revision:result.revision,replayed:true};
      if (action !== 'cancel') validateDecisionCanonicalContext(result.revision,snapshot.tables);
      await assertGateOwnership(gate,repository.root);
      await repository.writeDecisionStore(result.store,{gate});
      return {revision:result.revision,replayed:false};
    });
  }
  async function read(operation, fn) {
    const repository=await createFn004Repository(root,io?{io}:{});
    return gated(repository.root,operation,async gate=>{
      const persistence=await createPersistence(root,io?{io}:{});
      const ready=await inspectRuntimeState(persistence,{gate});
      if(ready.status!=='READY'||ready.readiness!=='initialized')fail(ready.status==='READY'?'RECOVERY_REQUIRED':ready.status,'Runtime blocks Decision operation');
      const store=await repository.readDecisionStore({gate});buildDecisionRegistry(store);
      return fn({store,persistence,gate});
    });
  }
  async function sources(persistence) {
    const source=await persistence.readJson('staging/song-candidates.json',{strict:true});
    try {validateCandidates(source);}catch(cause){throw new RepositoryError('CANDIDATE_FINGERPRINT_MISMATCH','Candidate source collection is invalid',{cause});}
    return source;
  }
  function selected(store,id,revision) {
    const head=getDecisionHead(store,id);
    const value=revision===undefined?head:store.revisions.find(r=>r.decision_id===id&&r.revision===revision);
    if(!value)fail('PERSISTENCE_NOT_FOUND','Decision revision not found');
    return {head,revision:value};
  }
  function confirmation(store,input) {
    const {head}=selected(store,input.decision_id);
    if(head.revision!==input.revision||head.content_hash!==input.expected_head)fail('DECISION_HEAD_CONFLICT','Decision head changed');
    return {decision_id:head.decision_id,base_revision:head.revision,base_content_hash:head.content_hash,
      source_revision:decisionIdentity(head),content:decisionContent(head),cancellation:null,actor:input.actor,mutation_key:input.mutation_key};
  }
  return Object.freeze({
    getDecision: (id,revision)=>read('decision_show',async({store})=>selected(store,id,revision)),
    createDecisionTemplate: candidateId=>read('decision_template',async({persistence})=>{
      const source=await sources(persistence);
      const found=source.candidates.filter(c=>c.candidate_id===candidateId);
      if(source.schema_version!==1||found?.length!==1)fail('CANDIDATE_FINGERPRINT_MISMATCH','Candidate missing or duplicate');
      const projection=candidateSourceProjection(found[0],source.schema_version);
      const facts=projection.facts;
      return {schema_version:1,decision_id:null,base_revision:null,base_content_hash:null,mutation_key:randomUUID(),content:{
        scope:createDecisionScope([candidateId]),replaces:[],derived_from_revision:null,
        candidate_bindings:[{candidate_id:candidateId,source_schema_version:1,projection_version:1,
          source_identity:Object.fromEntries(['source_artist_slug','source_release_url','media_type','edition','product_number','disc_index','track_number'].map(k=>[k,facts[k]])),
          source_facts:facts,fingerprint:candidateFingerprint(found[0]),work:null,song:null,audio_identity:null,accepted_version_type:null,
          release_track_refs:[],performer_review:'unreviewed',evidence_refs:[],human_note:''}],
        entities:{works:[],creators:[],artists:[],releases:[],songs:[]},relations:{song_artists:[],song_creators:[],song_performers:[],release_tracks:[]},
        unsupported_requests:[],evidence:[],human_note:''}};
    }),
    importDecisionDraft: (document,actor)=>mutate('save_draft',{document,actor},(store,{document:d,actor})=>{
      const keys=['schema_version','decision_id','base_revision','base_content_hash','mutation_key','content'];
      if(!d||typeof d!=='object'||Object.keys(d).length!==keys.length||keys.some(k=>!Object.hasOwn(d,k))||d.schema_version!==1)fail('DECISION_INVALID','Invalid external draft document');
      if(d.decision_id===null&&(d.base_revision!==null||d.base_content_hash!==null))fail('DECISION_INVALID','New draft cannot claim a base');
      if(d.decision_id!==null&&!getDecisionHead(store,d.decision_id))fail('DECISION_HEAD_CONFLICT','Update target does not exist');
      const replay=store.revisions.find(r=>r.metadata.mutation.key===d.mutation_key);
      return {decision_id:d.decision_id??replay?.decision_id??createDecisionId(),base_revision:d.base_revision,base_content_hash:d.base_content_hash,
        source_revision:null,content:d.content,cancellation:null,actor,mutation_key:d.mutation_key};
    }),
    confirmDecisionHead: input=>mutate('confirm',input,confirmation),
    validateDecision: (id,revision,actor)=>read('decision_validate',async({store,persistence})=>{
      const chosen=selected(store,id,revision);
      if(chosen.head.revision!==revision)fail('DECISION_HEAD_CONFLICT','Validation requires current head');
      const input={decision_id:id,revision,expected_head:chosen.head.content_hash,actor,mutation_key:randomUUID()};

      try {
        const candidates=await sources(persistence);
        for(const b of chosen.revision.candidate_bindings){const found=candidates.candidates.filter(c=>c.candidate_id===b.candidate_id);if(found.length!==1)fail('CANDIDATE_FINGERPRINT_MISMATCH','Candidate missing or duplicate');try{validateCandidateSource(b,found[0],candidates.schema_version);}catch(cause){throw new RepositoryError('CANDIDATE_FINGERPRINT_MISMATCH','Candidate source token mismatch',{cause});}}
        const value=chosen.head.status==='draft'?proposeDecisionRevision(store,'confirm',confirmation(store,input),{now:clock(),candidates}).revision:chosen.revision;
        validateDecisionCanonicalContext(value,(await validatedSnapshot(persistence)).tables);
        return {revision:chosen.revision,valid:true,confirmable:chosen.head.status==='draft',diagnostics:[]};
      } catch(error) {
        if(!['DECISION_INVALID','DECISION_INCOMPLETE','UNSUPPORTED_OPERATION','CANDIDATE_FINGERPRINT_MISMATCH','EXISTING_IDENTITY_CONFLICT'].includes(error.code))throw error;
        return {revision:chosen.revision,valid:false,confirmable:false,diagnostics:[{code:error.code}]};
      }
    }),
    saveDecisionDraft: command => mutate('save_draft',command),
    confirmDecision: command => mutate('confirm',command),
    cancelDecision: command => mutate('cancel',command),
    buildDecisionRegistry: async () => {
      const repository = await createFn004Repository(root,io ? {io} : {});
      return gated(repository.root,'decision_registry',async gate => {
        const persistence = await createPersistence(root,io ? {io} : {});
        const ready = await inspectRuntimeState(persistence,{gate});
        if (ready.status !== 'READY' || ready.readiness !== 'initialized') fail(ready.status === 'READY' ? 'RECOVERY_REQUIRED' : ready.status,'Runtime blocks Decision registry reads');
        return buildDecisionRegistry(await repository.readDecisionStore({gate}));
      });
    }
  });
}
export const saveDecisionDraft = (command,options) => createDecisionService(options).saveDecisionDraft(command);
export const confirmDecision = (command,options) => createDecisionService(options).confirmDecision(command);
export const cancelDecision = (command,options) => createDecisionService(options).cancelDecision(command);
