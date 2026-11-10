import * as fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {hostname,userInfo} from 'node:os';
import {createInterface} from 'node:readline';
import {parseStrictJson} from './strict-json.js';
import {RepositoryError} from './persistence.js';
import {createBootstrapService} from './fn004-bootstrap.js';
import {createDecisionService} from './fn004-decision-application.js';
import {createApplyPlanService} from './fn004-plan-application.js';
import {createCanonicalManagementService} from './fn004-management-application.js';
import {COMMANDS,parseCanonicalArguments} from './canonical-cli-arguments.js';
import {errorDocument,errorExit,resultDocument,formatHuman,serializeCliDocument} from './canonical-cli-output.js';

export function localOperator() {
 return {id:'local:'+createHash('sha256').update(JSON.stringify([hostname(),userInfo().uid,userInfo().username])).digest('hex'),assurance:'local_process'};
}
async function readInput(path) {
 let bytes;
 try {bytes=await fs.readFile(path);}catch(cause){throw new RepositoryError('PERSISTENCE_READ_FAILED','Cannot read external input',{path,cause});}
 try {return parseStrictJson(bytes);}catch(cause){throw new RepositoryError(cause instanceof TypeError?'PERSISTENCE_INVALID_UTF8':'PERSISTENCE_PARSE_FAILED','Invalid strict JSON input',{path,cause});}
}
export function managementServices(root,actor,options={}) {
 return {bootstrap:createBootstrapService(options),decisions:createDecisionService({root,...options}),
  plans:createApplyPlanService({root,...options}),management:createCanonicalManagementService({root,actor,...options})};
}
function requireInteractive(input,output,env) {
 if(!input.isTTY||!output.isTTY||env.CI||env.GITHUB_ACTIONS)
  throw new RepositoryError('UNSUPPORTED_OPERATION','Interactive local TTY required; CI and piped confirmation are forbidden');
}
async function confirm(input,output) {
 const rl=createInterface({input,output,terminal:true});
 return new Promise(resolve=>{
  let done=false;
  const finish=value=>{if(done)return;done=true;rl.close();resolve(value);};
  rl.once('SIGINT',()=>finish(false));rl.once('close',()=>finish(false));
  rl.question('Continue? [y/N] ',answer=>finish(/^(?:y|yes)$/i.test(answer.trim())));
 });
}
// Options are trusted dependency seams for process-level tests. The executable
// passes none; there is no flag/env to inject a service, actor, TTY or boundary.
export async function runCanonicalCli(argv,{root=process.cwd(),input=process.stdin,output=process.stdout,errorOutput=process.stderr,
 env=process.env,servicesFactory=managementServices}={}) {
 let json=argv.includes('--json'),selection={};
 const emit=doc=>output.write(json?serializeCliDocument(doc)+'\n':formatHuman(doc));
 try {
  const parsed=parseCanonicalArguments(argv);json=parsed.json;
  const {command,options:o}=parsed;
  for(const key of ['request','transaction','plan','decision'])if(o[key])selection[key+'_id']=o[key];
  if(o.id)selection[(command.startsWith('decision ')?'decision':command.startsWith('plan ')?'plan':'apply')+'_id']=o.id;
  if(command==='help'){emit({commands:COMMANDS,usage:'npm run canonical:manage -- <command> [--json]',documentation:'docs/canonical-cli.md'});return 0;}
  root=realpathSync(root);const actor=localOperator();
  const {bootstrap,decisions,plans,management}=servicesFactory(root,actor,{onBoundary:async e=>{
    if(e.phase==='receipt:after'){
      const match=/^staging\/apply-requests\/([0-9a-f-]{36})\.json$/.exec(e.path??'');
      if(match)errorOutput.write('Accepted Request: '+match[1]+'\n');
    }
  }});
  let data,operation=command;
  if(command==='status')data=await bootstrap.inspectBootstrapStatus({root});
  else if(command==='init') {
   const external_declaration=await readInput(o['external-declaration']);
   const check=await bootstrap.checkBootstrap({root,external_declaration});
   if(check.cause)throw check.cause;
   if(o.check){data=check;operation='init-check';}
   else {
    requireInteractive(input,errorOutput,env);
    if(check.readiness==='blocked'||!['BOOTSTRAP_REQUIRED','READY'].includes(check.status))throw new RepositoryError(check.status,'Bootstrap blocks initialization',{diagnostics:check.diagnostics});
    if(check.status!=='READY'&&check.audit_hash!==o['expect-audit-hash'])throw new RepositoryError('BOOTSTRAP_AUDIT_MISMATCH','Check and confirm the current audit first');
    errorOutput.write('Initialize repository '+root+'\n'+JSON.stringify(check,null,2)+'\n');
    if(!await confirm(input,errorOutput)){emit({outcome:'cancelled',canonical_effect:'none',readiness:check.readiness,diagnostics:[],allowed_actions:[]});return 10;}
    data=await bootstrap.initializeBootstrap({root,external_declaration,expected_audit_hash:o['expect-audit-hash'],actor});
   }
  } else if(command==='decision template')data=await decisions.createDecisionTemplate(o.candidate);
  else if(command==='decision import')data=await decisions.importDecisionDraft(await readInput(o.input),actor);
  else if(command==='decision show')data=await decisions.getDecision(o.id);
  else if(command==='decision validate')data=await decisions.validateDecision(o.id,o.revision,actor);
  else if(command==='decision confirm')data=await decisions.confirmDecisionHead({decision_id:o.id,revision:o.revision,expected_head:o['expect-head'],actor,mutation_key:randomUUID()});
  else if(command==='plan create')data=await management.createPlan({decision_id:o.decision,revision:o.revision,expected_decision_hash:o['expect-decision-hash']});
  else if(command==='plan show')data=await plans.getApplyPlan(o.id);
  else if(command==='plan check')data=await plans.checkApplyPlan(o.id);
  else if(command==='apply') {
   requireInteractive(input,errorOutput,env);
   const preview=await management.preflight(o.plan,o['expect-plan-hash']);
   errorOutput.write('Apply repository '+root+'\n'+JSON.stringify(preview.display,null,2)+'\n');
   if(!await confirm(input,errorOutput)){emit({outcome:'cancelled',canonical_effect:'none',readiness:'initialized',diagnostics:[],allowed_actions:[]});return 10;}
   data=await management.applyPlan(o.plan,o['expect-plan-hash']);
  } else if(command==='result')data=await management.result(o.request);
  else if(command==='history show')data=await management.history(o.id);
  else if(command==='recovery inspect')data=await management.inspectRecovery(o.request);
  else if(command==='recovery run')data=await management.runRecovery({transaction_id:o.transaction,expected_observed_state_hash:o['expect-state-hash'],action:o.action});
  const result=resultDocument(operation,data);emit(result.dto);return result.exit;
 } catch(error) {const document=errorDocument(error);if(Object.keys(selection).length)document.identities=selection;emit(document);return errorExit(error);}
}
