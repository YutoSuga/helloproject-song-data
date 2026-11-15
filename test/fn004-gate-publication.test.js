import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { acquireGate, releaseGate, assertGateOwnership, withCanonicalGate, GATE_PATH } from '../src/fn004-gate.js';
import { isGateCandidate } from '../src/fn004-gate-candidate.js';
import { publisherTarget, validateEvidenceNamespace, isKnownEvidenceFile } from '../src/fn004-evidence-namespace.js';
import { discoverEvidence } from '../src/fn004-evidence-discovery.js';
import { withGateAcquisitionBudget } from '../src/fn004-gate-budget.js';
import { errorExit, errorDocument } from '../src/canonical-cli-output.js';

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'fn004-gp-'));
  await fs.mkdir(join(root, 'staging'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const names = root => fs.readdir(join(root, 'staging'));
const eio = () => Object.assign(new Error('injected IO'), { code: 'EIO', descriptor: { source: 'GP07' } });
const absent = path => assert.rejects(fs.lstat(path), { code: 'ENOENT' });
const handleProxy = (h, overrides) => new Proxy(h, { get(target, key) {
  if (key in overrides) return overrides[key];
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
} });

test('GP01 complete immutable inode is linked and synced before lease/callback', async t => {
  const root = await fixture(t), order = []; let candidate;
  const io = { ...fs, open: async (p, flags, ...args) => {
    const h = await fs.open(p, flags, ...args);
    return handleProxy(h, { sync: async () => { order.push(flags === 'wx' ? 'file_sync' : 'dir_sync'); await h.sync(); } });
  }, link: async (from, to) => {
    candidate = from; const stat = await fs.lstat(from, { bigint: true });
    assert.equal(Number(stat.mode & 0o777n), 0o600);
    assert.ok(order.includes('file_sync'));
    const metadata = JSON.parse(await fs.readFile(from)); assert.equal(metadata.root, root);
    await fs.link(from, to); order.push('link');
    assert.equal((await fs.lstat(to, { bigint: true })).ino, stat.ino);
  }, unlink: async p => { order.push(p === candidate ? 'candidate_unlink' : 'release'); await fs.unlink(p); } };
  await withCanonicalGate({ root, io, fn: async gate => {
    order.push('callback'); await assertGateOwnership(gate);
    assert.equal((await names(root)).length, 1); assert.equal(order.filter(x => x === 'dir_sync').length, 2);
  } });
  assert.ok(order.indexOf('candidate_unlink') < order.indexOf('callback'));
  assert.deepEqual(await names(root), []);
});

test('GP02 a paused incomplete candidate never publishes a partial final or reserves first place', async t => {
  const root = await fixture(t); let resume, reached;
  const paused = new Promise(r => { reached = r; }), ready = new Promise(r => { resume = r; });
  const io = { ...fs, open: async (p, flags, ...args) => {
    const h = await fs.open(p, flags, ...args);
    if (flags !== 'wx') return h;
    return handleProxy(h, { writeFile: async bytes => { reached(); await ready; return h.writeFile(bytes); } });
  } };
  const first = acquireGate({ root, io }); await paused;
  await absent(join(root, GATE_PATH));
  const winner = await acquireGate({ root });
  const loser = assert.rejects(first, { code: 'GATE_BUSY' }); resume(); await loser;
  await assertGateOwnership(winner); await releaseGate(winner);
  assert.deepEqual(await names(root), []);
});

for (const after of [false, true]) test(`GP07 link ${after ? 'after' : 'before'} effect preserves publication evidence`, async t => {
  const root = await fixture(t), cause = eio();
  const io = { ...fs, link: async (...args) => { if (after) await fs.link(...args); throw cause; } };
  await assert.rejects(withCanonicalGate({ root, io, fn: () => assert.fail('no callback') }), error => {
    assert.equal(error.code, 'GATE_ACQUIRE_FAILED'); assert.equal(error.cause, cause);
    assert.equal(error.published, after ? true : null); assert.equal(error.phase, 'publish');
    assert.equal(error.descriptor, cause.descriptor); return true;
  });
  const remaining = await names(root); assert.equal(remaining.filter(n => isGateCandidate(`staging/${n}`)).length, 1);
  if (after) { await assert.rejects(acquireGate({ root }), { code: 'GATE_BUSY' }); }
  else await absent(join(root, GATE_PATH));
});

for (const mode of ['temp_create', 'temp_write', 'file_sync', 'temp_verify', 'directory_sync', 'temp_cleanup', 'cleanup_directory_sync'])
  for (const after of [false, true]) test(`GP07 ${mode} ${after ? 'after' : 'before'} effect has no lease`, async t => {
    const root = await fixture(t), cause = eio(); let fired = false, linked = false, directorySyncs = 0;
    const selected = (phase, p, flags) => !fired && mode === phase &&
      (phase.endsWith('directory_sync') ? linked && p === join(root, 'staging') : true);
    async function inject(phase, p, flags, fn) {
      if (!selected(phase, p, flags)) return fn();
      fired = true; if (after) await fn(); throw cause;
    }
    const io = { ...fs,
      open: async (p, flags, ...args) => {
        // An open-after-effect failure intentionally retains the path; close
        // the test adapter's otherwise unobservable descriptor.
        if (flags === 'wx' && selected('temp_create', p, flags)) {
          fired = true; if (after) { const h = await fs.open(p, flags, ...args); await h.close(); } throw cause;
        }
        const h = await fs.open(p, flags, ...args);
        return handleProxy(h, {
          writeFile: (...values) => inject('temp_write', p, flags, () => h.writeFile(...values)),
          sync: () => {
            const phase = flags === 'wx' ? 'file_sync' :
              linked && p === join(root,'staging') && ++directorySyncs === 2 ? 'cleanup_directory_sync' : 'directory_sync';
            return inject(phase, p, flags, () => h.sync());
          },
          readFile: (...values) => inject('temp_verify', p, flags, () => h.readFile(...values))
        });
      },
      link: async (...args) => { await fs.link(...args); linked = true; },
      unlink: p => inject('temp_cleanup', p, null, () => fs.unlink(p))
    };
    await assert.rejects(withCanonicalGate({ root, io, fn: () => assert.fail('no callback') }), error => {
      assert.equal(error.code, 'GATE_ACQUIRE_FAILED');
      assert.equal(error.published, linked); assert.ok(error.temp.includes('gate-candidate'));
      let native = error; while (native.cause) native = native.cause;
      assert.equal(native, cause); assert.equal(error.descriptor,cause.descriptor); return true;
    });
    assert.equal(fired, true);
    if (!linked) await absent(join(root, GATE_PATH));
    else assert.ok(JSON.parse(await fs.readFile(join(root, GATE_PATH))).lock_id);
  });

test('GP04 EEXIST then normal release/ENOENT reacquires exclusively, without fabricated BUSY', async t => {
  const root = await fixture(t), owner = await acquireGate({ root }); let released = false, links = 0;
  const io = { ...fs, link: async (...args) => { links++; return fs.link(...args); }, open: async (p, flags, ...args) => {
    if (p === join(root, GATE_PATH) && flags === 'r' && !released) { released = true; await releaseGate(owner); }
    return fs.open(p, flags, ...args);
  } };
  const next = await acquireGate({ root, io }); assert.equal(released, true); assert.equal(links, 2);
  await releaseGate(next);
});

test('GP04 ABA validates the new owner, never removes its final', async t => {
  const root = await fixture(t), old = await acquireGate({ root }); let next, changed = false;
  const io = { ...fs, open: async (p, flags, ...args) => {
    if (p === join(root, GATE_PATH) && flags === 'r' && !changed) {
      changed = true; await releaseGate(old); next = await acquireGate({ root });
    }
    return fs.open(p, flags, ...args);
  } };
  await assert.rejects(acquireGate({ root, io }), e => e.code === 'GATE_BUSY' && e.metadata.lock_id === next.lock_id);
  await assertGateOwnership(next); await releaseGate(next);
});

for (const budget of [null, 0]) test(`GP05 namespace races are bounded (${budget === null ? 'eight retries' : 'shared expired budget'})`, async t => {
  const root = await fixture(t); let links = 0;
  const cause = Object.assign(new Error('namespace raced'), { code: 'EEXIST' });
  const io = { ...fs, link: async () => { links++; throw cause; } };
  const run = () => acquireGate({ root, io });
  await assert.rejects(budget === null ? run() : withGateAcquisitionBudget(budget, run), e =>
    e.code === 'GATE_ACQUIRE_FAILED' && e.published === null && e.phase === 'publish' && e.cause.code === 'ENOENT');
  assert.equal(links, budget === null ? 9 : 1);
  await absent(join(root, GATE_PATH));
});

for (const code of ['EIO', 'EACCES', 'EPERM', 'EXDEV', 'ENOTSUP']) test(`GP03/05 ${code} never falls back to rename`, async t => {
  const root = await fixture(t), cause = Object.assign(new Error(code), { code }); let renamed = false;
  await assert.rejects(acquireGate({ root, io: { ...fs, link: async () => { throw cause; }, rename: async () => { renamed = true; } } }),
    e => e.code === 'GATE_ACQUIRE_FAILED' && e.cause === cause && e.published === null);
  assert.equal(renamed, false); await absent(join(root, GATE_PATH));
});

for (const invalid of ['', '{', '[]', Buffer.from([0xff]), '{"schema_version":99}'])
  test(`GP06 corrupt final retained: ${String(invalid)}`, async t => {
    const root = await fixture(t), path = join(root, GATE_PATH), bytes = Buffer.from(invalid);
    await fs.writeFile(path, bytes);
    await assert.rejects(acquireGate({ root }), { code: 'GATE_CORRUPT' });
    assert.deepEqual(await fs.readFile(path), bytes);
  });

for (const mutate of [m => ({ ...m, unknown: 1 }), m => ({ ...m, root: '/another-root' }), m => ({ ...m, mode: 'shared' })])
  test('GP06 full metadata type/root validation, not merely JSON or hash', async t => {
    const root = await fixture(t), original = await acquireGate({ root }), path = join(root, GATE_PATH);
    const raw = Buffer.from(JSON.stringify(mutate(JSON.parse(await fs.readFile(path)))));
    await fs.writeFile(path, raw);
    await assert.rejects(acquireGate({ root }), { code: 'GATE_CORRUPT' });
    await assert.rejects(releaseGate(original), { code: 'GATE_OWNERSHIP_MISMATCH' });
    assert.deepEqual(await fs.readFile(path), raw);
  });

for (const mode of ['unlink_after', 'dir_sync']) test(`GP09 release ${mode} cannot delete a later owner`, async t => {
  const root = await fixture(t), cause = eio(); let releasing = false, later, removed = 0;
  const io = { ...fs, unlink: async p => {
    await fs.unlink(p);
    if (p === join(root, GATE_PATH)) {
      removed++; releasing = true; later = await acquireGate({ root });
      if (mode === 'unlink_after') throw cause;
    }
  }, open: async (p, ...args) => {
    const h = await fs.open(p, ...args);
    return handleProxy(h, { sync: async () => { if (mode === 'dir_sync' && releasing && p === join(root, 'staging')) throw cause; return h.sync(); } });
  } };
  const owner = await acquireGate({ root, io });
  await assert.rejects(releaseGate(owner), e => e.code === 'GATE_RELEASE_FAILED' && e.release_observation === 'other' &&
    (mode === 'unlink_after' ? e.published === null : e.published === true));
  await assert.rejects(releaseGate(owner), { code: 'GATE_OWNERSHIP_MISMATCH' });
  assert.equal(removed, 1); await assertGateOwnership(later); await releaseGate(later);
});

test('GP10 exact candidate classification precedes publisherTarget, but is not an ArtifactRef allowlist', async t => {
  const root = await fixture(t), path = `staging/.fn004-gate-candidate.tmp-${randomUUID()}`;
  await fs.writeFile(join(root, path), '{partial');
  const discovery = await discoverEvidence(root); validateEvidenceNamespace(discovery.files);
  assert.equal(isGateCandidate(path), true); assert.equal(publisherTarget(path), null);
  assert.equal(isKnownEvidenceFile(path), false); assert.equal(discovery.documents[path], undefined);
  assert.equal(discovery.rawBytes[path].toString(), '{partial');
  for (const bad of [`${path}\n`, `staging/nested/${path.split('/').at(-1)}`, path.toUpperCase(), path.replace('tmp-', 'tmp-x')]) {
    assert.equal(isGateCandidate(bad), false);
    assert.throws(() => validateEvidenceNamespace([{ path: bad, kind: 'file' }]), /Unknown|Unsafe/);
  }
  assert.throws(() => validateEvidenceNamespace([{ path, kind: 'directory' }]), /Nonregular/);
});

test('GP03 identical metadata/lock_id on a different inode never creates ownership',async t=>{
  const root=await fixture(t);let foreign;
  const io={...fs,link:async(from,to)=>{
    foreign=await fs.readFile(from);await fs.writeFile(to,foreign,{flag:'wx'});return fs.link(from,to);
  }};
  await assert.rejects(acquireGate({root,io}),e=>e.code==='GATE_BUSY'&&e.published===false);
  assert.deepEqual(await fs.readFile(join(root,GATE_PATH)),foreign);
});

test('GP03 candidate name collision is never reused or removed without creation capability',async t=>{
  const root=await fixture(t);let candidate;
  const foreign=Buffer.from('unverified existing candidate');
  const io={...fs,open:async(p,flags,...args)=>{
    if(flags==='wx'){candidate=p;await fs.writeFile(p,foreign,{flag:'wx'});}
    return fs.open(p,flags,...args);
  }};
  await assert.rejects(withCanonicalGate({root,io,fn:()=>assert.fail('no lease')}),
    e=>e.code==='GATE_ACQUIRE_FAILED'&&e.phase==='temp_create'&&e.published===false&&e.cause.code==='EEXIST');
  await absent(join(root,GATE_PATH));assert.deepEqual(await fs.readFile(candidate),foreign);
});

test('GP03 BigInt inode comparisons do not collapse adjacent values above 2^53',async t=>{
  const root=await fixture(t),big=2n**60n;
  const fake=(s,n)=>new Proxy(s,{get(target,key){return key==='ino'?n:Reflect.get(target,key,target);}});
  const io={...fs,open:async(p,...args)=>{
    const h=await fs.open(p,...args);return handleProxy(h,{stat:async(...opts)=>fake(await h.stat(...opts),big)});
  },lstat:async(p,...args)=>{
    const s=await fs.lstat(p,...args);return String(p).includes('gate-candidate')&&args[0]?.bigint?fake(s,big+1n):s;
  }};
  await assert.rejects(acquireGate({root,io}),e=>e.code==='GATE_ACQUIRE_FAILED'&&e.published===false);
  await absent(join(root,GATE_PATH));
});

test('GP05 invalid final observation is not erased by its later ENOENT',async t=>{
  const root=await fixture(t),path=join(root,GATE_PATH);await fs.writeFile(path,'{');let links=0;
  const io={...fs,link:async(...args)=>{links++;return fs.link(...args);},open:async(p,...args)=>{
    const h=await fs.open(p,...args);if(p!==path)return h;
    return handleProxy(h,{readFile:async()=>{const raw=await h.readFile();await fs.unlink(path);return raw;}});
  }};
  await assert.rejects(acquireGate({root,io}),{code:'GATE_CORRUPT'});assert.equal(links,1);
});

for(const invalid of [false,true])test(`GP05 descriptor/path inode change validates the replacement (${invalid?'invalid':'valid'})`,async t=>{
  const root=await fixture(t),old=await acquireGate({root});let replaced=false,next;
  const path=join(root,GATE_PATH);
  const io={...fs,open:async(p,flags,...args)=>{
    const h=await fs.open(p,flags,...args);if(p!==path||replaced)return h;
    return handleProxy(h,{readFile:async()=>{
      const raw=await h.readFile();replaced=true;await releaseGate(old);
      if(invalid)await fs.writeFile(path,'{');else next=await acquireGate({root});
      return raw;
    }});
  }};
  await assert.rejects(acquireGate({root,io}),e=>invalid?e.code==='GATE_CORRUPT':e.code==='GATE_BUSY'&&e.metadata.lock_id===next.lock_id);
  if(next){await assertGateOwnership(next);await releaseGate(next);}else assert.equal(await fs.readFile(path,'utf8'),'{');
});

test('GP07 BUSY candidate cleanup failure preserves original contention and other owner',async t=>{
  const root=await fixture(t),gate=await acquireGate({root}),cause=eio();
  await assert.rejects(acquireGate({root,io:{...fs,unlink:async()=>{throw cause;}}}),e=>{
    assert.equal(e.code,'GATE_ACQUIRE_FAILED');assert.equal(e.phase,'temp_cleanup');assert.equal(e.published,false);
    assert.equal(e.operation_error.code,'GATE_BUSY');assert.equal(e.cause,cause);return true;
  });
  await assertGateOwnership(gate);await releaseGate(gate);
});

test('GP16 new Gate failures keep CLI codes and a single JSON error document',async t=>{
  const root=await fixture(t);
  for(const code of ['EIO','EACCES','EPERM']){
    let error;try{await acquireGate({root,io:{...fs,link:async()=>{throw Object.assign(Error(code),{code});}}});}
    catch(e){error=e;}
    assert.equal(errorExit(error),code==='EIO'?1:9);
    const document=errorDocument(error);assert.deepEqual(JSON.parse(JSON.stringify(document)),document);
    assert.equal(document.canonical_effect,'unknown');assert.deepEqual(document.allowed_actions,[]);
  }
  const g=await acquireGate({root});await assert.rejects(acquireGate({root}),e=>errorExit(e)===5);await releaseGate(g);
  await fs.writeFile(join(root,GATE_PATH),'');await assert.rejects(acquireGate({root}),e=>errorExit(e)===8);
});

test('GP05 first EEXIST starts one monotonic second, never a fresh deadline per race',async t=>{
  const root=await fixture(t);let links=0;
  const io={...fs,link:async()=>{links++;throw Object.assign(Error('raced'),{code:'EEXIST'});},open:async(p,flags,...args)=>{
    if(p===join(root,GATE_PATH)&&flags==='r')await new Promise(r=>setTimeout(r,1050));
    return fs.open(p,flags,...args);
  }};
  await assert.rejects(acquireGate({root,io}),e=>e.code==='GATE_ACQUIRE_FAILED'&&e.cause.code==='ENOENT');
  assert.equal(links,1);
});

test('GP05 wall-clock changes cannot reset or prematurely expire the monotonic retry bound',async t=>{
  const root=await fixture(t),original=Date.now;let links=0;
  try {
    Date.now=()=>links%2?0:99999999999999;
    await assert.rejects(acquireGate({root,io:{...fs,link:async()=>{links++;throw Object.assign(Error('raced'),{code:'EEXIST'});}}}),{code:'GATE_ACQUIRE_FAILED'});
    assert.equal(links,9);
  }finally{Date.now=original;}
});

for(const after of [false,true])test(`GP09 descriptor close ${after?'after':'before'} effect retains final without unlink`,async t=>{
  const root=await fixture(t),cause=eio();let releasing=false,fired=false;
  const io={...fs,open:async(p,flags,...args)=>{
    const h=await fs.open(p,flags,...args);if(flags!=='wx')return h;
    return handleProxy(h,{close:async()=>{
      if(releasing&&!fired){fired=true;if(after)await h.close();throw cause;}
      return h.close();
    }});
  }};
  const gate=await acquireGate({root,io});releasing=true;
  await assert.rejects(releaseGate(gate),e=>e.code==='GATE_RELEASE_FAILED'&&e.cause===cause&&e.release_observation==='same'&&e.published===false);
  await assert.rejects(releaseGate(gate),{code:'GATE_OWNERSHIP_MISMATCH'});
  await assert.rejects(acquireGate({root}),{code:'GATE_BUSY'});
});

test('GP07 read and close failures preserve the first native cause, permission code and descriptor',async t=>{
  const root=await fixture(t),owner=await acquireGate({root});
  const primary=Object.assign(Error('read denied'),{code:'EACCES',descriptor:{source:'primary'}}),secondary=eio();
  const io={...fs,open:async(p,flags,...args)=>{
    const h=await fs.open(p,flags,...args);if(p!==join(root,GATE_PATH)||flags!=='r')return h;
    return handleProxy(h,{readFile:async()=>{throw primary;},close:async()=>{await h.close();throw secondary;}});
  }};
  try {
    await assert.rejects(acquireGate({root,io}),e=>{
      assert.equal(errorExit(e),9);assert.equal(e.code,'GATE_CORRUPT');assert.equal(e.descriptor,primary.descriptor);
      assert.equal(e.cause.cause,primary);assert.equal(e.cause.close_error,secondary);return true;
    });
  }finally{await releaseGate(owner);}
});
