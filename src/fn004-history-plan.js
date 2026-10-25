// Static verification of an embedded successful Plan only. No planning,
// allocation, target reconstruction, repository access or publication.
import { hashCanonicalJson, canonicalJson } from './canonical-hash.js';
import { CANONICAL_SCHEMA, ID_PATTERNS } from './canonical-schema.js';
import { validateDecisionIdentity } from './fn004-decision-core.js';
import { APPLY_ID_PATTERN } from './fn004-history-directory.js';
import { validateNamespaceMap } from './fn004-state.js';
import { demand,shape,same,ordered,hash,text,integer,timestamp,manifest,row,rowKey,rowHash,validateKey,compareKeys,PLAN_RULES,TABLE_ORDER,singular,masterTables,refKey,cmp } from './fn004-history-schema.js';
const tupleKey=(table,ref)=>`${table}/${ref}`;
const pointer=parts=>'/'+parts.map(p=>String(p).replaceAll('~','~0').replaceAll('/','~1')).join('/');
function requirements(d){
  const defs=new Map(),requests=new Map();
  for(const [table,rows] of Object.entries({...d.entities,...d.relations}))rows.forEach((v,i)=>defs.set(v.local_ref,{table,value:v,path:pointer([Object.hasOwn(d.entities,table)?'entities':'relations',table,i])}));
  function add(table,ref,path,node){const k=tupleKey(table,ref);if(!requests.has(k))requests.set(k,{table,ref,paths:[],nodes:[],candidates:new Set()});const r=requests.get(k);r.paths.push(path);r.nodes.push(node);}
  for(const [ref,def] of defs)add(def.table,ref,def.path,def.value);
  function scan(v,path=[]){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((n,i)=>scan(n,[...path,i]));return;}
    if(Object.hasOwn(v,'assertions')){const table=Object.keys(ID_PATTERNS).find(t=>ID_PATTERNS[t].test(v.existing_id));add(table,v.existing_id,pointer(path),v);}
    else if(Object.keys(v).length===1&&v.local_ref){const def=defs.get(v.local_ref);demand(def,'Missing local definition');add(def.table,v.local_ref,pointer(path),v);}
    for(const [k,n]of Object.entries(v))if(k!=='distinct_from')scan(n,[...path,k]);
  }
  scan(d.candidate_bindings,['candidate_bindings']);scan(d.entities,['entities']);scan(d.relations,['relations']);
  function reach(table,ref,id,visited){if(!ref)return;const k=tupleKey(table,ref);if(visited.has(k))return;visited.add(k);const request=requests.get(k);demand(request,'Unresolved requirement');request.candidates.add(id);const def=defs.get(ref)?.value;if(def?.work)reach('works',refKey(def.work),id,visited);
    if(table==='songs'){for(const [rel,rows]of Object.entries(d.relations))if(rel!=='release_tracks'&&(rel!=='song_performers'||d.candidate_bindings.find(b=>b.candidate_id===id).performer_review==='specified'))for(const r of rows)if(refKey(r.song)===ref)reach(rel,r.local_ref,id,visited);}
    if(def)for(const c of CANONICAL_SCHEMA[table].columns)if(c.type==='id'&&c.target!==table)reach(c.target,refKey(def[singular[c.target]]),id,visited);
  }
  for(const b of d.candidate_bindings){const visited=new Set();reach('works',refKey(b.work),b.candidate_id,visited);reach('songs',refKey(b.song),b.candidate_id,visited);for(const t of b.release_track_refs)reach('release_tracks',t,b.candidate_id,visited);}
  for(const r of requests.values()){demand(r.candidates.size>0,'Unreachable Plan requirement');r.paths.sort();r.evidence=[...new Set(r.nodes.flatMap(v=>v.evidence_refs??[]))].sort();}
  return {defs,requests};
}
export function validateStoredSuccessfulPlan(plan,d){
  shape(plan,['schema_version','plan_id','generated_at','payload','plan_hash']);timestamp(plan.generated_at);
  demand(plan.schema_version===1&&hash(plan.plan_hash)&&plan.plan_id===`ap_${plan.plan_hash}`&&hashCanonicalJson(plan.payload)===plan.plan_hash,'Invalid embedded Plan hash/ID');
  const p=plan.payload;
  shape(p,['schema_version','repository_instance_id','bootstrap_hash','rules','decision','candidate_preconditions','canonical_precondition','id_state_precondition','history_precondition','planned_id_mappings','operations','no_op_operations','conflicts','unsupported_operations','validation','applicability']);
  demand(p.schema_version===1&&same(p.rules,PLAN_RULES),'Unsupported Plan version/rules');
  shape(p.decision,['identity','scope_hash','registry_hash']);validateDecisionIdentity(p.decision.identity);
  demand(same(p.decision.identity,{decision_id:d.decision_id,revision:d.revision,content_hash:d.content_hash})&&p.decision.scope_hash===d.scope.scope_hash&&hash(p.decision.registry_hash),'Plan Decision binding mismatch');
  demand(same(p.candidate_preconditions,d.candidate_bindings.map(b=>({candidate_id:b.candidate_id,source_schema_version:1,projection_version:1,source_identity:b.source_identity,fingerprint:b.fingerprint,snapshot_hash:b.fingerprint.value}))),'Plan candidate snapshot mismatch');
  manifest(p.canonical_precondition);
  const state=p.id_state_precondition;shape(state,['schema_version','state_hash','generation','high_water_marks','pending_transaction']);validateNamespaceMap(state.high_water_marks);
  demand(state.schema_version===1&&hash(state.state_hash)&&integer(state.generation)&&state.pending_transaction===null,'Invalid Plan state precondition');
  shape(p.history_precondition,['schema_version','bootstrap_hash','count','head_hash','last_apply_id','semantic_hash']);
  demand(p.history_precondition.schema_version===1&&integer(p.history_precondition.count)&&hash(p.history_precondition.bootstrap_hash)&&hash(p.history_precondition.head_hash)&&hash(p.history_precondition.semantic_hash),'Invalid History precondition');
  const history=p.history_precondition;
  demand(history.bootstrap_hash===p.bootstrap_hash&&(history.count===0?history.last_apply_id===null&&history.head_hash===p.bootstrap_hash:typeof history.last_apply_id==='string'&&APPLY_ID_PATTERN.test(history.last_apply_id)),'Invalid History prefix identity');
  const {defs,requests}=requirements(d),mappings=new Map(),ids=new Set();
  ordered(p.planned_id_mappings,m=>[Object.keys(masterTables).indexOf(m.entity_type),m.namespace,m.local_ref].map(String).join('/'));
  for(const m of p.planned_id_mappings){shape(m,['entity_type','local_ref','namespace','planned_id']);const table=masterTables[m.entity_type],def=defs.get(m.local_ref);
    demand(table&&table!=='members'&&def?.table===table&&!mappings.has(m.local_ref)&&typeof m.planned_id==='string'&&ID_PATTERNS[table].test(m.planned_id)&&m.namespace===m.planned_id[0]&&!ids.has(m.planned_id),'Invalid Plan mapping');
    demand(m.namespace===(table==='songs'?def.value.song_id_prefix:{works:'W',creators:'C',artists:'G',releases:'L'}[table]),'Mapping namespace mismatch');mappings.set(m.local_ref,m.planned_id);ids.add(m.planned_id);
  }
  const resolve=ref=>ref?.existing_id??mappings.get(ref?.local_ref);
  function expectedRow(def){return Object.fromEntries(CANONICAL_SCHEMA[def.table].columns.map(c=>{let value;if(['created_at','updated_at'].includes(c.name))value={system_binding:'apply_time'};
    else if(c.type==='id')value=c.target===def.table?mappings.get(def.value.local_ref):resolve(def.value[singular[c.target]]);
    else value=def.value[c.name]===null?'':String(def.value[c.name]);demand(value!==undefined,'Missing row mapping');return[c.name,value];}));}
  demand(p.planned_id_mappings.length===Object.values(d.entities).flat().length,'Incomplete master mapping set');
  demand(Array.isArray(p.operations)&&p.operations.length===requests.size,'Incomplete Plan operations');
  const operations=new Map(),byRequest=new Map(),actualRows=new Map();
  function operationCompare(a,b){const sa=a.source.subject,sb=b.source.subject;let n=cmp(TABLE_ORDER.indexOf(a.table),TABLE_ORDER.indexOf(b.table));if(n)return n;
    if(a.table==='songs'){n=cmp(a.key.song_id[0],b.key.song_id[0]);if(n)return n;}
    n=cmp(['local','existing','relation'].indexOf(sa.kind),['local','existing','relation'].indexOf(sb.kind));if(n)return n;
    n=sa.kind==='relation'?compareKeys(a.table,a.key,b.key):cmp(sa.ref,sb.ref);return n||cmp(sa.ref,sb.ref)||cmp(a.operation_id,b.operation_id);}
  for(const op of p.operations){shape(op,['schema_version','operation_id','classification','table','source','dependencies','key','result']);demand(op.schema_version===1&&['reuse','insert','no_op'].includes(op.classification)&&TABLE_ORDER.indexOf(op.table)>=0,'Invalid successful operation');
    shape(op.source,['subject','decision_paths','candidate_ids','evidence_refs']);shape(op.source.subject,['kind','ref']);const subject=op.source.subject,r=requests.get(tupleKey(op.table,subject.ref));
    demand(r&&!byRequest.has(tupleKey(op.table,subject.ref)),'Unknown/duplicate operation subject');demand(subject.kind===(defs.has(subject.ref)?(singular[op.table]?'local':'relation'):'existing'),'Wrong subject variant');
    demand(op.operation_id===`op_${hashCanonicalJson({schema_version:1,decision_id:d.decision_id,table:op.table,subject})}`&&!operations.has(op.operation_id),'Invalid operation identity');
    demand(same(op.source.decision_paths,r.paths)&&same(op.source.candidate_ids,[...r.candidates].sort())&&same(op.source.evidence_refs,r.evidence),'Invalid operation source graph');
    ordered(op.dependencies);op.dependencies.forEach(id=>demand(typeof id==='string'&&/^op_[0-9a-f]{64}$/.test(id),'Malformed dependency'));validateKey(op.table,op.key);
    const result=op.result,def=defs.get(subject.ref);
    if(op.classification==='reuse'){
      shape(result,['existing_id','assertions','existing_row','row_hash','reason_code']);demand(subject.kind==='existing'&&result.existing_id===subject.ref&&result.reason_code==='EXPLICIT_EXISTING_REFERENCE','Invalid reuse');row(op.table,result.existing_row);demand(result.existing_row[CANONICAL_SCHEMA[op.table].primaryKey[0]]===subject.ref,'Reuse ID/row mismatch');
      demand(same(result.assertions,r.nodes[0].assertions)&&result.row_hash===rowHash(op.table,result.existing_row),'Reuse assertion/hash mismatch');
      for(const [k,v]of Object.entries(result.assertions))if(k!=='primary_artist_ids')demand(same(result.existing_row[k]===''?null:result.existing_row[k],v),'Reuse row contradicts assertions');actualRows.set(op.operation_id,result.existing_row);
    }else if(op.classification==='insert'){
      shape(result,['local_ref','planned_id','row_template','reason_code']);demand(def&&result.local_ref===subject.ref&&result.planned_id===(mappings.get(subject.ref)??null)&&result.reason_code===(subject.kind==='local'?'NEW_ENTITY':'NEW_RELATION'),'Invalid insert');
      row(op.table,result.row_template,subject.kind==='local');demand(same(result.row_template,expectedRow(def)),'Template differs from Decision');actualRows.set(op.operation_id,result.row_template);
    }else{
      shape(result,['requested_row','existing_row','row_hash','reason_code']);demand(subject.kind==='relation'&&result.reason_code==='RELATION_ALL_COLUMNS_EQUAL','Invalid no_op');row(op.table,result.requested_row);row(op.table,result.existing_row);
      demand(same(result.requested_row,expectedRow(def))&&result.row_hash===rowHash(op.table,result.existing_row),'Invalid no_op requested row/hash');
      for(const c of CANONICAL_SCHEMA[op.table].columns)demand(c.type==='integer'?BigInt(result.requested_row[c.name]||'0')===BigInt(result.existing_row[c.name]||'0'):result.requested_row[c.name]===result.existing_row[c.name],'no_op row mismatch');actualRows.set(op.operation_id,result.existing_row);
    }
    demand(same(op.key,rowKey(op.table,actualRows.get(op.operation_id))),'Operation key/row mismatch');operations.set(op.operation_id,op);byRequest.set(tupleKey(op.table,subject.ref),op);
  }
  ordered(p.operations,v=>v,operationCompare);
  for(const op of p.operations){const dependencies=[];const s=CANONICAL_SCHEMA[op.table],row=actualRows.get(op.operation_id);
    for(const fk of s.foreignKeys){const col=fk.columns[0],id=row[col];if(id==='')continue;const target=[...operations.values()].find(o=>o.table===fk.table&&actualRows.get(o.operation_id)[col]===id);demand(target,'Missing foreign-key requirement');dependencies.push(target.operation_id);}
    demand(same(op.dependencies,[...new Set(dependencies)].sort()),'Dependency set mismatch');
  }
  const primaryKeys=new Set(),orderKeys=new Set();
  for(const op of p.operations){const s=CANONICAL_SCHEMA[op.table],r=actualRows.get(op.operation_id),pk=canonicalJson([op.table,op.key]);demand(!primaryKeys.has(pk),'Duplicate operation PK');primaryKeys.add(pk);
    for(const order of s.orders??[]){if(r[order.column]==='')continue;const n=Number(r[order.column]);demand(Number.isSafeInteger(n),'Unrepresentable order');const k=canonicalJson([op.table,order.column,...order.scope.map(c=>r[c]),n]);demand(!orderKeys.has(k),'Duplicate operation order');orderKeys.add(k);}
  }
  const visited=new Set(),active=new Set();function visit(id){demand(!active.has(id),'Dependency cycle');if(visited.has(id))return;demand(operations.has(id),'Unresolved dependency');active.add(id);operations.get(id).dependencies.forEach(visit);active.delete(id);visited.add(id);}for(const id of operations.keys())visit(id);
  demand(same(p.no_op_operations,p.operations.filter(o=>o.classification==='no_op').map(o=>o.operation_id))&&same(p.conflicts,[])&&same(p.unsupported_operations,[]),'Invalid classification indexes');
  shape(p.validation,['schema_version','validator_version','performed','target_semantic_hash','diagnostics']);demand(p.validation.schema_version===1&&p.validation.validator_version===1&&p.validation.performed===true&&hash(p.validation.target_semantic_hash),'Missing successful validation');
  ordered(p.validation.diagnostics,v=>canonicalJson(v));
  const codes=('EXISTING_IDENTITY_CONFLICT EXISTING_ID_MISSING DUPLICATE_IDENTITY_UNREVIEWED RELATION_PK_CONTENT_CONFLICT RELATION_ORDER_CONFLICT ID_CAPACITY_EXHAUSTED DUPLICATE_DECISION_REQUIREMENT NEW_MEMBER EXISTING_UPDATE DELETE MEMBER_AFFILIATION VIDEO LARGE_CORRECTION CANONICAL_TARGET_INVALID REQUIREMENT_UNPLANNED DECISION_NOT_EFFECTIVE CANDIDATE_FINGERPRINT_MISMATCH STALE_PLAN UNSUPPORTED_OPERATION').split(' ');
  for(const diag of p.validation.diagnostics){shape(diag,['severity','code','target','decision_path','evidence_refs','canonical']);demand(diag.severity==='warning'&&codes.includes(diag.code)&&(diag.target===null||operations.has(diag.target))&&(diag.decision_path===null||typeof diag.decision_path==='string'),'Invalid success diagnostic');ordered(diag.evidence_refs);demand(diag.evidence_refs.every(id=>d.evidence.some(e=>e.evidence_id===id)),'Dangling diagnostic evidence');if(diag.canonical!==null){demand(diag.code==='CANONICAL_TARGET_INVALID','Unexpected canonical diagnostic');shape(diag.canonical,['code','file','table','row','column','key']);demand(text(diag.canonical.code)&&['file','column','key'].every(k=>diag.canonical[k]===null||typeof diag.canonical[k]==='string')&&(diag.canonical.table===null||CANONICAL_SCHEMA[diag.canonical.table])&&(diag.canonical.row===null||integer(diag.canonical.row,1)),'Invalid canonical diagnostic');}}
  shape(p.applicability,['applicable','blocking_diagnostics','conflict_operation_ids','unsupported_operation_ids']);demand(same(p.applicability,{applicable:true,blocking_diagnostics:[],conflict_operation_ids:[],unsupported_operation_ids:[]}),'Non-applicable saved Plan');
  return {mappings,operations,resolve};
}
