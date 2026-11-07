import { constructHistoryRecord } from './fn004-history-construction.js';
import { readCanonicalSnapshotFromAdapter } from './canonical-snapshot.js';
import { CANONICAL_TABLES } from './canonical-schema.js';
import { publishSuccessfulHistory } from './fn004-history-publication.js';
import { applyHistoryPath } from './fn004-history-directory.js';
import { terminalStateForEntry } from './fn004-journal-chain.js';
import { confirmExistingBytes } from './fn004-recovery-durability.js';
import { canonicalJson } from './canonical-hash.js';
import { same, check } from './fn004-evidence-types.js';
import { evidencePath } from './fn004-evidence-persistence.js';

// Shared success kernel: only validated all-target/consumed observations or a
// durable decision enter here. It never replaces CSV or consumes IDs.
export async function finalizeSuccessfulTransaction(c) {
  let s=await c.guard('finalize_success');
  const {owner,intent,inputs,store,io,gate,binding}=c,root=`staging/transactions/${binding.transaction_id}`;
  if(s.chain.head.payload.phase==='RECOVERY_REQUIRED') {
    const phase=s.chain.head.payload.resume_phase;
    await c.journal({phase,resume_phase:null}, phase==='COMMIT_DECIDED'?s.chain.decision.record.payload.applied_at:undefined);
  }
  s=c.state();
  // The all-target exception must establish target durability before its
  // irreversible decision, including a prior rename whose parent sync failed.
  const targetBytes=new Map(intent.payload.target_manifest.files.map(f=>[f.path,c.discovery().rawBytes[f.path]]));
  await c.effect('target_confirm',targetBytes,async()=>{
    for(const [p,raw] of targetBytes)await confirmExistingBytes(store,io,p,raw);
    const source=`${root}/temp/data`;
    if(await store.exists(source)) {
      try { await store.syncDirectory(source); }
      catch(error) { Object.assign(error,{phase:'directory_sync',published:true});throw error; }
    }
  },'finalize_success');
  s=c.state();
  if(s.chain.head.payload.phase==='COMMITTING') {
    check(s.base.evidence.input_revalidation==='valid'&&same(s.state,intent.payload.expected_consumed_state)&&
      same(s.canonical_manifest,intent.payload.target_manifest)&&!s.chain.rollback,'All-target exception is not proven');
    // In a no-op transaction O == T can already hold immediately after an
    // uncertain consumed-state rename. Bind durable consumption before policy.
    const path='staging/fn004-state.json',raw=c.discovery().rawBytes[path];
    await c.effect('consumption_confirm',new Map([[path,raw]]),()=>confirmExistingBytes(store,io,path,raw),'finalize_success');
    if(!s.chain.head.payload.id_consumed)await c.journal({id_consumed:true,replaced_paths:intent.payload.changed_paths});
    const original=await readCanonicalSnapshotFromAdapter({list:()=>CANONICAL_TABLES.map(t=>t.path.slice(5)),read:p=>c.discovery().rawBytes[`${root}/backup/${p}`]});
    const candidate=c.discovery().documents[`${root}/temp/apply-history.json`];
    const applied_at=candidate?.payload.applied_at??c.clock();
    const record=await constructHistoryRecord({owner,intent,inputs,original,bootstrap:c.discovery().documents['staging/fn004-bootstrap.json'],
      records:s.histories,proofs:Object.entries(c.discovery().documents).filter(([p])=>p.startsWith('staging/transaction-proofs/')&&p.endsWith('.json')).map(([,v])=>v),applied_at});
    check(!candidate||same(candidate,record),'Unadoptable History candidate');
    await c.journal({phase:'COMMIT_DECIDED',id_consumed:true,replaced_paths:intent.payload.changed_paths,history:{record}},applied_at);
  }
  s=await c.guard('finalize_success');
  const record=s.chain.decision.record;
  check(same(s.canonical_manifest,intent.payload.target_manifest)&&s.semantic_codes.length===0,'Success requires exact whole-valid target');
  // Readback alone cannot establish that a pre-crash decision survived a
  // failed parent sync. Reconfirm its immutable prefix before History/state.
  const journalBytes=new Map(s.chain.entries.map(entry=>{
    const path=evidencePath(entry);return [path,c.discovery().rawBytes[path]];
  }));
  await c.effect('decision_confirm',journalBytes,async()=>{for(const [p,raw] of journalBytes)await confirmExistingBytes(store,io,p,raw);},'finalize_success');
  const historyPath=applyHistoryPath(binding.apply_id);
  await c.effect('history',new Map([[historyPath,c.discovery().rawBytes[historyPath]??Buffer.from(canonicalJson(record)+'\n')]]),
    ()=>publishSuccessfulHistory(store,io,gate,record),'finalize_success');
  if(c.state().chain.head.payload.phase==='COMMIT_DECIDED')await c.journal({phase:'HISTORY_COMMITTED'});
  const after=terminalStateForEntry({...c.state().chain.head.payload,phase:'COMPLETED'});
  if(!same(c.state().state,after))await c.effect('success_state',new Map([['staging/fn004-state.json',Buffer.from(canonicalJson(after)+'\n')]]),
    ()=>store.writeJsonAtomic('staging/fn004-state.json',after),'finalize_success');
  // A pre-crash atomic state rename may have succeeded before parent sync
  // failed. Exact after-state readback must not bypass durability confirmation.
  const statePath='staging/fn004-state.json',stateBytes=c.discovery().rawBytes[statePath];
  await c.effect('success_state_confirm',new Map([[statePath,stateBytes]]),
    ()=>confirmExistingBytes(store,io,statePath,stateBytes),'finalize_success');
  await c.journal({phase:'COMPLETED',terminal_state:after});
}
