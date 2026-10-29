/** Reads and writes files in GitHub repositories through the contents API. */
const API = process.env.GITHUB_API_URL || "https://api.github.com";

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function token() {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new GitHubError(503, "GITHUB_TOKEN is not set");
  return t;
}
export const siteRepo = () => process.env.GITHUB_REPO || "";
/** Research resources live in RESOURCES_REPO if set, otherwise in the site repository's resources/ folder. */
export const resourcesRepo = () => process.env.RESOURCES_REPO || process.env.GITHUB_REPO || "";

let privacy: { repo: string; ok: boolean; at: number } | null = null;
/** True only if the resources repository is private. Checked at most every 10 minutes. */
export async function resourcesRepoIsPrivate(): Promise<boolean> {
  const repo = resourcesRepo();
  if (!repo) return false;
  if (privacy && privacy.repo === repo && Date.now() - privacy.at < 600_000) return privacy.ok;
  const r = await gh(`/repos/${repo}`);
  const ok = r.ok ? (await r.json()).private === true : false;
  privacy = { repo, ok, at: Date.now() };
  return ok;
}
export const branchOf = (repo: string) =>
  (repo === process.env.RESOURCES_REPO ? process.env.RESOURCES_BRANCH : process.env.GITHUB_BRANCH) || "main";

async function gh(path: string, init: RequestInit = {}, accept = "application/vnd.github+json") {
  return fetch(API + path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
}
const contentsUrl = (repo: string, filePath: string) =>
  `/repos/${repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`;

/** Current sha and text of a file, or null if it doesn't exist. Files up to 1 MB. */
export async function getText(repo: string, filePath: string): Promise<{ sha: string; text: string } | null> {
  const r = await gh(`${contentsUrl(repo, filePath)}?ref=${encodeURIComponent(branchOf(repo))}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new GitHubError(r.status, `GitHub read failed (${r.status})`);
  const j = await r.json();
  return { sha: j.sha, text: Buffer.from(j.content || "", "base64").toString("utf8") };
}

/** Raw bytes of a file (up to 100 MB). */
export async function getRaw(repo: string, filePath: string): Promise<Response> {
  return gh(`${contentsUrl(repo, filePath)}?ref=${encodeURIComponent(branchOf(repo))}`, {}, "application/vnd.github.raw");
}

/** Create or replace a file. `content` is base64. Pass `sha` to fail on a concurrent change (409). */
export async function putFile(repo: string, filePath: string, content: string, message: string, sha?: string | null) {
  const branch = branchOf(repo);
  if (sha === undefined) {
    const cur = await gh(`${contentsUrl(repo, filePath)}?ref=${encodeURIComponent(branch)}`);
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status !== 404) throw new GitHubError(cur.status, `GitHub read failed (${cur.status})`);
  }
  const res = await gh(contentsUrl(repo, filePath), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new GitHubError(res.status === 422 ? 409 : res.status, `GitHub write failed (${res.status})`);
  return res.json();
}

export async function deleteFile(repo: string, filePath: string, message: string) {
  const branch = branchOf(repo);
  const cur = await gh(`${contentsUrl(repo, filePath)}?ref=${encodeURIComponent(branch)}`);
  if (cur.status === 404) return;
  if (!cur.ok) throw new GitHubError(cur.status, `GitHub read failed (${cur.status})`);
  const { sha } = await cur.json();
  const res = await gh(contentsUrl(repo, filePath), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok && res.status !== 404) throw new GitHubError(res.status, `GitHub delete failed (${res.status})`);
}
