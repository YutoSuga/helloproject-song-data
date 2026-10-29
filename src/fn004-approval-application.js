import { randomUUID } from 'node:crypto';
import { canonicalJson } from './canonical-hash.js';
import { createPersistence, RepositoryError } from './persistence.js';
import { createFn004Repository } from './fn004-repository.js';
import { withCanonicalGate, assertGateOwnership } from './fn004-gate.js';
import { createApplyPlanService } from './fn004-plan-application.js';
import { validateApplyPlan } from './fn004-plan-validator.js';
import { validateBootstrapRecord, validateFn004State } from './fn004-state.js';
import { inspectRuntimeState, directoryEntries, validatedSnapshot } from './fn004-runtime-state.js';
import { auditGitIds } from './fn004-git-audit.js';
import { verifySuccessfulHistory, lookupVerifiedHistory } from './fn004-history-verify.js';
import { buildDecisionRegistry } from './fn004-decision-lifecycle.js';
import { approvalPath, requestPath, invalidationPath } from './fn004-approval-repository.js';
import { actor as validateActor, closed, integrity, validateApproval, validateInvalidation, validateRequestPayload, validateApplyRequest, approvalHash, approvalDecision, requestPayloadProjectionV1, requestPayloadHash, receiptHash, initialProcessing, newApprovalId, newInvalidationId } from './fn004-approval-schema.js';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const fail=(code,message)=>{throw new RepositoryError(code,message);};
const freeze=v=>{try{return JSON.parse(canonicalJson(v));}catch{integrity('Input is outside the strict JSON domain');}};

// Trusted in-process application boundary, not an HTTP/input authentication
// adapter. context.actor must be supplied by the trusted operator/backend.
// No dispatcher, canonical writer, completion writer or recovery executor.
export function createApprovalRequestService({root=process.cwd(),io,clock=()=>new Date().toISOString()}={}) {
  const options=io?{io}:{};
  const knownEvents=new Set();
  async function run(operation,command,context,fn) {
    const input=freeze(command), trusted=freeze(context.actor);
    validateActor(trusted);
    return withCanonicalGate({root,gate:context.gate,operation,fn:async gate=>{
      const store=await createPersistence(root,options),repository=await createFn004Repository(root,options);
      const c={store,repository,gate,actor:trusted};
      for(const directory of ['staging/apply-approvals','staging/apply-requests']) {
        if((await directoryEntries(store,directory)).some(name=>name.startsWith('.fn004-')&&name.includes('.tmp-'))) fail('RECOVERY_REQUIRED','Unresolved artifact publication evidence');
      }
      return fn(input,c);
    }});
  }
  async function lineage(c) {
    const b=validateBootstrapRecord(await c.store.readJson('staging/fn004-bootstrap.json',{strict:true}));
    const s=validateFn004State(await c.store.readJson('staging/fn004-state.json',{strict:true}));
    if(s.repository_instance_id!==b.payload.repository_instance_id || s.bootstrap_hash!==b.bootstrap_hash || s.initialized_at!==b.metadata.initialized_at || s.baseline_manifest_hash!==b.canonical_manifest.manifest_hash) fail('STATE_BOOTSTRAP_MISMATCH','Invalid repository lineage');
    return s;
  }
  async function staticApproval(id,c) {
    let a;
    try { a=await c.repository.getApproval(id,{gate:c.gate}); }
    catch(e) { if(e.code==='PERSISTENCE_NOT_FOUND') integrity('Missing Approval original'); throw e; }
    const state=await lineage(c),p=await c.repository.getApplyPlan(a.plan_id,{gate:c.gate});
    const store=await c.repository.readDecisionStore({gate:c.gate});
    buildDecisionRegistry(store); // Validate all historical transitions, not only the selected revision.
    const revision=store.revisions.find(r=>r.decision_id===a.decision_id && r.revision===a.revision);
    if(!revision || revision.status!=='confirmed' || revision.content_hash!==a.decision_content_hash) integrity('Approval Decision original mismatch');
    validateApplyPlan(p,{decision:revision});
    if(a.repository_instance_id!==state.repository_instance_id || p.payload.repository_instance_id!==a.repository_instance_id || p.payload.bootstrap_hash!==state.bootstrap_hash || !same(approvalDecision(a),p.payload.decision.identity) || p.plan_hash!==a.plan_hash || p.payload.decision.scope_hash!==revision.scope.scope_hash) integrity('Approval static Plan/Decision/repository mismatch');
    return a;
  }
  async function staticRequest(e,c,expectedApproval) {
    validateApplyRequest(e);
    // Invalidation callers supply the validated target original; request-ID
    // lookup alone cannot establish which Approval authorized the Receipt.
    const a=expectedApproval ?? await staticApproval(e.receipt.approval_id,c),r=e.receipt;
    if(r.approval_id!==a.approval_id || r.repository_instance_id!==a.repository_instance_id || !same(r.decision,approvalDecision(a)) || r.plan_id!==a.plan_id || r.plan_hash!==a.plan_hash || r.approval_hash!==approvalHash(a) || r.request_id!==a.intended_request_id || !same(r.actor,a.actor)) integrity('Receipt exact Approval binding mismatch');
    return e;
  }
  async function optionalRequest(id,c,expectedApproval) {
    return await c.store.exists(requestPath(id)) ? staticRequest(await c.repository.getApplyRequest(id,{gate:c.gate}),c,expectedApproval) : null;
  }
  async function noUnknownWork(c) {
    // Slice 5 cannot prove terminal journals/completions. Preserve conservative
    // recovery blocking until those versioned validators exist.
    if((await directoryEntries(c.store,'staging/transactions')).length || (await directoryEntries(c.store,'staging/apply-requests/completions')).length) fail('RECOVERY_REQUIRED','Execution evidence requires recovery inspection');
    for(const name of await directoryEntries(c.store,'staging/apply-requests')) {
      if(name==='completions') continue;
      if(!name.endsWith('.json')) fail('RECOVERY_REQUIRED','Unknown Request publication evidence');
      await c.repository.getApplyRequest(name.slice(0,-5),{gate:c.gate});
    }
  }
  async function absenceEvidence(id,c) {
    await noUnknownWork(c);
    const history=await c.repository.readApplyHistoryDirectory({gate:c.gate});
    // Any matching historical acceptance is evidence even before a current
    // success-only proof can be established. Never reissue its missing receipt.
    for(const entry of history.entries) if(entry.document?.payload?.request?.request_id===id) fail('RECOVERY_REQUIRED','History references a missing Receipt');
  }
  async function scan(c) {
    const events=await c.repository.listApprovalInvalidations({gate:c.gate});
    for(const id of knownEvents) if(!events.some(e=>e.event_id===id)) integrity('Known Invalidation disappeared');
    for(const e of events) {
      const a=await staticApproval(e.approval_id,c);
      if(e.repository_instance_id!==a.repository_instance_id || e.approval_hash!==approvalHash(a)) integrity('Invalidation target mismatch');
      const r=await optionalRequest(a.intended_request_id,c,a);
      if(e.accepted_request===null) {
        if(r) integrity('Pre-acceptance Invalidation coexists with Receipt');
        await absenceEvidence(a.intended_request_id,c);
      } else {
        if(!r) fail('RECOVERY_REQUIRED','Invalidation referenced Receipt is missing');
        if(!same(e.accepted_request,{request_id:r.receipt.request_id,receipt_hash:r.receipt_hash})) integrity('Invalidation Receipt reference mismatch');
      }
    }
    events.forEach(e=>knownEvents.add(e.event_id));
    return events;
  }
  async function ready(c) {
    const r=await inspectRuntimeState(c.store);
    if(r.status!=='READY' || r.readiness!=='initialized') fail(r.status==='READY'?'RECOVERY_REQUIRED':r.status,'Runtime blocks new acceptance');
    return r;
  }
  async function current(a,c) {
    const events=await scan(c); // Collection integrity precedes ordinary rejection.
    const invalidated=events.some(e=>e.approval_id===a.approval_id);
    let check;
    try {check=await createApplyPlanService({root,io}).checkApplyPlan(a.plan_id,{gate:c.gate});}
    catch(error) {if(invalidated) error.diagnostics=[...(error.diagnostics??[]),{code:'APPROVAL_INVALIDATED',severity:'error'}];throw error;}
    const diagnostics=[...check.diagnostics,...(invalidated?[{code:'APPROVAL_INVALIDATED',severity:'error'}]:[])];
    if(check.status!=='APPLICABLE') throw new RepositoryError(check.status,'Current Plan blocks Approval',{diagnostics});
    if(invalidated) throw new RepositoryError('APPROVAL_INVALIDATED','Approval permanently invalidated',{diagnostics});
    return {approval:a,approval_hash:approvalHash(a),status:'APPLICABLE',diagnostics};
  }
  // One readonly evaluation for initial acceptance, retry and check. The caller
  // has already validated the immutable artifact and holds the live lease.
  async function requestResponse(artifact,c) {
    const events=await scan(c),runtime=await inspectRuntimeState(c.store);
    const bootstrap=await c.store.readJson('staging/fn004-bootstrap.json',{strict:true});
    const state=await lineage(c),snapshot=await validatedSnapshot(c.store);
    const history=verifySuccessfulHistory({bootstrap,state,snapshot,
      git_audit:await auditGitIds(c.store.root),
      history_directory:await c.repository.readApplyHistoryDirectory({gate:c.gate})});
    if(!history.valid) fail(history.diagnostics[0].code,'History cannot establish a verified result');
    const codes=new Set([...runtime.diagnostics,...history.diagnostics].map(d=>d.code));
    const r=artifact.receipt;
    const matches=history.successful_records.filter(({payload:p})=>p.request.request_id===r.request_id || p.apply_id===r.apply_id || p.transaction_id===r.transaction_id);
    if(matches.length>1) integrity('Request identities refer to different History records');
    let result=null;
    if(matches.length) {
      const record=matches[0],p=record.payload;
      if(p.repository_instance_id!==r.repository_instance_id || p.request.request_id!==r.request_id || p.request.request_payload_hash!==r.request_payload_hash || !same(p.decision,r.decision) || p.plan.plan_id!==r.plan_id || p.plan.plan_hash!==r.plan_hash || p.approval.approval_id!==r.approval_id || p.approval.approval_hash!==r.approval_hash || !same(p.actor,r.actor) || p.transaction_id!==r.transaction_id || p.apply_id!==r.apply_id) integrity('History exact Receipt binding mismatch');
      result={apply_id:p.apply_id,record_hash:record.record_hash};
      codes.add('ALREADY_APPLIED');
    }
    // Preserve the ready-only lookup boundary. A valid success set can expose
    // an exact result above even when pending/state proof blocks normal use.
    if(history.state_proof.verified && history.readiness==='ready') {
      const plan=await c.repository.getApplyPlan(r.plan_id,{gate:c.gate});
      const store=await c.repository.readDecisionStore({gate:c.gate});
      const decision=store.revisions.find(d=>d.decision_id===r.decision.decision_id && d.revision===r.decision.revision);
      const match=lookupVerifiedHistory(history,r.decision,{candidate_ids:plan.payload.candidate_preconditions.map(b=>b.candidate_id),replaces:decision.replaces??[]});
      if(match.code==='ALREADY_APPLIED') codes.add(match.code);
      else if(match.code) fail(match.code,'History conflicts with the accepted Decision');
    }
    if(events.some(e=>e.approval_id===r.approval_id)) codes.add('APPROVAL_INVALIDATED');
    // Never bypass the normal Plan guard to infer staleness from changed input.
    if(runtime.status==='READY' && runtime.readiness==='initialized') {
      const check=await createApplyPlanService({root,io}).checkApplyPlan(r.plan_id,{gate:c.gate});
      if(check.status==='INTEGRITY_CONFLICT') fail(check.status,'Plan History conflict');
      if(check.status!=='APPLICABLE') codes.add(check.status);
      check.diagnostics.forEach(d=>codes.add(d.code));
    }
    return {artifact,readiness:runtime.readiness,diagnostics:[...codes].sort().map(code=>({code})),result};
  }
  return Object.freeze({
    approveApplyPlan:(command,context={})=>run('approval_create',command,context,async(input,c)=>{
      closed(input,['approval_id','plan_id','plan_hash','intended_request_id']);
      const path=approvalPath(input.approval_id);
      if(await c.store.exists(path)) {
        const old=await staticApproval(input.approval_id,c);
        if(old.plan_id!==input.plan_id || old.plan_hash!==input.plan_hash || old.intended_request_id!==input.intended_request_id || !same(old.actor,c.actor)) integrity('Approval retry differs');
        return old;
      }
      await ready(c);
      const p=await c.repository.getApplyPlan(input.plan_id,{gate:c.gate});
      if(p.plan_hash!==input.plan_hash) fail('APPROVAL_PLAN_MISMATCH','Plan hash mismatch');
      const check=await createApplyPlanService({root,io}).checkApplyPlan(p,{gate:c.gate});
      if(check.status!=='APPLICABLE') throw new RepositoryError(check.status,'Plan not applicable',{diagnostics:check.diagnostics});
      const a=validateApproval({schema_version:1,approval_id:input.approval_id,repository_instance_id:p.payload.repository_instance_id,decision_id:p.payload.decision.identity.decision_id,revision:p.payload.decision.identity.revision,decision_content_hash:p.payload.decision.identity.content_hash,plan_id:p.plan_id,plan_hash:p.plan_hash,approved_at:clock(),actor:c.actor,purpose:'canonical_apply',intended_request_id:input.intended_request_id});
      await assertGateOwnership(c.gate); return c.repository.saveApproval(a,{gate:c.gate});
    }),
    getApproval:(id,context={})=>run('approval_read',{id},context,(input,c)=>staticApproval(input.id,c)),
    checkApproval:(id,context={})=>run('approval_check',{id},context,async(input,c)=>{const a=await staticApproval(input.id,c);if(!same(a.actor,c.actor)) fail('APPROVAL_PLAN_MISMATCH','Approval actor mismatch');return current(a,c);}),
    invalidateApproval:(command,context={})=>run('approval_invalidate',command,context,async(input,c)=>{
      closed(input,['event_id','approval_id','approval_hash','reason']);
      const path=invalidationPath(input.event_id),a=await staticApproval(input.approval_id,c);
      if(approvalHash(a)!==input.approval_hash) integrity('Invalidation Approval hash mismatch');
      if(await c.store.exists(path)) {
        const old=await c.repository.getApprovalInvalidation(input.event_id,{gate:c.gate});
        if(old.approval_id!==input.approval_id || old.approval_hash!==input.approval_hash || old.reason!==input.reason || !same(old.actor,c.actor)) integrity('Invalidation retry differs');
        await scan(c); return old;
      }
      await noUnknownWork(c);
      const r=await optionalRequest(a.intended_request_id,c,a);
      if(!r) await absenceEvidence(a.intended_request_id,c);
      await scan(c);
      const e=validateInvalidation({schema_version:1,event_id:input.event_id,repository_instance_id:a.repository_instance_id,approval_id:a.approval_id,approval_hash:input.approval_hash,reason:input.reason,actor:c.actor,invalidated_at:clock(),accepted_request:r?{request_id:r.receipt.request_id,receipt_hash:r.receipt_hash}:null});
      const saved=await c.repository.saveApprovalInvalidation(e,{gate:c.gate});
      knownEvents.add(saved.event_id); return saved;
    }),
    getApprovalInvalidations:(context={})=>run('invalidation_scan',{},context,(_input,c)=>scan(c)),
    getApprovalInvalidation:(id,context={})=>run('invalidation_read',{id},context,async(input,c)=>{invalidationPath(input.id);const events=await scan(c);const e=events.find(e=>e.event_id===input.id);if(!e) fail('PERSISTENCE_NOT_FOUND','Invalidation not found');return e;}),
    submitApplyRequest:(command,context={})=>run('request_accept',command,context,async(input,c)=>{
      validateRequestPayload(input);
      // Context is trusted; actor changes on an existing request are still the
      // established idempotency conflict, never a fresh acceptance.
      if(!same(input.actor,c.actor)) fail('APPROVAL_PLAN_MISMATCH','Untrusted Request actor');
      const old=await optionalRequest(input.request_id,c);
      if(old) {
        if(!same(requestPayloadProjectionV1(old),input)) integrity('Same Request ID with different semantic payload');
        return requestResponse(old,c);
      }
      const a=await staticApproval(input.approval_id,c);
      const expected={schema_version:1,repository_instance_id:a.repository_instance_id,request_id:a.intended_request_id,decision:approvalDecision(a),plan_id:a.plan_id,plan_hash:a.plan_hash,approval_id:a.approval_id,approval_hash:approvalHash(a),actor:a.actor,purpose:a.purpose};
      if(!same(expected,input)) fail('APPROVAL_PLAN_MISMATCH','Request differs from Approval');
      await current(a,c); await ready(c); await absenceEvidence(input.request_id,c);
      const id=randomUUID(),{schema_version,purpose,...payload}=input;
      const e={schema_version,receipt:{...payload,request_payload_hash:requestPayloadHash(input),requested_at:clock(),transaction_id:`tx_${id}`,apply_id:`apply_${id}`},receipt_hash:'',processing:initialProcessing()};
      e.receipt_hash=receiptHash(e); validateApplyRequest(e);
      const artifact=await c.repository.saveApplyRequest(e,{gate:c.gate});
      return requestResponse(artifact,c);
    }),
    checkApplyRequest:(id,context={})=>run('request_check',{id},context,async(input,c)=>{
      const artifact=await staticRequest(await c.repository.getApplyRequest(input.id,{gate:c.gate}),c);
      if(!same(artifact.receipt.actor,c.actor)) fail('APPROVAL_PLAN_MISMATCH','Request belongs to another actor');
      return requestResponse(artifact,c);
    }),
    getApplyRequest:(id,context={})=>run('request_read',{id},context,async(input,c)=>{
      const e=await staticRequest(await c.repository.getApplyRequest(input.id,{gate:c.gate}),c);
      if(!same(e.receipt.actor,c.actor)) fail('APPROVAL_PLAN_MISMATCH','Request belongs to another actor');
      await scan(c); return e;
    })
  });
}
export { newApprovalId, newInvalidationId };
