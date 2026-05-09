export async function fileGithubIssue({ title, body, env = process.env }) {
  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_REPO_OWNER;
  const repo = env.GITHUB_REPO_NAME;
  if (!token || !owner || !repo) {
    return { filed: false, reason: 'github creds not set; skipping issue creation' };
  }
  const { Octokit } = await import('@octokit/rest').catch(() => ({}));
  if (!Octokit) {
    return { filed: false, reason: '@octokit/rest not installed' };
  }
  const client = new Octokit({ auth: token });
  const res = await client.rest.issues.create({ owner, repo, title, body });
  return { filed: true, url: res.data.html_url };
}
