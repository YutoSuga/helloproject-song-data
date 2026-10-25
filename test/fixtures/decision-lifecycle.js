import { randomUUID } from 'node:crypto';
import { candidateSourceProjection, candidateFingerprint, createDecisionScope, decisionContentHash, decisionMutationHash } from '../../src/fn004-decision-core.js';
const copy = v => structuredClone(v);
const source = { title: '曲', source_url: 'https://example.org/song', credits: { lyrics: { raw: 'A/B', names: ['A', 'B', 'A'] } } };
const binding = () => {
  const facts = candidateSourceProjection(source).facts;
  return { candidate_id: 'candidate-1', source_schema_version: 1, projection_version: 1,
    source_identity: Object.fromEntries(['source_artist_slug', 'source_release_url', 'media_type', 'edition', 'product_number', 'disc_index', 'track_number'].map(k => [k, facts[k]])),
    source_facts: facts, fingerprint: candidateFingerprint(source), work: null, song: null, audio_identity: null, accepted_version_type: null,
    release_track_refs: [], performer_review: 'unreviewed', evidence_refs: [], human_note: '' };
};
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

export { source, binding, revision, completeDraft, next, seal, storeOf, identity };
