// Formal persisted-document validation only. Live canonical/source checks,
// lifecycle transitions, OCC and effective registry resolution belong to 4A-2.
import { canonicalJson, hashCanonicalJson } from './canonical-hash.js';
import { CANONICAL_SCHEMA, ID_PATTERNS } from './canonical-schema.js';
import { isCanonicalDate } from './canonical-validator.js';
import { RepositoryError } from './persistence.js';

export const DECISION_SCOPE_VERSION = 1;
export const CANDIDATE_SOURCE_SCHEMA_VERSION = 1;
export const CANDIDATE_FINGERPRINT_VERSION = 1;
const fail = (message) => { throw new RepositoryError('DECISION_INVALID', message); };
const check = (condition, message) => { if (!condition) fail(message); };
const text = (v) => typeof v === 'string';
const nonempty = (v) => text(v) && v.trim().length > 0;
const asciiId = (v) => nonempty(v) && /^[\x00-\x7f]+$/.test(v);
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const hash = (v) => text(v) && /^[0-9a-f]{64}$/.test(v);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function closed(v, keys) {
  check(object(v), 'Expected a closed object');
  check(Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)), 'Missing or unknown field');
}
function sorted(values, predicate = text) {
  check(Array.isArray(values), 'Expected an array');
  values.forEach((value, i) => check(predicate(value) && (i === 0 || values[i - 1] < value), 'Invalid, duplicate or unordered value'));
}
function https(v) {
  if (!text(v) || !/^[\x21-\x7e]+$/.test(v) || !v.startsWith('https://') || v.includes('\\')) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && Boolean(u.hostname); } catch { return false; }
}
const identityKeys = ['source_artist_slug', 'source_release_url', 'media_type', 'edition', 'product_number', 'disc_index', 'track_number'];
const factKeys = [...identityKeys, 'title', 'release_title', 'release_date', 'release_type', 'artist_name', 'source_url', 'credits'];
const roles = ['lyrics', 'composition', 'arrangement', 'performer', 'english_lyrics', 'brass_arrangement'];
function validateFacts(facts) {
  closed(facts, factKeys);
  for (const key of factKeys.filter(k => k !== 'credits')) {
    const v = facts[key];
    check(v === null || (['disc_index', 'track_number'].includes(key) ? positive(v) : text(v)), `Invalid source fact ${key}`);
    if (['source_release_url', 'source_url'].includes(key) && v !== null) check(https(v), `Invalid source URL ${key}`);
  }
  if (facts.credits !== null) {
    check(object(facts.credits), 'Invalid credits');
    for (const [role, credit] of Object.entries(facts.credits)) {
      check(roles.includes(role), 'Unknown credit role');
      closed(credit, ['raw', 'names']);
      check(credit.raw === null || text(credit.raw), 'Invalid raw credit');
      check(Array.isArray(credit.names) && credit.names.every(text), 'Invalid credit names');
    }
  }
  canonicalJson(facts);
  return facts;
}

// This is the only source normalization in profile v1. Administrative and
// volatile top-level fields never enter the projection; credit order is fact.
export function candidateSourceProjection(candidate, sourceSchemaVersion = 1) {
  check(sourceSchemaVersion === CANDIDATE_SOURCE_SCHEMA_VERSION && object(candidate), 'Unsupported candidate source schema');
  const facts = Object.fromEntries(factKeys.map(key => [key, Object.hasOwn(candidate, key) ? candidate[key] : null]));
  if (facts.credits !== null) {
    check(object(facts.credits), 'Invalid credits');
    facts.credits = Object.fromEntries(Object.entries(facts.credits).map(([role, credit]) => {
      check(object(credit) && Object.keys(credit).every(k => ['raw', 'names'].includes(k)), 'Unknown credit field');
      return [role, { raw: Object.hasOwn(credit, 'raw') ? credit.raw : null, names: Object.hasOwn(credit, 'names') ? credit.names : [] }];
    }));
  }
  validateFacts(facts);
  return { projection_version: 1, source_schema_version: 1, facts };
}
export function candidateFingerprint(candidate, sourceSchemaVersion = 1) {
  return { profile: 'candidate-source-v1', algorithm: 'sha256', value: hashCanonicalJson(candidateSourceProjection(candidate, sourceSchemaVersion)) };
}
function validateFingerprint(v) {
  closed(v, ['profile', 'algorithm', 'value']);
  check(v.profile === 'candidate-source-v1' && v.algorithm === 'sha256' && hash(v.value), 'Invalid fingerprint');
}
export function createDecisionScope(candidateIds) {
  check(Array.isArray(candidateIds) && candidateIds.length > 0, 'Empty scope');
  const candidate_ids = [...candidateIds].sort();
  sorted(candidate_ids, asciiId);
  const projection = { schema_version: 1, candidate_ids };
  return { ...projection, scope_hash: hashCanonicalJson(projection) };
}
export function validateDecisionScope(scope) {
  closed(scope, ['schema_version', 'candidate_ids', 'scope_hash']);
  check(scope.schema_version === 1, 'Unsupported scope version');
  sorted(scope.candidate_ids, asciiId);
  check(scope.candidate_ids.length > 0 && hash(scope.scope_hash) && scope.scope_hash === createDecisionScope(scope.candidate_ids).scope_hash, 'Invalid scope hash');
  return scope;
}
const refs = {
  work: ['works', /^work:w[1-9][0-9]*$/, ['title']],
  song: ['songs', /^song:s[1-9][0-9]*$/, ['work_id', 'title', 'version_name', 'version_type', 'primary_artist_ids']],
  creator: ['creators', /^creator:c[1-9][0-9]*$/, ['name']],
  artist: ['artists', /^artist:a[1-9][0-9]*$/, ['name', 'type']],
  release: ['releases', /^release:r[1-9][0-9]*$/, ['title', 'release_type', 'release_date', 'catalog_number']],
  member: ['members', null, ['name']]
};
function evidenceRefs(v) { sorted(v, x => text(x) && /^ev_[a-z][a-z0-9_]*$/.test(x)); }
export function validateTypedRef(type, ref) {
  check(Object.hasOwn(refs, type), 'Unknown ref type');
  canonicalJson(ref);
  const [table, local, fields] = refs[type];
  check(object(ref), 'Expected ref');
  if (Object.hasOwn(ref, 'local_ref')) {
    closed(ref, ['local_ref']);
    check(local && text(ref.local_ref) && local.test(ref.local_ref), 'Invalid local ref');
  } else {
    closed(ref, ['existing_id', 'assertions', 'evidence_refs']);
    check(text(ref.existing_id) && ID_PATTERNS[table].test(ref.existing_id), 'Invalid existing ID');
    closed(ref.assertions, fields);
    for (const field of fields) {
      const v = ref.assertions[field];
      if (field === 'primary_artist_ids') {
        sorted(v, x => text(x) && ID_PATTERNS.artists.test(x));
        check(v.length > 0, 'Empty primary artist assertions');
      } else {
        const col = CANONICAL_SCHEMA[table].columns.find(c => c.name === field);
        check(v === null ? !col.required : nonempty(v), 'Invalid assertion value');
        if (v !== null && col.type === 'enum') check(col.values.includes(v), 'Invalid assertion enum');
        if (v !== null && col.type === 'id') check(col.pattern.test(v), 'Invalid assertion ID');
        if (v !== null && col.type === 'date') check(isCanonicalDate(v), 'Invalid assertion date');
      }
    }
    evidenceRefs(ref.evidence_refs);
  }
  return ref;
}

// Projection alone is not a revision validator. Callers must validate the full
// revision before trusting its hash or writing it to a Decision store.
export function decisionContentProjection(revision) {
  check(object(revision), 'Expected revision');
  return Object.fromEntries(Object.entries(revision).filter(([key]) => !['content_hash', 'metadata'].includes(key)));
}
export const decisionContentHash = revision => hashCanonicalJson(decisionContentProjection(revision));

export function validateCandidateBinding(binding, scope) {
  canonicalJson(binding);
  validateDecisionScope(scope);
  closed(binding, ['candidate_id', 'source_schema_version', 'projection_version', 'source_identity', 'source_facts', 'fingerprint', 'work', 'song', 'audio_identity', 'accepted_version_type', 'release_track_refs', 'performer_review', 'evidence_refs', 'human_note']);
  check(scope.candidate_ids.includes(binding.candidate_id), 'Binding outside scope');
  check(binding.source_schema_version === 1 && binding.projection_version === 1, 'Unsupported binding version');
  validateFacts(binding.source_facts);
  closed(binding.source_identity, identityKeys);
  check(identityKeys.every(key => binding.source_identity[key] === binding.source_facts[key]), 'Source identity mismatch');
  validateFingerprint(binding.fingerprint);
  check(binding.fingerprint.value === candidateFingerprint(binding.source_facts).value, 'Fingerprint mismatch');
  for (const type of ['work', 'song']) if (binding[type] !== null) validateTypedRef(type, binding[type]);
  check([null, 'same_audio', 'distinct_recording'].includes(binding.audio_identity), 'Invalid audio identity');
  check(binding.accepted_version_type === null || CANONICAL_SCHEMA.songs.columns.find(c => c.name === 'version_type').values.includes(binding.accepted_version_type), 'Invalid version type');
  sorted(binding.release_track_refs, v => text(v) && /^track:t[1-9][0-9]*$/.test(v));
  check(['unreviewed', 'specified'].includes(binding.performer_review) && text(binding.human_note), 'Invalid binding review/note');
  evidenceRefs(binding.evidence_refs);
  return binding;
}

// Explicit comparison only: callers decide when to adopt a changed snapshot.
// No candidate lookup, fuzzy matching, or automatic reattachment occurs here.
export function validateCandidateSource(binding, candidate, sourceSchemaVersion) {
  validateCandidateBinding(binding, createDecisionScope([binding.candidate_id]));
  check(candidateFingerprint(candidate, sourceSchemaVersion).value === binding.fingerprint.value, 'Candidate source changed');
  return binding;
}

const judgmentTables = {
  work: ['works', /^work:w[1-9][0-9]*$/],
  creator: ['creators', /^creator:c[1-9][0-9]*$/],
  artist: ['artists', /^artist:a[1-9][0-9]*$/],
  release: ['releases', /^release:r[1-9][0-9]*$/],
  song: ['songs', /^song:s[1-9][0-9]*$/],
  song_artist: ['song_artists', /^song_artist:sa[1-9][0-9]*$/],
  song_creator: ['song_creators', /^song_creator:sc[1-9][0-9]*$/],
  song_performer: ['song_performers', /^song_performer:sp[1-9][0-9]*$/],
  track: ['release_tracks', /^track:t[1-9][0-9]*$/]
};
const tableRefType = { works: 'work', songs: 'song', creators: 'creator', artists: 'artist', releases: 'release', members: 'member' };
function judgmentColumns(type, table) {
  return CANONICAL_SCHEMA[table].columns.filter(c => !['created_at', 'updated_at'].includes(c.name) && c.name !== `${type}_id`).map(c => ({ ...c, name: c.type === 'id' ? tableRefType[c.target] : c.name }));
}
// Formal row shape only. Resolution against other local definitions, canonical
// assertions, reachability and confirmed completeness require revision context.
export function validateDecisionJudgment(type, judgment, { confirmed = false } = {}) {
  check(Object.hasOwn(judgmentTables, type), 'Unknown judgment type');
  canonicalJson(judgment);
  const [table, pattern] = judgmentTables[type];
  const master = Object.hasOwn(refs, type);
  const columns = judgmentColumns(type, table);
  const extra = master ? ['distinct_from', ...(type === 'song' ? ['song_id_prefix'] : [])] : [];
  closed(judgment, ['local_ref', 'evidence_refs', ...columns.map(c => c.name), ...extra]);
  check(text(judgment.local_ref) && pattern.test(judgment.local_ref), 'Invalid judgment local ref');
  evidenceRefs(judgment.evidence_refs);
  if (confirmed) check(judgment.evidence_refs.length > 0, 'Confirmed judgment requires evidence');
  for (const col of columns) {
    const value = judgment[col.name];
    if (value === null) { check(!confirmed || !col.required, `Missing required judgment ${col.name}`); continue; }
    if (col.type === 'id') validateTypedRef(tableRefType[col.target], value);
    else if (col.type === 'integer') check(positive(value), `Invalid integer ${col.name}`);
    else {
      check(nonempty(value), `Invalid text ${col.name}`);
      if (col.type === 'date') check(isCanonicalDate(value), `Invalid date ${col.name}`);
      if (col.type === 'url') check(https(value), `Invalid URL ${col.name}`);
      if (col.type === 'enum') check(col.values.includes(value), `Invalid enum ${col.name}`);
    }
  }
  if (type === 'artist' && judgment.start_date !== null && judgment.end_date !== null) check(judgment.start_date <= judgment.end_date, 'Invalid artist period');
  if (type === 'song') check(judgment.song_id_prefix === null ? !confirmed : ['M', 'A', 'J', 'T', 'B', 'O', 'R', 'H'].includes(judgment.song_id_prefix), 'Invalid song prefix');
  if (master) {
    check(Array.isArray(judgment.distinct_from), 'Invalid distinct_from');
    let previous = null;
    for (const item of judgment.distinct_from) {
      closed(item, ['target', 'evidence_refs', 'reason']);
      check(object(item.target), 'Invalid distinct target');
      const existing = Object.hasOwn(item.target, 'existing_id');
      closed(item.target, [existing ? 'existing_id' : 'local_ref']);
      const value = existing ? item.target.existing_id : item.target.local_ref;
      check(text(value) && (existing ? ID_PATTERNS[table].test(value) : refs[type][1].test(value)), 'Invalid distinct target');
      check(value !== judgment.local_ref, 'Self distinct target');
      const key = `${existing ? '0' : '1'}:${value}`;
      check(previous === null || previous < key, 'Duplicate or unordered distinct target');
      previous = key;
      check(nonempty(item.reason), 'Missing distinct reason');
      evidenceRefs(item.evidence_refs);
      if (confirmed) check(item.evidence_refs.length > 0, 'Missing distinct evidence');
    }
  }
  return judgment;
}

export const DECISION_STORE_VERSION = 1;
export const DECISION_REVISION_VERSION = 1;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decisionId = v => text(v) && v.startsWith('dec_') && uuidPattern.test(v.slice(4));
function timestamp(v) {
  if (!text(v)) return false;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(v);
  return Boolean(m && isCanonicalDate(m[1]) && +m[2] < 24 && +m[3] < 60 && +m[4] < 60 && (m[5] === 'Z' || (+m[6] < 24 && +m[7] < 60)));
}
export function validateDecisionIdentity(v) {
  closed(v, ['decision_id', 'revision', 'content_hash']);
  check(decisionId(v.decision_id) && positive(v.revision) && hash(v.content_hash), 'Invalid Decision identity');
  return v;
}
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
function orderedObjects(values, key) {
  check(Array.isArray(values), 'Expected object array');
  sorted(values.map(v => { check(object(v), 'Expected object'); return key(v); }));
}
export function validateDecisionEvidence(e, bindings, scope) {
  canonicalJson(e);
  closed(e, ['evidence_id', 'kind', 'url', 'publisher', 'official_basis', 'checked_at', 'facts', 'candidate_ids', 'source_fingerprints', 'human_note']);
  check(text(e.evidence_id) && /^ev_[a-z][a-z0-9_]*$/.test(e.evidence_id), 'Invalid evidence ID');
  check(['official_source', 'human_observation'].includes(e.kind), 'Invalid evidence kind');
  check(e.url === null || https(e.url), 'Invalid evidence URL');
  for (const key of ['publisher', 'official_basis']) check(e[key] === null || nonempty(e[key]), 'Invalid evidence attribution');
  if (e.kind === 'official_source') check(e.url !== null && e.publisher !== null && e.official_basis !== null, 'Missing official attribution');
  else check(e.official_basis === null, 'Observation cannot claim official basis');
  check(timestamp(e.checked_at) && nonempty(e.facts) && text(e.human_note), 'Invalid evidence facts/time/note');
  sorted(e.candidate_ids, asciiId);
  check(e.candidate_ids.every(id => scope.candidate_ids.includes(id)), 'Evidence outside scope');
  orderedObjects(e.source_fingerprints, v => v.candidate_id);
  for (const v of e.source_fingerprints) {
    closed(v, ['candidate_id', 'fingerprint']); validateFingerprint(v.fingerprint);
    check(bindings.some(b => b.candidate_id === v.candidate_id && same(b.fingerprint, v.fingerprint)), 'Evidence fingerprint mismatch');
  }
  check(same(e.candidate_ids, e.source_fingerprints.map(v => v.candidate_id)), 'Evidence candidate set mismatch');
  return e;
}
const entityTypes = { works: 'work', creators: 'creator', artists: 'artist', releases: 'release', songs: 'song' };
const relationTypes = { song_artists: 'song_artist', song_creators: 'song_creator', song_performers: 'song_performer', release_tracks: 'track' };
const contentFields = ['scope', 'replaces', 'derived_from_revision', 'candidate_bindings', 'entities', 'relations', 'unsupported_requests', 'evidence', 'human_note'];
export function decisionMutationHash(r) {
  return hashCanonicalJson({ schema_version: 1, action: { draft: 'save_draft', confirmed: 'confirm', cancelled: 'cancel' }[r.status], decision_id: r.decision_id,
    base_revision: r.parent?.revision ?? null, base_content_hash: r.parent?.content_hash ?? null, source_revision: r.source_revision,
    content: Object.fromEntries(contentFields.map(k => [k, r[k]])), cancellation: r.cancellation, actor: r.actor });
}
export function validateDecisionRevision(r) {
  canonicalJson(r);
  closed(r, ['schema_version', 'decision_id', 'revision', 'status', 'parent', ...contentFields, 'source_revision', 'cancellation', 'actor', 'content_hash', 'metadata']);
  check(r.schema_version === 1 && decisionId(r.decision_id) && positive(r.revision), 'Invalid revision version/identity');
  check(['draft', 'confirmed', 'cancelled'].includes(r.status), 'Invalid status');
  for (const key of ['parent', 'source_revision', 'derived_from_revision']) if (r[key] !== null) validateDecisionIdentity(r[key]);
  check(r.revision === 1 ? r.parent === null : r.parent !== null && r.parent.decision_id === r.decision_id && r.parent.revision === r.revision - 1, 'Invalid parent');
  check(r.status === 'draft' ? r.source_revision === null : r.source_revision !== null && same(r.source_revision, r.parent), 'Invalid source identity');
  if (r.status === 'cancelled') {
    closed(r.cancellation, ['target', 'reason']); validateDecisionIdentity(r.cancellation.target);
    check(r.cancellation.target.decision_id === r.decision_id && nonempty(r.cancellation.reason), 'Invalid cancellation');
  } else check(r.cancellation === null, 'Unexpected cancellation');
  validateDecisionScope(r.scope);
  orderedObjects(r.replaces, v => v.target?.decision_id);
  for (const replacement of r.replaces) {
    closed(replacement, ['target', 'reason', 'evidence_refs']); validateDecisionIdentity(replacement.target);
    check(replacement.target.decision_id !== r.decision_id && nonempty(replacement.reason), 'Invalid replacement');
    evidenceRefs(replacement.evidence_refs); check(replacement.evidence_refs.length > 0, 'Replacement needs evidence');
  }
  orderedObjects(r.candidate_bindings, v => v.candidate_id);
  check(same(r.scope.candidate_ids, r.candidate_bindings.map(v => v.candidate_id)), 'Bindings must equal scope');
  r.candidate_bindings.forEach(b => validateCandidateBinding(b, r.scope));
  for (const [group, types] of [['entities', entityTypes], ['relations', relationTypes]]) {
    closed(r[group], Object.keys(types));
    for (const [key, type] of Object.entries(types)) {
      orderedObjects(r[group][key], v => v.local_ref);
      r[group][key].forEach(v => validateDecisionJudgment(type, v, { confirmed: r.status === 'confirmed' }));
    }
  }
  orderedObjects(r.unsupported_requests, v => v.request_ref);
  for (const u of r.unsupported_requests) {
    closed(u, ['request_ref', 'kind', 'target', 'description', 'evidence_refs']);
    check(/^unsupported:u[1-9][0-9]*$/.test(u.request_ref) && ['new_member', 'update_existing', 'delete', 'member_affiliation', 'video', 'large_correction'].includes(u.kind), 'Invalid unsupported request');
    check((u.target === null || nonempty(u.target)) && nonempty(u.description), 'Invalid unsupported description'); evidenceRefs(u.evidence_refs);
  }
  check(r.status !== 'confirmed' || r.unsupported_requests.length === 0, 'Unsupported confirmed operation');
  orderedObjects(r.evidence, v => v.evidence_id);
  r.evidence.forEach(e => validateDecisionEvidence(e, r.candidate_bindings, r.scope));
  check(text(r.human_note), 'Invalid human note');
  closed(r.actor, ['id', 'assurance']);
  check(['local_process', 'authenticated_admin'].includes(r.actor.assurance), 'Invalid actor assurance');
  const prefix = { local_process: 'local:', authenticated_admin: 'admin:' }[r.actor.assurance];
  check(prefix && text(r.actor.id) && r.actor.id.startsWith(prefix) && nonempty(r.actor.id.slice(prefix.length)), 'Invalid actor');
  closed(r.metadata, ['created_at', 'saved_at', 'confirmed_at', 'cancelled_at', 'mutation']);
  check(timestamp(r.metadata.created_at) && timestamp(r.metadata.saved_at), 'Invalid metadata timestamps');
  for (const status of ['confirmed', 'cancelled']) check(r.status === status ? r.metadata[`${status}_at`] === r.metadata.saved_at : r.metadata[`${status}_at`] === null, 'Invalid status timestamp');
  if (r.revision === 1) check(r.metadata.created_at === r.metadata.saved_at, 'Invalid genesis creation time');
  closed(r.metadata.mutation, ['key', 'request_hash']);
  check(text(r.metadata.mutation.key) && uuidPattern.test(r.metadata.mutation.key) && hash(r.metadata.mutation.request_hash) && r.metadata.mutation.request_hash === decisionMutationHash(r), 'Invalid mutation metadata');
  validateDecisionReferences(r);
  check(hash(r.content_hash) && r.content_hash === decisionContentHash(r), 'Invalid content hash');
  return r;
}

const refKey = ref => ref === null ? null : ref.local_ref ?? ref.existing_id;
export function validateDecisionReferences(r) {
  const confirmed = r.status === 'confirmed';
  const definitions = new Map();
  const evidence = new Map(r.evidence.map(e => [e.evidence_id, e]));
  const assertions = new Map();
  const judgments = [...Object.values(r.entities).flat(), ...Object.values(r.relations).flat()];
  for (const j of judgments) { check(!definitions.has(j.local_ref), 'Duplicate local definition'); definitions.set(j.local_ref, j); }
  function visit(value) {
    if (!object(value) && !Array.isArray(value)) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (Object.hasOwn(value, 'evidence_refs')) {
      check(value.evidence_refs.every(id => evidence.has(id)), 'Dangling evidence ref');
      if (confirmed && !Object.hasOwn(value, 'request_ref')) check(value.evidence_refs.length > 0, 'Confirmed judgment needs evidence');
      if (confirmed && value.source_url !== null && Object.hasOwn(value, 'source_url')) check(value.evidence_refs.some(id => { const e = evidence.get(id); return e.kind === 'official_source' && e.url === value.source_url; }), 'Missing matching official evidence');
    }
    // Definitions and distinct targets also have local_ref, but only references
    // are one-field objects; definitions themselves do not imply reachability.
    if (Object.keys(value).length === 1 && Object.hasOwn(value, 'local_ref')) {
      check(definitions.has(value.local_ref), 'Dangling local ref');
    }
    if (Object.hasOwn(value, 'assertions')) {
      const previous = assertions.get(value.existing_id);
      check(!previous || same(previous, value.assertions), 'Contradictory existing assertions');
      assertions.set(value.existing_id, value.assertions);
    }
    Object.values(value).forEach(visit);
  }
  visit(r.candidate_bindings); visit(r.entities); visit(r.relations); visit(r.replaces); visit(r.unsupported_requests);
  for (const b of r.candidate_bindings) {
    for (const track of b.release_track_refs) check(r.relations.release_tracks.some(t => t.local_ref === track), 'Dangling track ref');
    if (confirmed) {
      check(b.work !== null && b.song !== null && b.audio_identity !== null && b.accepted_version_type !== null && b.release_track_refs.length > 0, 'Incomplete confirmed binding');
      check(nonempty(b.source_facts.title) && https(b.source_facts.source_url), 'Missing confirmed source facts');
    }
    if (b.song !== null) {
      const song = b.song.local_ref ? definitions.get(b.song.local_ref) : b.song.assertions;
      const work = b.song.local_ref ? refKey(song.work) : song.work_id;
      if (b.work !== null && work !== null) check(refKey(b.work) === work, 'Binding work mismatch');
      if (b.accepted_version_type !== null && song.version_type !== null) check(b.accepted_version_type === song.version_type, 'Binding version mismatch');
      for (const track of b.release_track_refs) {
        const t = definitions.get(track);
        if (t.song !== null) check(refKey(t.song) === refKey(b.song), 'Binding track song mismatch');
      }
      if (confirmed) {
        if (b.song.existing_id) check(b.audio_identity === 'same_audio', 'Existing song requires same audio');
        else check(r.candidate_bindings.some(other => refKey(other.song) === refKey(b.song) && other.audio_identity === 'distinct_recording'), 'Local song requires distinct recording evidence');
      }
    }
  }
  for (const [table, rows] of Object.entries(r.relations)) {
    const schema = CANONICAL_SCHEMA[table];
    const keys = new Set(), orders = new Set();
    const get = (row, name) => name.endsWith('_id') ? refKey(row[tableRefType[schema.columns.find(c => c.name === name).target]]) : row[name];
    for (const row of rows) {
      const pk = schema.primaryKey.map(k => get(row, k));
      if (pk.every(v => v !== null)) { const key = canonicalJson(pk); check(!keys.has(key), 'Duplicate relation PK'); keys.add(key); }
      for (const order of schema.orders ?? []) {
        const values = [...order.scope.map(k => get(row, k)), row[order.column]];
        if (values.every(v => v !== null)) { const key = canonicalJson([order.column, ...values]); check(!orders.has(key), 'Duplicate relation order'); orders.add(key); }
      }
      if (confirmed) {
        check(r.candidate_bindings.some(b => refKey(b.song) === refKey(row.song) && (table !== 'release_tracks' || b.release_track_refs.includes(row.local_ref))), 'Unmapped confirmed relation');
      }
    }
  }
  if (confirmed) {
    // Traverse only actual binding/relation edges (distinct_from is evidence,
    // not use of an otherwise orphan entity).
    const reachable = new Set();
    const reach = ref => {
      if (!ref?.local_ref || reachable.has(ref.local_ref)) return;
      reachable.add(ref.local_ref); const j = definitions.get(ref.local_ref);
      if (j?.work) reach(j.work);
    };
    r.candidate_bindings.forEach(b => { reach(b.work); reach(b.song); });
    Object.values(r.relations).flat().forEach(row => ['song', 'artist', 'creator', 'member', 'release'].forEach(k => reach(row[k])));
    for (const rows of Object.values(r.entities)) for (const row of rows) check(reachable.has(row.local_ref), 'Unreachable confirmed entity');
    for (const song of r.entities.songs) check(r.relations.song_artists.some(a => refKey(a.song) === song.local_ref && a.role === 'primary'), 'Missing primary artist');
    for (const rows of Object.values(r.entities)) for (const a of rows) for (const b of rows) {
      if (a === b || (a.title ?? a.name) !== (b.title ?? b.name) || (Object.hasOwn(a, 'work') && refKey(a.work) !== refKey(b.work))) continue;
      check(a.distinct_from.some(d => refKey(d.target) === b.local_ref && d.evidence_refs.length > 0), 'Missing same-name distinct declaration');
    }
  }
  return r;
}

export function validateDecisionStore(store) {
  canonicalJson(store);
  closed(store, ['schema_version', 'revisions']);
  check(store.schema_version === 1 && Array.isArray(store.revisions), 'Unsupported Decision store');
  const records = new Map(), heads = new Map(), mutationKeys = new Set(), localHistory = new Map();
  let previous = null;
  for (const r of store.revisions) {
    validateDecisionRevision(r);
    check(previous === null || previous.decision_id < r.decision_id || (previous.decision_id === r.decision_id && previous.revision < r.revision), 'Duplicate or unordered revision');
    const head = heads.get(r.decision_id);
    check(r.revision === (head?.revision ?? 0) + 1, 'Revision gap');
    if (head) {
      check(same(r.parent, { decision_id: head.decision_id, revision: head.revision, content_hash: head.content_hash }), 'Parent hash mismatch');
      check(r.metadata.created_at === head.metadata.created_at, 'Creation time changed');
      check(same(r.scope, head.scope) && same(r.replaces, head.replaces), 'Decision scope/replaces changed');
    }
    const locals = new Set([...Object.values(r.entities).flat(), ...Object.values(r.relations).flat()].map(j => j.local_ref));
    const history = localHistory.get(r.decision_id) ?? { current: new Set(), retired: new Set() };
    for (const ref of locals) check(!history.retired.has(ref), 'Retired local ref reused');
    for (const ref of history.current) if (!locals.has(ref)) history.retired.add(ref);
    history.current = locals; localHistory.set(r.decision_id, history);
    check(!mutationKeys.has(r.metadata.mutation.key), 'Duplicate mutation key'); mutationKeys.add(r.metadata.mutation.key);
    records.set(`${r.decision_id}/${r.revision}`, r); heads.set(r.decision_id, r); previous = r;
  }
  const edges = new Map();
  for (const r of store.revisions) {
    const identities = [r.parent, r.source_revision, r.derived_from_revision, r.cancellation?.target, ...r.replaces.map(v => v.target)].filter(Boolean);
    edges.set(r, identities.map(id => {
      const target = records.get(`${id.decision_id}/${id.revision}`);
      check(target && target.content_hash === id.content_hash, 'Dangling or mismatched Decision identity'); return target;
    }));
  }
  const active = new Set(), done = new Set();
  function visit(r) {
    check(!active.has(r), 'Cyclic Decision provenance');
    if (done.has(r)) return;
    active.add(r); edges.get(r).forEach(visit); active.delete(r); done.add(r);
  }
  store.revisions.forEach(visit);
  return store;
}

// Persistence guard, not an application append/OCC operation. Every old record
// including metadata must survive byte-equivalent under JCS in the next store.
export function assertImmutableDecisionStore(previous, next) {
  validateDecisionStore(previous); validateDecisionStore(next);
  const records = new Map(next.revisions.map(r => [`${r.decision_id}/${r.revision}`, r]));
  for (const r of previous.revisions) check(records.has(`${r.decision_id}/${r.revision}`) && same(r, records.get(`${r.decision_id}/${r.revision}`)), 'Saved revision is immutable');
  return next;
}
