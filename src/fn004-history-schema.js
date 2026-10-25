import { canonicalJson, hashCanonicalJson } from './canonical-hash.js';
import { CANONICAL_SCHEMA } from './canonical-schema.js';
import { canonicalValueError } from './canonical-validator.js';
import { isFn004Timestamp, validateManifest } from './fn004-state.js';
import { RepositoryError } from './persistence.js';
export const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const hash = v => typeof v==='string' && /^[0-9a-f]{64}$/.test(v);
export const text = v => typeof v==='string' && v.trim().length>0;
export const integer = (v,min=0) => Number.isSafeInteger(v)&&v>=min;
export const same = (a,b) => canonicalJson(a)===canonicalJson(b);
export const cmp = (a,b) => a<b?-1:a>b?1:0;
export function demand(ok,message,code='HISTORY_CORRUPT') {if(!ok)throw new RepositoryError(code,message);}
export function shape(v,keys) {demand(v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'Missing/unknown object field');}
export function ordered(a,key=v=>v,compare=cmp) {demand(Array.isArray(a),'Expected array');for(let i=0;i<a.length;i++)demand(i===0||compare(key(a[i-1]),key(a[i]))<0,'Duplicate or noncanonical ordering');}
export function timestamp(v){demand(isFn004Timestamp(v),'Invalid timestamp');}
export function compareTimestamps(a,b){
  const split=v=>{const match=/\.(\d+)(?=Z|[+-])/.exec(v);return {base:Date.parse(match?v.replace(match[0],''):v),fraction:match?.[1]??''};};
  const x=split(a),y=split(b),width=Math.max(x.fraction.length,y.fraction.length);
  return cmp(x.base,y.base)||cmp(x.fraction.padEnd(width,'0'),y.fraction.padEnd(width,'0'));
}
export function manifest(v){validateManifest(v);}
export function actor(v){shape(v,['id','assurance']);const prefix={local_process:'local:',authenticated_admin:'admin:'};demand(Object.hasOwn(prefix,v.assurance)&&typeof v.id==='string'&&v.id.startsWith(prefix[v.assurance])&&text(v.id.slice(prefix[v.assurance].length)),'Invalid actor');}
export function row(table,value,template=false){
  const schema=CANONICAL_SCHEMA[table];demand(schema,'Unknown table');shape(value,schema.columns.map(c=>c.name));
  for(const c of schema.columns){const v=value[c.name];if(template&&['created_at','updated_at'].includes(c.name)){demand(same(v,{system_binding:'apply_time'}),'Invalid system binding');continue;}demand(canonicalValueError(c,v)===null,`Invalid row column ${c.name}`);}
}
export function rowKey(table,value){const s=CANONICAL_SCHEMA[table];return Object.fromEntries(s.primaryKey.map(name=>{const c=s.columns.find(c=>c.name===name);let v=value[name];if(c.type==='integer'){v=Number(v);demand(integer(v,c.min),'Unrepresentable integer PK');}return [name,v];}));}
export function validateKey(table,key){const s=CANONICAL_SCHEMA[table];demand(s,'Unknown key table');shape(key,s.primaryKey);for(const name of s.primaryKey){const c=s.columns.find(c=>c.name===name),v=key[name];demand(c.type==='integer'?integer(v,c.min):canonicalValueError(c,v)===null,'Invalid typed key');}}
export function compareKeys(table,a,b){for(const name of CANONICAL_SCHEMA[table].primaryKey){const n=cmp(a[name],b[name]);if(n)return n;}return 0;}
export const rowHash=(table,row)=>hashCanonicalJson({table,row});
export const PLAN_RULES=Object.freeze({...Object.fromEntries(('decision_store decision_revision decision_scope candidate_source_schema candidate_fingerprint decision_registry apply_plan plan_payload plan_operation operation_order id_allocation planner hypothetical_validation canonical_schema canonical_validator canonical_manifest id_namespace state bootstrap git_id_audit history_record history_hash history_chain history_set state_proof serializer').split(' ').map(k=>[k,1])),canonical_json:'rfc8785',hash_algorithm:'sha256'});
export const TABLE_ORDER=['works','creators','artists','releases','songs','song_artists','song_creators','song_performers','release_tracks','members','member_affiliations','videos','video_songs','video_song_performers'];
export const singular={works:'work',creators:'creator',artists:'artist',releases:'release',songs:'song',members:'member'};
export const masterTables={work:'works',creator:'creators',artist:'artists',release:'releases',song:'songs',member:'members'};
export const refKey=ref=>ref?.existing_id??ref?.local_ref;
