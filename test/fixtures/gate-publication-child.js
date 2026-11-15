import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { acquireGate, releaseGate, GATE_PATH } from '../../src/fn004-gate.js';

if (process.argv[2] === '--gate-link-race-child') {
  const root = process.argv[3]; let go, release;
  const start = new Promise(r => { go = r; }), stop = new Promise(r => { release = r; });
  process.on('message', m => { if(m === 'go')go(); if(m === 'release')release(); });
  try {
    const gate = await acquireGate({root,io:{...fs,link:async(...args)=>{
      process.send({type:'prepared'});await start;return fs.link(...args);
    }}});
    process.send({type:'result',outcome:'acquired',pid:process.pid});await stop;
    await releaseGate(gate);process.disconnect();
  } catch(error) { process.send({type:'result',outcome:error.code});process.disconnect(); }
}

// Trusted fault/kill seam only, never imported by a production entrypoint.
if (process.argv[2] === '--gate-publication-child') {
  const root = process.argv[3], boundary = process.argv[4];
  process.on('message', () => {}); // An IPC reference makes the pause real.
  const pause = async at => {
    if (boundary !== at) return;
    process.send({ type: 'boundary', boundary: at });
    await new Promise(() => {});
  };
  let linked = false, directorySyncs = 0;
  const io = { ...fs, open: async (path, flags, ...args) => {
    if (flags === 'wx') await pause('before_temp_create');
    const h = await fs.open(path, flags, ...args);
    if (flags === 'wx') await pause('after_temp_create');
    return new Proxy(h, { get(target, key) {
      if (key === 'writeFile' && flags === 'wx') return async bytes => {
        if (boundary === 'during_temp_write') { await h.writeFile(bytes.subarray(0, 5)); await pause(boundary); }
        await h.writeFile(bytes); await pause('metadata_complete_before_sync');
      };
      if (key === 'sync') return async () => {
        await h.sync();
        if (flags === 'wx') await pause('after_file_sync');
        if (path === join(root, 'staging') && linked) {
          directorySyncs++;
          if (directorySyncs === 1) await pause('after_directory_sync');
          if (directorySyncs === 2) await pause('before_response');
          if (directorySyncs === 3) await pause('release_after_directory_sync');
        }
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
  }, link: async (...args) => {
    await pause('before_link'); await fs.link(...args); linked = true; await pause('after_link');
  }, unlink: async path => {
    if (path === join(root, GATE_PATH)) await pause('release_before_unlink');
    await fs.unlink(path);
    await pause(path === join(root, GATE_PATH) ? 'release_after_unlink' : 'after_candidate_unlink');
  } };
  try {
    const gate = await acquireGate({ root, io }); await pause('owned_no_domain');
    await releaseGate(gate);
    process.send({ type: 'error', message: 'Boundary was not reached' }); process.disconnect();
  } catch (error) { process.send({ type: 'error', message: error.stack }); process.disconnect(); }
}
