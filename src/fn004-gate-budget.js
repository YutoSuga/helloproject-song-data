import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

// Internal acquisition context; never a CLI option or persisted authority.
const budgets = new AsyncLocalStorage();
export const gateNow = () => performance.now();
export const gateDeadline = () => budgets.getStore() ?? Infinity;
export function withGateAcquisitionBudget(milliseconds, fn) {
  return budgets.run(Math.min(gateDeadline(), gateNow() + milliseconds), fn);
}
