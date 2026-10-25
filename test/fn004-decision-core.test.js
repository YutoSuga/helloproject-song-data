import test from 'node:test';
import assert from 'node:assert/strict';
import { hashCanonicalJson } from '../src/canonical-hash.js';
import { candidateSourceProjection, candidateFingerprint, createDecisionScope, validateDecisionScope, validateTypedRef, decisionContentHash, decisionContentProjection, validateCandidateBinding, validateCandidateSource } from '../src/fn004-decision-core.js';
const copy = v => structuredClone(v);
const source = { title: '曲', source_url: 'https://example.org/song', credits: { lyrics: { raw: 'A/B', names: ['A', 'B', 'A'] } } };
const binding = () => {
  const facts = candidateSourceProjection(source).facts;
  return { candidate_id: 'candidate-1', source_schema_version: 1, projection_version: 1,
    source_identity: Object.fromEntries(['source_artist_slug', 'source_release_url', 'media_type', 'edition', 'product_number', 'disc_index', 'track_number'].map(k => [k, facts[k]])),
    source_facts: facts, fingerprint: candidateFingerprint(source), work: null, song: null, audio_identity: null, accepted_version_type: null,
    release_track_refs: [], performer_review: 'unreviewed', evidence_refs: [], human_note: '' };
};
test('scope uses a sorted nonempty ASCII set and exact JCS projection', () => {
  const scope = createDecisionScope(['b', 'a']);
  assert.deepEqual(scope, createDecisionScope(['a', 'b']));
  assert.equal(scope.scope_hash, hashCanonicalJson({ schema_version: 1, candidate_ids: ['a', 'b'] }));
  assert.notEqual(scope.scope_hash, createDecisionScope(['a']).scope_hash);
  assert.deepEqual(validateDecisionScope(scope), scope);
  for (const ids of [[], ['a', 'a'], ['日本語'], [' '], [1]]) assert.throws(() => createDecisionScope(ids));
  for (const change of [{ extra: true }, { schema_version: 2 }, { scope_hash: '0'.repeat(64) }, { candidate_ids: ['b', 'a'] }]) assert.throws(() => validateDecisionScope({ ...scope, ...change }));
});
test('candidate profile has fourteen facts, exact missing defaults and ordered credits', () => {
  const p = candidateSourceProjection(source);
  assert.equal(Object.keys(p.facts).length, 14);
  assert.equal(p.facts.edition, null);
  assert.deepEqual(p.facts.credits.lyrics.names, ['A', 'B', 'A']);
  assert.deepEqual(candidateSourceProjection({ credits: { lyrics: {} } }).facts.credits, { lyrics: { raw: null, names: [] } });
  assert.notEqual(candidateFingerprint({}).value, candidateFingerprint({ credits: { lyrics: {} } }).value);
  assert.equal(candidateFingerprint(source).value, hashCanonicalJson(p));
  assert.deepEqual(candidateFingerprint(source), candidateFingerprint(copy(source)));
  assert.deepEqual(candidateFingerprint(source), candidateFingerprint({ ...source, detected_at: 'later', status: 'ignored', match: { id: 'W00001' }, artist_id: 'G00001', admin_note: 'note' }));
  for (const changed of [{ ...source, title: '別' }, { ...source, credits: { lyrics: { raw: 'A/B', names: ['B', 'A', 'A'] } } }, { ...source, edition: 'limited' }]) assert.notEqual(candidateFingerprint(source).value, candidateFingerprint(changed).value);
});
test('profile rejects malformed present facts and unknown credit fields', () => {
  for (const value of [{ title: undefined }, { disc_index: 0 }, { track_number: Number.MAX_SAFE_INTEGER + 1 }, { credits: [] }, { credits: { unknown: {} } }, { credits: { lyrics: { extra: true } } }, { credits: { lyrics: { names: null } } }, { source_url: 'http://example.org' }, { title: '\ud800' }]) assert.throws(() => candidateFingerprint(value));
  assert.throws(() => candidateFingerprint(source, 2));
});
test('typed refs enforce exact union, ID namespace, local grammar and assertions', () => {
  for (const [type, ref] of Object.entries({ work: 'work:w1', song: 'song:s1', creator: 'creator:c1', artist: 'artist:a1', release: 'release:r1' })) assert.deepEqual(validateTypedRef(type, { local_ref: ref }), { local_ref: ref });
  const existing = { existing_id: 'W00001', assertions: { title: '曲' }, evidence_refs: [] };
  assert.deepEqual(validateTypedRef('work', existing), existing);
  for (const ref of [{ ...existing, local_ref: 'work:w1' }, { local_ref: 'pw_123' }, { local_ref: 'work:w01' }, { local_ref: 'song:s1' }, { ...existing, existing_id: 'pw_123' }, { ...existing, assertions: {} }, { ...existing, assertions: { title: '曲', patch: 'bad' } }, { ...existing, evidence_refs: ['ev_z', 'ev_a'] }]) assert.throws(() => validateTypedRef('work', ref));
  assert.throws(() => validateTypedRef('member', { local_ref: 'member:m1' }));
  assert.throws(() => validateTypedRef('release', { existing_id: 'L00001', assertions: { title: '曲', release_type: 'single', release_date: '2025-02-29', catalog_number: null }, evidence_refs: [] }));
});
test('content projection excludes only the two contracted root fields', () => {
  const r = { schema_version: 1, actor: { id: 'local:test' }, human_note: 'a', content_hash: 'old', metadata: { saved_at: 'time' } };
  assert.deepEqual(decisionContentProjection(r), { schema_version: 1, actor: { id: 'local:test' }, human_note: 'a' });
  assert.equal(decisionContentHash(r), decisionContentHash({ ...r, content_hash: 'new', metadata: { saved_at: 'later', mutation: { key: 'different' } } }));
  assert.notEqual(decisionContentHash(r), decisionContentHash({ ...r, human_note: 'b' }));
});
test('binding validates snapshot, identity, hash and explicit current-source token', () => {
  const b = binding(), scope = createDecisionScope(['candidate-1']);
  assert.deepEqual(validateCandidateBinding(b, scope), b);
  assert.deepEqual(validateCandidateSource(b, source, 1), b);
  assert.throws(() => validateCandidateSource(b, { ...source, title: 'changed' }, 1));
  for (const change of [{ candidate_id: 'other' }, { projection_version: 2 }, { extra: true }, { work: {} }, { performer_review: 'unknown' }, { release_track_refs: ['track:t01'] }, { source_identity: { ...b.source_identity, edition: 'other' } }, { fingerprint: { ...b.fingerprint, value: '0'.repeat(64) } }, { source_facts: { ...b.source_facts, extra: true } }]) assert.throws(() => validateCandidateBinding({ ...b, ...change }, scope));
});

test('new entity and relation formal shapes derive canonical types without assigning IDs', async () => {
  const { validateDecisionJudgment } = await import('../src/fn004-decision-core.js');
  const work = { local_ref: 'work:w1', evidence_refs: [], title: null, title_kana: null, notes: null, source_url: null, distinct_from: [] };
  assert.deepEqual(validateDecisionJudgment('work', work), work);
  assert.throws(() => validateDecisionJudgment('work', work, { confirmed: true }));
  const complete = { ...work, title: '曲', source_url: 'https://example.org', evidence_refs: ['ev_source'] };
  assert.deepEqual(validateDecisionJudgment('work', complete, { confirmed: true }), complete);
  const relation = { local_ref: 'song_artist:sa1', evidence_refs: ['ev_source'], song: { local_ref: 'song:s1' }, artist: { local_ref: 'artist:a1' }, role: 'primary', credit_order: null, source_url: 'https://example.org' };
  assert.deepEqual(validateDecisionJudgment('song_artist', relation, { confirmed: true }), relation);
  for (const value of [{ ...work, title: '' }, { ...work, extra: true }, { ...work, local_ref: 'work:w0' }, { ...work, distinct_from: [{ target: { local_ref: 'work:w1' }, reason: 'same', evidence_refs: [] }] }]) assert.throws(() => validateDecisionJudgment('work', value));
  for (const change of [{ role: 'unknown' }, { credit_order: 0 }, { song: { local_ref: 'work:w1' } }, { source_url: 'http://example.org' }, { extra: true }]) assert.throws(() => validateDecisionJudgment('song_artist', { ...relation, ...change }));
});

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDecisionRevision, validateDecisionStore, decisionMutationHash, assertImmutableDecisionStore } from '../src/fn004-decision-core.js';
import { createFn004Repository } from '../src/fn004-repository.js';
import { withCanonicalGate } from '../src/fn004-gate.js';
const time = '2026-10-25T01:02:03Z';
const identity = r => ({ decision_id: r.decision_id, revision: r.revision, content_hash: r.content_hash });
const storeOf = (...revisions) => ({ schema_version: 1, revisions });
function seal(r) {
  r.metadata.mutation.request_hash = decisionMutationHash(r);
  r.content_hash = decisionContentHash(r);
  return r;
}
function revision() {
  return seal({ schema_version: 1, decision_id: `dec_${randomUUID()}`, revision: 1, status: 'draft', parent: null,
    scope: createDecisionScope(['candidate-1']), replaces: [], derived_from_revision: null, source_revision: null, cancellation: null,
    candidate_bindings: [binding()], entities: { works: [], creators: [], artists: [], releases: [], songs: [] },
    relations: { song_artists: [], song_creators: [], song_performers: [], release_tracks: [] }, unsupported_requests: [], evidence: [], human_note: '',
    actor: { id: 'local:test', assurance: 'local_process' }, content_hash: '',
    metadata: { created_at: time, saved_at: time, confirmed_at: null, cancelled_at: null, mutation: { key: randomUUID(), request_hash: '' } } });
}
function next(r, status = 'draft') {
  const n = copy(r); n.revision++; n.parent = identity(r); n.status = status;
  n.source_revision = status === 'draft' ? null : identity(r);
  n.cancellation = status === 'cancelled' ? { target: identity(r), reason: 'withdrawn' } : null;
  n.metadata.mutation.key = randomUUID(); n.metadata.confirmed_at = status === 'confirmed' ? time : null; n.metadata.cancelled_at = status === 'cancelled' ? time : null;
  return seal(n);
}
function completeDraft() {
  const r = revision();
  const ref = (existing_id, assertions) => ({ existing_id, assertions, evidence_refs: ['ev_source'] });
  const b = r.candidate_bindings[0];
  b.work = ref('W00001', { title: '曲' });
  b.song = ref('J00001', { work_id: 'W00001', title: '曲', version_name: null, version_type: 'original', primary_artist_ids: ['G00001'] });
  b.audio_identity = 'same_audio'; b.accepted_version_type = 'original'; b.release_track_refs = ['track:t1']; b.evidence_refs = ['ev_source'];
  r.relations.release_tracks.push({ local_ref: 'track:t1', evidence_refs: ['ev_source'], release: ref('L00001', { title: '盤', release_type: 'single', release_date: null, catalog_number: null }), disc_number: 1, track_number: 1, song: copy(b.song), track_title: '曲', notes: null, source_url: source.source_url });
  r.evidence.push({ evidence_id: 'ev_source', kind: 'official_source', url: source.source_url, publisher: 'Official', official_basis: 'Publisher site', checked_at: time, facts: 'Track identity', candidate_ids: ['candidate-1'], source_fingerprints: [{ candidate_id: 'candidate-1', fingerprint: b.fingerprint }], human_note: '' });
  return seal(r);
}
test('store accepts empty, draft, confirmed and draft-only cancelled snapshots', () => {
  assert.deepEqual(validateDecisionStore(storeOf()), storeOf());
  const draft = revision(); assert.equal(validateDecisionRevision(draft), draft);
  validateDecisionStore(storeOf(draft, next(draft, 'cancelled')));
  const complete = completeDraft(), confirmed = next(complete, 'confirmed');
  validateDecisionRevision(confirmed); validateDecisionStore(storeOf(complete, confirmed, next(confirmed, 'cancelled')));
});
test('revision rejects required/unknown fields, malformed identity/hash and status metadata', () => {
  for (const mutate of [r => delete r.actor, r => r.extra = true, r => r.schema_version = 2, r => r.decision_id = 'dec_bad', r => r.revision = 0, r => r.revision = Number.MAX_SAFE_INTEGER + 1, r => r.content_hash = 'a'.repeat(63), r => r.parent = identity(r), r => r.source_revision = identity(r), r => r.cancellation = {}, r => r.metadata.saved_at = '2026-02-30T00:00:00Z', r => r.actor.id = 'admin:test', r => r.metadata.confirmed_at = time, r => r.metadata.mutation.request_hash = '0'.repeat(64)]) {
    const r = revision(); mutate(r); assert.throws(() => validateDecisionRevision(r));
  }
  assert.throws(() => validateDecisionRevision(next(revision(), 'confirmed')));
});
test('store checks every revision, order, gaps, hashes, mutation keys and identity DAG', () => {
  const a = revision(), b = next(a);
  for (const s of [storeOf(a, a), storeOf(b, a), storeOf(b), { ...storeOf(), extra: true }, { schema_version: 2, revisions: [] }]) assert.throws(() => validateDecisionStore(s));
  const other = revision(); other.decision_id = a.decision_id < other.decision_id ? other.decision_id : `dec_ffffffff-ffff-4fff-bfff-ffffffffffff`; seal(other);
  assert.throws(() => validateDecisionStore(storeOf(other, a)));
  const badParent = copy(b); badParent.parent.content_hash = '0'.repeat(64); seal(badParent); assert.throws(() => validateDecisionStore(storeOf(a, badParent)));
  const reused = copy(b); reused.metadata.mutation.key = a.metadata.mutation.key; seal(reused); assert.throws(() => validateDecisionStore(storeOf(a, reused)));
  const dangling = copy(a); dangling.derived_from_revision = identity(other); seal(dangling); assert.throws(() => validateDecisionStore(storeOf(dangling)));
  const self = copy(a); self.derived_from_revision = identity(a); seal(self); assert.throws(() => validateDecisionStore(storeOf(self)));
  const changed = copy(b); changed.metadata.created_at = '2026-10-24T00:00:00Z'; seal(changed); assert.throws(() => validateDecisionStore(storeOf(a, changed)));
});
test('evidence enforces closed schema, attribution, dates, scope and fingerprint agreement', () => {
  for (const mutate of [e => e.extra = true, e => e.url = null, e => e.publisher = ' ', e => e.official_basis = null, e => e.checked_at = '2026-02-29T00:00:00Z', e => e.kind = 'other', e => e.facts = '', e => e.candidate_ids = ['missing'], e => e.source_fingerprints = [], e => e.source_fingerprints[0].fingerprint.value = '0'.repeat(64)]) {
    const r = completeDraft(); mutate(r.evidence[0]); seal(r); assert.throws(() => validateDecisionRevision(r));
  }
  const r = completeDraft(); Object.assign(r.evidence[0], { kind: 'human_observation', url: null, publisher: null, official_basis: null }); seal(r); validateDecisionRevision(r);
  assert.throws(() => validateDecisionRevision(next(r, 'confirmed')));
});
test('reference integrity rejects dangling refs, inconsistent assertions and duplicate relation PK/order', () => {
  for (const mutate of [r => r.candidate_bindings[0].work = { local_ref: 'work:w1' }, r => r.candidate_bindings[0].evidence_refs = ['ev_missing'], r => r.candidate_bindings[0].release_track_refs = ['track:t2'], r => r.relations.release_tracks[0].song.assertions.title = 'contradiction', r => r.relations.release_tracks[0].song = { local_ref: 'song:s99' }, r => r.relations.release_tracks.push({ ...copy(r.relations.release_tracks[0]), local_ref: 'track:t2' })]) {
    const r = completeDraft(); mutate(r); seal(r); assert.throws(() => validateDecisionRevision(r));
  }
  const r = completeDraft(); r.candidate_bindings[0].work.existing_id = 'W00002'; seal(r); assert.throws(() => validateDecisionRevision(r));
});
test('immutable guard rejects deletion and changes to saved metadata as well as content', () => {
  const a = revision(), b = next(a); assertImmutableDecisionStore(storeOf(a), storeOf(a, b));
  assert.throws(() => assertImmutableDecisionStore(storeOf(a), storeOf()));
  const modified = copy(a); modified.metadata.mutation.key = randomUUID();
  assert.equal(decisionContentHash(a), decisionContentHash(modified));
  assert.throws(() => assertImmutableDecisionStore(storeOf(a), storeOf(modified)));
});
async function tempRepo(t, options) {
  const root = await fs.mkdtemp(join(tmpdir(), 'fn004-decision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, repo: await createFn004Repository(root, options) };
}
test('repository validates reads, creates without clobber, replaces atomically and preserves immutable snapshots', async t => {
  const { root, repo } = await tempRepo(t); const a = revision(), b = next(a);
  assert.deepEqual(await repo.readDecisionStore(), storeOf());
  await assert.rejects(repo.writeDecisionStore(storeOf(a)), { code: 'GATE_OWNERSHIP_MISMATCH' });
  await withCanonicalGate({ root, fn: async gate => {
    await repo.writeDecisionStore(storeOf(a), { gate });
    assert.deepEqual(await repo.readDecisionStore({ gate }), storeOf(a));
    await repo.writeDecisionStore(storeOf(a, b), { gate });
    await assert.rejects(repo.writeDecisionStore(storeOf(b), { gate }));
    await assert.rejects(repo.writeJsonAtomic('staging/decisions.json', {}, { gate }));
    await assert.rejects(repo.createJsonExclusive('staging/decisions.json', storeOf(a, b), { gate }), { code: 'PERSISTENCE_ALREADY_EXISTS' });
    await assert.rejects(repo.writeJsonAtomic('staging/../decisions.json', {}, { gate }), { code: 'PATH_UNSAFE' });
  } });
  assert.deepEqual(await repo.readDecisionStore(), storeOf(a, b));
  assert.deepEqual((await fs.readdir(join(root, 'staging'))).filter(n => !n.startsWith('.fn004-')), ['decisions.json']);
});
test('repository rejects duplicate JSON members, BOM, invalid UTF8 and broken stores without replacing them', async t => {
  const { root, repo } = await tempRepo(t); await fs.mkdir(join(root, 'staging'), { recursive: true });
  for (const bytes of [Buffer.from('{"schema_version":1,"schema_version":1,"revisions":[]}'), Buffer.from('{"schema_version":1,"schema_versi\\u006fn":1,"revisions":[]}'), Buffer.from('\ufeff{"schema_version":1,"revisions":[]}'), Buffer.from([0xff]), Buffer.from('{'), Buffer.from('{"schema_version":2,"revisions":[]}')]) {
    await fs.writeFile(join(root, 'staging/decisions.json'), bytes);
    await assert.rejects(repo.readDecisionStore());
    await withCanonicalGate({ root, fn: gate => assert.rejects(repo.writeDecisionStore(storeOf(), { gate })) });
    assert.deepEqual(await fs.readFile(join(root, 'staging/decisions.json')), bytes);
  }
});
test('Decision persistence propagates failed rename and failed directory sync with publication state', async t => {
  const { root } = await tempRepo(t); const a = revision(), b = next(a);
  const repo = await createFn004Repository(root);
  await withCanonicalGate({ root, fn: gate => repo.writeDecisionStore(storeOf(a), { gate }) });
  const fault = () => { throw Object.assign(new Error('injected'), { code: 'EIO' }); };
  const badRename = await createFn004Repository(root, { io: { ...fs, rename: fault } });
  await withCanonicalGate({ root, fn: gate => assert.rejects(badRename.writeDecisionStore(storeOf(a, b), { gate }), e => e.code === 'PERSISTENCE_WRITE_FAILED' && !e.published && e.phase === 'publish') });
  assert.deepEqual(await repo.readDecisionStore(), storeOf(a));
  const badSync = await createFn004Repository(root, { io: { ...fs, open: async (path, ...args) => {
    const h = await fs.open(path, ...args);
    return new Proxy(h, { get(target, key) { if (key === 'sync' && path === join(root, 'staging')) return fault; const v = target[key]; return typeof v === 'function' ? v.bind(target) : v; } });
  } } });
  await withCanonicalGate({ root, fn: gate => assert.rejects(badSync.writeDecisionStore(storeOf(a, b), { gate }), e => e.code === 'PERSISTENCE_WRITE_FAILED' && e.published && e.phase === 'directory_sync') });
  assert.deepEqual(await repo.readDecisionStore(), storeOf(a, b));
});
test('Decision path rejects symlinks before reading or publishing', async t => {
  const { root, repo } = await tempRepo(t); await fs.mkdir(join(root, 'staging'), { recursive: true });
  await fs.writeFile(join(root, 'other.json'), JSON.stringify(storeOf()));
  await fs.symlink(join(root, 'other.json'), join(root, 'staging/decisions.json'));
  await assert.rejects(repo.readDecisionStore(), { code: 'PATH_UNSAFE' });
  await withCanonicalGate({ root, fn: gate => assert.rejects(repo.writeDecisionStore(storeOf(), { gate }), { code: 'PATH_UNSAFE' }) });
});

test('all entity and relation kinds retain closed draft schemas and typed foreign refs', async () => {
  const { validateDecisionJudgment } = await import('../src/fn004-decision-core.js');
  const samples = {
    creator: { local_ref: 'creator:c1', name: null, name_kana: null, notes: null, source_url: null, distinct_from: [] },
    artist: { local_ref: 'artist:a1', name: null, type: null, start_date: null, end_date: null, notes: null, source_url: null, distinct_from: [] },
    release: { local_ref: 'release:r1', title: null, release_type: null, release_date: null, catalog_number: null, notes: null, source_url: null, distinct_from: [] },
    song: { local_ref: 'song:s1', work: null, title: null, version_name: null, version_type: null, release_date: null, notes: null, source_url: null, song_id_prefix: null, distinct_from: [] },
    song_creator: { local_ref: 'song_creator:sc1', song: null, creator: null, role: null, credit_name: null, credit_order: null, source_url: null },
    song_performer: { local_ref: 'song_performer:sp1', song: null, member: null, performer_order: null, notes: null, source_url: null }
  };
  for (const [type, v] of Object.entries(samples)) {
    const j = { ...v, evidence_refs: [] }; validateDecisionJudgment(type, j);
    assert.throws(() => validateDecisionJudgment(type, { ...j, extra: true }));
    assert.throws(() => validateDecisionJudgment(type, j, { confirmed: true }));
  }
  assert.throws(() => validateDecisionJudgment('song_performer', { ...samples.song_performer, evidence_refs: [], member: { local_ref: 'member:m1' } }));
  validateTypedRef('member', { existing_id: 'P00001', assertions: { name: 'Member' }, evidence_refs: [] });
});
test('confirmed local song requires primary, reachability, mapped relations and distinct audio judgment', () => {
  const draft = completeDraft();
  const evidence_refs = ['ev_source'];
  draft.entities.songs.push({ local_ref: 'song:s1', evidence_refs, work: copy(draft.candidate_bindings[0].work), title: '新音源', version_name: null, version_type: 'cover', release_date: null, notes: null, source_url: source.source_url, song_id_prefix: 'J', distinct_from: [] });
  const b = draft.candidate_bindings[0]; b.song = { local_ref: 'song:s1' }; b.audio_identity = 'distinct_recording'; b.accepted_version_type = 'cover';
  draft.relations.release_tracks[0].song = { local_ref: 'song:s1' };
  draft.relations.song_artists.push({ local_ref: 'song_artist:sa1', evidence_refs, song: { local_ref: 'song:s1' }, artist: { existing_id: 'G00001', assertions: { name: 'Artist', type: 'group' }, evidence_refs }, role: 'primary', credit_order: 1, source_url: source.source_url });
  seal(draft); const confirmed = next(draft, 'confirmed'); validateDecisionStore(storeOf(draft, confirmed));
  for (const mutate of [r => r.relations.song_artists = [], r => r.candidate_bindings[0].audio_identity = 'same_audio', r => r.entities.songs[0].song_id_prefix = null, r => r.relations.song_artists[0].evidence_refs = [], r => r.relations.song_artists.push({ ...copy(r.relations.song_artists[0]), local_ref: 'song_artist:sa2', artist: { ...copy(r.relations.song_artists[0].artist), existing_id: 'G00002' } }), r => r.entities.creators.push({ local_ref: 'creator:c1', evidence_refs, name: 'unused', name_kana: null, notes: null, source_url: null, distinct_from: [] })]) {
    const r = copy(confirmed); mutate(r); seal(r); assert.throws(() => validateDecisionRevision(r));
  }
});
test('publication verifies temp bytes and file sync before rename and uses no-clobber for genesis', async t => {
  const { root } = await tempRepo(t); const path = join(root, 'staging/decisions.json');
  const empty = storeOf(); const repo = await createFn004Repository(root);
  await withCanonicalGate({ root, fn: gate => repo.writeDecisionStore(empty, { gate }) });
  let renames = 0;
  const badVerify = await createFn004Repository(root, { io: { ...fs, readFile: async (p, ...args) => p.includes('.tmp-') ? Buffer.from('corrupt') : fs.readFile(p, ...args), rename: async (...args) => { renames++; return fs.rename(...args); } } });
  await withCanonicalGate({ root, fn: gate => assert.rejects(badVerify.writeDecisionStore(empty, { gate }), e => e.phase === 'temp_verify' && !e.published) });
  assert.equal(renames, 0); assert.deepEqual(await repo.readDecisionStore(), empty);
  const original = await fs.readFile(path);
  const badFileSync = await createFn004Repository(root, { io: { ...fs, open: async (p, ...args) => {
    const h = await fs.open(p, ...args); return new Proxy(h, { get(target, key) { if (key === 'sync' && p.includes('.tmp-')) return async () => { throw new Error('file sync failure'); }; const v = target[key]; return typeof v === 'function' ? v.bind(target) : v; } });
  } } });
  await withCanonicalGate({ root, fn: gate => assert.rejects(badFileSync.writeDecisionStore(empty, { gate }), e => e.phase === 'file_sync' && !e.published) });
  assert.deepEqual(await fs.readFile(path), original);
  await fs.unlink(path);
  const race = await createFn004Repository(root, { io: { ...fs, link: async (from, to) => { await fs.writeFile(to, original); return fs.link(from, to); } } });
  await withCanonicalGate({ root, fn: gate => assert.rejects(race.writeDecisionStore(empty, { gate }), { code: 'PERSISTENCE_ALREADY_EXISTS' }) });
  assert.deepEqual(await fs.readFile(path), original);
});

test('store rejects retired local ref reintroduction and actor assurance prototype keys', () => {
  const a = revision(); a.entities.creators.push({ local_ref: 'creator:c1', evidence_refs: [], name: null, name_kana: null, notes: null, source_url: null, distinct_from: [] }); seal(a);
  const b = next(a); b.entities.creators = []; seal(b);
  const c = next(b); c.entities.creators = copy(a.entities.creators); seal(c);
  validateDecisionStore(storeOf(a, b)); assert.throws(() => validateDecisionStore(storeOf(a, b, c)));
  const r = revision(); r.actor = { assurance: '__proto__', id: '[object Object]' }; seal(r); assert.throws(() => validateDecisionRevision(r));
});
