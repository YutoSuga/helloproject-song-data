import { canonicalJson,hashCanonicalJson } from './canonical-hash.js';
import { createPersistence,RepositoryError } from './persistence.js';
import { createFn004Repository } from './fn004-repository.js';
import { withCanonicalGate,assertGateOwnership } from './fn004-gate.js';
import { validatedSnapshot,inspectRuntimeState } from './fn004-runtime-state.js';
import { auditGitIds } from './fn004-git-audit.js';
import { buildDecisionRegistry } from './fn004-decision-lifecycle.js';
import { lookupVerifiedHistory } from './fn004-history-verify.js';
import { generatePlanFromInput } from './fn004-plan-generate.js';
import { validateApplyPlan } from './fn004-plan-validator.js';
import { PLAN_RULES } from './fn004-plan-primitives.js';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const fail=(code,message)=>{throw new RepositoryError(code,message);};
const diagnostic=code=>({severity:'error',code,target:null,decision_path:null,evidence_refs:[],canonical:null});
export function createApplyPlanService({root=process.cwd(),io,clock=()=>new Date().toISOString()}={}){
  async function context(gate){
    const persistence=await createPersistence(root,io?{io}:{}),repository=await createFn004Repository(root,io?{io}:{});
    const snapshot=await validatedSnapshot(persistence),historical=await auditGitIds(persistence.root),runtime=await inspectRuntimeState(persistence,{snapshot,historical});
    if(runtime.status!=='READY'||runtime.readiness!=='initialized')fail(runtime.status==='READY'?'RECOVERY_REQUIRED':runtime.status,'Runtime blocks Apply Plan operations');
    const state=await persistence.readJson('staging/fn004-state.json',{strict:true});
    if(state.pending_transaction!==null)fail('RECOVERY_REQUIRED','Pending transaction blocks planning');
    const store=await repository.readDecisionStore({gate}),registry=buildDecisionRegistry(store);
    return {repository,persistence,snapshot,state,history:runtime.history_verification,historical,store,registry};
  }
  async function input(c,decision_id){
    const decision=c.registry.active_confirmed.find(r=>r.decision_id===decision_id);
    if(!decision)fail('DECISION_NOT_EFFECTIVE','Selected Decision is not effective confirmed');
    const candidates=await c.persistence.readJson('staging/song-candidates.json',{strict:true});
    return {decision,registry:c.registry,candidates,snapshot:c.snapshot,state:c.state,history:c.history};
  }
  async function check(plan,c){
    // Verify the saved hash before treating a rules mismatch as stale. Unknown
    // rule versions can never produce an applicable check result.
    if(plan?.schema_version!==1||!plan.payload||plan.plan_hash!==hashCanonicalJson(plan.payload)||plan.plan_id!==`ap_${plan.plan_hash}`)fail('PLAN_INTEGRITY_CONFLICT','Malformed saved Plan');
    const response=(status,diagnostics=[],history_match=null)=>({status,plan_id:plan.plan_id,applicable:status==='APPLICABLE',diagnostics,history_match});
    const identity=plan.payload.decision?.identity;
    const historicalDecision=c.store.revisions.find(r=>r.decision_id===identity?.decision_id&&r.revision===identity?.revision);
    const match=lookupVerifiedHistory(c.history,identity,{candidate_ids:plan.payload.candidate_preconditions.map(b=>b.candidate_id),replaces:historicalDecision?.replaces??[]});
    if(match.code==='ALREADY_APPLIED'||match.code==='INTEGRITY_CONFLICT')return response(match.code,[],match.apply_id);
    if(match.code)fail(match.code,'Applied History blocks this Decision revision/coverage');
    if(!same(plan.payload.rules,PLAN_RULES))return response('STALE_PLAN',[diagnostic('STALE_PLAN')]);
    validateApplyPlan(plan,{decision:historicalDecision});
    if(!c.registry.active_confirmed.some(r=>same(identity,{decision_id:r.decision_id,revision:r.revision,content_hash:r.content_hash})))return response('STALE_PLAN',[diagnostic('DECISION_NOT_EFFECTIVE')]);
    let regenerated;
    try{regenerated=generatePlanFromInput(await input(c,identity.decision_id),{generated_at:plan.generated_at});}
    catch(error){if(error.code==='CANDIDATE_FINGERPRINT_MISMATCH')return response('STALE_PLAN',[diagnostic(error.code)]);throw error;}
    if(!same(plan.payload,regenerated.payload))return response('STALE_PLAN',[diagnostic('STALE_PLAN')]);
    return response(plan.payload.applicability.applicable?'APPLICABLE':'BLOCKED',plan.payload.validation.diagnostics);
  }
  return Object.freeze({
    generateApplyPlan: ({decision_id})=>withCanonicalGate({root,operation:'plan_generate',fn:async gate=>{const c=await context(gate);const value=await input(c,decision_id);const plan=generatePlanFromInput(value,{generated_at:clock()});await assertGateOwnership(gate,c.repository.root);return plan;}}),
    saveApplyPlan: value=>{const plan=JSON.parse(canonicalJson(value));return withCanonicalGate({root,operation:'plan_save',fn:async gate=>{const c=await context(gate),checked=await check(plan,c);if(!['APPLICABLE','BLOCKED'].includes(checked.status))fail(checked.status,'Plan is not current');const freshAudit=await auditGitIds(c.repository.root);if(!same(freshAudit,c.historical))fail('STALE_PLAN','Authoritative Git audit changed before publication');return c.repository.saveApplyPlan(plan,{gate});}});},
    getApplyPlan: id=>withCanonicalGate({root,operation:'plan_load',fn:async gate=>{const c=await context(gate);return c.repository.getApplyPlan(id,{gate});}}),
    checkApplyPlan: (value,{gate}={})=>{const frozen=typeof value==='string'?value:JSON.parse(canonicalJson(value));return withCanonicalGate({root,operation:'plan_check',gate,fn:async gate=>{const c=await context(gate),plan=typeof frozen==='string'?await c.repository.getApplyPlan(frozen,{gate}):frozen;return check(plan,c);}});}
  });
}
export const generateApplyPlan=(input,options)=>createApplyPlanService(options).generateApplyPlan(input);
export const saveApplyPlan=(plan,options)=>createApplyPlanService(options).saveApplyPlan(plan);
export const getApplyPlan=(id,options)=>createApplyPlanService(options).getApplyPlan(id);
export const checkApplyPlan=(plan,options)=>createApplyPlanService(options).checkApplyPlan(plan);
export {validateApplyPlan};
