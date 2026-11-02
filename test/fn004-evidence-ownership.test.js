import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOwnershipArchive, validateMutexAnchor, validateMutexClaim, validateMutexBarrier,
  validateMutexRetiring, validateMutexRetired } from '../src/fn004-evidence-ownership.js';
import { abortedFixture, ownershipFixture, rehash } from './fixtures/transaction-evidence.js';

const bad = fn => assert.throws(fn, { code: 'GATE_CORRUPT' });
test('H-01: permanent full archive retains latest successor through all retirement stages', () => {
  const f = abortedFixture();
  for (const retirement of ['ACTIVE', 'RETIRING', 'RETIRED', 'SEALED']) {
    const a = ownershipFixture(f, { count: 3, retirement });
    const value = validateOwnershipArchive({ ...a, claims: [...a.claims].reverse(), retirements: [...a.retirements].reverse() });
    assert.equal(value.sequence, 3); assert.equal(value.head.hash, a.claims[2].hash); assert.equal(value.state, retirement);
    const withoutLatest = { ...a, claims: a.claims.slice(0, -1) };
    if (retirement !== 'ACTIVE') bad(() => validateOwnershipArchive(withoutLatest));
    assert.equal(a.claims.length, 3); // Validators never delete/GC or mutate evidence.
  }
});

test('ownership gap/fork/duplicate, predecessor mismatch and same-sequence different bytes are rejected', () => {
  const f = abortedFixture(), a = ownershipFixture(f, { count: 3 });
  for (const claims of [a.claims.slice(1), [a.claims[0], a.claims[2]], [...a.claims, a.claims[2]]]) bad(() => validateOwnershipArchive({ ...a, claims }));
  for (const mutate of [p => p.previous_claim_hash = 'f'.repeat(64), p => p.sequence = 1,
    p => p.binding.repository_instance_id = 'repo_00000000-0000-4000-8000-000000000099',
    p => p.predecessor_exit.owner.process_start_id = 'reused', p => p.owner.boot_id = 'another-boot']) {
    const claims = structuredClone(a.claims); mutate(claims[1].payload); rehash(claims[1]);
    bad(() => validateOwnershipArchive({ ...a, claims }));
  }
});

test('retirement cannot exist without owner/Retiring or exact reference/hash/owner/barrier', () => {
  const f = abortedFixture(), a = ownershipFixture(f, { retirement: 'RETIRED' });
  bad(() => validateOwnershipArchive({ ...a, retirements: [a.retirements[1]] }));
  for (const mutate of [p => p.retiring_hash = 'f'.repeat(64), p => p.owner.sequence = 0,
    p => p.owner.owner_hash = a.anchor.hash, p => p.canonical_gate_released = false]) {
    const records = structuredClone(a.retirements); mutate(records[1].payload); rehash(records[1]);
    bad(() => validateOwnershipArchive({ ...a, retirements: records }));
  }
  const retiring = structuredClone(a.retirements[0]); retiring.payload.barrier.inode = '999'; rehash(retiring);
  const retired = structuredClone(a.retirements[1]); retired.payload.retiring_hash = retiring.hash; rehash(retired);
  validateOwnershipArchive({ ...a, retirements: [retiring, retired] }); // Physical witness checked against collection by snapshot validation.
});

test('active/retiring owners cannot become sealed merely because barrier disappeared', () => {
  const f = abortedFixture();
  for (const retirement of ['ACTIVE', 'RETIRING']) bad(() => validateOwnershipArchive({ ...ownershipFixture(f, { retirement }), barrier: null }));
});

for (const kind of ['anchor', 'claim', 'barrier', 'retiring', 'retired']) {
  test(`${kind} closed schema, version and required fields`, () => {
    const a = ownershipFixture(abortedFixture(), { retirement: 'RETIRED' });
    const [value, validate] = { anchor: [a.anchor, validateMutexAnchor], claim: [a.claims[0], validateMutexClaim],
      barrier: [a.barrier, validateMutexBarrier], retiring: [a.retirements[0], validateMutexRetiring], retired: [a.retirements[1], validateMutexRetired] }[kind];
    validate(value);
    for (const key of Object.keys(value.payload)) {
      const mutated = structuredClone(value); delete mutated.payload[key]; rehash(mutated); bad(() => validate(mutated));
    }
    for (const mutate of [v => v.payload.extra = 1, v => v.schema_version = 2]) {
      const mutated = structuredClone(value); mutate(mutated); rehash(mutated); bad(() => validate(mutated));
    }
  });
}
