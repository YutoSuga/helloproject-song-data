import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalJson } from './canonical-hash.js';
import { assertGateOwnership, withCanonicalGate } from './fn004-gate.js';
import { RepositoryError } from './persistence.js';
import { approvalId, requestId, invalidationId, validateApproval, validateApplyRequest, validateInvalidation, integrity } from './fn004-approval-schema.js';
const execute = promisify(execFile);
export const INVALIDATIONS = 'staging/apply-approvals/invalidations';
export function approvalPath(id) { if(!approvalId(id)) throw new RepositoryError('PATH_UNSAFE','Invalid Approval ID'); return `staging/apply-approvals/${id}.json`; }
export function requestPath(id) { if(!requestId(id)) throw new RepositoryError('PATH_UNSAFE','Invalid Request ID'); return `staging/apply-requests/${id}.json`; }
export function invalidationPath(id) { if(!invalidationId(id)) throw new RepositoryError('PATH_UNSAFE','Invalid Invalidation ID'); return `${INVALIDATIONS}/${id}.json`; }

// Schema and immutable persistence only; static cross-artifact checks belong to
// the application service. Every operation uses the caller's live common lease.
export function approvalRepository(store, {io = fs} = {}) {
  const gated = (gate,fn) => withCanonicalGate({root:store.root,gate,operation:'approval_artifact',fn});
  async function read(path,validate,id) {
    try { return validate(await store.readJson(path,{strict:true}),id); }
    catch(e) {
      if(['PERSISTENCE_PARSE_FAILED','PERSISTENCE_INVALID_UTF8','PERSISTENCE_ROOT_TYPE'].includes(e.code)) integrity('Malformed Approval/Request/Invalidation JSON');
      throw e;
    }
  }
  async function immutable(path,value,validate,id,gate) {
    value=JSON.parse(canonicalJson(value));
    await assertGateOwnership(gate,store.root);
    validate(value,id);
    if(await store.exists(path)) {
      const old=await read(path,validate,id);
      if(canonicalJson(old)!==canonicalJson(value)) integrity('Immutable artifact differs');
      return old;
    }
    await store.createJsonExclusive(path,value);
    return value;
  }
  return {
    getApproval:(id,{gate}={})=>gated(gate,()=>read(approvalPath(id),validateApproval,id)),
    saveApproval:(v,{gate}={})=>immutable(approvalPath(v.approval_id),v,validateApproval,v.approval_id,gate),
    getApplyRequest:(id,{gate}={})=>gated(gate,()=>read(requestPath(id),validateApplyRequest,id)),
    saveApplyRequest:(v,{gate}={})=>immutable(requestPath(v.receipt.request_id),v,validateApplyRequest,v.receipt.request_id,gate),
    getApprovalInvalidation:(id,{gate}={})=>gated(gate,()=>read(invalidationPath(id),validateInvalidation,id)),
    saveApprovalInvalidation:(v,{gate}={})=>immutable(invalidationPath(v.event_id),v,validateInvalidation,v.event_id,gate),
    listApprovalInvalidations:({gate}={})=>gated(gate,async()=>{
      let names;
      try {names=await store.exists(INVALIDATIONS) ? await io.readdir(await store.resolvePath(INVALIDATIONS)) : [];}
      catch(cause) {if(cause instanceof RepositoryError) throw cause;throw new RepositoryError('PERSISTENCE_READ_FAILED','Cannot list Invalidation directory',{path:INVALIDATIONS,cause});}
      // Tracked deletions are evidence, even when the directory is absent.
      let tracked;
      try { tracked=(await execute('git',['-C',store.root,'ls-files','-z','--',`${INVALIDATIONS}/`])).stdout.split('\0').filter(Boolean); }
      catch(cause) { throw new RepositoryError('INTEGRITY_CONFLICT','Cannot verify tracked Invalidation evidence',{cause}); }
      for(const path of tracked) if(!await store.exists(path)) integrity('Tracked Invalidation is missing');
      const result=[];
      for(const name of names.sort()) {
        const id=name.endsWith('.json')?name.slice(0,-5):null;
        if(!invalidationId(id)) integrity('Unexpected Invalidation entry');
        const path=invalidationPath(id); let stat;
        try {stat=await io.lstat(await store.resolvePath(path));}
        catch(cause) {if(cause instanceof RepositoryError) throw cause;throw new RepositoryError('PERSISTENCE_READ_FAILED','Cannot inspect Invalidation entry',{path,cause});}
        if(!stat.isFile() || stat.isSymbolicLink()) integrity('Invalid Invalidation entry kind');
        result.push(await read(path,validateInvalidation,id));
      }
      return result;
    })
  };
}
