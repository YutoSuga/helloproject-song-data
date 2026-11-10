import {createApprovalRequestService} from './fn004-approval-application.js';
import {executeAcceptedRequest} from './fn004-normal-apply.js';

// Normal 6E composition used by the 6F CLI application adapter. The lower
// approval/request factory retains its acceptance-only default. No client
// execution/skip flag or HTTP dispatch is exposed.
export function createCanonicalApplyService(options={}) {
  return createApprovalRequestService({...options,execute:executeAcceptedRequest});
}
