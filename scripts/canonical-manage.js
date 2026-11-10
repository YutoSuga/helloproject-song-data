import {runCanonicalCli} from '../src/canonical-cli.js';

// SIGINT after acceptance retains the normal runtime's gate/evidence. No
// process exit handler sweeps artifacts, unlocks or infers Recovery.
let outputFailed=false;
process.stdout.on('error',()=>{outputFailed=true;process.exitCode=1;});
let code=1;
try {code=await runCanonicalCli(process.argv.slice(2));}
catch {
  // Even an unexpected adapter/rendering failure must not print an internal
  // exception or infer a transaction result. No cleanup runs in this handler.
  process.stdout.write(JSON.stringify({outcome:'unknown_result',canonical_effect:'unknown',readiness:'blocked',
    diagnostics:[{code:'UNKNOWN_ERROR'}],allowed_actions:[],error:{code:'UNKNOWN_ERROR'}})+'\n');
}
process.exitCode=outputFailed?1:code;
