import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {prepareFixture} from './durable-prepare.js';
import {requestPayloadProjectionV1} from '../../src/fn004-approval-schema.js';

export async function normalApplyFixture(t,options={}) {
 const f=await prepareFixture(t,{...options,releaseGate:true});
 await fs.rm(join(f.root,`staging/transactions/${f.binding.transaction_id}`),{recursive:true});
 await fs.rm(join(f.root,`staging/apply-requests/${f.binding.request_id}.json`));
 return {...f,payload:requestPayloadProjectionV1(f.request),context:{actor:f.binding.actor}};
}
