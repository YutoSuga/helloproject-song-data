import { createRecoveryExecutor } from './fn004-recovery-executor.js';

// Existing failure-only API and boundaries remain unchanged.
export const createFailureRecoveryService = (root, options) => createRecoveryExecutor(root, options, false);
