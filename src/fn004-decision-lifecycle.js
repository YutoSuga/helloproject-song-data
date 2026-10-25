import { randomUUID } from 'node:crypto';
import { canonicalJson, hashCanonicalJson } from './canonical-hash.js';
import { validateDecisionStore, validateDecisionRevision, validateDecisionIdentity, decisionContentHash, decisionMutationHash, validateCandidateSource } from './fn004-decision-core.js';
import { RepositoryError } from './persistence.js';

export const DECISION_REGISTRY_VERSION = 1;
const fields = ['scope', 'replaces', 'derived_from_revision', 'candidate_bindings', 'entities', 'relations', 'unsupported_requests', 'evidence', 'human_note'];
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code, message) => { throw new RepositoryError(code, message); };
const requireThat = (ok, code, message) => { if (!ok) fail(code, message); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clone = value => JSON.parse(canonicalJson(value));
export const createDecisionId = () => `dec_${randomUUID()}`;
export const decisionIdentity = r => ({ decision_id: r.decision_id, revision: r.revision, content_hash: r.content_hash });
export const decisionContent = r => Object.fromEntries(fields.map(k => [k, clone(r[k])]));
function closed(value, names) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(k => Object.hasOwn(value, k)), 'DECISION_INVALID', 'Missing or unknown command field');
}
function groups(store) {
  const result = new Map();
  for (const r of store.revisions) {
    if (!result.has(r.decision_id)) result.set(r.decision_id, []);
    result.get(r.decision_id).push(r);
  }
  return result;
}

// Validate persisted transition history without consulting current candidates:
// disappeared/changed sources must not prevent inspecting or cancelling history.
export function buildDecisionRegistry(store) {
  validateDecisionStore(store);
  const lineages = groups(store), events = new Map(), invalidated = new Map(), edges = new Map();
  const records = new Map(store.revisions.map(r => [`${r.decision_id}/${r.revision}`, r]));
  for (const [id, revisions] of lineages) {
    let event = null;
    edges.set(id, revisions[0].replaces.map(v => v.target.decision_id));
    for (let index = 0; index < revisions.length; index++) {
      const r = revisions[index], parent = revisions[index - 1];
      if (!parent) requireThat(r.status === 'draft', 'DECISION_INVALID', 'Decision must start with a draft');
      if (r.status === 'confirmed') {
        requireThat(parent?.status === 'draft' && same(decisionContent(r), decisionContent(parent)), 'DECISION_INVALID', 'Confirmation must copy the current draft');
        event = r;
      } else if (r.status === 'cancelled') {
        requireThat(parent && parent.status !== 'cancelled' && same(decisionContent(r), decisionContent(parent)), 'DECISION_INVALID', 'Cancellation must copy its source');
        const target = event?.status === 'confirmed' ? event : parent;
        requireThat(same(r.cancellation.target, decisionIdentity(target)), 'DECISION_INVALID', 'Cancellation target differs from effective confirmation/source');
        event = r;
      }
    }
    if (event?.status === 'confirmed') events.set(id, event);
    const firstConfirm = revisions.find(r => r.status === 'confirmed');
    for (const replacement of revisions[0].replaces) {
      const target = records.get(`${replacement.target.decision_id}/${replacement.target.revision}`);
      requireThat(target?.status === 'confirmed', 'DECISION_INVALID', 'Replacement target must be confirmed');
      requireThat(target.scope.scope_hash !== revisions[0].scope.scope_hash, 'DECISION_INVALID', 'Same-scope edits must keep the original Decision');
      if (!firstConfirm) continue;
      requireThat(!invalidated.has(target.decision_id), 'DECISION_INVALID', 'Replacement target was invalidated more than once');
      requireThat(!lineages.get(target.decision_id).some(r => r.status !== 'draft' && r.revision > target.revision), 'DECISION_INVALID', 'Replacement target has later confirmation/cancellation events');
      invalidated.set(target.decision_id, replacement.target);
    }
  }
  const visiting = new Set(), done = new Set();
  function visit(id) {
    requireThat(!visiting.has(id), 'DECISION_INVALID', 'Replacement lineage cycle');
    if (done.has(id)) return;
    visiting.add(id); for (const target of edges.get(id) ?? []) visit(target); visiting.delete(id); done.add(id);
  }
  for (const id of lineages.keys()) visit(id);
  const active = [...events.values()].filter(r => !invalidated.has(r.decision_id)).sort((a, b) => compare(a.decision_id, b.decision_id));
  const claims = new Map();
  for (const r of active) for (const id of r.scope.candidate_ids) {
    requireThat(!claims.has(id), 'COMPETING_CONFIRMED_DECISION', 'Multiple active Decisions claim the same candidate'); claims.set(id, decisionIdentity(r));
  }
  const projection = { schema_version: 1, active_confirmed: active.map(r => ({ identity: decisionIdentity(r), scope_hash: r.scope.scope_hash, candidate_ids: [...r.scope.candidate_ids] })) };
  return { projection, registry_hash: hashCanonicalJson(projection), active_confirmed: active.map(clone), invalidated_decision_ids: [...invalidated.keys()].sort() };
}
export function getDecisionHead(store, decisionId) {
  buildDecisionRegistry(store);
  return clone(store.revisions.filter(r => r.decision_id === decisionId).at(-1) ?? null);
}
export const resolveEffectiveConfirmedClaims = store => buildDecisionRegistry(store).projection.active_confirmed;

// Only semantic arrays are sorted; credit.names and all observed source facts
// retain their original order/content. Unknown fields survive to Core rejection.
function canonicalOrder(content) {
  const c = clone(content);
  closed(c, fields);
  const sort = (array, key = v => v) => { requireThat(Array.isArray(array), 'DECISION_INVALID', 'Expected semantic array'); array.sort((a, b) => compare(key(a), key(b))); };
  sort(c.scope.candidate_ids);
  sort(c.replaces, v => v.target.decision_id); sort(c.candidate_bindings, v => v.candidate_id);
  for (const group of [c.entities, c.relations]) for (const rows of Object.values(group)) sort(rows, v => v.local_ref);
  sort(c.unsupported_requests, v => v.request_ref); sort(c.evidence, v => v.evidence_id);
  function walk(v) {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    for (const k of ['evidence_refs', 'release_track_refs', 'primary_artist_ids']) if (Object.hasOwn(v, k)) sort(v[k]);
    if (Object.hasOwn(v, 'distinct_from')) sort(v.distinct_from, d => `${Object.hasOwn(d.target, 'existing_id') ? '0' : '1'}:${d.target.existing_id ?? d.target.local_ref}`);
    Object.values(v).forEach(walk);
  }
  walk(c);
  for (const e of c.evidence) { sort(e.candidate_ids); sort(e.source_fingerprints, v => v.candidate_id); }
  return c;
}
export function normalizeDecisionCommand(command) {
  const input = clone(command);
  closed(input, ['decision_id', 'base_revision', 'base_content_hash', 'source_revision', 'content', 'cancellation', 'actor', 'mutation_key']);
  try { input.content = canonicalOrder(input.content); }
  catch (cause) {
    if (cause instanceof RepositoryError) throw cause;
    throw new RepositoryError('DECISION_INVALID','Malformed Decision content',{cause});
  }
  if (input.base_revision !== null || input.base_content_hash !== null) validateDecisionIdentity({ decision_id: input.decision_id, revision: input.base_revision, content_hash: input.base_content_hash });
  if (input.source_revision !== null) validateDecisionIdentity(input.source_revision);
  requireThat(typeof input.mutation_key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.mutation_key), 'DECISION_INVALID', 'Invalid mutation key');
  return input;
}
function requestHash(action, input) {
  const { mutation_key, ...rest } = input;
  return hashCanonicalJson({ schema_version: 1, action, ...rest });
}
// Pure proposal: publication and current-source reads are application duties.
// Replayed records are returned explicitly as historical results, never as head.
export function inspectDecisionMutation(store, action, command) {
  requireThat(['save_draft', 'confirm', 'cancel'].includes(action), 'DECISION_INVALID', 'Unknown Decision action');
  const registry = buildDecisionRegistry(store), input = normalizeDecisionCommand(command);
  const hash = requestHash(action, input);
  const replay = store.revisions.find(r => r.metadata.mutation.key === input.mutation_key);
  if (replay) {
    requireThat(replay.metadata.mutation.request_hash === hash, 'INTEGRITY_CONFLICT', 'Mutation key reused with different content');
    return { replay: clone(replay), input, hash, registry };
  }
  const head = store.revisions.filter(r => r.decision_id === input.decision_id).at(-1);
  requireThat(head ? input.base_revision === head.revision && input.base_content_hash === head.content_hash : input.base_revision === null && input.base_content_hash === null, 'DECISION_HEAD_CONFLICT', 'Decision head changed');
  requireThat(!registry.invalidated_decision_ids.includes(input.decision_id), 'DECISION_INVALID', 'Replaced Decision requires a new Decision ID');
  if (head) requireThat(same(input.content.scope, head.scope), 'DECISION_INVALID', 'Scope change requires a new Decision ID');
  if (action === 'save_draft') requireThat(input.source_revision === null && input.cancellation === null, 'DECISION_INVALID', 'Draft cannot have source/cancellation');
  else {
    requireThat(head && same(input.source_revision, decisionIdentity(head)), 'DECISION_HEAD_CONFLICT', 'Source is not the current head');
    requireThat(same(input.content, decisionContent(head)), 'INTEGRITY_CONFLICT', 'Operation content differs from saved snapshot');
    if (action === 'confirm') requireThat(head.status === 'draft' && input.cancellation === null, 'DECISION_INVALID', 'Only a draft can be confirmed');
    else {
      requireThat(head.status !== 'cancelled', 'DECISION_INVALID', 'Already cancelled');
      const effective = registry.active_confirmed.find(r => r.decision_id === head.decision_id) ?? head;
      requireThat(input.cancellation && same(input.cancellation.target, decisionIdentity(effective)), 'INTEGRITY_CONFLICT', 'Cancellation target mismatch');
    }
  }
  const firstConfirm = store.revisions.some(r => r.decision_id === input.decision_id && r.status === 'confirmed');
  if (!head || (action === 'confirm' && !firstConfirm)) for (const replacement of input.content.replaces) {
    requireThat(registry.active_confirmed.some(r => same(decisionIdentity(r), replacement.target)), 'DECISION_HEAD_CONFLICT', 'Replacement target is no longer the selected effective confirmation');
  }
  return { replay: null, input, hash, registry, head };
}
export function proposeDecisionRevision(store, action, command, { now = new Date().toISOString(), candidates } = {}) {
  const { replay, input, hash, head } = inspectDecisionMutation(store,action,command);
  if (replay) return {revision:replay,replayed:true,store:clone(store)};
  if (action !== 'cancel') {
    requireThat(candidates?.schema_version === 1 && Array.isArray(candidates.candidates), 'CANDIDATE_FINGERPRINT_MISMATCH', 'Current candidate source is required');
    for (const binding of input.content.candidate_bindings) {
      const matches = candidates.candidates.filter(c => c.candidate_id === binding.candidate_id);
      requireThat(matches.length === 1, 'CANDIDATE_FINGERPRINT_MISMATCH', 'Candidate missing or duplicate');
      try { validateCandidateSource(binding, matches[0], candidates.schema_version); }
      catch (cause) { throw new RepositoryError('CANDIDATE_FINGERPRINT_MISMATCH', 'Candidate source token mismatch', { cause }); }
    }
  }
  if (action === 'confirm' && input.content.unsupported_requests.length) fail('UNSUPPORTED_OPERATION','Unsupported requests cannot be confirmed');
  const status = { save_draft: 'draft', confirm: 'confirmed', cancel: 'cancelled' }[action];
  const r = { schema_version: 1, decision_id: input.decision_id, revision: (head?.revision ?? 0) + 1, status,
    parent: head ? decisionIdentity(head) : null, ...input.content, source_revision: input.source_revision, cancellation: input.cancellation, actor: input.actor, content_hash: '',
    metadata: { created_at: head?.metadata.created_at ?? now, saved_at: now, confirmed_at: status === 'confirmed' ? now : null, cancelled_at: status === 'cancelled' ? now : null, mutation: { key: input.mutation_key, request_hash: hash } } };
  requireThat(r.metadata.mutation.request_hash === decisionMutationHash(r), 'INTEGRITY_CONFLICT', 'Mutation projection mismatch');
  r.content_hash = decisionContentHash(r);
  try { validateDecisionRevision(r); }
  catch (cause) { if (action !== 'confirm') throw cause; throw new RepositoryError('DECISION_INCOMPLETE', 'Decision cannot be confirmed', { cause }); }
  const next = { schema_version: 1, revisions: [...store.revisions, r].sort((a, b) => compare(a.decision_id, b.decision_id) || a.revision - b.revision) };
  buildDecisionRegistry(next);
  return { revision: clone(r), replayed: false, store: next };
}
