import { createPersistence,RepositoryError } from './persistence.js';
import { withCanonicalGate,assertGateOwnership } from './fn004-gate.js';
import { inspectRuntimeState } from './fn004-runtime-state.js';
import { lookupVerifiedHistory } from './fn004-history-verify.js';
// The service obtains canonical/Git/history/state observations itself under one
// lease. Callers cannot supply a proof bypass or a claimed-complete audit flag.
export async function readApplyHistory({root=process.cwd(),gate}={}){
  return withCanonicalGate({root,gate,operation:'history_verify',fn:async lease=>{
    const persistence=await createPersistence(lease.root);
    const runtime=await inspectRuntimeState(persistence);
    if(runtime.status!=='READY'||runtime.readiness!=='initialized')throw new RepositoryError(runtime.status==='READY'?'RECOVERY_REQUIRED':runtime.status,'Runtime blocks History reads',{diagnostics:runtime.diagnostics});
    await assertGateOwnership(lease,persistence.root);
    return runtime.history_verification;
  }});
}
export async function lookupAppliedDecision({root=process.cwd(),gate,decision,candidate_ids=[],replaces=[]}){
  const result=await readApplyHistory({root,gate});return lookupVerifiedHistory(result,decision,{candidate_ids,replaces});
}
