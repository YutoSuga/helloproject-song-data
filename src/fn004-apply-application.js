import {createApprovalRequestService} from './fn004-approval-application.js';
import {executeAcceptedRequest} from './fn004-normal-apply.js';

// Internal 6E composition only. No public command/CLI/HTTP dispatch is wired
// here. The existing acceptance service keeps its acceptance-only default
// until 6F release validation; clients cannot choose an execution/skip flag.
export function createCanonicalApplyService(options={}) {
  return createApprovalRequestService({...options,execute:executeAcceptedRequest});
}
