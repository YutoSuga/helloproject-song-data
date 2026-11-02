import { hashCanonicalJson, canonicalJson, sha256 } from '../../src/canonical-hash.js';
import { evidenceHashV1 } from '../../src/fn004-evidence-hash.js';
import { generatePlanFromInput, generatePlanFromTerminalInput } from '../../src/fn004-plan-generate.js';
import { approvalHash, requestPayloadHash, receiptHashProjectionV1, receiptHash, initialProcessing } from '../../src/fn004-approval-schema.js';
import { deriveConsumedState, createAuditPayload, createBootstrapRecords, DECLARATION_STATEMENT, hashState } from '../../src/fn004-state.js';
import { CANONICAL_TABLES } from '../../src/canonical-schema.js';
import { verifySuccessfulHistory } from '../../src/fn004-history-verify.js';
import { currentIdMaxima } from '../../src/fn004-id-audit.js';
import { planFixture, withNewEntities, time } from './plan-input.js';
import { rowKey, compareKeys } from '../../src/fn004-history-schema.js';
import { COMMIT_PATHS } from '../../src/fn004-evidence-types.js';
import { terminalStateForEntry } from '../../src/fn004-journal-chain.js';
import { allocationRanges, transactionPaths } from '../../src/fn004-transaction-evidence.js';

export const uuid = '00000000-0000-4000-8000-000000000001';
export const artifact = (kind, payload) => ({ schema_version: 1, kind, payload, hash: evidenceHashV1(kind, payload) });
export const rehash = value => { value.hash = evidenceHashV1(value.kind, value.payload); return value; };
export const bytes = value => Buffer.from(canonicalJson(value) + '\n');
export const rawRef = (path, value) => ({ path, byte_length: bytes(value).length, sha256: sha256(bytes(value)) });

const fixtureCsv = (table, rows) => Buffer.from(table.columns.map(column => column.name).join(',') + '\n' + rows.map(row =>
  table.columns.map(column => { const value = row[column.name]; return /[,\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }).join(',') + '\n').join(''));

export function transactionFixture({ gate: suppliedGate, noop = false, newEntities = false, checkpoint = null,
  requestUuid = uuid, pastProofs = [], pastHistories = [] } = {}) {
  const f = checkpoint ? { ...checkpoint, snapshot: { ...checkpoint.snapshot, tables: structuredClone(checkpoint.snapshot.tables) } } :
    newEntities ? withNewEntities(planFixture()) : planFixture();
  if (noop) {
    const relation = f.decision.relations.release_tracks[0], table = CANONICAL_TABLES.find(table => table.name === 'release_tracks');
    f.snapshot.tables.release_tracks = [Object.fromEntries(table.columns.map(column => [column.name,
      column.name === 'release_id' ? relation.release.existing_id : column.name === 'song_id' ? relation.song.existing_id : String(relation[column.name] ?? '')]))];
  }
  f.snapshot.rawBytes = Object.fromEntries(CANONICAL_TABLES.map(table => [table.path, fixtureCsv(table, f.snapshot.tables[table.name])]));
  const files = Object.entries(f.snapshot.rawBytes).map(([path, bytes]) => ({ path, byte_length: bytes.length, sha256: sha256(bytes) }))
    .sort((a, b) => a.path < b.path ? -1 : 1);
  f.snapshot.manifest = { schema_version: 1, files, manifest_hash: hashCanonicalJson(files) };
  if (!checkpoint) {
  const audit_payload = createAuditPayload({ ...f.snapshot, current_maxima: currentIdMaxima(f.snapshot) }, f.git_audit,
    { schema_version: 1, namespaces: f.state.high_water_marks, statement: DECLARATION_STATEMENT, evidence: [] });
  const boot = createBootstrapRecords({ audit_payload, canonical_manifest: f.snapshot.manifest,
    repository_instance_id: f.state.repository_instance_id, initialized_at: time, actor: { id: 'local:test', assurance: 'local_process' },
    expected_audit_hash: hashCanonicalJson(audit_payload) });
  f.bootstrap = boot.record; f.state = boot.state;
  }
  f.history = verifySuccessfulHistory({ ...f, history_directory: { present: true, entries: [] } });
  const plan = checkpoint ? generatePlanFromTerminalInput(f, { bootstrap: f.bootstrap, records: pastHistories, proofs: pastProofs }, { generated_at: time }) :
    generatePlanFromInput(f, { generated_at: time });
  const actor = { id: 'local:test', assurance: 'local_process' };
  const approval = { schema_version: 1, approval_id: `apr_${requestUuid}`, repository_instance_id: f.state.repository_instance_id,
    decision_id: f.decision.decision_id, revision: f.decision.revision, decision_content_hash: f.decision.content_hash,
    plan_id: plan.plan_id, plan_hash: plan.plan_hash, approved_at: time, actor, purpose: 'canonical_apply', intended_request_id: requestUuid };
  const requestPayload = { schema_version: 1, repository_instance_id: f.state.repository_instance_id,
    request_id: requestUuid, decision: plan.payload.decision.identity, plan_id: plan.plan_id, plan_hash: plan.plan_hash,
    approval_id: approval.approval_id, approval_hash: approvalHash(approval), actor, purpose: 'canonical_apply' };
  const receipt = { repository_instance_id: f.state.repository_instance_id, request_id: requestUuid,
    request_payload_hash: requestPayloadHash(requestPayload), decision: requestPayload.decision,
    plan_id: plan.plan_id, plan_hash: plan.plan_hash, approval_id: approval.approval_id,
    approval_hash: requestPayload.approval_hash, actor, requested_at: time,
    transaction_id: `tx_${requestUuid}`, apply_id: `apply_${requestUuid}` };
  const request = { schema_version: 1, receipt, receipt_hash: receiptHash({ schema_version: 1, receipt }), processing: initialProcessing() };
  const binding = { ...receipt, bootstrap_hash: f.state.bootstrap_hash, receipt_hash: request.receipt_hash };
  delete binding.requested_at;
  const inputs = { decision: f.decision, plan, approval, request: receiptHashProjectionV1(request) };
  const process = { process_id: 100, hostname: 'test-host', platform: 'linux', process_instance_id: uuid,
    process_started_at: time, process_start_id: '1000', boot_id: 'boot-1', pid_namespace: 'pid:[1]' };
  const metadata = { schema_version: 1, lock_id: requestUuid, root: '/fixture', operation: 'apply', mode: 'exclusive',
    started_at: time, actor: null, ...process };
  const gate = suppliedGate ?? { metadata, byte_length: bytes(metadata).length, sha256: sha256(bytes(metadata)), device: '1', inode: '2' };
  const owner = artifact('fn004-owner', { binding, gate, before_state: f.state, original_manifest: f.snapshot.manifest, accepted_at: time });
  const genesis = artifact('fn004-journal', { binding, sequence: 1, previous_entry_hash: owner.hash,
    phase: 'PREPARING', resume_phase: null, authority: { gate, recovery: null }, recorded_at: time, apply_time: time,
    intent_hash: null, original_manifest: f.snapshot.manifest, target_manifest: null, changed_paths: [], backup_refs: [],
    temp_refs: [], replaced_paths: [], restored_paths: [], before_state: f.state, consumed_state: null,
    id_consumed: false, terminal_state: null, history: null, error: null });
  const target = structuredClone(f.snapshot.manifest);
  const targetRawBytes = {};
  for (const table of CANONICAL_TABLES) {
    const insertRows = plan.payload.operations.filter(operation => operation.classification === 'insert' && operation.table === table.name)
      .map(operation => Object.fromEntries(Object.entries(operation.result.row_template).map(([key, value]) => [key, typeof value === 'object' ? time : value])))
      .sort((a, b) => compareKeys(table.name, rowKey(table.name, a), rowKey(table.name, b)));
    const raw = insertRows.length ? fixtureCsv(table, [...f.snapshot.tables[table.name], ...insertRows]) : f.snapshot.rawBytes[table.path];
    targetRawBytes[table.path] = raw;
    const file = target.files.find(file => file.path === table.path); file.sha256 = sha256(raw); file.byte_length = raw.length;
  }
  target.manifest_hash = hashCanonicalJson(target.files);
  const paths = transactionPaths(binding), ranges = allocationRanges(plan, f.state, binding.transaction_id);
  const intent = artifact('fn004-intent', { binding, owner_hash: owner.hash, apply_time: time,
    original_manifest: f.snapshot.manifest, target_manifest: target, before_state: f.state,
    expected_consumed_state: deriveConsumedState(f.state, binding.transaction_id, ranges), allocation_ranges: ranges,
    changed_paths: COMMIT_PATHS.filter(path => !sameFile(f.snapshot.manifest, target, path)), backup_refs: [...f.snapshot.manifest.files.map(file => ({ ...file,
      path: `${paths.root}/backup/${file.path}` })), rawRef(`${paths.root}/backup/fn004-state.json`, f.state)].sort((a, b) => a.path < b.path ? -1 : 1),
    temp_refs: target.files.filter(file => !sameFile(f.snapshot.manifest, target, file.path)).map(file => ({ ...file, path: `${paths.root}/temp/${file.path}` })),
    inputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, rawRef(paths.inputs[key], value)])) });
  return { ...f, plan, binding, inputs, request, owner, intent, genesis, process, gate, targetBytes: targetRawBytes['data/release_tracks.csv'], targetRawBytes };
}

const sameFile = (a, b, path) => canonicalJson(a.files.find(file => file.path === path)) === canonicalJson(b.files.find(file => file.path === path));

export function append(previous, changes) {
  return artifact('fn004-journal', { ...structuredClone(previous.payload), sequence: previous.payload.sequence + 1,
    previous_entry_hash: previous.hash, ...changes });
}

export function commitFixture(options = {}) {
  const f = transactionFixture(options), p = f.intent.payload;
  const prepared = append(f.genesis, { phase: 'PREPARED', intent_hash: f.intent.hash,
    target_manifest: p.target_manifest, changed_paths: p.changed_paths, backup_refs: p.backup_refs, temp_refs: p.temp_refs });
  const committing = append(prepared, { phase: 'COMMITTING', consumed_state: p.expected_consumed_state });
  const consumed = append(committing, { id_consumed: true });
  const replaced = append(consumed, { replaced_paths: p.changed_paths });
  const resolve = ref => ref.existing_id ?? f.plan.payload.planned_id_mappings.find(mapping => mapping.local_ref === ref.local_ref).planned_id;
  const payload = { schema_version: 1, repository_instance_id: f.binding.repository_instance_id, bootstrap_hash: f.binding.bootstrap_hash,
    sequence: f.state.history.count + 1, previous_history_hash: f.state.history.head_hash,
    apply_id: f.binding.apply_id, transaction_id: f.binding.transaction_id, decision: f.binding.decision,
    plan: { plan_id: f.plan.plan_id, plan_hash: f.plan.plan_hash },
    approval: { approval_id: f.binding.approval_id, approval_hash: f.binding.approval_hash },
    request: { request_id: f.binding.request_id, request_payload_hash: f.binding.request_payload_hash }, actor: f.binding.actor,
    candidate_coverage: f.decision.candidate_bindings.map(binding => ({ candidate_id: binding.candidate_id,
      source_identity: binding.source_identity, fingerprint: binding.fingerprint, work_id: resolve(binding.work), song_id: resolve(binding.song),
      release_track_keys: binding.release_track_refs.map(ref => f.plan.payload.operations.find(operation => operation.table === 'release_tracks' &&
        operation.source.subject.ref === ref).key).sort((a, b) => compareKeys('release_tracks', a, b)) })),
    id_mappings: f.plan.payload.planned_id_mappings.map(({ planned_id, ...mapping }) => ({ ...mapping, canonical_id: planned_id })),
    results: f.plan.payload.operations.map(operation => {
      const template = operation.result.row_template ?? operation.result.existing_row;
      const row = Object.fromEntries(Object.entries(template).map(([key, value]) => [key, typeof value === 'object' ? time : value]));
      return { operation_id: operation.operation_id, classification: operation.classification, table: operation.table,
        key: operation.key, row, row_hash: hashCanonicalJson({ table: operation.table, row }) };
    }), before_manifest: f.snapshot.manifest, after_manifest: p.target_manifest,
    state_transition: { before: f.state, consumed: p.expected_consumed_state, allocation_ranges: p.allocation_ranges },
    apply_time: time, applied_at: time, rules: { plan: f.plan.payload.rules, transaction: 1, history_record: 1,
      history_hash: 1, history_chain: 1, history_set: 1, state_proof: 1 } };
  const record = { schema_version: 1, payload, record_hash: hashCanonicalJson(payload), decision_snapshot: f.decision,
    plan_snapshot: f.plan, metadata: { published_at: time } };
  const decided = append(replaced, { phase: 'COMMIT_DECIDED', history: { record } });
  const historyCommitted = append(decided, { phase: 'HISTORY_COMMITTED' });
  const after = terminalStateForEntry({ phase: 'COMPLETED', consumed_state: p.expected_consumed_state, history: { record } });
  const completed = append(historyCommitted, { phase: 'COMPLETED', terminal_state: after });
  const journal = [f.genesis, prepared, committing, consumed, replaced, decided, historyCommitted, completed];
  const proof = artifact('fn004-terminal-proof', { binding: f.binding, owner: f.owner, inputs: f.inputs, intent: f.intent,
    journal, phase: 'COMPLETED', before_state: f.state, consumed_state: p.expected_consumed_state, after_state: after,
    final_manifest: p.target_manifest, history: record, authority: completed.payload.authority, ended_at: time, diagnostics: [] });
  const completion = artifact('fn004-completion', { binding: f.binding, phase: 'COMPLETED', proof_hash: proof.hash,
    terminal_journal: { sequence: completed.payload.sequence, entry_hash: completed.hash }, ended_at: time, diagnostics: [],
    result: { apply_id: f.binding.apply_id, record_hash: record.record_hash } });
  return { ...f, prepared, committing, consumed, replaced, decided, historyCommitted, completed, journal, record, after, proof, completion };
}

export function rollbackFixture({ consumed: actualConsumed = true, ...options } = {}) {
  const f = commitFixture(options), last = actualConsumed ? f.replaced : f.committing;
  const rollingBack = append(last, { phase: 'ROLLING_BACK' });
  const restored = append(rollingBack, { restored_paths: actualConsumed ? [...f.intent.payload.changed_paths].reverse() : [] });
  const after = terminalStateForEntry({ ...restored.payload, phase: 'ROLLED_BACK' });
  const terminal = append(restored, { phase: 'ROLLED_BACK', terminal_state: after });
  const journal = [...f.journal.slice(0, actualConsumed ? 5 : 3), rollingBack, restored, terminal];
  const proof = artifact('fn004-terminal-proof', { binding: f.binding, owner: f.owner, inputs: f.inputs, intent: f.intent,
    journal, phase: 'ROLLED_BACK', before_state: f.state, consumed_state: actualConsumed ? f.intent.payload.expected_consumed_state : null,
    after_state: after, final_manifest: f.snapshot.manifest, history: null, authority: terminal.payload.authority, ended_at: time, diagnostics: [] });
  const completion = artifact('fn004-completion', { binding: f.binding, phase: 'ROLLED_BACK', proof_hash: proof.hash,
    terminal_journal: { sequence: terminal.payload.sequence, entry_hash: terminal.hash }, ended_at: time, diagnostics: [], result: null });
  return { ...f, rollingBack, restored, terminal, journal, proof, completion, after };
}

export function abortedFixture({ withIntent = false, receiptOnly = false } = {}) {
  const f = transactionFixture(), intent = withIntent ? f.intent : null;
  const terminal = append(f.genesis, { phase: 'ABORTED', terminal_state: f.state,
    ...(intent ? { intent_hash: intent.hash, target_manifest: intent.payload.target_manifest,
      changed_paths: intent.payload.changed_paths, backup_refs: intent.payload.backup_refs, temp_refs: intent.payload.temp_refs } : {}) });
  const proof = artifact('fn004-terminal-proof', { binding: f.binding, owner: f.owner, inputs: f.inputs,
    intent, journal: receiptOnly ? [] : [f.genesis, terminal], phase: 'ABORTED', before_state: f.state,
    consumed_state: null, after_state: f.state, final_manifest: f.snapshot.manifest, history: null,
    authority: terminal.payload.authority, ended_at: time, diagnostics: [] });
  const completion = artifact('fn004-completion', { binding: f.binding, phase: 'ABORTED', proof_hash: proof.hash,
    terminal_journal: receiptOnly ? null : { sequence: 2, entry_hash: terminal.hash }, ended_at: time, diagnostics: [], result: null });
  return { ...f, terminal, proof, completion };
}

export function recoveryDiscovery(f, { journal = [f.genesis], intent = null, proof = null, completion = null,
  state = f.state, target = false, gate = true, extra = {}, omit = [] } = {}) {
  const root = `staging/transactions/${f.binding.transaction_id}`;
  const values = {
    'staging/fn004-bootstrap.json': f.bootstrap, 'staging/fn004-state.json': state,
    'staging/decisions.json': f.store, 'staging/song-candidates.json': f.candidates,
    [`staging/apply-plans/${f.plan.plan_id}.json`]: f.plan,
    [`staging/apply-approvals/${f.inputs.approval.approval_id}.json`]: f.inputs.approval,
    [`staging/apply-requests/${f.binding.request_id}.json`]: f.request,
    [`${root}/owner.json`]: f.owner,
    ...Object.fromEntries(journal.map(entry => [`${root}/journal/${String(entry.payload.sequence).padStart(6, '0')}.json`, entry]))
  };
  if (gate) values['staging/.fn004.lock'] = f.gate.metadata;
  if (intent) {
    values[`${root}/intent.json`] = intent;
    for (const [key, value] of Object.entries(f.inputs)) values[intent.payload.inputs[key].path] = value;
    values[`${root}/backup/fn004-state.json`] = f.state;
  }
  if (proof) values[`staging/transaction-proofs/${f.binding.transaction_id}.json`] = proof;
  if (completion) values[`staging/apply-requests/completions/${f.binding.request_id}.json`] = completion;
  Object.assign(values, extra);
  const rawBytes = { ...f.snapshot.rawBytes, ...Object.fromEntries(Object.entries(values).map(([path, value]) => [path, bytes(value)])) };
  if (target) Object.assign(rawBytes, f.targetRawBytes);
  if (intent) {
    for (const [path, raw] of Object.entries(f.snapshot.rawBytes)) rawBytes[`${root}/backup/${path}`] = raw;
    for (const ref of intent.payload.temp_refs) rawBytes[ref.path] = f.targetRawBytes[ref.path.slice(`${root}/temp/`.length)];
  }
  for (const path of omit) delete rawBytes[path];
  const files = [], identities = {}, directories = new Set();
  let inode = 1000;
  for (const [path, raw] of Object.entries(rawBytes)) {
    files.push({ path, kind: 'file', byte_length: raw.length, sha256: sha256(raw) });
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent) { directories.add(parent); parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''; }
    identities[path] = { device: f.gate.device, inode: path === 'staging/.fn004.lock' ? f.gate.inode :
      path === 'staging/.fn004-recovery.lock' ? '3' : String(inode++) };
  }
  for (const path of directories) files.push({ path, kind: 'directory', byte_length: null, sha256: null });
  return { root: f.gate.metadata.root, files: files.sort((a, b) => a.path < b.path ? -1 : 1), rawBytes, documents: values, identities };
}

export const exitedProbe = owner => ({ owner, observer: { ...owner, process_id: owner.process_id + 1,
  process_instance_id: '00000000-0000-4000-8000-000000000099' }, status: 'exited' });

export function ownershipFixture(f, { count = 1, retirement = 'ACTIVE' } = {}) {
  const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
  const owner = number => ({ ...f.process, process_id: 200 + number, process_instance_id: id(10 + number) });
  const anchor = artifact('fn004-recovery-mutex', { mutex_id: id(2), binding: f.binding, gate: f.gate,
    owner: owner(0), operator: f.binding.actor, predecessor_exit: { owner: f.process, checked_at: time, status: 'exited' },
    observed_state_hash: 'a'.repeat(64), acquired_at: time });
  const claims = [];
  for (let sequence = 1; sequence <= count; sequence++) {
    const previous = claims.at(-1) ?? anchor;
    claims.push(artifact('fn004-recovery-claim', { mutex_id: id(2), binding: f.binding, sequence,
      previous_claim_hash: previous.hash, owner: owner(sequence), operator: f.binding.actor, gate: f.gate,
      predecessor_exit: { owner: previous.payload.owner, checked_at: time, status: 'exited' },
      observed_state_hash: 'b'.repeat(64), acquired_at: time }));
  }
  const barrier = artifact('fn004-recovery-barrier', { binding: f.binding, mutex_id: id(2), anchor_hash: anchor.hash, barrier_id: id(3) });
  const head = claims.at(-1) ?? anchor, retirements = [];
  if (retirement !== 'ACTIVE') {
    const retiring = artifact('fn004-recovery-retiring', { binding: f.binding, mutex_id: id(2),
      owner: { sequence: count, owner_hash: head.hash },
      barrier: { artifact: barrier, byte_length: bytes(barrier).length, sha256: sha256(bytes(barrier)), device: f.gate.device, inode: '3' },
      canonical_gate: f.gate, terminal_proof_hash: f.proof.hash, completion_hash: f.completion.hash,
      terminal_journal: f.completion.payload.terminal_journal, final_manifest_hash: f.proof.payload.final_manifest.manifest_hash,
      terminal_state_hash: f.proof.payload.after_state.state_hash, retiring_at: time });
    retirements.push(retiring);
    if (retirement === 'RETIRED' || retirement === 'SEALED') retirements.push(artifact('fn004-recovery-retired', {
      binding: f.binding, mutex_id: id(2), owner: retiring.payload.owner, retiring_hash: retiring.hash,
      canonical_gate_released: true, retired_at: time }));
  }
  const root = `staging/recovery-ownership/${f.binding.transaction_id}`;
  const extra = { [`${root}/anchor.json`]: anchor,
    ...Object.fromEntries(claims.map(claim => [`${root}/claims/${String(claim.payload.sequence).padStart(6, '0')}.json`, claim])),
    ...Object.fromEntries(retirements.map(record => [`${root}/retirements/${String(count).padStart(6, '0')}.${record.kind.endsWith('retiring') ? 'retiring' : 'retired'}.json`, record])) };
  if (retirement !== 'SEALED') extra['staging/.fn004-recovery.lock'] = barrier;
  return { anchor, claims, retirements, barrier: retirement === 'SEALED' ? null : barrier, head, extra };
}
