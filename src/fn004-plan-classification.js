import { CANONICAL_SCHEMA } from './canonical-schema.js';
import { validateTypedRef,validateDecisionJudgment } from './fn004-decision-core.js';
import { validateDecisionCanonicalContext } from './fn004-decision-application.js';
import { validateCanonicalTables } from './canonical-validator.js';
import { canonicalJson } from './canonical-hash.js';
import { row,rowHash,compareKeys } from './fn004-history-schema.js';
import { canonicalTypedKey,equivalentCanonicalRows,plannedRowTemplate } from './fn004-plan-primitives.js';
import { RepositoryError } from './persistence.js';
const typeByTable={works:'work',songs:'song',creators:'creator',artists:'artist',releases:'release',members:'member'};
function validateSnapshot(snapshot) {if(!snapshot?.validation?.ok||!validateCanonicalTables(snapshot.tables).ok)throw new RepositoryError('CANONICAL_INVALID','Invalid original canonical snapshot');}
const conflict=(code,requested,existing_rows,evidence_refs)=>({classification:'conflict',result:{code,requested,existing_rows:structuredClone(existing_rows),evidence_refs:[...evidence_refs]}});
// Classification only: no artifact is created and no input row is mutated.
export function classifyExistingReference({table,reference,snapshot}) {
  validateSnapshot(snapshot);validateTypedRef(typeByTable[table],reference);
  if(!reference.existing_id)throw new RepositoryError('PLAN_INTEGRITY_CONFLICT','Expected an explicit existing reference');
  const primary=CANONICAL_SCHEMA[table].primaryKey[0];
  const existing=snapshot.tables[table].find(r=>r[primary]===reference.existing_id);
  const requested={kind:'reference',ref:reference};
  if(!existing)return conflict('EXISTING_ID_MISSING',requested,[],reference.evidence_refs);
  try {validateDecisionCanonicalContext({status:'draft',candidate_bindings:[{[typeByTable[table]]:reference}],entities:{},relations:{}},snapshot.tables);}
  catch(error) {if(error.code!=='EXISTING_IDENTITY_CONFLICT')throw error;return conflict('EXISTING_IDENTITY_CONFLICT',requested,[existing],reference.evidence_refs);}
  return {classification:'reuse',result:{existing_id:reference.existing_id,assertions:structuredClone(reference.assertions),existing_row:structuredClone(existing),row_hash:rowHash(table,existing),reason_code:'EXPLICIT_EXISTING_REFERENCE'}};
}
export function classifyNewEntity({table,judgment,mappings,overflow,snapshot}) {
  validateSnapshot(snapshot);const type=typeByTable[table];validateDecisionJudgment(type,judgment,{confirmed:true});
  const exhausted=overflow.find(r=>r.local_ref===judgment.local_ref);
  if(exhausted)return conflict('ID_CAPACITY_EXHAUSTED',{kind:'allocation',local_ref:judgment.local_ref,namespace:exhausted.namespace},[],judgment.evidence_refs);
  const field=['works','songs','releases'].includes(table)?'title':'name';
  const resolvedWork=judgment.work?.existing_id??mappings.find(m=>m.local_ref===judgment.work?.local_ref)?.planned_id;
  const candidates=snapshot.tables[table].filter(r=>r[field]===judgment[field]&&(table!=='songs'||r.work_id===resolvedWork));
  const unresolved=candidates.filter(r=>!judgment.distinct_from.some(d=>d.target.existing_id===r[`${type}_id`]&&d.evidence_refs.length>0));
  const template=plannedRowTemplate(table,judgment,mappings);
  if(unresolved.length)return conflict('DUPLICATE_IDENTITY_UNREVIEWED',{kind:'row',row_template:template},unresolved.sort((a,b)=>compareKeys(table,canonicalTypedKey(table,a),canonicalTypedKey(table,b))),judgment.evidence_refs);
  return {classification:'insert',result:{local_ref:judgment.local_ref,planned_id:mappings.find(m=>m.local_ref===judgment.local_ref)?.planned_id??null,row_template:template,reason_code:'NEW_ENTITY'}};
}
export function classifyRelation({table,judgment,mappings,snapshot}) {
  validateSnapshot(snapshot);
  const type={song_artists:'song_artist',song_creators:'song_creator',song_performers:'song_performer',release_tracks:'track'}[table];
  validateDecisionJudgment(type,judgment,{confirmed:true});
  const requested_row=plannedRowTemplate(table,judgment,mappings),key=canonicalTypedKey(table,requested_row),schema=CANONICAL_SCHEMA[table];
  const current=snapshot.tables[table],pk=current.find(r=>canonicalJson(canonicalTypedKey(table,r))===canonicalJson(key));
  const requested={kind:'row',row_template:requested_row};
  if(pk&&!equivalentCanonicalRows(table,requested_row,pk))return conflict('RELATION_PK_CONTENT_CONFLICT',requested,[pk],judgment.evidence_refs);
  const orderConflicts=current.filter(r=>r!==pk&&schema.orders.some(o=>requested_row[o.column]!==''&&r[o.column]!==''&&BigInt(requested_row[o.column])===BigInt(r[o.column])&&o.scope.every(k=>requested_row[k]===r[k])));
  if(orderConflicts.length)return conflict('RELATION_ORDER_CONFLICT',requested,orderConflicts.sort((a,b)=>compareKeys(table,canonicalTypedKey(table,a),canonicalTypedKey(table,b))),judgment.evidence_refs);
  if(pk)return {classification:'no_op',result:{requested_row,existing_row:structuredClone(pk),row_hash:rowHash(table,pk),reason_code:'RELATION_ALL_COLUMNS_EQUAL'}};
  return {classification:'insert',result:{local_ref:judgment.local_ref,planned_id:null,row_template:requested_row,reason_code:'NEW_RELATION'}};
}
