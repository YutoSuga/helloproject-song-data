// Test-only process crash harness. No production command/dispatch is exposed.
import { prepareFixture } from './durable-prepare.js';
import { createTransactionPreparer } from '../../src/fn004-durable-prepare.js';

if (process.argv[2] === '--prepare-crash-child') {
  try {
    const f = await prepareFixture({ after() {} });
    process.send({ type: 'setup', root: f.root });
    const service = await createTransactionPreparer(f.root, { onBoundary: async event => {
      if (event.phase === process.argv[3]) {
        process.send({ type: 'boundary', boundary: event.phase, root: f.root, binding: f.binding, before: f.before });
        await new Promise(() => {}); // Parent kills this process; no catch/finally cleanup.
      }
    } });
    await service.prepare({ gate: f.gate, binding: f.binding, apply_time: f.apply_time });
    process.send({ type: 'error', message: 'Expected crash boundary was not reached' });
  } catch (error) { process.send({ type: 'error', message: error.stack }); }
}
