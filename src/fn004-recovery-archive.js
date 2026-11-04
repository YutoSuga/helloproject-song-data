import { RepositoryError } from './persistence.js';
import { validateOwnershipArchive } from './fn004-evidence-ownership.js';
import { evidencePath } from './fn004-evidence-persistence.js';
import { publisherTarget } from './fn004-evidence-namespace.js';
import { canonicalJson } from './canonical-hash.js';
import { check, same, uuid } from './fn004-evidence-types.js';

// Focused persistence adapter shared by live capability and normal gate checks.
// Full canonical/state/input validation remains in the executor's fresh snapshot;
// this checks every ownership record and the barrier without rereading domain CSVs.
export async function readRecoveryArchive(store, io, tx) {
  try { return await readArchive(store, io, tx); }
  catch (cause) {
    if (cause instanceof RepositoryError && cause.code === 'INTEGRITY_CONFLICT') {
      throw new RepositoryError('GATE_CORRUPT','Invalid ownership archive',{path:`staging/recovery-ownership/${tx}`,cause});
    }
    throw cause;
  }
}
async function readArchive(store, io, tx) {
  check(tx.startsWith('tx_') && uuid(tx.slice(3)), 'Invalid ownership transaction');
  const root = `staging/recovery-ownership/${tx}`, docs = new Map(), temps = [];
  async function names(path) {
    try { return (await io.readdir(await store.resolvePath(path))).sort(); }
    catch (cause) { if (cause instanceof RepositoryError) throw cause;
      throw new RepositoryError('PERSISTENCE_READ_FAILED','Cannot list ownership archive',{path,cause}); }
  }
  async function record(path) {
    const value = await store.readJson(path,{strict:true});
    if (publisherTarget(path)) temps.push({path,value});
    else { check(evidencePath(value)===path,'Noncanonical ownership filename');docs.set(path,value); }
  }
  for (const name of await names(root)) {
    const path=`${root}/${name}`;
    if (['claims','retirements'].includes(name)) for (const child of await names(path)) await record(`${path}/${child}`);
    else if (name==='anchor.json'||publisherTarget(path)) await record(path);
    else check(false,'Unknown ownership archive entry');
  }
  for (const temp of temps) check(docs.has(publisherTarget(temp.path)) && same(temp.value,docs.get(publisherTarget(temp.path))),
    'Unresolved ownership publication cannot be skipped');
  const anchor=docs.get(`${root}/anchor.json`);
  const claims=[...docs].filter(([p])=>p.startsWith(`${root}/claims/`)).map(([,v])=>v);
  const retirements=[...docs].filter(([p])=>p.startsWith(`${root}/retirements/`)).map(([,v])=>v);
  const path='staging/.fn004-recovery.lock';let barrier=null,identity=null;
  if(await store.exists(path)){
    barrier=await store.readJson(path,{strict:true});
    try {
      const absolute=await store.resolvePath(path),stat=await io.lstat(absolute,{bigint:true}),raw=await io.readFile(absolute);
      check(stat.isFile()&&!stat.isSymbolicLink()&&raw.equals(Buffer.from(canonicalJson(barrier)+'\n')),'Barrier bytes/kind are not canonical');
      identity={device:stat.dev.toString(),inode:stat.ino.toString()};
    }catch(cause){if(cause instanceof RepositoryError)throw cause;
      throw new RepositoryError('PERSISTENCE_READ_FAILED','Cannot read barrier identity',{path,cause});}
  }
  return { anchor,claims,retirements,barrier,identity,archive:validateOwnershipArchive({anchor,claims,retirements,barrier}) };
}
