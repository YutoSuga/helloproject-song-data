// Pure event selection. Never infer a push boundary from HEAD^.
module.exports = function selectIdBase({ eventName, payload, sha, ref }) {
  let base, candidate = sha;
  if (eventName === 'pull_request' && payload.pull_request?.base.ref === 'main') base = payload.pull_request.base.sha;
  else if (eventName === 'push' && ref === 'refs/heads/main') {
    base = payload.before;
    if (payload.after !== sha) throw new Error('push after and checkout SHA differ');
  } else if (eventName === 'workflow_dispatch' && ref === 'refs/heads/main') base = payload.inputs?.base_sha;
  else throw new Error('Unsupported ID verification event/ref');
  if (![base,candidate].every(s=>typeof s==='string' && /^[a-f0-9]{40}$/.test(s) && !/^0+$/.test(s)) || base === candidate) throw new Error('Distinct full base/candidate SHAs required');
  return { base, candidate };
};
