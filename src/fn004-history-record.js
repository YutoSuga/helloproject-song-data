import { canonicalJson } from './canonical-hash.js';
import { validateDecisionRevision } from './fn004-decision-core.js';
import { validateFn004State } from './fn004-state.js';
import { RepositoryError } from './persistence.js';
import { historyRecordHash } from './fn004-history-projections.js';
import { validateStoredSuccessfulPlan } from './fn004-history-plan.js';
import { UUID,demand,shape,same,ordered,hash,integer,timestamp,manifest,actor,row,rowKey,rowHash,compareKeys,compareTimestamps } from './fn004-history-schema.js';
export function validateHistoryRecord(record){
  try{
    canonicalJson(record);shape(record,['schema_version','payload','record_hash','decision_snapshot','plan_snapshot','metadata']);
    demand(record.schema_version===1&&hash(record.record_hash)&&record.record_hash===historyRecordHash(record.payload),'Invalid record hash/version');
    shape(record.metadata,['published_at']);timestamp(record.metadata.published_at);
    const p=record.payload;
    shape(p,['schema_version','repository_instance_id','bootstrap_hash','sequence','previous_history_hash','apply_id','transaction_id','decision','plan','approval','request','actor','candidate_coverage','id_mappings','results','before_manifest','after_manifest','state_transition','apply_time','applied_at','rules']);
    demand(p.schema_version===1&&new RegExp(`^repo_${UUID}$`).test(p.repository_instance_id)&&hash(p.bootstrap_hash)&&integer(p.sequence,1)&&hash(p.previous_history_hash)&&new RegExp(`^apply_${UUID}$`).test(p.apply_id)&&p.transaction_id===`tx_${p.apply_id.slice(6)}`,'Invalid History identity');
    actor(p.actor);timestamp(p.apply_time);timestamp(p.applied_at);demand(compareTimestamps(p.apply_time,p.applied_at)<=0,'Apply times out of order');
    shape(p.approval,['approval_id','approval_hash']);demand(new RegExp(`^apr_${UUID}$`).test(p.approval.approval_id)&&hash(p.approval.approval_hash),'Invalid approval reference');
    shape(p.request,['request_id','request_payload_hash']);demand(new RegExp(`^${UUID}$`).test(p.request.request_id)&&hash(p.request.request_payload_hash),'Invalid request reference');
    validateDecisionRevision(record.decision_snapshot);const d=record.decision_snapshot;
    demand(d.status==='confirmed'&&same(p.decision,{decision_id:d.decision_id,revision:d.revision,content_hash:d.content_hash}),'Invalid confirmed Decision binding');
    const binding=validateStoredSuccessfulPlan(record.plan_snapshot,d),plan=record.plan_snapshot.payload;
    demand(same(p.plan,{plan_id:record.plan_snapshot.plan_id,plan_hash:record.plan_snapshot.plan_hash})&&p.repository_instance_id===plan.repository_instance_id&&p.bootstrap_hash===plan.bootstrap_hash,'Plan/History identity mismatch');
    shape(p.rules,['plan','transaction','history_record','history_hash','history_chain','history_set','state_proof']);demand(same(p.rules,{plan:plan.rules,transaction:1,history_record:1,history_hash:1,history_chain:1,history_set:1,state_proof:1}),'History rule mismatch');
    manifest(p.before_manifest);manifest(p.after_manifest);demand(same(p.before_manifest,plan.canonical_precondition),'Before manifest mismatch');
    demand(same(p.id_mappings,plan.planned_id_mappings.map(({planned_id,...m})=>({...m,canonical_id:planned_id}))),'Final ID mappings differ from Plan');
    demand(Array.isArray(p.results)&&p.results.length===plan.operations.length,'Partial operation results');
    for(let i=0;i<p.results.length;i++){
      const result=p.results[i],op=plan.operations[i];shape(result,['operation_id','classification','table','key','row','row_hash']);
      demand(result.operation_id===op.operation_id&&result.classification===op.classification&&result.table===op.table&&same(result.key,op.key),'Operation result binding mismatch');row(result.table,result.row);
      const expected=op.classification==='insert'?Object.fromEntries(Object.entries(op.result.row_template).map(([k,v])=>[k,typeof v==='object'?p.apply_time:v])):op.result.existing_row;
      demand(same(result.row,expected)&&same(rowKey(result.table,result.row),result.key)&&result.row_hash===rowHash(result.table,result.row),'Operation result differs from saved row/template');
    }
    if(!plan.operations.some(o=>o.classification==='insert'))demand(same(p.before_manifest,p.after_manifest),'No-write History changed manifest');
    demand(Array.isArray(p.candidate_coverage)&&p.candidate_coverage.length===d.candidate_bindings.length,'Incomplete coverage');
    for(let i=0;i<p.candidate_coverage.length;i++){
      const coverage=p.candidate_coverage[i],b=d.candidate_bindings[i];shape(coverage,['candidate_id','source_identity','fingerprint','work_id','song_id','release_track_keys']);
      demand(coverage.candidate_id===b.candidate_id&&same(coverage.source_identity,b.source_identity)&&same(coverage.fingerprint,b.fingerprint)&&coverage.work_id===binding.resolve(b.work)&&coverage.song_id===binding.resolve(b.song),'Candidate coverage mismatch');
      const keys=b.release_track_refs.map(ref=>plan.operations.find(o=>o.table==='release_tracks'&&o.source.subject.ref===ref)?.key);demand(keys.every(Boolean),'Missing track operation');keys.sort((a,b)=>compareKeys('release_tracks',a,b));ordered(keys,v=>v,(a,b)=>compareKeys('release_tracks',a,b));demand(same(coverage.release_track_keys,keys),'Candidate track key mismatch');
    }
    shape(p.state_transition,['before','consumed','allocation_ranges']);validateFn004State(p.state_transition.before);validateFn004State(p.state_transition.consumed);
    // Range syntax is the existing AllocationEvent schema; structural validation
    // here does not assert that this range was actually consumed by the Plan.
    const rangeState=structuredClone(p.state_transition.consumed);rangeState.allocation_events=p.state_transition.allocation_ranges;
    demand(Array.isArray(rangeState.allocation_events),'Invalid allocation range array');ordered(rangeState.allocation_events,e=>e.namespace);
    for(const event of rangeState.allocation_events){shape(event,['transaction_id','namespace','first','last']);demand(event.transaction_id===p.transaction_id&&Object.hasOwn(rangeState.high_water_marks,event.namespace)&&integer(event.first,1)&&integer(event.last,event.first)&&event.last<=rangeState.high_water_marks[event.namespace],'Invalid allocation range');}
    return record;
  }catch(cause){if(cause instanceof RepositoryError&&cause.code==='HISTORY_CORRUPT')throw cause;throw new RepositoryError('HISTORY_CORRUPT','Invalid successful History record',{cause});}
}
