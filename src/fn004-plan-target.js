import { canonicalJson,hashCanonicalJson } from './canonical-hash.js';
import { CANONICAL_TABLES,CANONICAL_SCHEMA } from './canonical-schema.js';
import { validateCanonicalTables } from './canonical-validator.js';
import { row,compareKeys,TABLE_ORDER } from './fn004-history-schema.js';
import { canonicalTypedKey } from './fn004-plan-primitives.js';
import { RepositoryError } from './persistence.js';
const conflictCodes=['EXISTING_IDENTITY_CONFLICT','EXISTING_ID_MISSING','DUPLICATE_IDENTITY_UNREVIEWED','RELATION_PK_CONTENT_CONFLICT','RELATION_ORDER_CONFLICT','ID_CAPACITY_EXHAUSTED','DUPLICATE_DECISION_REQUIREMENT'];
const unsupportedCodes=['NEW_MEMBER','EXISTING_UPDATE','DELETE','MEMBER_AFFILIATION','VIDEO','LARGE_CORRECTION'];
const demand=(ok,message)=>{if(!ok)throw new RepositoryError('PLAN_INTEGRITY_CONFLICT',message);};
const sortedDiagnostics=items=>[...new Map(items.map(d=>[canonicalJson(d),d])).entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,d])=>d);
export function operationDiagnostics(operations) {
  const diagnostics=[];
  for(const op of operations) {
    demand(['reuse','insert','no_op','conflict','unsupported'].includes(op.classification),'Unknown operation classification');
    if(!['conflict','unsupported'].includes(op.classification))continue;
    demand((op.classification==='conflict'?conflictCodes:unsupportedCodes).includes(op.result.code),'Unknown diagnostic code');
    diagnostics.push({severity:'error',code:op.result.code,target:op.operation_id,decision_path:op.source.decision_paths[0]??null,evidence_refs:[...op.source.evidence_refs],canonical:null});
  }
  return sortedDiagnostics(diagnostics);
}
export function planApplicability(operations,validation) {
  const conflicts=operations.filter(o=>o.classification==='conflict').map(o=>o.operation_id);
  const unsupported=operations.filter(o=>o.classification==='unsupported').map(o=>o.operation_id);
  const blocking=validation.diagnostics.filter(d=>d.severity==='error');
  return {applicable:validation.performed&&blocking.length===0&&conflicts.length===0&&unsupported.length===0,blocking_diagnostics:blocking,conflict_operation_ids:conflicts,unsupported_operation_ids:unsupported};
}

// Pure target checking only. It does not certify Decision effectiveness, bind
// preconditions, validate an entire Plan artifact, or authorize publication.
export function validateHypotheticalTarget({snapshot,operations,unplanned=[]}) {
  demand(Array.isArray(operations)&&Array.isArray(unplanned),'Expected operation/diagnostic arrays');
  if(!snapshot?.validation?.ok||!validateCanonicalTables(snapshot.tables).ok)throw new RepositoryError('CANONICAL_INVALID','Original snapshot is invalid');
  for(const d of unplanned)demand(d.severity==='error'&&d.code==='REQUIREMENT_UNPLANNED','Expected missing-requirement diagnostic');
  const diagnostics=[...operationDiagnostics(operations),...unplanned];
  const unresolved=unplanned.length>0||operations.some(o=>o.classification==='conflict'&&o.result.requested?.kind==='allocation');
  if(unresolved) {
    const validation={schema_version:1,validator_version:1,performed:false,target_semantic_hash:null,diagnostics:sortedDiagnostics(diagnostics)};
    return {validation,applicability:planApplicability(operations,validation)};
  }
  const templates=structuredClone(snapshot.tables);
  const inserts=new Map(CANONICAL_TABLES.map(t=>[t.name,[]]));
  for(const op of operations.filter(o=>o.classification==='insert')) {
    demand(TABLE_ORDER.indexOf(op.table)>=0&&TABLE_ORDER.indexOf(op.table)<9,'Insert table is outside v1');
    const template=op.result.row_template;
    row(op.table,template,CANONICAL_SCHEMA[op.table].columns.some(c=>c.name==='created_at'));
    canonicalTypedKey(op.table,template);inserts.get(op.table).push(structuredClone(template));
  }
  const compare=(table,a,b)=>compareKeys(table,canonicalTypedKey(table,a),canonicalTypedKey(table,b));
  for(const [table,rows] of inserts)templates[table].push(...rows.sort((a,b)=>compare(table,a,b)));
  const checkTables=Object.fromEntries(Object.entries(templates).map(([table,rows])=>[table,rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='object'?'2000-01-01T00:00:00Z':v])))]));
  const checked=validateCanonicalTables(checkTables);
  for(const d of checked.diagnostics) {
    const canonical={code:d.code,file:d.file??null,table:d.table??null,row:d.row??null,column:d.column??null,key:d.key===undefined?null:typeof d.key==='string'?d.key:typeof d.key==='number'?String(d.key):canonicalJson(d.key)};
    diagnostics.push({severity:'error',code:'CANONICAL_TARGET_INVALID',target:null,decision_path:null,evidence_refs:[],canonical});
  }
  const projection={schema_version:1,tables:[...CANONICAL_TABLES].sort((a,b)=>a.path<b.path?-1:1).map(t=>({table:t.name,rows:[...templates[t.name]].sort((a,b)=>compare(t.name,a,b))}))};
  const validation={schema_version:1,validator_version:1,performed:true,target_semantic_hash:hashCanonicalJson(projection),diagnostics:sortedDiagnostics(diagnostics)};
  return {validation,applicability:planApplicability(operations,validation)};
}
