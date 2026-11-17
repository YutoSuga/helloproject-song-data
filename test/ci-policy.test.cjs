const test = require('node:test');
const assert = require('node:assert/strict');
const selectMode = require('../.github/scripts/ci-policy.cjs');
const sha = 'a'.repeat(40);
const repo = { owner: 'owner', repo: 'repo' };
const pr = { number: 1, merged: true, merged_at: '2026-11-17', merge_commit_sha: sha,
  base: { ref: 'main', repo: { full_name: 'owner/repo' } }, labels: [{ name: 'ci:light' }] };
async function run({ eventName = 'push', pulls = [pr], detail = pr, error, detailError, payload = {} } = {}) {
  const outputs = {}, warnings = [];
  let requests = 0;
  const github = { rest: { repos: { listPullRequestsAssociatedWithCommit() {} }, pulls: {
    async get() { requests++; if (detailError) throw detailError; return { data: detail }; }
  } }, async paginate(method, args) {
    assert.equal(args.commit_sha, sha); assert.equal(args.per_page, 100);
    if (error) throw error; return pulls;
  } };
  await selectMode({ github, context: { eventName, sha, repo, payload }, core: {
    setOutput: (key, value) => { outputs[key] = value; }, info() {}, warning: msg => warnings.push(msg)
  } });
  assert.equal(outputs.sha, sha);
  return { ...outputs, warnings, requests };
}
test('exact merged PR selects light; no label selects full', async () => {
  assert.equal((await run()).mode, 'light');
  assert.equal((await run({ detail: { ...pr, labels: [] } })).mode, 'full');
});
for (const [name, options] of Object.entries({
  'API failure': { error: Error('403') }, 'detail API failure': { detailError: Error('503') },
  'different detail PR': { detail: { ...pr, number: 2 } }, 'no match': { pulls: [] },
  'ambiguous match': { pulls: [pr, { ...pr, number: 2 }] },
  'different merge SHA': { pulls: [{ ...pr, merge_commit_sha: 'b'.repeat(40) }] },
  'unmerged PR': { pulls: [{ ...pr, merged_at: null }] },
  'different base': { pulls: [{ ...pr, base: { ...pr.base, ref: 'other' } }] },
  'different repository': { pulls: [{ ...pr, base: { ...pr.base, repo: { full_name: 'other/repo' } } }] },
  'detail changed': { detail: { ...pr, merge_commit_sha: 'b'.repeat(40) } },
  'detail not merged': { detail: { ...pr, merged: false } },
  'malformed detail': { detail: {} }
})) test(`${name} falls back to full with a warning`, async () => {
  const result = await run(options); assert.equal(result.mode, 'full'); assert.equal(result.warnings.length, 1);
});
test('irrelevant associated PRs do not obscure the single exact match', async () => {
  assert.equal((await run({ pulls: [pr, { ...pr, merge_commit_sha: 'b'.repeat(40) }] })).mode, 'light');
});
test('manual execution is full without label API access', async () => {
  const result = await run({ eventName: 'workflow_dispatch', error: Error('must not call API') });
  assert.equal(result.mode, 'full'); assert.equal(result.warnings.length, 0); assert.equal(result.requests, 0);
});
for (const light of [true, false]) test(`PR label selects ${light ? 'light' : 'full'}`, async () => {
  const result = await run({ eventName: 'pull_request', payload: { pull_request: { labels: light ? pr.labels : [] } } });
  assert.equal(result.mode, light ? 'light' : 'full'); assert.equal(result.requests, 0);
});
