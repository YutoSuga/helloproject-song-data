import { randomUUID } from 'node:crypto';
import { historyFixture } from './history-success.js';
import { completeDraft,next,seal,source } from './decision-lifecycle.js';
import { CANONICAL_SCHEMA } from '../../src/canonical-schema.js';
import { validateCanonicalTables } from '../../src/canonical-validator.js';
import { createAuditPayload,createBootstrapRecords,DECLARATION_STATEMENT } from '../../src/fn004-state.js';
import { currentIdMaxima } from '../../src/fn004-id-audit.js';
import { hashCanonicalJson } from '../../src/canonical-hash.js';
import { verifySuccessfulHistory } from '../../src/fn004-history-verify.js';
import { buildDecisionRegistry } from '../../src/fn004-decision-lifecycle.js';
export const time='2026-10-25T00:00:00Z';
export function csvRow(table,values){return Object.fromEntries(CANONICAL_SCHEMA[table].columns.map(c=>[c.name,values[c.name]??(['created_at','updated_at'].includes(c.name)?time:'')]));}
export function planFixture(){const f=historyFixture(),snapshot=f.snapshot,url=source.source_url;
  snapshot.tables.works=[csvRow('works',{work_id:'W00001',title:'曲',source_url:url})];snapshot.tables.artists=[csvRow('artists',{artist_id:'G00001',name:'Artist',type:'group'})];snapshot.tables.members=[csvRow('members',{member_id:'P00001',name:'Member'})];
  snapshot.tables.songs=[csvRow('songs',{song_id:'J00001',work_id:'W00001',title:'曲',version_type:'original',source_url:url})];snapshot.tables.song_artists=[csvRow('song_artists',{song_id:'J00001',artist_id:'G00001',role:'primary',source_url:url})];snapshot.tables.releases=[csvRow('releases',{release_id:'L00001',title:'盤',release_type:'single',source_url:url})];snapshot.validation=validateCanonicalTables(snapshot.tables);
  const current=currentIdMaxima(snapshot),declaration={schema_version:1,namespaces:current,statement:DECLARATION_STATEMENT,evidence:[]};
  const audit_payload=createAuditPayload({...snapshot,current_maxima:current},f.git_audit,declaration);
  const {record:bootstrap,state}=createBootstrapRecords({audit_payload,canonical_manifest:snapshot.manifest,repository_instance_id:`repo_${randomUUID()}`,initialized_at:time,actor:{id:'local:test',assurance:'local_process'},expected_audit_hash:hashCanonicalJson(audit_payload)});
  const history=verifySuccessfulHistory({...f,bootstrap,state,snapshot}),draft=completeDraft(),decision=next(draft,'confirmed'),store={schema_version:1,revisions:[draft,decision]};
  return {...f,bootstrap,state,snapshot,history,decision,store,registry:buildDecisionRegistry(store),candidates:{schema_version:1,candidates:[{...source,candidate_id:'candidate-1'}]}};
}
export function withNewEntities(f){const d=structuredClone(f.store.revisions[0]),evidence_refs=['ev_source'],url=source.source_url;
  d.entities.works=[{local_ref:'work:w1',evidence_refs,title:'New composition',title_kana:null,notes:null,source_url:url,distinct_from:[]}];
  d.entities.creators=[{local_ref:'creator:c1',evidence_refs,name:'Author',name_kana:null,notes:null,source_url:null,distinct_from:[]}];
  d.entities.artists=[{local_ref:'artist:a1',evidence_refs,name:'Unit',type:'group',start_date:null,end_date:null,notes:null,source_url:null,distinct_from:[]}];
  d.entities.releases=[{local_ref:'release:r1',evidence_refs,title:'New disc',release_type:'single',release_date:null,catalog_number:null,notes:null,source_url:url,distinct_from:[]}];
  d.entities.songs=[{local_ref:'song:s1',evidence_refs,work:{local_ref:'work:w1'},title:'New recording',version_name:null,version_type:'cover',release_date:null,notes:null,source_url:url,song_id_prefix:'H',distinct_from:[]}];
  Object.assign(d.candidate_bindings[0],{work:{local_ref:'work:w1'},song:{local_ref:'song:s1'},audio_identity:'distinct_recording',accepted_version_type:'cover',performer_review:'specified'});
  Object.assign(d.relations.release_tracks[0],{release:{local_ref:'release:r1'},song:{local_ref:'song:s1'}});
  d.relations.song_artists=[{local_ref:'song_artist:sa1',evidence_refs,song:{local_ref:'song:s1'},artist:{local_ref:'artist:a1'},role:'primary',credit_order:1,source_url:url}];
  d.relations.song_creators=[{local_ref:'song_creator:sc1',evidence_refs,song:{local_ref:'song:s1'},creator:{local_ref:'creator:c1'},role:'composition',credit_name:'Author',credit_order:1,source_url:url}];
  d.relations.song_performers=[{local_ref:'song_performer:sp1',evidence_refs,song:{local_ref:'song:s1'},member:{existing_id:'P00001',assertions:{name:'Member'},evidence_refs},performer_order:1,notes:null,source_url:url}];
  seal(d);const decision=next(d,'confirmed'),store={schema_version:1,revisions:[d,decision]};return {...f,decision,store,registry:buildDecisionRegistry(store)};
}
