import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {runCanonicalCli,managementServices} from '../../src/canonical-cli.js';

// Trusted process-kill / syscall seam, imported only by process-level tests.
// The production executable never imports this module or reads these arguments.
if(process.argv[2]) {
 const [root,mode,target,...argv]=process.argv.slice(2);
 let fired=false;
 const io={...fs,link:async(from,to)=>{
  const requestFault=mode==='io-request'&&to.startsWith(join(root,'staging/apply-requests')+'/');
  const historyFault=['io-history','io-history-unknown'].includes(mode)&&to.startsWith(join(root,'staging/apply-history')+'/');
  if(requestFault||historyFault){
   if(mode==='io-history-unknown'&&!fired){fired=true;await fs.appendFile(join(root,'data/works.csv'),'UNKNOWN');}
   throw Object.assign(Error('trusted persistent History failure'),{code:'EIO'});
  }
  return fs.link(from,to);
 },rename:async(from,to)=>{
  const hit=!fired&&mode==='io'&&to===join(root,'staging/fn004-state.json');
  await fs.rename(from,to);
  if(hit){fired=true;throw Object.assign(Error('trusted syscall failure'),{code:'EIO'});}
 }};
 process.exitCode=await runCanonicalCli(argv,{root,servicesFactory:(r,actor,cliOptions={})=>managementServices(r,actor,{...cliOptions,
  ...(mode.startsWith('io')?{io}:{}),onBoundary:async e=>{
   const [phase,path]=target.split('|');await cliOptions.onBoundary?.(e);
   if(mode==='kill'&&e.phase===phase&&(!path||e.path===path)&&!fired){fired=true;process.stderr.write('TRUSTED_TEST_BOUNDARY\n');await new Promise(()=>{setInterval(()=>{},1000);});}
  }
 })});
}
