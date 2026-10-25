import { validateBootstrapRecord,validateFn004State,validateGitAuditIdentity,validateNamespaceMap,hashState } from './fn004-state.js';
import { currentIdMaxima,ID_NAMESPACES } from './fn004-id-audit.js';
import { validateCanonicalTables } from './canonical-validator.js';
import { RepositoryError } from './persistence.js';
import { validateHistoryRecord } from './fn004-history-record.js';
import { validateHistoryChain,historySemanticHash,buildHistoryIndexes,lookupAppliedDecision } from './fn004-history-projections.js';
import { APPLY_ID_PATTERN } from './fn004-history-directory.js';
import { demand,shape,same,integer,cmp,manifest } from './fn004-history-schema.js';

function genesis(bootstrap){const state={schema_version:1,repository_instance_id:bootstrap.payload.repository_instance_id,bootstrap_hash:bootstrap.bootstrap_hash,initialized_at:bootstrap.metadata.initialized_at,generation:0,baseline_manifest_hash:bootstrap.canonical_manifest.manifest_hash,high_water_marks:structuredClone(bootstrap.payload.high_water_marks),allocation_events:[],history:{count:0,head_hash:bootstrap.bootstrap_hash,last_apply_id:null},pending_transaction:null};state.state_hash=hashState(state);return state;}
function lineage(state,bootstrap){demand(state.repository_instance_id===bootstrap.payload.repository_instance_id&&state.bootstrap_hash===bootstrap.bootstrap_hash&&state.initialized_at===bootstrap.metadata.initialized_at&&state.baseline_manifest_hash===bootstrap.canonical_manifest.manifest_hash,'State/bootstrap lineage mismatch','STATE_BOOTSTRAP_MISMATCH');}
function expectedRanges(p,before){const values=new Map();for(const m of p.id_mappings){if(!values.has(m.namespace))values.set(m.namespace,[]);values.get(m.namespace).push(Number(m.canonical_id.slice(1)));}
  return [...values].sort(([a],[b])=>cmp(a,b)).map(([namespace,ids])=>{ids.sort((a,b)=>a-b);demand(ids.every((v,i)=>v===before.high_water_marks[namespace]+i+1),'Unproven/noncontiguous ID consumption','STATE_TRANSITION_PROOF_REQUIRED');return {transaction_id:p.transaction_id,namespace,first:ids[0],last:ids.at(-1)};});}
function deriveTerminal(bootstrap,records){
  validateBootstrapRecord(bootstrap);
  records.forEach(validateHistoryRecord);validateHistoryChain(records,{repository_instance_id:bootstrap.payload.repository_instance_id,bootstrap_hash:bootstrap.bootstrap_hash});
  let terminal=genesis(bootstrap);
  for(const r of records){const p=r.payload,before=p.state_transition.before,consumed=p.state_transition.consumed;
    lineage(before,bootstrap);lineage(consumed,bootstrap);
    demand(same(before,terminal),'History before state has an unproven transition gap','STATE_TRANSITION_PROOF_REQUIRED');
    demand(same(r.plan_snapshot.payload.id_state_precondition,{schema_version:1,state_hash:before.state_hash,generation:before.generation,high_water_marks:before.high_water_marks,pending_transaction:null}),'Plan state precondition mismatch','STATE_TRANSITION_PROOF_REQUIRED');
    demand(ID_NAMESPACES.every(n=>consumed.high_water_marks[n]>=before.high_water_marks[n]),'High-water decreased','STATE_HIGH_WATER_INVALID');
    const ranges=expectedRanges(p,before);demand(same(ranges,p.state_transition.allocation_ranges),'Allocation range/Plan mismatch','STATE_TRANSITION_PROOF_REQUIRED');
    const expected=structuredClone(before);expected.generation++;expected.pending_transaction=p.transaction_id;expected.allocation_events.push(...ranges);for(const e of ranges)expected.high_water_marks[e.namespace]=e.last;expected.state_hash=hashState(expected);
    demand(same(expected,consumed),'Consumed state differs from proven successful transition','STATE_TRANSITION_PROOF_REQUIRED');
    terminal=structuredClone(consumed);terminal.generation++;terminal.pending_transaction=null;terminal.history={count:p.sequence,head_hash:r.record_hash,last_apply_id:p.apply_id};terminal.state_hash=hashState(terminal);validateFn004State(terminal);
  }
  return terminal;
}
export function proveHistoryState({bootstrap,state,records,current_maxima,historical_maxima}){
  const terminal=deriveTerminal(bootstrap,records);
  try {
  validateFn004State(state);lineage(state,bootstrap);
  const lower=[bootstrap.payload.high_water_marks,current_maxima,historical_maxima];for(const m of lower)validateNamespaceMap(m);
  demand(ID_NAMESPACES.every(n=>lower.every(m=>state.high_water_marks[n]>=m[n])),'State high-water is below proven usage','STATE_HIGH_WATER_INVALID');
  return {terminal,verified:same(state,terminal)};
  } catch(error) { error.terminal_state_hash=terminal.state_hash;throw error; }
}
export function verifySuccessfulHistory({bootstrap,state,history_directory,snapshot,git_audit}){
  // These are independently trusted readonly observations, not caller-supplied
  // completion flags. The runtime service obtains them under the common gate.
  validateGitAuditIdentity(git_audit?.git);validateNamespaceMap(git_audit?.maxima,'BOOTSTRAP_AUDIT_INCOMPLETE');
  if(!snapshot?.validation?.ok||!validateCanonicalTables(snapshot.tables).ok)throw new RepositoryError('CANONICAL_INVALID','Current canonical snapshot is invalid');manifest(snapshot.manifest);
  const diagnostics=[];
  const add=(code,r=null)=>diagnostics.push({code,sequence:integer(r?.payload?.sequence,1)?r.payload.sequence:null,apply_id:typeof r?.payload?.apply_id==='string'&&APPLY_ID_PATTERN.test(r.payload.apply_id)?r.payload.apply_id:null});
  const result={schema_version:1,valid:false,readiness:'recovery_required',count:null,head_hash:null,last_apply_id:null,semantic_hash:null,successful_records:[],indexes:null,state_proof:{profile:'success-only-v1',verified:false,terminal_state_hash:null},diagnostics};
  function finish(){const nullable=(a,b)=>a===b?0:a===null?1:b===null?-1:cmp(a,b);diagnostics.sort((a,b)=>cmp(a.code,b.code)||nullable(a.sequence,b.sequence)||nullable(a.apply_id,b.apply_id));const seen=new Set();result.diagnostics=diagnostics.filter(d=>{const key=JSON.stringify(d);if(seen.has(key))return false;seen.add(key);return true;});return result;}
  try{validateBootstrapRecord(bootstrap);}catch{add('STATE_BOOTSTRAP_MISMATCH');return finish();}
  const identity={repository_instance_id:bootstrap.payload.repository_instance_id,bootstrap_hash:bootstrap.bootstrap_hash};
  let records=[];
  try{
    shape(history_directory,['present','entries']);demand(typeof history_directory.present==='boolean'&&Array.isArray(history_directory.entries)&&(!history_directory.present?history_directory.entries.length===0:true),'Invalid History directory snapshot');
    let previous=null;for(const entry of history_directory.entries){shape(entry,['name','kind','document']);demand(typeof entry.name==='string'&&(previous===null||previous<entry.name),'Invalid directory ordering');previous=entry.name;demand(entry.kind==='file'&&entry.document!==null&&entry.name.endsWith('.json')&&APPLY_ID_PATTERN.test(entry.name.slice(0,-5)),'Unknown/non-file History artifact');
      try{validateHistoryRecord(entry.document);}catch{add('HISTORY_CORRUPT',entry.document);return finish();}
      demand(entry.name===`${entry.document.payload.apply_id}.json`,'Filename/Apply identity mismatch');records.push(entry.document);
    }
    records=validateHistoryChain(records,identity);buildHistoryIndexes(records,identity);
    const prefix=[];for(const r of records){const expected={schema_version:1,bootstrap_hash:identity.bootstrap_hash,count:prefix.length,head_hash:prefix.at(-1)?.record_hash??identity.bootstrap_hash,last_apply_id:prefix.at(-1)?.payload.apply_id??null,semantic_hash:historySemanticHash(prefix,identity)};demand(same(r.plan_snapshot.payload.history_precondition,expected),'Saved Plan History prefix mismatch','HISTORY_CHAIN_MISMATCH');prefix.push(r);}
  }catch(error){add(['HISTORY_CORRUPT','HISTORY_CHAIN_MISMATCH','HISTORY_IDENTITY_CONFLICT'].includes(error.code)?error.code:'HISTORY_CORRUPT');return finish();}
  const head=records.at(-1);const summary={count:records.length,head_hash:head?.record_hash??bootstrap.bootstrap_hash,last_apply_id:head?.payload.apply_id??null};
  let stateValid=true;try{validateFn004State(state);}catch(error){stateValid=false;add(error.code==='STATE_HIGH_WATER_INVALID'?error.code:'STATE_CORRUPT');}
  if(stateValid&&!same(state.history,summary)){add('HISTORY_CHAIN_MISMATCH');return finish();}
  Object.assign(result,{valid:true,...summary,semantic_hash:historySemanticHash(records,identity),successful_records:structuredClone(records),indexes:buildHistoryIndexes(records,identity)});
  if(!stateValid){try{result.state_proof.terminal_state_hash=deriveTerminal(bootstrap,records).state_hash;}catch{/* a proof gap has no terminal hash */}return finish();}
  if(state.pending_transaction!==null)add('RECOVERY_REQUIRED');
  try{const proof=proveHistoryState({bootstrap,state,records,current_maxima:currentIdMaxima(snapshot),historical_maxima:git_audit.maxima});result.state_proof.terminal_state_hash=proof.terminal.state_hash;if(!proof.verified)add('STATE_TRANSITION_PROOF_REQUIRED');result.state_proof.verified=proof.verified&&state.pending_transaction===null;}
  catch(error){result.state_proof.terminal_state_hash=error.terminal_state_hash??null;add(['STATE_BOOTSTRAP_MISMATCH','STATE_HIGH_WATER_INVALID','STATE_TRANSITION_PROOF_REQUIRED'].includes(error.code)?error.code:'STATE_TRANSITION_PROOF_REQUIRED');}
  if(result.state_proof.verified&&diagnostics.length===0)result.readiness='ready';return finish();
}
export function lookupVerifiedHistory(result,decision,options){
  if(!result.valid||!result.state_proof.verified||result.readiness!=='ready')throw new RepositoryError('RECOVERY_REQUIRED','History/state proof is not ready');
  return lookupAppliedDecision(result.indexes,decision,options);
}
