import { randomUUID } from 'node:crypto';
import { CANONICAL_TABLES,CANONICAL_SCHEMA } from '../../src/canonical-schema.js';
import { hashCanonicalJson } from '../../src/canonical-hash.js';
import { createAuditPayload,createBootstrapRecords,DECLARATION_STATEMENT,hashState } from '../../src/fn004-state.js';
import { emptyMaxima } from '../../src/fn004-id-audit.js';
import { validateCanonicalTables } from '../../src/canonical-validator.js';
import { completeDraft,next,seal } from './decision-lifecycle.js';
import { PLAN_RULES } from '../../src/fn004-history-schema.js';
import { historySemanticHash } from '../../src/fn004-history-projections.js';
const time='2026-10-25T00:00:00Z';
export function historyFixture(){
  const tables=Object.fromEntries(CANONICAL_TABLES.map(t=>[t.name,[]]));
  const files=CANONICAL_TABLES.map(t=>({path:t.path,byte_length:0,sha256:'a'.repeat(64)})).sort((a,b)=>a.path<b.path?-1:1);
  const manifest={schema_version:1,files,manifest_hash:hashCanonicalJson(files)};
  const snapshot={tables,manifest,validation:validateCanonicalTables(tables)};
  const git_audit={git:{authoritative_ref:'origin/main',audited_head:'a'.repeat(40),object_format:'sha1',history_scope:'all_reachable_parents',history_rule_version:1,shallow:false,complete:true,reachable_commit_count:1,root_commits:['a'.repeat(40)]},maxima:emptyMaxima()};
  const namespaces={...emptyMaxima(),W:1,J:1,L:1,G:1};
  const audit_payload=createAuditPayload({...snapshot,current_maxima:emptyMaxima()},git_audit,{schema_version:1,namespaces,statement:DECLARATION_STATEMENT,evidence:[]});
  const {record:bootstrap,state}=createBootstrapRecords({audit_payload,canonical_manifest:manifest,repository_instance_id:`repo_${randomUUID()}`,initialized_at:time,actor:{id:'local:test',assurance:'local_process'},expected_audit_hash:hashCanonicalJson(audit_payload)});
  return {bootstrap,state,snapshot,git_audit,history_directory:{present:false,entries:[]}};
}
export function syntheticSuccess(f,previous=[],{allocate=false,candidate_id}={}){
  const before=structuredClone(f.state),draft=completeDraft(),candidate=candidate_id??`candidate-${previous.length+1}`;
  draft.scope.candidate_ids=[candidate];draft.scope.scope_hash=hashCanonicalJson({schema_version:1,candidate_ids:[candidate]});
  draft.candidate_bindings[0].candidate_id=candidate;draft.evidence[0].candidate_ids=[candidate];draft.evidence[0].source_fingerprints[0].candidate_id=candidate;
  draft.relations.release_tracks[0].track_number=previous.length+1;
  if(allocate){draft.entities.creators.push({local_ref:'creator:c1',evidence_refs:['ev_source'],name:'Author',name_kana:null,notes:null,source_url:null,distinct_from:[]});draft.relations.song_creators.push({local_ref:'song_creator:sc1',evidence_refs:['ev_source'],song:structuredClone(draft.candidate_bindings[0].song),creator:{local_ref:'creator:c1'},role:'lyrics',credit_name:'Author',credit_order:1,source_url:'https://example.org/song'});}
  seal(draft);const d=next(draft,'confirmed'),decision={decision_id:d.decision_id,revision:d.revision,content_hash:d.content_hash};
  const b=d.candidate_bindings[0],id=randomUUID(),apply_id=`apply_${id}`,transaction_id=`tx_${id}`;
  const mappings=allocate?[{entity_type:'creator',local_ref:'creator:c1',namespace:'C',planned_id:`C${String(before.high_water_marks.C+1).padStart(5,'0')}`}]:[];
  const defs=[
    {table:'works',kind:'existing',ref:'W00001',paths:['/candidate_bindings/0/work'],assertions:b.work.assertions,values:{work_id:'W00001',title:'曲',source_url:'https://example.org/song'}},
    ...(allocate?[{table:'creators',kind:'local',ref:'creator:c1',paths:['/entities/creators/0','/relations/song_creators/0/creator'],values:{creator_id:mappings[0].planned_id,name:'Author'}}]:[]),
    {table:'releases',kind:'existing',ref:'L00001',paths:['/relations/release_tracks/0/release'],assertions:d.relations.release_tracks[0].release.assertions,values:{release_id:'L00001',title:'盤',release_type:'single',source_url:'https://example.org/song'}},
    {table:'songs',kind:'existing',ref:'J00001',paths:['/candidate_bindings/0/song',...(allocate?['/relations/song_creators/0/song']:[]),'/relations/release_tracks/0/song'],assertions:b.song.assertions,values:{song_id:'J00001',work_id:'W00001',title:'曲',version_type:'original',source_url:'https://example.org/song'}},
    ...(allocate?[{table:'song_creators',kind:'relation',ref:'song_creator:sc1',paths:['/relations/song_creators/0'],values:{song_id:'J00001',creator_id:mappings[0].planned_id,role:'lyrics',credit_name:'Author',credit_order:'1',source_url:'https://example.org/song'}}]:[]),
    {table:'release_tracks',kind:'relation',ref:'track:t1',paths:['/relations/release_tracks/0'],values:{release_id:'L00001',disc_number:'1',track_number:String(previous.length+1),song_id:'J00001',track_title:'曲',source_url:'https://example.org/song'}}
  ];
  const operations=defs.map(def=>{const subject={kind:def.kind,ref:def.ref};const schema=CANONICAL_SCHEMA[def.table];const values=Object.fromEntries(schema.columns.map(c=>[c.name,def.values[c.name]??(['created_at','updated_at'].includes(c.name)?(def.kind==='local'?{system_binding:'apply_time'}:time):'')]));const key=Object.fromEntries(schema.primaryKey.map(k=>[k,schema.columns.find(c=>c.name===k).type==='integer'?Number(values[k]):values[k]]));return {schema_version:1,operation_id:`op_${hashCanonicalJson({schema_version:1,decision_id:d.decision_id,table:def.table,subject})}`,classification:def.kind==='existing'?'reuse':'insert',table:def.table,source:{subject,decision_paths:def.paths.sort(),candidate_ids:[candidate],evidence_refs:['ev_source']},dependencies:[],key,result:def.kind==='existing'?{existing_id:def.ref,assertions:def.assertions,existing_row:values,row_hash:hashCanonicalJson({table:def.table,row:values}),reason_code:'EXPLICIT_EXISTING_REFERENCE'}:{local_ref:def.ref,planned_id:def.kind==='local'?mappings[0].planned_id:null,row_template:values,reason_code:def.kind==='local'?'NEW_ENTITY':'NEW_RELATION'}};});
  for(const op of operations){const r=op.result.existing_row??op.result.row_template;op.dependencies=CANONICAL_SCHEMA[op.table].foreignKeys.map(fk=>operations.find(target=>target.table===fk.table&&(target.result.existing_row??target.result.row_template)[fk.columns[0]]===r[fk.columns[0]]).operation_id).sort();}
  const payload={schema_version:1,repository_instance_id:before.repository_instance_id,bootstrap_hash:before.bootstrap_hash,rules:PLAN_RULES,decision:{identity:decision,scope_hash:d.scope.scope_hash,registry_hash:'b'.repeat(64)},candidate_preconditions:[{candidate_id:candidate,source_schema_version:1,projection_version:1,source_identity:b.source_identity,fingerprint:b.fingerprint,snapshot_hash:b.fingerprint.value}],canonical_precondition:f.snapshot.manifest,id_state_precondition:{schema_version:1,state_hash:before.state_hash,generation:before.generation,high_water_marks:before.high_water_marks,pending_transaction:null},history_precondition:{schema_version:1,bootstrap_hash:before.bootstrap_hash,count:previous.length,head_hash:previous.at(-1)?.record_hash??before.bootstrap_hash,last_apply_id:previous.at(-1)?.payload.apply_id??null,semantic_hash:historySemanticHash(previous,{repository_instance_id:before.repository_instance_id,bootstrap_hash:before.bootstrap_hash})},planned_id_mappings:mappings,operations,no_op_operations:[],conflicts:[],unsupported_operations:[],validation:{schema_version:1,validator_version:1,performed:true,target_semantic_hash:'c'.repeat(64),diagnostics:[]},applicability:{applicable:true,blocking_diagnostics:[],conflict_operation_ids:[],unsupported_operation_ids:[]}};
  const plan_hash=hashCanonicalJson(payload),plan_snapshot={schema_version:1,plan_id:`ap_${plan_hash}`,generated_at:time,payload,plan_hash};
  const ranges=allocate?[{transaction_id,namespace:'C',first:before.high_water_marks.C+1,last:before.high_water_marks.C+1}]:[];
  const consumed=structuredClone(before);consumed.generation++;consumed.pending_transaction=transaction_id;consumed.allocation_events.push(...ranges);if(allocate)consumed.high_water_marks.C++;consumed.state_hash=hashState(consumed);
  const after=structuredClone(f.snapshot.manifest);after.files[0].byte_length++;after.manifest_hash=hashCanonicalJson(after.files);
  const p={schema_version:1,repository_instance_id:before.repository_instance_id,bootstrap_hash:before.bootstrap_hash,sequence:previous.length+1,previous_history_hash:before.history.head_hash,apply_id,transaction_id,decision,plan:{plan_id:plan_snapshot.plan_id,plan_hash},approval:{approval_id:`apr_${randomUUID()}`,approval_hash:'d'.repeat(64)},request:{request_id:randomUUID(),request_payload_hash:'e'.repeat(64)},actor:{id:'local:test',assurance:'local_process'},candidate_coverage:[{candidate_id:candidate,source_identity:b.source_identity,fingerprint:b.fingerprint,work_id:'W00001',song_id:'J00001',release_track_keys:[operations.at(-1).key]}],id_mappings:mappings.map(({planned_id,...m})=>({...m,canonical_id:planned_id})),results:operations.map(op=>{const row=Object.fromEntries(Object.entries(op.result.existing_row??op.result.row_template).map(([k,v])=>[k,typeof v==='object'?time:v]));return {operation_id:op.operation_id,classification:op.classification,table:op.table,key:op.key,row,row_hash:hashCanonicalJson({table:op.table,row})};}),before_manifest:payload.canonical_precondition,after_manifest:after,state_transition:{before,consumed,allocation_ranges:ranges},apply_time:time,applied_at:time,rules:{plan:PLAN_RULES,transaction:1,history_record:1,history_hash:1,history_chain:1,history_set:1,state_proof:1}};
  const record={schema_version:1,payload:p,record_hash:hashCanonicalJson(p),decision_snapshot:d,plan_snapshot,metadata:{published_at:time}};
  const terminal=structuredClone(consumed);terminal.generation++;terminal.pending_transaction=null;terminal.history={count:p.sequence,head_hash:record.record_hash,last_apply_id:apply_id};terminal.state_hash=hashState(terminal);
  return {record,terminal};
}
export function directory(records,present=true){return {present,entries:records.map(document=>({name:`${document.payload.apply_id}.json`,kind:'file',document})).sort((a,b)=>a.name<b.name?-1:1)};}
