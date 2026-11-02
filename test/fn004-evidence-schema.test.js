import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceHashV1 } from '../src/fn004-evidence-hash.js';
import { validateOwner, validateIntent, validateJournalEntry } from '../src/fn004-transaction-evidence.js';
import { validateJournalChain } from '../src/fn004-journal-chain.js';
import { validateTerminalProof, validateCompletion } from '../src/fn004-terminal-evidence.js';
import { proveTerminalHistory } from '../src/fn004-terminal-history.js';
import { transactionFixture, abortedFixture, append, rehash } from './fixtures/transaction-evidence.js';

const copy = structuredClone;
const invalid = fn => assert.throws(fn, { code: 'INTEGRITY_CONFLICT' });
test('formal projection vectors reuse JCS/SHA while empty payload is not domain-valid', () => {
  assert.equal(evidenceHashV1('fn004-journal', {}), '64a4744396427ce4c3b2ef036a0c93a1aca13de5e51bdfaa6c79ba8593bd5f79');
  assert.equal(evidenceHashV1('fn004-recovery-retiring', {}), '5cf9aaf04b4acf1ab5ebec7799a918cebd33cc3abab0313a232eff4020577dfe');
  invalid(() => validateJournalEntry({ schema_version: 1, kind: 'fn004-journal', payload: {}, hash: evidenceHashV1('fn004-journal', {}) }));
});

for (const kind of ['Owner', 'Intent', 'Journal', 'Proof', 'Completion']) {
  test(`${kind}: closed root/payload, required keys, version and rehashed unknown fields`, () => {
    const f = abortedFixture();
    const [value, validate] = { Owner: [f.owner, v => validateOwner(v, f.inputs)],
      Intent: [f.intent, v => validateIntent(v, { owner: f.owner, inputs: f.inputs })],
      Journal: [f.genesis, validateJournalEntry], Proof: [f.proof, validateTerminalProof],
      Completion: [f.completion, v => validateCompletion(v, f.proof)] }[kind];
    validate(value);
    for (const key of Object.keys(value)) { const bad = copy(value); delete bad[key]; invalid(() => validate(bad)); }
    for (const key of Object.keys(value.payload)) { const bad = copy(value); delete bad.payload[key]; rehash(bad); invalid(() => validate(bad)); }
    for (const [mutate, recalculate] of [[v => v.extra = 1, false], [v => v.schema_version = 2, false],
      [v => v.payload.extra = 1, true], [v => v.hash = '0'.repeat(64), false], [v => v.kind = 'unknown', false]]) {
      const bad = copy(value); mutate(bad); if (recalculate) rehash(bad);
      invalid(() => validate(bad));
    }
  });
}

test('6A-DG01-01: PREPARING(null) can terminate ABORTED(null) with complete journal Proof/Completion', () => {
  const f = abortedFixture();
  const result = validateJournalChain({ owner: f.owner, intent: null, entries: f.proof.payload.journal, inputs: f.inputs });
  assert.equal(result.head.payload.intent_hash, null); assert.equal(result.intent_state, 'NOT_CREATED');
  validateTerminalProof(f.proof); validateCompletion(f.completion, f.proof);
  assert.equal(f.completion.payload.terminal_journal.entry_hash, f.terminal.hash);
  assert.deepEqual(f.proof.payload.before_state, f.proof.payload.after_state);
});

test('Intent establishment lag and H-bound abort are valid without rewriting genesis', () => {
  const f = abortedFixture({ withIntent: true });
  const lag = validateJournalChain({ owner: f.owner, intent: f.intent, entries: [f.genesis], inputs: f.inputs });
  assert.equal(lag.intent_hash, f.intent.hash); assert.equal(f.genesis.payload.intent_hash, null);
  validateTerminalProof(f.proof); validateCompletion(f.completion, f.proof);
});

test('null never stands for a missing/corrupt established Intent or a changed Intent hash', () => {
  const f = abortedFixture({ withIntent: true });
  invalid(() => validateJournalChain({ owner: f.owner, intent: null, entries: f.proof.payload.journal, inputs: f.inputs }));
  const checkpoint = append(f.genesis, { ...f.terminal.payload, phase: 'PREPARING', terminal_state: null });
  for (const intent_hash of [null, 'f'.repeat(64)]) {
    const terminal = append(checkpoint, { phase: 'ABORTED', terminal_state: f.state, intent_hash });
    invalid(() => validateJournalChain({ owner: f.owner, intent: f.intent, entries: [f.genesis, checkpoint, terminal], inputs: f.inputs }));
  }
  const before = abortedFixture();
  invalid(() => validateJournalChain({ owner: before.owner, intent: before.intent, entries: before.proof.payload.journal, inputs: before.inputs }));
});

test('journal gap, duplicate/fork, bad predecessor, illegal phase, time drift and post-terminal append fail closed', () => {
  const f = abortedFixture();
  const run = entries => validateJournalChain({ owner: f.owner, intent: null, entries, inputs: f.inputs });
  for (const entries of [[f.terminal], [f.genesis, f.genesis], [f.genesis, f.terminal, append(f.terminal, {})]]) invalid(() => run(entries));
  for (const mutate of [p => p.previous_entry_hash = 'f'.repeat(64), p => p.sequence = 3,
    p => p.phase = 'COMPLETED', p => p.apply_time = '2026-10-26T00:00:00Z',
    p => p.binding.transaction_id = 'tx_00000000-0000-4000-8000-000000000099']) {
    const bad = copy(f.terminal); mutate(bad.payload); rehash(bad); invalid(() => run([f.genesis, bad]));
  }
});

test('Proof/Completion exact identity, terminal state, journal ordering and no success-only failure result', () => {
  const f = abortedFixture();
  for (const mutate of [p => p.intent = f.intent, p => p.journal.reverse(), p => p.after_state.generation++,
    p => p.phase = 'COMPLETED', p => p.final_manifest = f.intent.payload.target_manifest]) {
    const bad = copy(f.proof); mutate(bad.payload); rehash(bad); assert.throws(() => validateTerminalProof(bad));
  }
  invalid(() => validateCompletion(f.completion, null));
  for (const mutate of [p => p.proof_hash = 'f'.repeat(64), p => p.terminal_journal = null,
    p => p.result = { apply_id: f.binding.apply_id, record_hash: 'f'.repeat(64) }]) {
    const bad = copy(f.completion); mutate(bad.payload); rehash(bad); invalid(() => validateCompletion(bad, f.proof));
  }
  const receipt = abortedFixture({ receiptOnly: true }); validateTerminalProof(receipt.proof);
  assert.equal(receipt.completion.payload.terminal_journal, null);
});

test('composite pure state profile keeps zero-change aborts on the proven checkpoint', () => {
  const f = abortedFixture();
  const result = proveTerminalHistory({ bootstrap: f.bootstrap, records: [], proofs: [f.proof] });
  assert.deepEqual(result.terminal, f.state);
  invalid(() => proveTerminalHistory({ bootstrap: f.bootstrap, records: [], proofs: [f.proof, f.proof] }));
});
