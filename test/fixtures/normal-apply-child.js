import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {createCanonicalApplyService as createApprovalRequestService} from '../../src/fn004-apply-application.js';

// node --test also discovers fixture modules; only an explicit IPC worker runs.
if(process.send&&process.argv.length>=6){
const [root,payloadJson,contextJson,boundary,selectedPath='']=process.argv.slice(2);
const payload=JSON.parse(payloadJson),context=JSON.parse(contextJson);
// A pending Promise alone does not keep Node alive at a trusted pause.
setInterval(()=>{},1000);
const pause=async message=>{
  process.send(message);
  await new Promise(()=>{});
};
const service=createApprovalRequestService({root,onBoundary:async event=>{
  if(event.phase!==boundary||selectedPath&&event.path!==selectedPath)return;
  const artifact=JSON.parse(await fs.readFile(join(root,`staging/apply-requests/${payload.request_id}.json`)));
  const bootstrap=JSON.parse(await fs.readFile(join(root,'staging/fn004-bootstrap.json')));
  const {requested_at,...identity}=artifact.receipt;
  await pause({boundary:event.phase,path:event.path,binding:{...identity,
    receipt_hash:artifact.receipt_hash,bootstrap_hash:bootstrap.bootstrap_hash}});
}});
try {await service.submitApplyRequest(payload,context);process.send({unexpected:'completed without pause'});}
catch(error){process.send({unexpected:'error',code:error.code,message:error.message,stack:error.stack});}

}
