// Only an unambiguous, exactly matching merged PR may select light post-merge CI.
module.exports = async function selectMode({ github, context, core }) {
  let mode = 'full';
  if (context.eventName === 'pull_request') {
    mode = context.payload.pull_request.labels.some(label => label.name === 'ci:light') ? 'light' : 'full';
  } else if (context.eventName === 'push') {
    try {
      const pulls = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
        ...context.repo, commit_sha: context.sha, per_page: 100
      });
      const matches = pulls.filter(pr => pr.merged_at && pr.merge_commit_sha === context.sha &&
        pr.base.ref === 'main' && pr.base.repo.full_name === `${context.repo.owner}/${context.repo.repo}`);
      if (matches.length !== 1) throw new Error(`Expected one matching merged PR, found ${matches.length}`);
      const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: matches[0].number });
      if (pr.number !== matches[0].number || !pr.merged || !pr.merged_at || pr.merge_commit_sha !== context.sha ||
          pr.base.ref !== 'main' || pr.base.repo.full_name !== `${context.repo.owner}/${context.repo.repo}`) {
        throw new Error('Merged PR detail does not match the push SHA and main repository');
      }
      mode = pr.labels.some(label => label.name === 'ci:light') ? 'light' : 'full';
      core.info(`Push ${context.sha} matches merged PR #${pr.number}; CI mode: ${mode}`);
    } catch (error) {
      mode = 'full';
      core.warning(`PR label lookup failed or was ambiguous; using full CI: ${error.message}`);
    }
  }
  core.setOutput('mode', mode);
  core.setOutput('sha', context.sha);
};
