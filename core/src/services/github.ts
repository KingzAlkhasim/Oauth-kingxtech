import { supabaseAdmin } from '../lib/supabaseAdmin';
import { listProjectFilesWithContent, writeProjectFile, assertProjectOwnership } from './projectFs';

const GITHUB_API = 'https://api.github.com';

async function gh(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// --- Token management --------------------------------------------------

export async function saveGithubToken(userId: string, token: string): Promise<void> {
  // Validate the PAT before storing it so an invalid token cannot leave the
  // UI showing "Connected" while every repository request fails.
  try {
    await gh(token, '/user');
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (message.includes('(401)')) {
      throw new Error('GitHub token is invalid or expired. Generate a new GitHub Personal Access Token and try again.');
    }
    throw error;
  }

  const { error } = await supabaseAdmin
    .from('github_connections')
    .upsert({ user_id: userId, token }, { onConflict: 'user_id' });
  if (error) throw new Error(`saveGithubToken failed: ${error.message}`);
}

export async function deleteGithubToken(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('github_connections').delete().eq('user_id', userId);
  if (error) throw new Error(`deleteGithubToken failed: ${error.message}`);
}

async function getGithubToken(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('github_connections')
    .select('token')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`getGithubToken failed: ${error.message}`);
  if (!data) throw new Error('No GitHub token connected. Add one in Console → AI Lab → GitHub.');
  return data.token;
}

export async function hasGithubToken(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('github_connections')
    .select('token')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.token) return false;

  try {
    await gh(data.token, '/user');
    return true;
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    // A revoked/expired PAT should behave as disconnected so the UI can
    // immediately offer a replacement token.
    if (message.includes('(401)')) return false;
    throw error;
  }
}

// --- Repo listing --------------------------------------------------------

export interface GithubRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  updated_at: string;
}

export async function listGithubRepos(userId: string): Promise<GithubRepo[]> {
  const token = await getGithubToken(userId);
  const repos = await gh(token, '/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator');
  return (repos as any[]).map((r) => ({
    full_name: r.full_name,
    private: r.private,
    default_branch: r.default_branch,
    html_url: r.html_url,
    updated_at: r.updated_at,
  }));
}

// --- Project <-> repo linking ---------------------------------------------

export interface GithubLink {
  repo_full_name: string;
  branch: string;
}

export async function linkProjectToRepo(
  userId: string,
  projectId: string,
  repoFullName: string,
  branch: string
): Promise<void> {
  await assertProjectOwnership(userId, projectId);
  const { error } = await supabaseAdmin.from('project_github_links').upsert(
    { project_id: projectId, user_id: userId, repo_full_name: repoFullName, branch, updated_at: new Date().toISOString() },
    { onConflict: 'project_id' }
  );
  if (error) throw new Error(`linkProjectToRepo failed: ${error.message}`);
}

export async function getProjectGithubLink(userId: string, projectId: string): Promise<GithubLink | null> {
  const { data, error } = await supabaseAdmin
    .from('project_github_links')
    .select('repo_full_name, branch')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`getProjectGithubLink failed: ${error.message}`);
  return data ?? null;
}

// --- Push (multi-file commit via the Git Data API) ------------------------

export interface PushResult {
  commitUrl: string;
  filesChanged: number;
  filesSkipped: number;
}

export async function pushProjectToGithub(
  userId: string,
  projectId: string,
  commitMessage: string
): Promise<PushResult> {
  const link = await getProjectGithubLink(userId, projectId);
  if (!link) throw new Error('This project isn\'t linked to a GitHub repo yet — link one in Console → AI Lab → GitHub first.');

  const token = await getGithubToken(userId);
  const [owner, repo] = link.repo_full_name.split('/');
  if (!owner || !repo) throw new Error(`Invalid repo name: ${link.repo_full_name}`);

  const projectFiles = await listProjectFilesWithContent(userId, projectId);
  const ignoredPushPrefixes = [
    '.kingxtech-dist/',
    '.kx-verify-dist/',
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    '.next/',
    '.cache/',
  ];
  const isSensitivePath = (filePath: string): boolean => {
    const name = filePath.split('/').pop() ?? filePath;
    if (name === '.env.example' || name === '.env.sample') return false;
    return (
      name === '.env' ||
      name.startsWith('.env.') ||
      /\.(?:pem|key)$/i.test(name) ||
      /^id_rsa/i.test(name) ||
      /^serviceAccount.*\.json$/i.test(name)
    );
  };
  const files = projectFiles.filter(
    (file) =>
      !ignoredPushPrefixes.some((prefix) => file.path.startsWith(prefix)) &&
      !isSensitivePath(file.path)
  );
  const filesSkipped = projectFiles.length - files.length;
  if (files.length === 0) throw new Error('This project has no eligible source files to push.');

  // Scan text files before making any GitHub write requests. Report only paths
  // and pattern categories; never include matched secret values in the error.
  const secretPatterns: Array<{ type: string; pattern: RegExp }> = [
    { type: 'Google API key (AIza…)', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },
    { type: 'secret key (sk-…)', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
    { type: 'service_role credential marker', pattern: /service_role/gi },
    { type: 'private-key header', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/gi },
    { type: 'GitHub classic token (ghp_…)', pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
    { type: 'GitHub fine-grained token (github_pat_…)', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  ];
  const secretFindings = new Map<string, Set<string>>();
  for (const file of files) {
    const content = file.content ?? '';
    if (content.startsWith('__KX_BINARY_BASE64__:')) continue;
    for (const { type, pattern } of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        const types = secretFindings.get(file.path) ?? new Set<string>();
        types.add(type);
        secretFindings.set(file.path, types);
      }
    }
  }
  if (secretFindings.size > 0) {
    const findings = [...secretFindings.entries()]
      .map(([path, types]) => `- ${path}: ${[...types].join(', ')}`)
      .join('\\n');
    throw new Error(
      `GitHub push blocked: possible secrets detected. Remove or replace these values before pushing; secret values are not shown:\\n${findings}`
    );
  }

  // 1. Resolve the branch's current commit — create the branch from the
  // repo's default branch if it doesn't exist yet.
  let baseCommitSha: string;
  try {
    const ref = await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${link.branch}`);
    baseCommitSha = ref.object.sha;
  } catch {
    const repoInfo = await gh(token, `/repos/${owner}/${repo}`);
    const defaultRef = await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${repoInfo.default_branch}`);
    baseCommitSha = defaultRef.object.sha;
    await gh(token, `/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${link.branch}`, sha: baseCommitSha }),
    });
  }

  // 2. Get the base tree.
  const baseCommit = await gh(token, `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  // 3. Remove legacy generated output from the destination repo on the next push.
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
  try {
    const existingTree = await gh(token, `/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`);
    if (existingTree.truncated) {
      console.warn('GitHub base tree was truncated; skipping .kingxtech-dist cleanup for this push.');
    } else {
      for (const entry of existingTree.tree ?? []) {
        if (entry.path.startsWith('.kingxtech-dist/')) {
          treeEntries.push({ path: entry.path, mode: '100644', type: 'blob', sha: null });
        }
      }
    }
  } catch (error) {
    console.warn('Could not inspect the GitHub base tree for .kingxtech-dist cleanup; continuing push.', error);
  }

  // 4. Create a blob for every source file. Decode marked binary payloads as base64.
  for (const file of files) {
    const content = file.content ?? '';
    const binaryPrefix = '__KX_BINARY_BASE64__:';
    const isBinaryPayload = content.startsWith(binaryPrefix);
    const blob = await gh(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: isBinaryPayload ? content.slice(binaryPrefix.length) : content,
        encoding: isBinaryPayload ? 'base64' : 'utf-8',
      }),
    });
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 5. Create a new tree on top of the base tree.
  const newTree = await gh(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  // 6. Create the commit.
  const newCommit = await gh(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: commitMessage, tree: newTree.sha, parents: [baseCommitSha] }),
  });

  // 7. Move the branch ref to the new commit.
  await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${link.branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return {
    commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`,
    filesChanged: files.length,
    filesSkipped,
  };
}

// --- Import (pull an existing repo's files INTO a project) ----------------

const IGNORE_PATH_PREFIXES = ['node_modules/', '.git/', 'dist/', 'build/', '.next/', 'vendor/', '.cache/'];
const MAX_IMPORT_FILES = 300;
const MAX_IMPORT_FILE_BYTES = 300_000; // 300KB per file — keeps this fast and Postgres-row-friendly

function looksBinary(buf: Buffer): boolean {
  // Crude but effective: real text files essentially never contain a null
  // byte in their first few KB; binary formats (images, fonts, archives) do.
  const sampleLen = Math.min(buf.length, 8000);
  for (let i = 0; i < sampleLen; i++) if (buf[i] === 0) return true;
  return false;
}

export interface ImportResult {
  filesImported: number;
  skipped: string[];
}

/**
 * Pulls an existing GitHub repo's files INTO a project's virtual
 * filesystem — the inverse of pushProjectToGithub. Binary files (images,
 * fonts, etc.) are skipped since the virtual filesystem only stores text
 * content; so are common heavy/irrelevant directories (node_modules, .git,
 * build output) and anything past a sane file-count/size safety cap.
 */
export async function importRepoIntoProject(
  userId: string,
  projectId: string,
  repoFullName: string,
  branch: string
): Promise<ImportResult> {
  await assertProjectOwnership(userId, projectId);
  const token = await getGithubToken(userId);

  // Accept both the canonical "owner/repo" form and a GitHub repository URL.
  // Some older workspace flows submitted /tree/<branch> URLs directly.
  let normalizedRepo = repoFullName.trim();
  let normalizedBranch = branch.trim();
  const githubUrl = normalizedRepo.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)(?:\/tree\/(.+))?\/?$/i);
  if (githubUrl) {
    normalizedRepo = `${githubUrl[1]}/${githubUrl[2]}`;
    if (!normalizedBranch && githubUrl[3]) normalizedBranch = decodeURIComponent(githubUrl[3]);
  }

  const [owner, repo] = normalizedRepo.split('/');
  if (!owner || !repo || normalizedRepo.split('/').length !== 2) throw new Error(`Invalid repo name: ${repoFullName}`);
  if (!normalizedBranch) throw new Error('GitHub branch is required.');

  const tree = await gh(token, `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(normalizedBranch)}?recursive=1`);
  const blobs = ((tree.tree as any[]) ?? []).filter((e) => e.type === 'blob');

  let imported = 0;
  const skipped: string[] = [];

  for (const entry of blobs) {
    if (IGNORE_PATH_PREFIXES.some((p) => entry.path.startsWith(p))) continue;

    if (imported >= MAX_IMPORT_FILES) {
      skipped.push(`${entry.path} (import file limit reached — ${MAX_IMPORT_FILES} max)`);
      continue;
    }
    if (entry.size && entry.size > MAX_IMPORT_FILE_BYTES) {
      skipped.push(`${entry.path} (too large — over 300KB)`);
      continue;
    }

    const blob = await gh(token, `/repos/${owner}/${repo}/git/blobs/${entry.sha}`);
    const raw = Buffer.from(blob.content, 'base64');

    if (looksBinary(raw)) {
      skipped.push(`${entry.path} (binary file — not supported yet)`);
      continue;
    }

    await writeProjectFile(userId, projectId, entry.path, raw.toString('utf-8'));
    imported += 1;
  }

  return { filesImported: imported, skipped };
}
