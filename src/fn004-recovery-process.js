import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { same } from './fn004-evidence-types.js';

const instance = randomUUID(), started = new Date(Date.now() - process.uptime() * 1000).toISOString();
let identity;
export async function recoveryProcessIdentity() {
  identity ??= (async () => {
    const optional = async fn => { try { return await fn(); } catch { return null; } };
    return Object.freeze({ process_id: process.pid, hostname: hostname(), platform: process.platform,
      process_instance_id: instance, process_started_at: started,
      process_start_id: await optional(async () => (await fs.readFile('/proc/self/stat', 'utf8')).split(') ').at(-1).split(' ')[19]),
      boot_id: await optional(async () => (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()),
      pid_namespace: await optional(() => fs.readlink('/proc/self/ns/pid')) });
  })();
  return identity;
}
// No kill(pid,0), stale PID or client-provided ExitProof grants authority.
export async function probeRecoveryOwner(owner) {
  const observer = await recoveryProcessIdentity();
  let status = 'unverifiable';
  if (owner.platform === 'linux' && owner.process_start_id !== null &&
    ['hostname', 'boot_id', 'pid_namespace'].every(k => owner[k] !== null && owner[k] === observer[k])) {
    try {
      const stat = await fs.readFile(`/proc/${owner.process_id}/stat`, 'utf8');
      status = stat.split(') ').at(-1).split(' ')[19] === owner.process_start_id ? 'live' : 'unverifiable';
    } catch (cause) { if (cause.code === 'ENOENT') status = 'exited'; }
  }
  if (same(owner, observer)) status = 'live';
  return { owner, observer, status };
}
