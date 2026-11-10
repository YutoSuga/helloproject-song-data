import {CANONICAL_TABLES} from './canonical-schema.js';
import {COMMIT_PATHS} from './fn004-evidence-types.js';
import {requestPath} from './fn004-approval-repository.js';
import {randomUUID} from 'node:crypto';
import {createPersistence,RepositoryError} from './persistence.js';
import {withCanonicalGate} from './fn004-gate.js';
import {inspectRuntimeState} from './fn004-runtime-state.js';
import {createApplyPlanService} from './fn004-plan-application.js';
import {createCanonicalApplyService} from './fn004-apply-application.js';
import {newApprovalId,approvalHash,approvalDecision,validateApplyRequest} from './fn004-approval-schema.js';
import {validateBootstrapRecord} from './fn004-state.js';
import {binding as validateBinding} from './fn004-evidence-types.js';
import {discoverEvidence} from './fn004-evidence-discovery.js';
import {collectRecoverySnapshot} from './fn004-recovery-collection.js';
import {classifyRecoverySnapshot} from './fn004-recovery-classifier.js';
import {recoverySnapshotData} from './fn004-recovery-snapshot.js';
import {probeRecoveryOwner} from './fn004-recovery-process.js';
import {createFailureRecoveryService} from './fn004-failure-recovery.js';
import {createSuccessRecoveryService} from './fn004-success-recovery.js';

const fail=(code,message)=>{throw new RepositoryError(code,message);};

// Application composition only. Caller context and factory dependencies are
// trusted in-process inputs, never command-line flags or environment hooks.
export function createCanonicalManagementService({root=process.cwd(),actor,...options}={}) {
  const plans=createApplyPlanService({root,...options});
  const accepted=new Set();
  const apply=createCanonicalApplyService({root,...options,onBoundary:async e=>{
    if(e.phase==='receipt:after')accepted.add(e.path);
    await options.onBoundary?.(e);
  }});
  const context={actor};
  async function result(request_id) {
    return withCanonicalGate({root,operation:'management_result',fn:async gate=>{
      const response=await apply.checkApplyRequest(request_id,{actor,gate});
      const runtime=await inspectRuntimeState(await createPersistence(root,options),{...options,gate});
      if(runtime.cause&&!['RECOVERY_REQUIRED','STATE_TRANSITION_PROOF_REQUIRED'].includes(runtime.status))throw runtime.cause;
      const proof=runtime.terminal_context?.proofs.find(p=>p.payload.binding.request_id===request_id);
      return {response,terminal_phase:proof?.payload.phase??null};
    }});
  }
  async function resolveRecovery(selector) {
    const d=await discoverEvidence(root,options);
    const bootstrapPath='staging/fn004-bootstrap.json';
    if(!Object.hasOwn(d.documents,bootstrapPath))throw new RepositoryError('PERSISTENCE_NOT_FOUND','Required Recovery original is missing',{path:bootstrapPath});
    const bootstrap=validateBootstrapRecord(d.documents[bootstrapPath]);
    const requests=Object.entries(d.documents).filter(([p])=>/^staging\/apply-requests\/[0-9a-f-]{36}\.json$/.test(p));
    for(const [path,r] of requests)validateApplyRequest(r,path.split('/').at(-1).slice(0,-5));
    const matches=requests.filter(([,r])=>selector.request_id?r.receipt.request_id===selector.request_id:r.receipt.transaction_id===selector.transaction_id);
    if(matches.length!==1)fail(matches.length?'INTEGRITY_CONFLICT':'PERSISTENCE_NOT_FOUND','Recovery requires one exact retained Receipt');
    const e=matches[0][1],r=e.receipt;
    if(r.repository_instance_id!==bootstrap.payload.repository_instance_id)fail('INTEGRITY_CONFLICT','Receipt repository differs');
    const binding={...Object.fromEntries(['repository_instance_id','transaction_id','request_id','apply_id','decision','plan_id','plan_hash',
      'approval_id','approval_hash','request_payload_hash','actor'].map(k=>[k,r[k]])),bootstrap_hash:bootstrap.bootstrap_hash,receipt_hash:e.receipt_hash};
    validateBinding(binding);
    // Full static/global validation and actual OS probes belong to the existing
    // collector, not to the binding lookup or the public adapter.
    const snapshot=await collectRecoverySnapshot(root,binding,{...options,probeOwner:options.probeOwner??probeRecoveryOwner});
    return {binding,snapshot,observation:classifyRecoverySnapshot(snapshot)};
  }
  async function annotateExecutionFailure(error,request_id) {
    // An earlier inspect result cannot establish the effect after a failed
    // execution. Reuse the normal Apply's full readonly reobservation only;
    // never retry, repair evidence or replace the original exception here.
    try {
      const {snapshot,observation}=await resolveRecovery({request_id});
      const s=recoverySnapshotData(snapshot);
      if(s.base.evidence.consistency==='stable'&&observation.readiness!=='blocked') {
        if(s.chain?.decision&&s.semantic_codes.length===0&&s.canonical_manifest?.manifest_hash===s.intent?.payload.target_manifest.manifest_hash)
          Object.assign(error,{canonical_effect:'applied',finalization_pending:observation.readiness!=='initialized'});
        if(s.proof&&s.completion&&observation.classification==='terminal'&&['ABORTED','ROLLED_BACK'].includes(s.proof.payload.phase))
          Object.assign(error,{terminal_outcome:s.proof.payload.phase==='ABORTED'?'aborted':'rolled_back',canonical_effect:s.proof.payload.phase==='ABORTED'?'none':'restored'});
      }
    } catch(inspection_error) {error.recovery_inspection_error=inspection_error;}
  }
  return Object.freeze({
    createPlan:async({decision_id,revision,expected_decision_hash})=>{
      const plan=await plans.generateApplyPlan({decision_id});
      const d=plan.payload.decision.identity;
      if(d.revision!==revision||d.content_hash!==expected_decision_hash)fail('STALE_PLAN','Requested Decision snapshot changed');
      return plans.saveApplyPlan(plan);
    },
    preflight:async(plan_id,expected_plan_hash)=>{
      const plan=await plans.getApplyPlan(plan_id);
      if(plan.plan_hash!==expected_plan_hash)fail('PLAN_INTEGRITY_CONFLICT','Expected Plan hash differs');
      const check=await plans.checkApplyPlan(plan);
      if(!check.applicable)throw new RepositoryError(check.status,'Plan is not applicable',{diagnostics:check.diagnostics,history_match:check.history_match});
      const operations=plan.payload.operations,paths=new Map(CANONICAL_TABLES.map(t=>[t.name,t.path]));
      const display={repository_instance_id:plan.payload.repository_instance_id,decision:plan.payload.decision.identity,
        plan:{plan_id:plan.plan_id,plan_hash:plan.plan_hash},planned_ids:plan.payload.planned_id_mappings,
        inserts:operations.filter(o=>o.classification==='insert').map(o=>({table:o.table,...o.result})),
        reuse:operations.filter(o=>o.classification==='reuse').map(o=>({table:o.table,...o.result})),
        no_op:operations.filter(o=>o.classification==='no_op').map(o=>({table:o.table,key:o.key,...o.result})),
        warnings:plan.payload.validation.diagnostics.filter(d=>d.severity==='warning'),
        changed_csvs:COMMIT_PATHS.filter(path=>operations.some(o=>o.classification==='insert'&&paths.get(o.table)===path))};
      return {plan,check,display};
    },
    applyPlan:async(plan_id,expected_plan_hash)=>{
      const request_id=randomUUID(),approval_id=newApprovalId();let approvalEstablished=false;
      try {
        const a=await apply.approveApplyPlan({approval_id,plan_id,plan_hash:expected_plan_hash,intended_request_id:request_id},context);
        approvalEstablished=true;
        const response=await apply.submitApplyRequest({schema_version:1,repository_instance_id:a.repository_instance_id,request_id,
          decision:approvalDecision(a),plan_id:a.plan_id,plan_hash:a.plan_hash,approval_id,approval_hash:approvalHash(a),actor:a.actor,purpose:a.purpose},context);
        // The initial response is evaluated inside the consumed live lease.
        // Refresh readonly after release; never resubmit or recover here.
        const current=await result(request_id);
        return {...current,initial_readiness:response.readiness};
      } catch(error) {
        if(error&&typeof error==='object') {
          Object.assign(error,{intended_request_id:request_id,plan_id,...(approvalEstablished?{approval_id}:{intended_approval_id:approval_id})});
          if(accepted.has(requestPath(request_id)))error.request_id=request_id;
          await annotateExecutionFailure(error,request_id);
        }
        throw error;
      }
    },
    result,
    history:apply_id=>withCanonicalGate({root,operation:'history_show',fn:async gate=>{
      const store=await createPersistence(root,options);
      const r=await inspectRuntimeState(store,{...options,gate});
      if(r.status!=='READY'||r.readiness!=='initialized')throw r.cause??new RepositoryError(r.status==='READY'?'RECOVERY_REQUIRED':r.status,'Runtime blocks History read',{diagnostics:r.diagnostics});
      const h=r.history_verification;
      if(!h?.valid)throw new RepositoryError(h?.diagnostics[0]?.code??'HISTORY_CORRUPT','Successful History is not valid',{diagnostics:h?.diagnostics});
      if(!(h.state_proof.verified&&h.readiness==='ready'||r.terminal_context))fail('STATE_TRANSITION_PROOF_REQUIRED','History state is not proven');
      const record=h.successful_records.find(v=>v.payload.apply_id===apply_id);
      if(!record)fail('PERSISTENCE_NOT_FOUND','Successful History not found');
      return record;
    }}),
    inspectRecovery:async request_id=>(await resolveRecovery({request_id})).observation,
    runRecovery:async({transaction_id,expected_observed_state_hash,action})=>{
      const {binding,snapshot,observation}=await resolveRecovery({transaction_id});
      if(observation.observed_state_hash!==expected_observed_state_hash||observation.allowed_actions.length!==1||observation.allowed_actions[0]!==action)
        fail('RECOVERY_REQUIRED','Stale or ineligible Recovery command; inspect again');
      const s=recoverySnapshotData(snapshot);
      const terminal=s.proof?.payload??s.proof_intent?.payload??s.chain?.head?.payload;
      const success=action==='finalize_success'||s.chain?.decision!==null&&s.chain?.decision!==undefined||terminal?.phase==='COMPLETED';
      try {
        const service=await (success?createSuccessRecoveryService:createFailureRecoveryService)(root,{...options,operator:actor});
        return await service.run({binding,command:{schema_version:2,request_id:binding.request_id,transaction_id,
          expected_observed_state_hash,action}});
      } catch(error) {
        // Keep stale-command, busy and integrity refusals unchanged. Only
        // success-side execution I/O failures can need the known-commit exit7.
        if(success&&error instanceof RepositoryError&&(/^PERSISTENCE_/.test(error.code)||error.code==='GATE_RELEASE_FAILED'))
          await annotateExecutionFailure(error,binding.request_id);
        throw error;
      }
    }
  });
}
