import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CANONICAL_SCHEMA,CANONICAL_TABLES } from '../src/canonical-schema.js';
import { validateCanonicalTables } from '../src/canonical-validator.js';
import { emptyMaxima,currentIdMaxima } from '../src/fn004-id-audit.js';
import { hashCanonicalJson } from '../src/canonical-hash.js';
import { allocatePlannedIds,validatePlannedIdRegistry,canonicalOperationId,comparePlanOperations,plannedRowTemplate,canonicalTypedKey,applyPlanHash,applyPlanId } from '../src/fn004-plan-primitives.js';
import { classifyExistingReference,classifyNewEntity,classifyRelation } from '../src/fn004-plan-classification.js';
import { validateHypotheticalTarget } from '../src/fn004-plan-target.js';
const url='https://example.org/source',evidence_refs=['ev_source'];
const work=(local_ref,title=local_ref)=>({local_ref,evidence_refs,title,title_kana:null,notes:null,source_url:url,distinct_from:[]});
const ref=(existing_id,assertions)=>({existing_id,assertions,evidence_refs});
const song=(local_ref,prefix='J')=>({local_ref,evidence_refs,work:ref('W00001',{title:'Old'}),title:local_ref,version_name:null,version_type:'cover',release_date:null,notes:null,source_url:url,song_id_prefix:prefix,distinct_from:[]});
const entities=(works=[],songs=[])=>({works,creators:[],artists:[],releases:[],songs});
function csvRow(table,values){return Object.fromEntries(CANONICAL_SCHEMA[table].columns.map(c=>[c.name,values[c.name]??(['created_at','updated_at'].includes(c.name)?'2026-10-25T00:00:00Z':'')]));}
function snapshot(){const tables=Object.fromEntries(CANONICAL_TABLES.map(t=>[t.name,[]]));
  tables.works=[csvRow('works',{work_id:'W00001',title:'Old',source_url:url})];tables.artists=[csvRow('artists',{artist_id:'G00001',name:'Artist',type:'group'})];
  tables.songs=[csvRow('songs',{song_id:'J00001',work_id:'W00001',title:'Song',version_type:'original',source_url:url})];tables.song_artists=[csvRow('song_artists',{song_id:'J00001',artist_id:'G00001',role:'primary',source_url:url})];tables.releases=[csvRow('releases',{release_id:'L00001',title:'Disc',release_type:'single',source_url:url})];
  return {tables,validation:validateCanonicalTables(tables)};
}
const track=()=>({local_ref:'track:t1',evidence_refs,release:ref('L00001',{title:'Disc',release_type:'single',release_date:null,catalog_number:null}),disc_number:1,track_number:1,song:ref('J00001',{work_id:'W00001',title:'Song',version_name:null,version_type:'original',primary_artist_ids:['G00001']}),track_title:'Track',notes:null,source_url:url});
const op=(table,classification,result,i=1)=>({schema_version:1,operation_id:`op_${String(i).padStart(64,'0')}`,classification,table,source:{subject:{kind:'local',ref:'work:w1'},decision_paths:['/entities/works/0'],candidate_ids:['c1'],evidence_refs},dependencies:[],key:null,result});
test('allocation uses max+1 without consuming supplied high-water and sorts local refs in ASCII order',()=>{
  const e=entities([work('work:w2'),work('work:w10'),work('work:w1')]);const current={...emptyMaxima(),W:5},state={...emptyMaxima(),W:9};const saved=JSON.stringify({e,current,state});
  const a=allocatePlannedIds({entities:e,canonical_maxima:current,high_water_marks:state});
  assert.deepEqual(a.planned_id_mappings.map(m=>[m.local_ref,m.planned_id]),[['work:w1','W00010'],['work:w10','W00011'],['work:w2','W00012']]);
  assert.deepEqual(a,allocatePlannedIds({entities:{...e,works:[...e.works].reverse()},canonical_maxima:current,high_water_marks:state}));assert.equal(JSON.stringify({e,current,state}),saved);
  assert.equal(allocatePlannedIds({entities:entities([work('work:w1')]),canonical_maxima:{...current,W:20},high_water_marks:state}).planned_id_mappings[0].planned_id,'W00021');
});
test('all song prefixes stay human-selected and namespaces allocate independently',()=>{
  const e=entities([work('work:w1')],['M','A','J','T','B','O','R','H'].map((p,i)=>song(`song:s${i+1}`,p)));
  const a=allocatePlannedIds({entities:e,canonical_maxima:emptyMaxima(),high_water_marks:emptyMaxima()});
  assert.deepEqual(a.planned_id_mappings.filter(m=>m.entity_type==='song').map(m=>m.planned_id),['A00001','B00001','H00001','J00001','M00001','O00001','R00001','T00001']);
  assert.equal(a.planned_id_mappings[0].planned_id,'W00001');
});
test('overflow removes the whole namespace and registry rejects collisions/wrong namespaces/partial results',()=>{
  const e=entities([work('work:w1'),work('work:w2')],[song('song:s1')]);
  const result=allocatePlannedIds({entities:e,canonical_maxima:emptyMaxima(),high_water_marks:{...emptyMaxima(),W:99998}});
  assert.equal(result.overflow.length,2);assert.deepEqual(result.planned_id_mappings.map(m=>m.planned_id),['J00001']);
  const good=allocatePlannedIds({entities:e,canonical_maxima:emptyMaxima(),high_water_marks:emptyMaxima()}).planned_id_mappings;
  for(const mutate of [a=>a[1].planned_id=a[0].planned_id,a=>a[0].namespace='P',a=>a.pop(),a=>a.reverse()]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validatePlannedIdRegistry(bad,{entities:e}));}
  assert.throws(()=>allocatePlannedIds({entities:entities([work('work:w1'),work('work:w1')]),canonical_maxima:emptyMaxima(),high_water_marks:emptyMaxima()}));
});
test('operation identity uses only the formal Decision/table/subject projection',()=>{
  const id=`dec_${randomUUID()}`,subject={kind:'local',ref:'work:w1'};
  assert.equal(canonicalOperationId(id,'works',subject),`op_${hashCanonicalJson({schema_version:1,decision_id:id,table:'works',subject})}`);
  assert.throws(()=>canonicalOperationId(id,'works',{kind:'local',ref:'pw_1'}));assert.throws(()=>canonicalOperationId(id,'members',{kind:'local',ref:'member:m1'}));
});
test('operation comparator handles table, song prefix, subject/ref and typed relation PK before null keys',()=>{
  const make=(table,kind,ref,key,i)=>({...op(table,'conflict',{},i),source:{subject:{kind,ref}},key});
  const a=make('release_tracks','relation','track:t1',{release_id:'L00001',disc_number:1,track_number:10},1),b=make('release_tracks','relation','track:t2',{release_id:'L00001',disc_number:1,track_number:2},2),c=make('release_tracks','relation','track:t3',null,3);
  const list=[c,a,b];list.sort((x,y)=>comparePlanOperations(x,y,{entities:{songs:[]}}));assert.deepEqual(list,[b,a,c]);
  const s1=make('songs','local','song:s1',null,1),s2=make('songs','existing','A00001',{song_id:'A00001'},2);const d={entities:{songs:[song('song:s1','J')]}};assert.ok(comparePlanOperations(s2,s1,d)<0);
  assert.ok(comparePlanOperations(make('works','local','work:w10',{work_id:'W00002'},1),make('works','local','work:w2',{work_id:'W00001'},2),d)<0);
});
test('templates retain system bindings and reject unsafe PK integer representation',()=>{
  const j=work('work:w1'),mapping=[{entity_type:'work',local_ref:j.local_ref,namespace:'W',planned_id:'W00002'}];const r=plannedRowTemplate('works',j,mapping);
  assert.deepEqual(r.created_at,{system_binding:'apply_time'});assert.equal(r.notes,'');assert.equal(r.work_id,'W00002');
  assert.throws(()=>canonicalTypedKey('release_tracks',{release_id:'L00001',disc_number:'9007199254740992',track_number:'1'}),{code:'PLAN_INTEGER_UNREPRESENTABLE'});
});
test('classification distinguishes reuse, assertion conflicts, inserts, exact no_op and PK content conflict',()=>{
  const s=snapshot();assert.equal(s.validation.ok,true);
  assert.equal(classifyExistingReference({table:'works',reference:ref('W00001',{title:'Old'}),snapshot:s}).classification,'reuse');
  assert.equal(classifyExistingReference({table:'works',reference:ref('W00001',{title:'Changed'}),snapshot:s}).result.code,'EXISTING_IDENTITY_CONFLICT');
  assert.equal(classifyExistingReference({table:'works',reference:ref('W99999',{title:'Missing'}),snapshot:s}).result.code,'EXISTING_ID_MISSING');
  const j=track(),insert=classifyRelation({table:'release_tracks',judgment:j,mappings:[],snapshot:s});assert.equal(insert.classification,'insert');
  s.tables.release_tracks.push({...insert.result.row_template,disc_number:'01'});s.validation=validateCanonicalTables(s.tables);
  const noOp=classifyRelation({table:'release_tracks',judgment:j,mappings:[],snapshot:s});assert.equal(noOp.classification,'no_op');assert.equal(noOp.result.existing_row.disc_number,'01');
  assert.equal(classifyRelation({table:'release_tracks',judgment:{...j,notes:'different'},mappings:[],snapshot:s}).result.code,'RELATION_PK_CONTENT_CONFLICT');
});
test('same-name new judgment requires explicit distinct evidence and never auto-reuses',()=>{
  const s=snapshot(),j=work('work:w1','Old');const {planned_id_mappings:mappings}=allocatePlannedIds({entities:entities([j]),canonical_maxima:currentIdMaxima(s),high_water_marks:emptyMaxima()});
  const blocked=classifyNewEntity({table:'works',judgment:j,mappings,overflow:[],snapshot:s});assert.equal(blocked.result.code,'DUPLICATE_IDENTITY_UNREVIEWED');
  j.distinct_from=[{target:{existing_id:'W00001'},evidence_refs,reason:'Different composition'}];assert.equal(classifyNewEntity({table:'works',judgment:j,mappings,overflow:[],snapshot:s}).classification,'insert');
});
test('hypothetical target preserves original bytes/rows and hashes templates independently of operation order',()=>{
  const s=snapshot(),j=work('work:w1');const {planned_id_mappings:mappings}=allocatePlannedIds({entities:entities([j]),canonical_maxima:currentIdMaxima(s),high_water_marks:emptyMaxima()});
  const a=op('works','insert',classifyNewEntity({table:'works',judgment:j,mappings,overflow:[],snapshot:s}).result,1),b=op('release_tracks','insert',classifyRelation({table:'release_tracks',judgment:track(),mappings:[],snapshot:s}).result,2);
  const before=JSON.stringify({s,a,b}),one=validateHypotheticalTarget({snapshot:s,operations:[a,b]}),two=validateHypotheticalTarget({snapshot:s,operations:[b,a]});
  assert.equal(one.applicability.applicable,true);assert.equal(one.validation.target_semantic_hash,two.validation.target_semantic_hash);assert.equal(JSON.stringify({s,a,b}),before);
  assert.deepEqual(a.result.row_template.created_at,{system_binding:'apply_time'});
});
test('whole-target FK/PK/primary failures block the whole target',()=>{
  const s=snapshot(),r=classifyRelation({table:'release_tracks',judgment:track(),mappings:[],snapshot:s}).result;
  for(const operations of [[op('release_tracks','insert',{...r,row_template:{...r.row_template,song_id:'J99999'}})],[op('release_tracks','insert',r,1),op('release_tracks','insert',r,2)],[op('songs','insert',{row_template:{...csvRow('songs',{song_id:'J00002',work_id:'W00001',title:'New',version_type:'cover',source_url:url}),created_at:{system_binding:'apply_time'},updated_at:{system_binding:'apply_time'}}})]]){
    const v=validateHypotheticalTarget({snapshot:s,operations});assert.equal(v.validation.performed,true);assert.equal(v.applicability.applicable,false);assert.ok(v.validation.diagnostics.some(d=>d.code==='CANONICAL_TARGET_INVALID'));
  }
});
test('conflict/unsupported diagnostics block applicability and allocation failures suppress incomplete target hashes',()=>{
  const s=snapshot();const unsupported=op('members','unsupported',{code:'NEW_MEMBER',request_ref:'unsupported:u1',description:'new member'});
  assert.equal(validateHypotheticalTarget({snapshot:s,operations:[unsupported]}).applicability.applicable,false);
  const capacity=op('works','conflict',{code:'ID_CAPACITY_EXHAUSTED',requested:{kind:'allocation',local_ref:'work:w1',namespace:'W'},existing_rows:[],evidence_refs});const v=validateHypotheticalTarget({snapshot:s,operations:[capacity]});assert.equal(v.validation.performed,false);assert.equal(v.validation.target_semantic_hash,null);
});
test('hash/ID are full JCS hashes over payload only; metadata stays outside',()=>{
  const payload={schema_version:1,operations:[],value:'x'};const a={generated_at:'one',payload},b={generated_at:'two',payload};assert.equal(applyPlanHash(a.payload),applyPlanHash(b.payload));assert.equal(applyPlanId(payload),`ap_${hashCanonicalJson(payload)}`);assert.notEqual(applyPlanHash(payload),applyPlanHash({...payload,value:'y'}));
});
