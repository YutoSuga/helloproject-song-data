import { canonicalJson,hashCanonicalJson } from './canonical-hash.js';
import { CANONICAL_SCHEMA,ID_PATTERNS } from './canonical-schema.js';
import { currentIdMaxima } from './fn004-id-audit.js';
import { validateDecisionRevision,validateCandidateSource } from './fn004-decision-core.js';
import { validateFn004State } from './fn004-state.js';
import { lookupVerifiedHistory } from './fn004-history-verify.js';
import { collectDecisionRequirements } from './fn004-history-plan.js';
import { singular,PLAN_RULES } from './fn004-history-schema.js';
import { allocatePlannedIds,canonicalOperationId,comparePlanOperations,canonicalTypedKey,applyPlanHash } from './fn004-plan-primitives.js';
import { classifyExistingReference,classifyNewEntity,classifyRelation } from './fn004-plan-classification.js';
import { validateHypotheticalTarget,operationDiagnostics } from './fn004-plan-target.js';
import { validateApplyPlan } from './fn004-plan-validator.js';
import { RepositoryError } from './persistence.js';
const fail=(code,message)=>{throw new RepositoryError(code,message);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const token=(table,ref)=>`${table}/${ref}`;
function sourceFor(r,kind){return {subject:{kind,ref:r.ref},decision_paths:[...r.paths],candidate_ids:[...r.candidates].sort(),evidence_refs:[...r.evidence]};}
function missingDiagnostic(r){return {severity:'error',code:'REQUIREMENT_UNPLANNED',target:null,decision_path:r.paths[0],evidence_refs:[...r.evidence],canonical:null};}
function operationRow(op){return op.result.existing_row??op.result.row_template??op.result.requested?.row_template;}
export function buildDecisionOperations(decision,snapshot,high_water_marks){
  validateDecisionRevision(decision);
  if(decision.status!=='confirmed')fail('DECISION_NOT_EFFECTIVE','Only a confirmed Decision can produce formal operations');
  const {defs,requests}=collectDecisionRequirements(decision);
  const allocated=allocatePlannedIds({entities:decision.entities,canonical_maxima:currentIdMaxima(snapshot),high_water_marks});
  const mappings=allocated.planned_id_mappings,byRef=new Map(mappings.map(m=>[m.local_ref,m.planned_id]));
  const operations=[],unplanned=[];
  for(const r of requests.values()){
    const def=defs.get(r.ref),kind=def?(singular[r.table]?'local':'relation'):'existing';
    const exhausted=allocated.overflow.some(m=>m.local_ref===r.ref);
    const unresolved=def&&CANONICAL_SCHEMA[r.table].columns.some(c=>c.type==='id'&&c.target!==r.table&&def.value[singular[c.target]]?.local_ref&&!byRef.has(def.value[singular[c.target]].local_ref));
    if(unresolved&&!exhausted){unplanned.push(missingDiagnostic(r));continue;}
    let classified;
    if(!def)classified=classifyExistingReference({table:r.table,reference:r.nodes[0],snapshot});
    else if(kind==='local')classified=classifyNewEntity({table:r.table,judgment:def.value,mappings,overflow:allocated.overflow,snapshot});
    else classified=classifyRelation({table:r.table,judgment:def.value,mappings,snapshot});
    const source=sourceFor(r,kind),result=classified.result;
    const row=operationRow({result});
    const key=row?canonicalTypedKey(r.table,row):classified.classification==='conflict'&&result.requested.kind==='reference'?{[CANONICAL_SCHEMA[r.table].primaryKey[0]]:r.ref}:null;
    operations.push({schema_version:1,operation_id:canonicalOperationId(decision.decision_id,r.table,source.subject),...classified,table:r.table,source,dependencies:[],key});
  }
  // Dependencies describe only executable master requirements. Missing or
  // conflicted masters leave a diagnostic instead of a partial dependent row.
  let changed=true;
  while(changed){changed=false;for(let i=operations.length-1;i>=0;i--){const op=operations[i],r=operationRow(op);if(!r)continue;
    const needed=CANONICAL_SCHEMA[op.table].foreignKeys.map(fk=>({table:fk.table,column:fk.columns[0],value:r[fk.columns[0]]})).filter(v=>v.value!=='');
    const targets=needed.map(f=>operations.find(other=>other.table===f.table&&['reuse','insert'].includes(other.classification)&&operationRow(other)?.[f.column]===f.value));
    if(targets.some(t=>!t)){unplanned.push(missingDiagnostic(requests.get(token(op.table,op.source.subject.ref))));operations.splice(i,1);changed=true;}
    else op.dependencies=[...new Set(targets.map(t=>t.operation_id))].sort();
  }}
  operations.sort((a,b)=>comparePlanOperations(a,b,decision));
  return {planned_id_mappings:mappings,operations,unplanned};
}
// Defensive diagnostic surface only. Draft unsupported requests never become
// a formal persisted Plan, and no member/video IDs are allocated here.
export function diagnoseUnsupportedRequests(decision){
  validateDecisionRevision(decision);
  const codes={new_member:'NEW_MEMBER',update_existing:'EXISTING_UPDATE',delete:'DELETE',member_affiliation:'MEMBER_AFFILIATION',video:'VIDEO',large_correction:'LARGE_CORRECTION'};
  const localTables={work:'works',creator:'creators',artist:'artists',release:'releases',song:'songs',song_artist:'song_artists',song_creator:'song_creators',song_performer:'song_performers',track:'release_tracks'};
  function explicitTable(target){
    if(typeof target!=='string')return null;
    if(Object.hasOwn(CANONICAL_SCHEMA,target))return target;
    const master=Object.keys(ID_PATTERNS).find(table=>ID_PATTERNS[table].test(target));
    if(master)return master;
    const type=target.split(':')[0];
    if(!Object.hasOwn(localTables,type))return null;
    const table=localTables[type];
    try{canonicalOperationId(decision.decision_id,table,{kind:singular[table]?'local':'relation',ref:target});return table;}catch{return null;}
  }
  const operations=[],diagnostics=[];
  decision.unsupported_requests.forEach((request,i)=>{
    const code=codes[request.kind],subject={kind:'unsupported',ref:request.request_ref},path=`/unsupported_requests/${i}`;
    const explicit=explicitTable(request.target);
    const table=request.kind==='new_member'?'members':request.kind==='member_affiliation'?'member_affiliations':request.kind==='video'?(explicit&&['videos','video_songs','video_song_performers'].includes(explicit)?explicit:'videos'):explicit;
    // target is explanatory, never an executable payload. Ambiguous targets
    // have no formal operation/table; retain their blocking diagnostic only.
    if(!table){diagnostics.push({severity:'error',code,target:null,decision_path:path,evidence_refs:[...request.evidence_refs],canonical:null});return;}
    operations.push({schema_version:1,operation_id:canonicalOperationId(decision.decision_id,table,subject),classification:'unsupported',table,source:{subject,decision_paths:[path],candidate_ids:[],evidence_refs:[...request.evidence_refs]},dependencies:[],key:null,result:{code,request_ref:request.request_ref,description:request.description}});
  });
  operations.sort((a,b)=>comparePlanOperations(a,b,decision));
  const all=[...operationDiagnostics(operations),...diagnostics];
  all.sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:canonicalJson(a)>canonicalJson(b)?1:0);
  return {operations,diagnostics:all};
}
export function generatePlanFromInput({decision,registry,candidates,snapshot,state,history},{generated_at=new Date().toISOString()}={}){
  validateDecisionRevision(decision);validateFn004State(state);
  if(state.pending_transaction!==null)fail('RECOVERY_REQUIRED','Pending transaction blocks planning');
  const identity={decision_id:decision.decision_id,revision:decision.revision,content_hash:decision.content_hash};
  if(!history?.state_proof?.verified||history.readiness!=='ready'||history.state_proof.terminal_state_hash!==state.state_hash||!same(state.history,{count:history.count,head_hash:history.head_hash,last_apply_id:history.last_apply_id}))fail('RECOVERY_REQUIRED','History proof does not bind the supplied state');
  if(!registry?.projection||hashCanonicalJson(registry.projection)!==registry.registry_hash||!same(registry.projection.active_confirmed,registry.active_confirmed.map(r=>({identity:{decision_id:r.decision_id,revision:r.revision,content_hash:r.content_hash},scope_hash:r.scope.scope_hash,candidate_ids:r.scope.candidate_ids}))))fail('INTEGRITY_CONFLICT','Registry projection/hash mismatch');
  const match=lookupVerifiedHistory(history,identity,{candidate_ids:decision.scope.candidate_ids,replaces:decision.replaces});
  if(match.code)fail(match.code,'Decision/candidate coverage was already applied');
  if(decision.status!=='confirmed'||!registry.active_confirmed.some(r=>same(identity,{decision_id:r.decision_id,revision:r.revision,content_hash:r.content_hash})))fail('DECISION_NOT_EFFECTIVE','Decision is not effective confirmed');
  if(candidates?.schema_version!==1||!Array.isArray(candidates.candidates))fail('CANDIDATE_FINGERPRINT_MISMATCH','Invalid current candidate source');
  for(const b of decision.candidate_bindings){const found=candidates.candidates.filter(c=>c.candidate_id===b.candidate_id);if(found.length!==1)fail('CANDIDATE_FINGERPRINT_MISMATCH','Candidate missing/duplicate');try{validateCandidateSource(b,found[0],candidates.schema_version);}catch(cause){throw new RepositoryError('CANDIDATE_FINGERPRINT_MISMATCH','Candidate facts changed',{cause});}}
  const compiled=buildDecisionOperations(decision,snapshot,state.high_water_marks);
  const {validation,applicability}=validateHypotheticalTarget({snapshot,operations:compiled.operations,unplanned:compiled.unplanned});
  const payload={schema_version:1,repository_instance_id:state.repository_instance_id,bootstrap_hash:state.bootstrap_hash,rules:PLAN_RULES,
    decision:{identity,scope_hash:decision.scope.scope_hash,registry_hash:registry.registry_hash},
    candidate_preconditions:decision.candidate_bindings.map(b=>({candidate_id:b.candidate_id,source_schema_version:1,projection_version:1,source_identity:structuredClone(b.source_identity),fingerprint:structuredClone(b.fingerprint),snapshot_hash:b.fingerprint.value})),
    canonical_precondition:structuredClone(snapshot.manifest),id_state_precondition:{schema_version:1,state_hash:state.state_hash,generation:state.generation,high_water_marks:structuredClone(state.high_water_marks),pending_transaction:null},
    history_precondition:{schema_version:1,bootstrap_hash:state.bootstrap_hash,count:history.count,head_hash:history.head_hash,last_apply_id:history.last_apply_id,semantic_hash:history.semantic_hash},
    planned_id_mappings:compiled.planned_id_mappings,operations:compiled.operations,no_op_operations:compiled.operations.filter(o=>o.classification==='no_op').map(o=>o.operation_id),conflicts:compiled.operations.filter(o=>o.classification==='conflict').map(o=>o.operation_id),unsupported_operations:[],validation,applicability};
  const plan_hash=applyPlanHash(payload),plan={schema_version:1,plan_id:`ap_${plan_hash}`,generated_at,payload,plan_hash};
  validateApplyPlan(plan,{decision});return plan;
}
