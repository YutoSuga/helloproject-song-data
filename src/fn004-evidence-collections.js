import { validateApplyPlan } from './fn004-plan-validator.js';
import { validateApproval, validateInvalidation, approvalHash } from './fn004-approval-schema.js';
import { check, same } from './fn004-evidence-types.js';
import { publisherTarget } from './fn004-evidence-namespace.js';
// Shared static collection checks. No mutation, freshness decision or gate bypass.
export function validateEvidenceCollections({ docs, requests, binding: b, required, attempt, add }) {
  for (const [path, value] of Object.entries(docs)) {
    if (publisherTarget(path)) continue;
    if (/^staging\/apply-plans\//.test(path)) attempt(() => {
      validateApplyPlan(value); check(path === `staging/apply-plans/${value.plan_id}.json`, 'Plan filename mismatch');
    });
    if (/^staging\/apply-approvals\/apr_/.test(path)) attempt(() => {
      validateApproval(value); check(path === `staging/apply-approvals/${value.approval_id}.json`, 'Approval filename mismatch');
      const plan = required(`staging/apply-plans/${value.plan_id}.json`);
      validateApplyPlan(plan);
      check(value.repository_instance_id === b.repository_instance_id && plan.payload.bootstrap_hash === b.bootstrap_hash &&
        plan.plan_hash === value.plan_hash && same(plan.payload.decision.identity, { decision_id: value.decision_id,
          revision: value.revision, content_hash: value.decision_content_hash }), 'Approval static binding mismatch');
    });
    if (path.startsWith('staging/apply-history/')) attempt(() => check(path === `staging/apply-history/${value?.payload?.apply_id}.json`, 'History filename mismatch'));
    if (path.startsWith('staging/transaction-proofs/')) attempt(() => check(path === `staging/transaction-proofs/${value?.payload?.binding?.transaction_id}.json`, 'Proof filename mismatch'));
    if (path.startsWith('staging/apply-approvals/invalidations/')) attempt(() => {
      validateInvalidation(value, path.split('/').at(-1).slice(0, -5));
      const approval = validateApproval(required(`staging/apply-approvals/${value.approval_id}.json`));
      check(value.approval_hash === approvalHash(approval) && value.repository_instance_id === approval.repository_instance_id,
        'Invalidation does not bind Approval');
      const accepted = requests.find(request => request.receipt.request_id === approval.intended_request_id);
      if (value.accepted_request === null) check(!accepted, 'Pre-accept Invalidation coexists with Receipt');
      else {
        if (!accepted) { add('RECOVERY_REQUIRED'); return; }
        check(accepted.receipt.approval_id === approval.approval_id && accepted.receipt.approval_hash === value.approval_hash &&
          same(value.accepted_request, { request_id: accepted.receipt.request_id, receipt_hash: accepted.receipt_hash }),
        'Invalidation does not bind exact Receipt');
      }
    });
  }
}
