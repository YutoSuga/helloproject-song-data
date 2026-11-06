import { RepositoryError } from './persistence.js';
import { assertGateOwnership } from './fn004-gate.js';
import { applyHistoryPath, APPLY_ID_PATTERN } from './fn004-history-directory.js';
import { validateHistoryRecord } from './fn004-history-record.js';
import { validateHistoryChain, validateHistoryPlanPrefixes, buildHistoryIndexes } from './fn004-history-projections.js';
import { publisherTarget } from './fn004-evidence-namespace.js';
import { same, check } from './fn004-evidence-types.js';
import { confirmExistingBytes, readPublishedBytes, readPublishedJson } from './fn004-recovery-durability.js';

// The record must be the exact durable COMMIT_DECIDED payload supplied by the
// owned executor. All physical History records are independently revalidated.
export async function publishSuccessfulHistory(store, io, gate, record) {
  validateHistoryRecord(record); await assertGateOwnership(gate, store.root);
  const path=applyHistoryPath(record.payload.apply_id), records=[], temps=[];
  const directory='staging/apply-history';
  if(await store.exists(directory)) {
    let names;
    try { names=await io.readdir(await store.resolvePath(directory)); }
    catch(cause) { throw new RepositoryError('PERSISTENCE_READ_FAILED','Cannot list History publication directory',{path:directory,cause}); }
    for(const name of names.sort()) {
      const p=`${directory}/${name}`,target=publisherTarget(p),value=await store.readJson(p,{strict:true});
      validateHistoryRecord(value);
      if(target) { check(target===path && same(value,record),'Foreign/conflicting History publication temp'); temps.push(p); }
      else { check(name.endsWith('.json')&&APPLY_ID_PATTERN.test(name.slice(0,-5))&&p===applyHistoryPath(value.payload.apply_id),'Unknown History artifact'); records.push(value); }
    }
  }
  const existing=records.find(r=>r.payload.apply_id===record.payload.apply_id);
  check(!existing||same(existing,record),'History identity has different immutable content');
  const identity={repository_instance_id:record.payload.repository_instance_id,bootstrap_hash:record.payload.bootstrap_hash};
  const chain=validateHistoryChain(existing?records:[...records,record],identity);
  validateHistoryPlanPrefixes(chain,identity);buildHistoryIndexes(chain,identity);
  for(const p of temps) {
    // Formatting is not changed; confirm the exact existing temp bytes.
    const bytes=await readPublishedBytes(store,io,p);
    await confirmExistingBytes(store,io,p,bytes);
  }
  if(existing) await confirmExistingBytes(store,io,path,await readPublishedBytes(store,io,path));
  else await store.createJsonExclusive(path,record);
  const reread=validateHistoryRecord(await readPublishedJson(store,path));
  check(same(reread,record),'Published History readback differs from decision');
  await assertGateOwnership(gate,store.root);
  return reread;
}
