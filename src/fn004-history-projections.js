import { canonicalJson, hashCanonicalJson } from './canonical-hash.js';
import { validateDecisionIdentity } from './fn004-decision-core.js';
import { APPLY_ID_PATTERN } from './fn004-history-directory.js';
import { RepositoryError } from './persistence.js';

// Narrow chain/set/index building blocks. These do NOT validate complete History
// records, embedded Plans, or state proof, and do not return a readiness result.
// The complete verifier must establish those checks before exposing lookups as
// authorization to generate a Plan. Runtime consumes these through the full
// verifier; these helpers alone never establish readiness.
const fail = (code, message) => { throw new RepositoryError(code, message); };
const check = (ok, code, message) => { if (!ok) fail(code,message); };
const hash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const repositoryPattern = new RegExp(`^repo_${uuid}$`), requestPattern = new RegExp(`^${uuid}$`);
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const historyRecordHash = payload => hashCanonicalJson(payload);

export function validateHistoryChain(records, { repository_instance_id, bootstrap_hash }) {
  check(typeof repository_instance_id === 'string' && repositoryPattern.test(repository_instance_id) && hash(bootstrap_hash), 'HISTORY_CORRUPT', 'Invalid chain identity');
  check(Array.isArray(records), 'HISTORY_CORRUPT', 'Expected History record array');
  canonicalJson(records);
  const ordered = [...records].sort((a,b) => a?.payload?.sequence - b?.payload?.sequence);
  let previous = bootstrap_hash;
  const applyIds = new Set(), transactions = new Set();
  for (let index=0;index<ordered.length;index++) {
    const record = ordered[index], p = record?.payload;
    check(p && Number.isSafeInteger(p.sequence) && p.sequence > 0 && typeof p.apply_id === 'string' && APPLY_ID_PATTERN.test(p.apply_id), 'HISTORY_CORRUPT', 'Invalid chain record identity');
    check(p.transaction_id === `tx_${p.apply_id.slice(6)}`, 'HISTORY_CORRUPT', 'Transaction and Apply identities differ');
    check(!applyIds.has(p.apply_id) && !transactions.has(p.transaction_id), 'HISTORY_CORRUPT', 'Duplicate Apply or transaction identity');
    check(p.sequence === index+1 && p.previous_history_hash === previous && p.repository_instance_id === repository_instance_id && p.bootstrap_hash === bootstrap_hash, 'HISTORY_CHAIN_MISMATCH', 'History chain does not match its bootstrap/prefix');
    check(hash(record.record_hash) && historyRecordHash(p) === record.record_hash, 'HISTORY_CORRUPT', 'History record hash mismatch');
    applyIds.add(p.apply_id); transactions.add(p.transaction_id); previous=record.record_hash;
  }
  return ordered;
}
export function historySetProjection(records, identity) {
  const ordered = validateHistoryChain(records,identity);
  return { schema_version:1, repository_instance_id:identity.repository_instance_id, bootstrap_hash:identity.bootstrap_hash,
    records:ordered.map(({payload,record_hash})=>({sequence:payload.sequence,apply_id:payload.apply_id,record_hash})) };
}
export const historySemanticHash = (records,identity) => hashCanonicalJson(historySetProjection(records,identity));

export function buildHistoryIndexes(records, identity) {
  const ordered=validateHistoryChain(records,identity);
  const indexes={by_decision_revision:[],by_candidate:[],by_request:[],by_plan:[]};
  const seen={decision:new Set(),candidate:new Set(),request:new Set(),plan:new Set()};
  function unique(type,value) { check(!seen[type].has(value),'HISTORY_IDENTITY_CONFLICT',`Duplicate History ${type} identity`);seen[type].add(value); }
  for(const {payload:p} of ordered) {
    validateDecisionIdentity(p.decision);
    check(p.plan && hash(p.plan.plan_hash) && p.plan.plan_id===`ap_${p.plan.plan_hash}` && p.request && typeof p.request.request_id==='string' && requestPattern.test(p.request.request_id) && hash(p.request.request_payload_hash),'HISTORY_CORRUPT','Invalid Plan/request index identity');
    unique('decision',p.decision.decision_id);unique('request',p.request.request_id);unique('plan',p.plan.plan_id);
    const result={apply_id:p.apply_id,sequence:p.sequence};
    indexes.by_decision_revision.push({...p.decision,plan_id:p.plan.plan_id,plan_hash:p.plan.plan_hash,...result});
    indexes.by_request.push({request_id:p.request.request_id,request_payload_hash:p.request.request_payload_hash,...result});
    indexes.by_plan.push({plan_id:p.plan.plan_id,plan_hash:p.plan.plan_hash,...result});
    check(Array.isArray(p.candidate_coverage),'HISTORY_CORRUPT','Invalid candidate coverage index');
    for(const coverage of p.candidate_coverage) {
      check(typeof coverage.candidate_id==='string' && coverage.candidate_id.trim().length>0 && /^[\x00-\x7f]+$/.test(coverage.candidate_id),'HISTORY_CORRUPT','Invalid candidate coverage ID');
      unique('candidate',coverage.candidate_id);
      indexes.by_candidate.push({candidate_id:coverage.candidate_id,...p.decision,...result});
    }
  }
  indexes.by_decision_revision.sort((a,b)=>compare(a.decision_id,b.decision_id)||a.revision-b.revision);
  indexes.by_candidate.sort((a,b)=>compare(a.candidate_id,b.candidate_id));
  indexes.by_request.sort((a,b)=>compare(a.request_id,b.request_id));
  indexes.by_plan.sort((a,b)=>compare(a.plan_id,b.plan_id));
  return indexes;
}
// Lookup only; no readiness certification or permission to apply. Call only
// after the complete History/runtime verifier has established ready input.
export function lookupAppliedDecision(indexes, decision, {candidate_ids=[],replaces=[]}={}) {
  validateDecisionIdentity(decision);
  const exact=indexes.by_decision_revision.find(r=>r.decision_id===decision.decision_id&&r.revision===decision.revision);
  if(exact) return {code:exact.content_hash===decision.content_hash?'ALREADY_APPLIED':'INTEGRITY_CONFLICT',apply_id:exact.apply_id};
  const other=indexes.by_decision_revision.find(r=>r.decision_id===decision.decision_id);
  if(other) return {code:'APPLIED_DECISION_REVISION_UNSUPPORTED',apply_id:other.apply_id};
  const replaced=indexes.by_decision_revision.find(r=>replaces.some(v=>v.target.decision_id===r.decision_id));
  const covered=indexes.by_candidate.find(r=>candidate_ids.includes(r.candidate_id));
  if(replaced||covered) return {code:'APPLIED_CANDIDATE_COVERAGE_UNSUPPORTED',apply_id:(replaced??covered).apply_id};
  return {code:null,apply_id:null};
}
