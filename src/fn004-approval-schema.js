import { randomUUID } from 'node:crypto';
import { canonicalJson, hashCanonicalJson } from './canonical-hash.js';
import { isFn004Timestamp } from './fn004-state.js';
import { RepositoryError } from './persistence.js';

export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const approvalId = v => typeof v === 'string' && v.length === 40 && new RegExp(`^apr_${UUID_PATTERN}$`).test(v);
export const requestId = v => typeof v === 'string' && v.length === 36 && new RegExp(`^${UUID_PATTERN}$`).test(v);
export const invalidationId = v => typeof v === 'string' && v.length === 41 && new RegExp(`^ainv_${UUID_PATTERN}$`).test(v);
export const newApprovalId = () => `apr_${randomUUID()}`;
export const newRequestId = () => randomUUID();
export const newInvalidationId = () => `ainv_${randomUUID()}`;
export const integrity = message => { throw new RepositoryError('INTEGRITY_CONFLICT', message); };
const require = (v, message) => { if (!v) integrity(message); };
export function closed(v, keys) {
  require(v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k)), 'Missing or unknown field');
}
const hash = v => typeof v === 'string' && v.length === 64 && /^[0-9a-f]{64}$/.test(v);
const timestamp = v => isFn004Timestamp(v) && !/[\r\n]/.test(v);
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
export function actor(v) {
  closed(v,['id','assurance']);
  require(nonempty(v.id) && ((v.assurance === 'local_process' && /^local:.+/u.test(v.id)) || (v.assurance === 'authenticated_admin' && /^admin:.+/u.test(v.id))), 'Invalid trusted Actor');
}
function json(v) { try { canonicalJson(v); } catch { integrity('Invalid JSON value'); } }
function version(v) { require(v.schema_version === 1,'Unknown schema version'); }
function decision(v) {
  closed(v,['decision_id','revision','content_hash']);
  require(typeof v.decision_id === 'string' && v.decision_id.length === 40 && new RegExp(`^dec_${UUID_PATTERN}$`).test(v.decision_id) && Number.isSafeInteger(v.revision) && v.revision > 0 && hash(v.content_hash),'Invalid Decision identity');
}
function bindings(v) {
  require(typeof v.repository_instance_id === 'string' && v.repository_instance_id.length === 41 && new RegExp(`^repo_${UUID_PATTERN}$`).test(v.repository_instance_id),'Invalid repository identity');
  require(hash(v.plan_hash) && v.plan_id === `ap_${v.plan_hash}`,'Invalid Plan identity');
}
export function validateApproval(v, id = v?.approval_id) {
  closed(v,['schema_version','approval_id','repository_instance_id','decision_id','revision','decision_content_hash','plan_id','plan_hash','approved_at','actor','purpose','intended_request_id']);
  version(v); json(v); bindings(v); actor(v.actor);
  decision({decision_id:v.decision_id,revision:v.revision,content_hash:v.decision_content_hash});
  require(approvalId(v.approval_id) && v.approval_id === id && requestId(v.intended_request_id) && timestamp(v.approved_at) && v.purpose === 'canonical_apply','Invalid Approval');
  return v;
}
export const approvalHashProjectionV1 = v => validateApproval(v);
export const approvalHash = v => hashCanonicalJson(approvalHashProjectionV1(v));
export const approvalDecision = v => ({decision_id:v.decision_id,revision:v.revision,content_hash:v.decision_content_hash});
export function validateRequestPayload(v) {
  closed(v,['schema_version','repository_instance_id','request_id','decision','plan_id','plan_hash','approval_id','approval_hash','actor','purpose']);
  version(v); json(v); bindings(v); decision(v.decision); actor(v.actor);
  require(requestId(v.request_id) && approvalId(v.approval_id) && hash(v.approval_hash) && v.purpose === 'canonical_apply','Invalid Request payload');
  return v;
}
export function requestPayloadProjectionV1(e) {
  const r = e.receipt;
  return validateRequestPayload({schema_version:e.schema_version,repository_instance_id:r.repository_instance_id,request_id:r.request_id,decision:r.decision,plan_id:r.plan_id,plan_hash:r.plan_hash,approval_id:r.approval_id,approval_hash:r.approval_hash,actor:r.actor,purpose:'canonical_apply'});
}
export const requestPayloadHash = v => hashCanonicalJson(validateRequestPayload(v));
export const receiptHashProjectionV1 = e => ({schema_version:e.schema_version,receipt:e.receipt});
export const receiptHash = e => hashCanonicalJson(receiptHashProjectionV1(e));
export const initialProcessing = () => ({state:'accepted',journal_ref:null,history_ref:null,diagnostic_code:null});
export function validateApplyRequest(e, id = e?.receipt?.request_id) {
  closed(e,['schema_version','receipt','receipt_hash','processing']); version(e); json(e);
  const r=e.receipt;
  closed(r,['repository_instance_id','request_id','request_payload_hash','decision','plan_id','plan_hash','approval_id','approval_hash','actor','requested_at','transaction_id','apply_id']);
  require(r.request_id === id && hash(r.request_payload_hash) && r.request_payload_hash === requestPayloadHash(requestPayloadProjectionV1(e)), 'Request identity/hash mismatch');
  require(typeof r.transaction_id === 'string' && r.transaction_id.length === 39 && new RegExp(`^tx_${UUID_PATTERN}$`).test(r.transaction_id) && r.apply_id === `apply_${r.transaction_id.slice(3)}` && timestamp(r.requested_at),'Invalid Receipt');
  require(hash(e.receipt_hash) && e.receipt_hash === receiptHash(e),'Receipt hash mismatch');
  const p=e.processing; closed(p,['state','journal_ref','history_ref','diagnostic_code']);
  require(nonempty(p.state) && (p.journal_ref === null || p.journal_ref === `staging/transactions/${r.transaction_id}/transaction.json`) && (p.history_ref === null || p.history_ref === `staging/apply-history/${r.apply_id}.json`) && (p.diagnostic_code === null || nonempty(p.diagnostic_code)),'Invalid ProcessingCache');
  return e;
}
export function validateInvalidation(v, id = v?.event_id) {
  closed(v,['schema_version','event_id','repository_instance_id','approval_id','approval_hash','reason','actor','invalidated_at','accepted_request']);
  version(v); json(v); actor(v.actor);
  require(invalidationId(v.event_id) && v.event_id === id && approvalId(v.approval_id) && hash(v.approval_hash) && typeof v.repository_instance_id === 'string' && v.repository_instance_id.length === 41 && new RegExp(`^repo_${UUID_PATTERN}$`).test(v.repository_instance_id) && nonempty(v.reason) && timestamp(v.invalidated_at),'Invalid Invalidation');
  if(v.accepted_request !== null) { closed(v.accepted_request,['request_id','receipt_hash']); require(requestId(v.accepted_request.request_id) && hash(v.accepted_request.receipt_hash),'Invalid accepted_request'); }
  return v;
}
