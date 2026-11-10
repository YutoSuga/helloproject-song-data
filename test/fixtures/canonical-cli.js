import * as fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {normalApplyFixture} from './normal-apply.js';
import {sha256} from '../../src/canonical-hash.js';
const execute=promisify(execFile);
export const cliPath=fileURLToPath(new URL('../../scripts/canonical-manage.js',import.meta.url));
export const testCliPath=fileURLToPath(new URL('./canonical-cli-process.js',import.meta.url));
const ptyPath=fileURLToPath(new URL('./canonical-cli-pty.py',import.meta.url));
export async function cli(root,args,env={}) {
 const childEnv={...process.env,...env};
 try {const r=await execute(process.execPath,[cliPath,...args,'--json'],{cwd:root,env:childEnv,maxBuffer:32*1024*1024});return {code:0,stdout:r.stdout,stderr:r.stderr,data:JSON.parse(r.stdout)};}
 catch(error){if(typeof error.code!=='number')throw error;return {code:error.code,stdout:error.stdout,stderr:error.stderr,data:JSON.parse(error.stdout)};}
}
export async function tty(root,args,{answer='y\n',env={},mode,target,signal='SIGKILL'}={}) {
 const argv=mode?[process.execPath,testCliPath,root,mode,target??'',...args,'--json']:[process.execPath,cliPath,...args,'--json'];
 const r=await execute('python3',[ptyPath,JSON.stringify({root,argv,answer,env,kill_boundary:mode==='kill',stop_signal:signal})],{maxBuffer:32*1024*1024,timeout:900000});
 const value=JSON.parse(r.stdout);
 return {...value,data:value.stdout?JSON.parse(value.stdout):null};
}
export async function cliFixture(t,options={}) {
 const f=await normalApplyFixture(t,options);
 return {...f,args:['apply','--plan',f.plan.plan_id,'--expect-plan-hash',f.plan.plan_hash]};
}
export async function evidenceHashes(root) {
 const result={};
 async function walk(relative){for(const e of await fs.readdir(join(root,relative),{withFileTypes:true})){const p=relative+'/'+e.name;if(e.isDirectory())await walk(p);else result[p]=sha256(await fs.readFile(join(root,p)));}}
 await walk('data');await walk('staging');return result;
}
