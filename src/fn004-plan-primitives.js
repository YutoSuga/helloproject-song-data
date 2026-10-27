import { canonicalJson, hashCanonicalJson } from './canonical-hash.js';
import { CANONICAL_SCHEMA, ID_PATTERNS } from './canonical-schema.js';
import { validateDecisionIdentity, validateDecisionJudgment, validateTypedRef } from './fn004-decision-core.js';
import { validateNamespaceMap } from './fn004-state.js';
import { RepositoryError } from './persistence.js';
import { TABLE_ORDER, compareKeys, row, rowKey } from './fn004-history-schema.js';
export { PLAN_RULES } from './fn004-history-schema.js';

const rank = { work:0, creator:1, artist:2, release:3, song:4 };
const tables = { work:'works', creator:'creators', artist:'artists', release:'releases', song:'songs' };
const prefixes = { work:'W', creator:'C', artist:'G', release:'L' };
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
function demand(ok,message,code='PLAN_INTEGRITY_CONFLICT') { if(!ok) throw new RepositoryError(code,message); }
function closed(value,keys) { demand(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'Unexpected/missing fields'); }
const compareAllocation=(a,b)=>rank[a.entity_type]-rank[b.entity_type]||cmp(a.namespace,b.namespace)||cmp(a.local_ref,b.local_ref);
function allocationRequests(entities) {
  canonicalJson(entities);closed(entities,Object.values(tables));
  const requests=[],refs=new Set();
  for(const [type,table] of Object.entries(tables)) {
    demand(Array.isArray(entities[table]),'Expected entity judgment array');
    for(const judgment of entities[table]) {
      validateDecisionJudgment(type,judgment,{confirmed:true});
      demand(!refs.has(judgment.local_ref),'Duplicate local ref');refs.add(judgment.local_ref);
      requests.push({entity_type:type,local_ref:judgment.local_ref,namespace:type==='song'?judgment.song_id_prefix:prefixes[type]});
    }
  }
  return requests.sort(compareAllocation);
}

// Allocation is a pure proposal. No reservation, state/generation update, or
// allocation event is produced. Overflow excludes the ENTIRE namespace.
export function allocatePlannedIds({entities,canonical_maxima,high_water_marks}) {
  validateNamespaceMap(canonical_maxima);validateNamespaceMap(high_water_marks);
  const requests=allocationRequests(entities),counts=new Map();
  for(const r of requests)counts.set(r.namespace,(counts.get(r.namespace)??0)+1);
  const next=Object.fromEntries(Object.keys(high_water_marks).map(n=>[n,Math.max(canonical_maxima[n],high_water_marks[n])]));
  const exhausted=new Set([...counts].filter(([n,count])=>next[n]+count>99999).map(([n])=>n));
  const planned_id_mappings=[],overflow=[];
  for(const r of requests) {
    if(exhausted.has(r.namespace)){overflow.push({...r});continue;}
    planned_id_mappings.push({...r,planned_id:`${r.namespace}${String(++next[r.namespace]).padStart(5,'0')}`});
  }
  validatePlannedIdRegistry(planned_id_mappings,{entities,overflow});
  return {planned_id_mappings,overflow};
}
export function validatePlannedIdRegistry(mappings,{entities,overflow=[]}) {
  const requests=allocationRequests(entities),byRef=new Map(requests.map(r=>[r.local_ref,r]));
  demand(Array.isArray(mappings)&&Array.isArray(overflow),'Expected allocation registry arrays');
  const refs=new Set(),ids=new Set(),excluded=new Set();
  for(const r of overflow){closed(r,['entity_type','local_ref','namespace']);const expected=byRef.get(r.local_ref);demand(expected&&canonicalJson(r)===canonicalJson(expected)&&!excluded.has(r.local_ref),'Invalid overflow entry');excluded.add(r.local_ref);}
  for(let i=0;i<mappings.length;i++) {
    const m=mappings[i];closed(m,['entity_type','local_ref','namespace','planned_id']);const expected=byRef.get(m.local_ref);
    demand(expected&&m.entity_type===expected.entity_type&&m.namespace===expected.namespace&&!refs.has(m.local_ref)&&!excluded.has(m.local_ref),'Invalid mapping identity/namespace');
    demand(typeof m.planned_id==='string'&&ID_PATTERNS[tables[m.entity_type]].test(m.planned_id)&&m.planned_id[0]===m.namespace&&Number(m.planned_id.slice(1))>0&&!ids.has(m.planned_id),'Invalid/colliding planned ID');
    demand(i===0||compareAllocation(mappings[i-1],m)<0,'Noncanonical allocation order');refs.add(m.local_ref);ids.add(m.planned_id);
  }
  demand(refs.size+excluded.size===requests.length,'Partial registry without explicit overflow');
  for(const r of requests)if(excluded.has(r.local_ref))demand(requests.filter(x=>x.namespace===r.namespace).every(x=>excluded.has(x.local_ref)),'Partially allocated exhausted namespace');
  return mappings;
}

const relationRefs={song_artists:/^song_artist:sa[1-9][0-9]*$/,song_creators:/^song_creator:sc[1-9][0-9]*$/,song_performers:/^song_performer:sp[1-9][0-9]*$/,release_tracks:/^track:t[1-9][0-9]*$/};
const refTypes={works:'work',creators:'creator',artists:'artist',releases:'release',songs:'song'};
export function canonicalOperationId(decisionId,table,subject) {
  validateDecisionIdentity({decision_id:decisionId,revision:1,content_hash:'0'.repeat(64)});
  closed(subject,['kind','ref']);demand(Object.hasOwn(CANONICAL_SCHEMA,table)&&typeof subject.ref==='string','Invalid operation subject');
  if(subject.kind==='local'){demand(Object.hasOwn(refTypes,table),'Unsupported local master');validateTypedRef(refTypes[table],{local_ref:subject.ref});}
  else if(subject.kind==='existing')demand(Object.hasOwn(ID_PATTERNS,table)&&ID_PATTERNS[table].test(subject.ref),'Invalid existing subject');
  else if(subject.kind==='relation')demand(Object.hasOwn(relationRefs,table)&&relationRefs[table].test(subject.ref),'Invalid relation subject');
  else demand(subject.kind==='unsupported'&&/^unsupported:u[1-9][0-9]*$/.test(subject.ref),'Invalid unsupported subject');
  return `op_${hashCanonicalJson({schema_version:1,decision_id:decisionId,table,subject})}`;
}
export function comparePlanOperations(a,b,decision) {
  const sa=a.source.subject,sb=b.source.subject;
  let n=cmp(TABLE_ORDER.indexOf(a.table),TABLE_ORDER.indexOf(b.table));if(n)return n;
  if(a.table==='songs') {
    const prefix=op=>op.key?.song_id?.[0]??decision?.entities.songs.find(s=>s.local_ref===op.source.subject.ref)?.song_id_prefix??op.result?.requested?.namespace??'';
    n=cmp(prefix(a),prefix(b));if(n)return n;
  }
  n=cmp(['local','existing','relation','unsupported'].indexOf(sa.kind),['local','existing','relation','unsupported'].indexOf(sb.kind));if(n)return n;
  if(sa.kind==='relation')n=a.key===null?(b.key===null?0:1):b.key===null?-1:compareKeys(a.table,a.key,b.key);
  else n=cmp(sa.ref,sb.ref);
  return n||cmp(sa.ref,sb.ref)||cmp(a.operation_id,b.operation_id);
}
export function plannedRowTemplate(table,judgment,mappings) {
  demand(Object.hasOwn(CANONICAL_SCHEMA,table)&&TABLE_ORDER.indexOf(table)<9,'Insert table is outside v1');
  const registry=new Map(mappings.map(m=>[m.local_ref,m.planned_id]));
  const singular={works:'work',songs:'song',creators:'creator',artists:'artist',releases:'release',members:'member'};
  const master=Object.hasOwn(ID_PATTERNS,table);
  const result=Object.fromEntries(CANONICAL_SCHEMA[table].columns.map(c=>{
    let value;
    if(master&&['created_at','updated_at'].includes(c.name))value={system_binding:'apply_time'};
    else if(c.type==='id') {const ref=judgment[singular[c.target]];value=master&&c.target===table?registry.get(judgment.local_ref):ref?.existing_id??registry.get(ref?.local_ref);}
    else {const v=judgment[c.name];demand(v!==undefined,'Missing judgment field');if(c.type==='integer'&&v!==null)demand(Number.isSafeInteger(v),'Unrepresentable integer','PLAN_INTEGER_UNREPRESENTABLE');value=v===null?'':String(v);}
    demand(value!==undefined,'Unresolved planned row dependency');return[c.name,value];
  }));
  row(table,result,master);return result;
}
export function canonicalTypedKey(table,value) {
  demand(Object.hasOwn(CANONICAL_SCHEMA,table),'Unknown table');
  for(const c of CANONICAL_SCHEMA[table].columns.filter(c=>c.type==='integer'&&CANONICAL_SCHEMA[table].primaryKey.includes(c.name))) {
    const v=value[c.name];demand(typeof v==='string'&&/^[0-9]+$/.test(v)&&BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER),'Unrepresentable integer PK','PLAN_INTEGER_UNREPRESENTABLE');
  }
  return rowKey(table,value);
}

// Callers validate row shape first. Only integer spelling is normalized for
// comparison; every other CSV string is compared exactly, including notes/URL.
export function equivalentCanonicalRows(table,a,b) {
  return CANONICAL_SCHEMA[table].columns.every(c=>c.type==='integer'?BigInt(a[c.name]||'0')===BigInt(b[c.name]||'0'):a[c.name]===b[c.name]);
}
export const applyPlanHash=payload=>hashCanonicalJson(payload);
export const applyPlanId=payload=>`ap_${applyPlanHash(payload)}`;
