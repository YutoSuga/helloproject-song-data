import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCanonicalArguments,CliArgumentError,COMMANDS} from '../src/canonical-cli-arguments.js';
import {errorExit,resultDocument,errorDocument,serializeCliDocument} from '../src/canonical-cli-output.js';
import {RepositoryError} from '../src/persistence.js';
import {randomUUID} from 'node:crypto';

test('6F closed parser rejects bypasses, duplicate options and malformed identities before service access',()=>{
 for(const args of [[],['unknown'],['constructor'],['toString'],['__proto__'],['status','--root','/tmp'],['apply','--yes'],['status','--json','--json'],
  ['decision','confirm','bad','--revision','1','--expect-head','f'.repeat(64)],['plan','create','--decision','dec_'+randomUUID(),'--revision','0','--expect-decision-hash','f'.repeat(64)],
  ['recovery','run','--transaction','tx_'+randomUUID(),'--expect-state-hash','f'.repeat(64),'--action','force_restore'],
  ['init','--check','--expect-audit-hash','f'.repeat(64),'--external-declaration','d.json'],['status','--json=true'],
  ['apply','--plan','ap_'+'f'.repeat(64),'--expect-plan-hash','f'.repeat(64)+'\n'],
  ['plan','show','ap_'+'f'.repeat(64),'--$id','ignored']])
  assert.throws(()=>parseCanonicalArguments(args),CliArgumentError);
 assert.equal(COMMANDS.length,15);
 assert.equal(parseCanonicalArguments(['--json','decision','validate','dec_'+randomUUID(),'--revision','2']).options.revision,2);
});
test('6F exit classification uses typed codes/errno, including unknown and cancellation outcomes',()=>{
 const cases=[['ALREADY_APPLIED',0],['UNSUPPORTED_OPERATION',3],['STALE_PLAN',4],['GATE_BUSY',5],['RECOVERY_REQUIRED',6],
  ['GATE_CORRUPT',8],['DECISION_HEAD_CONFLICT',8],['HISTORY_CHAIN_MISMATCH',8],['PERSISTENCE_ROOT_TYPE',8],['GATE_NESTED',1],['BOOTSTRAP_INCOMPLETE',12],['BOOTSTRAP_REQUIRED',12]];
 for(const [code,exit] of cases)assert.equal(errorExit(new RepositoryError(code,'arbitrary message')),exit);
 assert.equal(errorExit(new CliArgumentError('anything')),2);
 assert.equal(errorExit(new Error('STALE_PLAN')),1);
 assert.equal(errorExit('unknown thrown primitive'),1);
 assert.equal(errorExit(new RepositoryError('PERSISTENCE_READ_FAILED','read',{cause:Object.assign(Error(),{code:'EACCES'})})),9);
 const dto={response:{result:{apply_id:'apply',record_hash:'hash'},readiness:'cleanup_required',diagnostics:[{code:'RECOVERY_REQUIRED'}]}};
 assert.equal(resultDocument('apply',dto).exit,7);
 assert.equal(resultDocument('result',{response:{result:null,readiness:'initialized',diagnostics:[]},terminal_phase:'ROLLED_BACK'}).exit,11);
 assert.equal(resultDocument('status',{readiness:'blocked',status:'INTEGRITY_CONFLICT'}).exit,0);
 assert.equal(resultDocument('recovery run',{outcome:'aborted',observation:{readiness:'initialized'}}).exit,11);
 const e=new RepositoryError('PERSISTENCE_WRITE_FAILED','secret detail',{path:'staging/example',phase:'publish',published:null});
 const printed=errorDocument(e);assert.equal(printed.error.published,null);assert.equal(JSON.stringify(printed).includes('secret detail'),false);
 const unknown=errorDocument({diagnostics:'unexpected shape'});
 assert.equal(unknown.error.code,'UNKNOWN_ERROR');assert.deepEqual(unknown.diagnostics,[{code:'UNKNOWN_ERROR'}]);
 const privateCause=Object.assign(Error('private implementation detail'),{code:'EIO',secret:'do not publish'});
 const text=serializeCliDocument({data:{cause:privateCause,descriptor:{inode:9007199254740993n}}});
 assert.equal(text.includes('private implementation detail'),false);assert.equal(text.includes('do not publish'),false);
 assert.equal(JSON.parse(text).data.descriptor.inode,'9007199254740993');
});

test('6F initialize/check preserve blocked bootstrap and typed audit failures before hash comparison',async t=>{
 const fs=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {PassThrough}=await import('node:stream'),{runCanonicalCli}=await import('../src/canonical-cli.js');
 const root=await fs.mkdtemp(join(tmpdir(),'fn004-cli-audit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const inputFile=join(root,'declaration.json');await fs.writeFile(inputFile,'{}');
 const cases=[
  [{status:'BOOTSTRAP_INCOMPLETE',readiness:'blocked',audit_hash:null,diagnostics:[{code:'BOOTSTRAP_INCOMPLETE'}]},12],
  [{status:'RECOVERY_REQUIRED',readiness:'recovery_required',audit_hash:null,diagnostics:[{code:'RECOVERY_REQUIRED'}]},6],
  [{status:'PERSISTENCE_READ_FAILED',readiness:'blocked',audit_hash:null,cause:new RepositoryError('PERSISTENCE_READ_FAILED','audit',{path:'staging/fn004-state.json',cause:Object.assign(Error(),{code:'EACCES'})})},9],
  [{status:'GATE_CORRUPT',readiness:'blocked',audit_hash:null,cause:new RepositoryError('GATE_CORRUPT','audit')},8]
 ];
 for(const [check,expected] of cases)for(const checkOnly of [false,true]){
  const input=new PassThrough(),output=new PassThrough(),errorOutput=new PassThrough();input.isTTY=true;errorOutput.isTTY=true;
  let stdout='',stderr='',initialized=false;output.on('data',b=>stdout+=b);errorOutput.on('data',b=>stderr+=b);
  const args=['init','--external-declaration',inputFile,...(checkOnly?['--check']:['--expect-audit-hash','f'.repeat(64)]),'--json'];
  const exit=await runCanonicalCli(args,{root,input,output,errorOutput,env:{},servicesFactory:()=>({bootstrap:{
   checkBootstrap:async()=>check,initializeBootstrap:async()=>{initialized=true;throw Error('Unexpected mutation');}
  }})});
  assert.equal(exit,expected,JSON.stringify({checkOnly,stdout,stderr}));assert.equal(initialized,false);assert.equal(stderr,'');
  const doc=JSON.parse(stdout);assert.equal(doc.error?.code??doc.data.status,check.status);
  if(expected===9){assert.equal(doc.error.path,'staging/fn004-state.json');assert.deepEqual(doc.error.cause_codes,['EACCES']);}
 }
});
