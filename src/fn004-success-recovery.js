import { createRecoveryExecutor } from './fn004-recovery-executor.js';

// Internal success-only service. run requires dead-owner Recovery authority;
// finalize consumes the original owner's live gate after a durable decision.
// Neither method dispatches Apply, consumes IDs or replaces canonical files.
export const createSuccessRecoveryService = (root, options) => createRecoveryExecutor(root, options, true);
