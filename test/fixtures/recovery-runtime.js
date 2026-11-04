import * as fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function fixture(t, mode, keepAlive = false) {
  const root = await fs.mkdtemp(join(tmpdir(),'fn004-recovery-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const child = fork(new URL('./recovery-runtime-child.js',import.meta.url),['setup',root,mode],{stdio:['ignore','ignore','pipe','ipc']});
  let error='';child.stderr.on('data',c=>error+=c);
  const msg = await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(error);})]);
  if (keepAlive) t.after(async()=>{if(child.exitCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}});
  else {const exit=once(child,'exit');child.kill('SIGKILL');const [,signal]=await exit;if(signal!=='SIGKILL')throw new Error('Fixture did not terminate by SIGKILL');}
  return {root,binding:msg[0].binding,child};
}
export const command = (b,o) => ({schema_version:2,request_id:b.request_id,transaction_id:b.transaction_id,
  expected_observed_state_hash:o.observed_state_hash,action:o.allowed_actions[0]});
