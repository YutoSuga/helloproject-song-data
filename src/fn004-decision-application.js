import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson } from './canonical-hash.js';
import { CANONICAL_SCHEMA, ID_PATTERNS } from './canonical-schema.js';
import { createPersistence, RepositoryError } from './persistence.js';
import { createFn004Repository } from './fn004-repository.js';
import { withCanonicalGate, assertGateOwnership } from './fn004-gate.js';
import { inspectRuntimeState, validatedSnapshot } from './fn004-runtime-state.js';
import { proposeDecisionRevision, inspectDecisionMutation, buildDecisionRegistry } from './fn004-decision-lifecycle.js';
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
  async function mutate(action, command) {
    // Freeze caller input before any await; no buffer mutation during gate wait.
    const input = JSON.parse(canonicalJson(command));
    const repository = await createFn004Repository(root, io ? {io} : {});
    const persistence = await createPersistence(root, io ? {io} : {});
    return gated(repository.root, `decision_${action}`, async gate => {
      const snapshot = await validatedSnapshot(persistence);
      const ready = await inspectRuntimeState(persistence,{snapshot});
      if (ready.status !== 'READY' || ready.readiness !== 'initialized') fail(ready.status === 'READY' ? 'RECOVERY_REQUIRED' : ready.status,'Runtime blocks Decision mutation');
      const current = await repository.readDecisionStore({gate});
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
  return Object.freeze({
    saveDecisionDraft: command => mutate('save_draft',command),
    confirmDecision: command => mutate('confirm',command),
    cancelDecision: command => mutate('cancel',command),
    buildDecisionRegistry: async () => {
      const repository = await createFn004Repository(root,io ? {io} : {});
      return gated(repository.root,'decision_registry',async gate => {
        const persistence = await createPersistence(root,io ? {io} : {});
        const ready = await inspectRuntimeState(persistence);
        if (ready.status !== 'READY' || ready.readiness !== 'initialized') fail(ready.status === 'READY' ? 'RECOVERY_REQUIRED' : ready.status,'Runtime blocks Decision registry reads');
        return buildDecisionRegistry(await repository.readDecisionStore({gate}));
      });
    }
  });
}
export const saveDecisionDraft = (command,options) => createDecisionService(options).saveDecisionDraft(command);
export const confirmDecision = (command,options) => createDecisionService(options).confirmDecision(command);
export const cancelDecision = (command,options) => createDecisionService(options).cancelDecision(command);
