import {RECOVERY_CODES} from './fn004-evidence-errors.js';
import {CliArgumentError} from './canonical-cli-arguments.js';
const integrity=new Set(`INTEGRITY_CONFLICT PLAN_INTEGRITY_CONFLICT DECISION_HEAD_CONFLICT COMPETING_CONFIRMED_DECISION APPROVAL_PLAN_MISMATCH GATE_CORRUPT GATE_OWNERSHIP_MISMATCH HISTORY_CORRUPT HISTORY_CHAIN_MISMATCH HISTORY_IDENTITY_CONFLICT STATE_CORRUPT STATE_BOOTSTRAP_MISMATCH STATE_HIGH_WATER_INVALID BOOTSTRAP_CORRUPT PERSISTENCE_PARSE_FAILED PERSISTENCE_INVALID_UTF8 PERSISTENCE_ROOT_TYPE PERSISTENCE_ALREADY_EXISTS`.split(' '));
function permission(error) {const seen=new Set();while(error&&!seen.has(error)){seen.add(error);if(['EACCES','EPERM'].includes(error.code))return true;error=error.cause;}return false;}
export function errorExit(error) {
 if(error instanceof CliArgumentError)return 2;
 if(permission(error))return 9;
 const code=error?.code;
 if(integrity.has(code))return 8;
 if(['BOOTSTRAP_REQUIRED','BOOTSTRAP_INCOMPLETE'].includes(code))return 12;
 if(error?.finalization_pending)return 7;
 if(['aborted','rolled_back'].includes(error?.terminal_outcome))return 11;
 if(['STALE_PLAN','BOOTSTRAP_AUDIT_MISMATCH'].includes(code))return 4;
 if(code==='GATE_BUSY')return 5;
 if(['RECOVERY_REQUIRED','STATE_TRANSITION_PROOF_REQUIRED','GATE_RELEASE_FAILED'].includes(code))return 6;
 if(code==='ALREADY_APPLIED')return 0;
 if(code==='GATE_NESTED')return 1;
 if(RECOVERY_CODES.includes(code)&&!code.startsWith('PERSISTENCE_')&&code!=='GATE_ACQUIRE_FAILED')return 3;
 return 1;
}
export function errorDocument(error) {
 const exit=errorExit(error),code=error instanceof CliArgumentError?'ARGUMENT_ERROR':typeof error?.code==='string'?error.code:'UNKNOWN_ERROR';
 const evidence={};
 for(const key of ['path','phase','published','descriptor','temp','io_code','request_id','intended_request_id','approval_id','intended_approval_id','plan_id','history_match'])if(error?.[key]!==undefined)evidence[key]=error[key];
 // No arbitrary exception serialization, stack, environment or credentials.
 const supplied=Array.isArray(error?.diagnostics)?error.diagnostics:[];
 const diagnostics=supplied.filter(d=>d&&typeof d==='object'&&typeof d.code==='string').map(d=>Object.fromEntries(Object.entries(d).filter(([k])=>['code','severity','file','table','row','column','key','target','decision_path','evidence_refs','canonical'].includes(k))));
 if(!diagnostics.length)diagnostics.push({code});
 const cause_codes=[];let cause=error?.cause;const seen=new Set();while(cause&&!seen.has(cause)){seen.add(cause);if(typeof cause.code==='string')cause_codes.push(cause.code);cause=cause.cause;}
 if(cause_codes.length)evidence.cause_codes=cause_codes;
 return {outcome:error?.terminal_outcome??(error?.finalization_pending?'committed_pending_finalization':null)??(code==='ALREADY_APPLIED'?'already_applied':exit===2?'argument_error':exit===5?'busy':exit===4?'stale':exit===8?'integrity_conflict':exit===6?'recovery_required':'blocked'),canonical_effect:error?.canonical_effect??(code==='ALREADY_APPLIED'?'applied':'unknown'),
  readiness:code==='ALREADY_APPLIED'?'initialized':[6,7].includes(exit)?'recovery_required':exit===11?'initialized':'blocked',diagnostics,allowed_actions:[],error:{code,...evidence}};
}
export function resultDocument(command,data) {
 const response=data?.response;
 const observation=data?.observation??(data?.observed_state_hash?data:null);
 const readiness=response?.readiness??observation?.readiness??data?.readiness??null;
 const diagnostics=response?.diagnostics??observation?.diagnostics??data?.diagnostics??[];
 let outcome=data?.outcome??data?.status??'retrieved',canonical_effect='none';
 if(response){
  if(response.result){outcome=command==='apply'?'completed':'already_applied';canonical_effect='applied';}
  else if(data.terminal_phase==='ABORTED')outcome='aborted';
  else if(data.terminal_phase==='ROLLED_BACK'){outcome='rolled_back';canonical_effect='restored';}
  else outcome='incomplete';
 }
 if(data?.status==='ALREADY_APPLIED'){outcome='already_applied';canonical_effect='applied';}
 if(data?.outcome==='completed')canonical_effect='applied';
 if(data?.outcome==='rolled_back')canonical_effect='restored';
 const dto={outcome,canonical_effect,readiness,diagnostics,allowed_actions:observation?.allowed_actions??[],data};
 let exit=0;
 const readonly=['status','decision template','decision show','plan show','result','history show','recovery inspect'].includes(command);
 if(!readonly){
  if(['aborted','rolled_back'].includes(outcome))exit=11;
  else if(readiness==='cleanup_required'||readiness==='recovery_required')exit=canonical_effect==='applied'?7:6;
  else if(data?.valid===false||data?.applicable===false||data?.readiness==='blocked')exit=errorExit({code:data.status??diagnostics[0]?.code??'BLOCKED'});
 }
 // A readonly Request result still conveys required action in its exit code;
 // status/show/inspect alone can successfully retrieve a blocked state.
 if(command==='result')exit=readiness==='cleanup_required'||readiness==='recovery_required'?(response.result?7:6):['aborted','rolled_back'].includes(outcome)?11:0;
 return {dto,exit};
}
export function serializeCliDocument(document,pretty=false) {
 return JSON.stringify(document,(_key,value)=>value instanceof Error?
  {code:typeof value.code==='string'?value.code:'UNKNOWN_ERROR'}:typeof value==='bigint'?value.toString():value,pretty?2:undefined);
}
export function formatHuman(document) {
 if(document.commands)return document.usage+'\n'+document.commands.join('\n')+'\nSee '+document.documentation+'\n';
 return ['Outcome: '+document.outcome,'Canonical effect: '+document.canonical_effect,'Readiness: '+(document.readiness??'not evaluated'), 'Diagnostics: '+serializeCliDocument(document.diagnostics??[]),'Allowed actions: '+serializeCliDocument(document.allowed_actions??[]),'Details:',serializeCliDocument(document.data??document,true),''].join('\n');
}
