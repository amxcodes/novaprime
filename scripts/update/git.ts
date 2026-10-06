import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readdir, realpath, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const UPDATE_BRANCH_PREFIX = "nova/update/";

export type GitWorkspaceErrorCode =
  | "NOT_GIT_REPOSITORY"
  | "WRONG_REPOSITORY_ROOT"
  | "DETACHED_HEAD"
  | "SHALLOW_CLONE"
  | "SPARSE_CHECKOUT"
  | "LINKED_WORKTREE_UNSUPPORTED"
  | "SUBMODULES_UNSUPPORTED"
  | "DIRTY_WORKTREE"
  | "HEAD_CHANGED"
  | "REMOTE_NOT_FOUND"
  | "INVALID_RELEASE_TAG"
  | "RELEASE_TAG_CHANGED"
  | "RELEASE_TAG_UNAVAILABLE"
  | "INVALID_COMMIT"
  | "UPDATE_BRANCH_EXISTS"
  | "WORKTREE_PREPARATION_FAILED"
  | "WORKTREE_CONFLICT"
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_BRANCH_MISMATCH"
  | "CANDIDATE_TARGET_MISSING"
  | "CANDIDATE_HEAD_MISMATCH"
  | "CANDIDATE_HEAD_UNPINNED"
  | "CANDIDATE_HISTORY_INVALID"
  | "PUSH_DESTINATION_UNSUPPORTED"
  | "PUSH_DESTINATION_CHANGED"
  | "PUSH_DESTINATION_CANONICAL"
  | "SOURCE_CHECKOUT_CHANGED"
  | "INVALID_BRANCH"
  | "PUSH_REMOTE_AMBIGUOUS"
  | "PUSH_FAILED";

/** Errors intentionally contain no Git stderr, which may include credential-bearing URLs. */
export class GitWorkspaceError extends Error {
  constructor(
    readonly code: GitWorkspaceErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "GitWorkspaceError";
  }
}

export interface GitRemoteInfo {
  name: string;
  fetchUrls: string[];
  pushUrls: string[];
  /** The single strict-valid GitHub destination, safe to show and bind to confirmation. */
  pushUrl?: string;
}

export interface GitCheckoutInfo {
  root: string;
  headCommit: string;
  branch: string | null;
  isShallow: boolean;
  isSparseCheckout: boolean;
  isLinkedWorktree: boolean;
  hasSubmodules: boolean;
  dirtyPaths: string[];
  remotes: GitRemoteInfo[];
}

export interface ReleaseRef {
  tag: string;
  commit: string;
  remoteName: string;
  remoteUrl: string;
}

export interface PreparedUpdateWorktree {
  status: "prepared" | "already-included" | "conflict";
  branch: string | null;
  path: string | null;
  baseCommit: string;
  targetCommit: string;
  conflictedPaths: string[];
}

export interface ExistingUpdateWorktree {
  branch: string;
  path: string;
  headCommit: string;
  originalHead: string;
  targetCommit: string;
}

export interface PushUpdateBranchOptions {
  repoRoot: string;
  worktreePath: string;
  remoteName: string;
  confirmedPushUrl: string;
  canonicalRepository: string;
  localBranch: string;
  destinationBranch: string;
  expectedOriginalHead: string;
  expectedCandidateHead: string;
  expectedTargetCommit: string;
}

export interface PushedUpdateBranch {
  localBranch: string;
  commit: string;
  destination: {
    remoteName: string;
    remoteUrl: string;
    branch: string;
  };
}

interface GitResult {
  stdout: string;
  stderr: string;
  status: number;
}

class GitCommandFailure extends Error {
  constructor(readonly status: number) {
    super(`Git command failed with exit status ${status}.`);
    this.name = "GitCommandFailure";
  }
}

async function runGit(cwd: string, args: string[], allowedStatuses: number[] = []): Promise<GitResult> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr, status: 0 };
  } catch (error) {
    const status = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
      ? error.code
      : -1;
    if (allowedStatuses.includes(status)) {
      const processError = error as { stdout?: string; stderr?: string };
      return { stdout: processError.stdout ?? "", stderr: processError.stderr ?? "", status };
    }
    throw new GitCommandFailure(status);
  }
}

function gitFailure(code: GitWorkspaceErrorCode, message: string, cause?: unknown): GitWorkspaceError {
  return new GitWorkspaceError(code, message, cause instanceof Error ? { cause: cause.name } : undefined);
}

async function realPathOrError(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    throw new GitWorkspaceError("NOT_GIT_REPOSITORY", "The requested NOVA checkout path does not exist.");
  }
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function parseStatusPaths(porcelain: string): string[] {
  const records = porcelain.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    // -z emits a second path for rename/copy records.
    if (status.includes("R") || status.includes("C")) {
      const previousPath = records[index + 1];
      if (previousPath) paths.push(previousPath);
      index += 1;
    }
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function redactRemoteUrl(rawUrl: string): string {
  const value = rawUrl.trim();
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    // SCP-style SSH URLs contain no URL authority credentials; avoid echoing odd URLs.
    const scp = value.match(/^[^\s@]+@([^\s:]+):([A-Za-z0-9._/-]+)$/);
    return scp ? `ssh://${scp[1]}/${scp[2]}` : "(unrecognized remote URL)";
  }
}

async function remoteInfo(root: string, remoteName: string): Promise<GitRemoteInfo | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remoteName)) return null;
  const remotes = (await runGit(root, ["remote"])).stdout.split(/\r?\n/).filter(Boolean);
  if (!remotes.includes(remoteName)) return null;
  const [fetch, push] = await Promise.all([
    runGit(root, ["remote", "get-url", "--all", remoteName]),
    runGit(root, ["remote", "get-url", "--push", "--all", remoteName]),
  ]);
  const rawPushUrls = push.stdout.split(/\r?\n/).filter(Boolean);
  let pushUrl: string | undefined;
  if (rawPushUrls.length === 1) {
    try {
      validateGitHubPushUrl(rawPushUrls[0]!);
      pushUrl = rawPushUrls[0]!;
    } catch {
      // Keep invalid destinations redacted for inspection, but never offer them for update pushes.
    }
  }
  return {
    name: remoteName,
    fetchUrls: fetch.stdout.split(/\r?\n/).filter(Boolean).map(redactRemoteUrl),
    pushUrls: rawPushUrls.map(redactRemoteUrl),
    ...(pushUrl ? { pushUrl } : {}),
  };
}

async function rawPushUrls(root: string, remoteName: string): Promise<string[]> {
  return (await runGit(root, ["remote", "get-url", "--push", "--all", remoteName]))
    .stdout.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
}

function validGitHubRepositoryPath(pathname: string): boolean {
  return /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(pathname);
}

/** Only GitHub.com HTTPS and SSH repository destinations are accepted for an updater push. */
export function validateGitHubPushUrl(rawUrl: string, options: { displayOnly?: boolean } = {}): void {
  const value = rawUrl.trim();
  if (!value || /[\s\0]/.test(value)) {
    throw new GitWorkspaceError("PUSH_DESTINATION_UNSUPPORTED", "The configured push destination is not a supported GitHub repository URL.");
  }
  try {
    const parsed = new URL(value);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const validPort = !parsed.port || (protocol === "https:" && parsed.port === "443") || (protocol === "ssh:" && parsed.port === "22");
    const validAuthority = hostname === "github.com" && validPort && !parsed.password
      && !parsed.search && !parsed.hash;
    const validHttps = protocol === "https:" && validAuthority && !parsed.username
      && validGitHubRepositoryPath(parsed.pathname);
    const validSshUser = parsed.username === "git" || (options.displayOnly === true && parsed.username === "");
    const validSsh = protocol === "ssh:" && validAuthority && validSshUser
      && validGitHubRepositoryPath(parsed.pathname);
    if (validHttps || validSsh) return;
  } catch {
    // Git's SCP-style SSH form is not a URL; accept only the exact GitHub host and git user.
    const scp = value.match(/^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?)$/i);
    if (scp) return;
  }
  throw new GitWorkspaceError("PUSH_DESTINATION_UNSUPPORTED", "The configured push destination must be a GitHub.com repository using HTTPS or SSH.", {
    destination: redactRemoteUrl(value),
  });
}

/** Returns a normalized GitHub owner/repository pair for supported URL forms. */
export function githubRepositoryIdentity(rawUrl: string): string | undefined {
  const value = rawUrl.trim();
  let path: string | undefined;
  const scp = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?)$/i.exec(value);
  if (scp) path = scp[1];
  else {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() !== "github.com" || !validGitHubRepositoryPath(parsed.pathname)) return undefined;
      path = parsed.pathname.replace(/^\//, "");
    } catch {
      return undefined;
    }
  }
  return path?.replace(/\/$/, "").replace(/\.git$/i, "").toLowerCase();
}

async function inspectGitCheckoutInternal(path: string, options: { allowLinkedWorktree?: boolean } = {}): Promise<GitCheckoutInfo> {
  const requestedRoot = await realPathOrError(path);
  let discoveredRoot: string;
  try {
    discoveredRoot = (await runGit(requestedRoot, ["rev-parse", "--show-toplevel"])).stdout.trim();
  } catch (error) {
    throw gitFailure("NOT_GIT_REPOSITORY", "The path is not inside a Git checkout.", error);
  }
  const root = await realPathOrError(discoveredRoot);
  if (comparablePath(root) !== comparablePath(requestedRoot)) {
    throw new GitWorkspaceError("WRONG_REPOSITORY_ROOT", "Run the updater from the root of the NOVA checkout.", { root });
  }

  const [head, symbolicBranch, shallow, sparse, gitDir, commonDir, status, submodules, remoteNames] = await Promise.all([
    runGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]),
    runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], [1]),
    runGit(root, ["rev-parse", "--is-shallow-repository"]),
    runGit(root, ["config", "--bool", "--get", "core.sparseCheckout"], [1]),
    runGit(root, ["rev-parse", "--absolute-git-dir"]),
    runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]),
    runGit(root, ["submodule", "status", "--recursive"], [1]),
    runGit(root, ["remote"]),
  ]);
  const isShallow = shallow.stdout.trim() === "true";
  const isSparseCheckout = sparse.status === 0 && sparse.stdout.trim() === "true";
  const isLinkedWorktree = comparablePath(gitDir.stdout.trim()) !== comparablePath(commonDir.stdout.trim());
  const hasSubmodules = submodules.stdout.trim().length > 0;
  const remotes = await Promise.all(remoteNames.stdout.split(/\r?\n/).filter(Boolean).map((name) => remoteInfo(root, name)));

  const info: GitCheckoutInfo = {
    root,
    headCommit: head.stdout.trim(),
    branch: symbolicBranch.status === 0 ? symbolicBranch.stdout.trim() : null,
    isShallow,
    isSparseCheckout,
    isLinkedWorktree,
    hasSubmodules,
    dirtyPaths: parseStatusPaths(status.stdout),
    remotes: remotes.filter((remote): remote is GitRemoteInfo => remote !== null),
  };

  if (!info.branch) throw new GitWorkspaceError("DETACHED_HEAD", "The NOVA checkout is detached; switch to a named branch and retry.", { head: info.headCommit });
  if (info.isShallow) throw new GitWorkspaceError("SHALLOW_CLONE", "The NOVA checkout is shallow; fetch full history before updating.");
  if (info.isSparseCheckout) throw new GitWorkspaceError("SPARSE_CHECKOUT", "Sparse checkouts are not supported by the updater.");
  if (info.isLinkedWorktree && !options.allowLinkedWorktree) {
    throw new GitWorkspaceError("LINKED_WORKTREE_UNSUPPORTED", "Run the updater from the primary NOVA checkout, not a linked Git worktree.");
  }
  if (info.hasSubmodules) throw new GitWorkspaceError("SUBMODULES_UNSUPPORTED", "This NOVA checkout contains Git submodules; the updater cannot safely prepare it.");
  return info;
}

/** Inspects the checkout without changing its working tree or Git refs. */
export async function inspectGitCheckout(repoRoot: string): Promise<GitCheckoutInfo> {
  return inspectGitCheckoutInternal(repoRoot);
}

/** Fetches one immutable stable release tag into a private updater ref namespace. */
export async function fetchReleaseTag(repoRoot: string, remoteName: string, tag: string): Promise<ReleaseRef> {
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new GitWorkspaceError("INVALID_RELEASE_TAG", "Select a stable release tag in vMAJOR.MINOR.PATCH form.");
  }
  const checkout = await inspectGitCheckout(repoRoot);
  const remote = await remoteInfo(checkout.root, remoteName);
  if (!remote) throw new GitWorkspaceError("REMOTE_NOT_FOUND", "The selected upstream remote is not configured.", { remoteName });
  const privateRef = `refs/nova-updater/tags/${tag}`;
  try {
    await runGit(checkout.root, [
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      "--",
      remoteName,
      `refs/tags/${tag}:${privateRef}`,
    ]);
  } catch {
    const existing = await runGit(checkout.root, ["show-ref", "--verify", "--quiet", privateRef], [1]);
    if (existing.status === 0) {
      throw new GitWorkspaceError("RELEASE_TAG_CHANGED", "The release tag differs from the version previously fetched; stable tags must not be retargeted.", { tag });
    }
    throw new GitWorkspaceError("RELEASE_TAG_UNAVAILABLE", "The selected stable release tag could not be fetched.", { tag, remoteName });
  }
  let commit: string;
  try {
    commit = (await runGit(checkout.root, ["rev-parse", "--verify", `${privateRef}^{commit}`])).stdout.trim();
  } catch (error) {
    throw gitFailure("INVALID_COMMIT", "The release tag does not resolve to a commit.", error);
  }
  return { tag, commit, remoteName, remoteUrl: remote.fetchUrls[0] ?? "(remote URL unavailable)" };
}

function assertSafeFetchUrl(sourceUrl: string): void {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:") {
      throw new GitWorkspaceError("RELEASE_TAG_UNAVAILABLE", "Release source must use HTTPS or SSH.");
    }
    if (!parsed.hostname) throw new Error("missing host");
  } catch (error) {
    if (error instanceof GitWorkspaceError) throw error;
    // Allow the conventional user@host:path SSH form; disallow Git's ext/file helpers.
    if (!/^[^\s@]+@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+(?:\.git)?$/.test(sourceUrl)) {
      throw new GitWorkspaceError("RELEASE_TAG_UNAVAILABLE", "Release source URL is invalid or uses an unsupported Git transport.");
    }
  }
}

/** Fetches a stable tag from an explicit canonical source and binds it to the release API's commit. */
export async function fetchPinnedRelease(
  repoRoot: string,
  sourceUrl: string,
  tag: string,
  expectedCommit: string,
): Promise<ReleaseRef> {
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new GitWorkspaceError("INVALID_RELEASE_TAG", "Select a stable release tag in vMAJOR.MINOR.PATCH form.");
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(expectedCommit)) {
    throw new GitWorkspaceError("INVALID_COMMIT", "Release metadata must provide a full commit ID.");
  }
  assertSafeFetchUrl(sourceUrl);
  const checkout = await inspectGitCheckout(repoRoot);
  const privateRef = `refs/nova-updater/tags/${tag}`;
  const incomingRef = `refs/nova-updater/incoming/${randomUUID()}`;
  try {
    await runGit(checkout.root, [
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      "--",
      sourceUrl,
      `refs/tags/${tag}:${incomingRef}`,
    ]);
  } catch {
    throw new GitWorkspaceError("RELEASE_TAG_UNAVAILABLE", "The selected stable release tag could not be fetched from the canonical source.", { tag });
  }
  let actualCommit: string;
  try {
    actualCommit = await validateCommit(checkout.root, (await runGit(checkout.root, ["rev-parse", "--verify", `${incomingRef}^{commit}`])).stdout.trim());
  } catch {
    await runGit(checkout.root, ["update-ref", "-d", incomingRef]).catch(() => undefined);
    throw new GitWorkspaceError("INVALID_COMMIT", "The fetched release tag does not resolve to a commit.", { tag });
  }
  if (actualCommit.toLowerCase() !== expectedCommit.toLowerCase()) {
    await runGit(checkout.root, ["update-ref", "-d", incomingRef]).catch(() => undefined);
    throw new GitWorkspaceError("RELEASE_TAG_CHANGED", "The fetched release tag does not match the commit pinned by release metadata.", {
      tag,
      expectedCommit,
      actualCommit,
    });
  }
  const existing = await runGit(checkout.root, ["show-ref", "--verify", "--quiet", privateRef], [1]);
  if (existing.status === 0) {
    const previousCommit = (await runGit(checkout.root, ["rev-parse", "--verify", `${privateRef}^{commit}`])).stdout.trim();
    if (previousCommit.toLowerCase() !== actualCommit.toLowerCase()) {
      await runGit(checkout.root, ["update-ref", "-d", incomingRef]).catch(() => undefined);
      throw new GitWorkspaceError("RELEASE_TAG_CHANGED", "This stable tag was previously fetched at another commit and cannot be retargeted.", {
        tag,
        previousCommit,
        actualCommit,
      });
    }
  } else {
    const objectFormat = (await runGit(checkout.root, ["rev-parse", "--show-object-format"])).stdout.trim();
    const emptyObjectId = objectFormat === "sha256" ? "0".repeat(64) : "0".repeat(40);
    try {
      await runGit(checkout.root, ["update-ref", privateRef, actualCommit, emptyObjectId]);
    } catch {
      // Another updater may have stored the same verified release at the same time.
      const raced = await runGit(checkout.root, ["show-ref", "--verify", "--quiet", privateRef], [1]);
      if (raced.status !== 0) {
        await runGit(checkout.root, ["update-ref", "-d", incomingRef]).catch(() => undefined);
        throw new GitWorkspaceError("RELEASE_TAG_UNAVAILABLE", "Could not persist the verified release ref.", { tag });
      }
      const racedCommit = (await runGit(checkout.root, ["rev-parse", "--verify", `${privateRef}^{commit}`])).stdout.trim();
      if (racedCommit.toLowerCase() !== actualCommit.toLowerCase()) {
        await runGit(checkout.root, ["update-ref", "-d", incomingRef]).catch(() => undefined);
        throw new GitWorkspaceError("RELEASE_TAG_CHANGED", "This stable tag was concurrently recorded at another commit.", { tag });
      }
    }
  }
  await runGit(checkout.root, ["update-ref", "-d", incomingRef]).catch(() => undefined);
  return {
    tag,
    commit: actualCommit,
    remoteName: "canonical",
    remoteUrl: redactRemoteUrl(sourceUrl),
  };
}

async function isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean> {
  const result = await runGit(root, ["merge-base", "--is-ancestor", ancestor, descendant], [1]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new GitWorkspaceError("INVALID_COMMIT", "Git could not compare the selected release with the checkout history.");
}

async function validateCommit(root: string, commit: string): Promise<string> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commit)) {
    throw new GitWorkspaceError("INVALID_COMMIT", "The update target must be pinned to a full Git commit ID.");
  }
  try {
    const resolved = (await runGit(root, ["rev-parse", "--verify", `${commit}^{commit}`])).stdout.trim();
    if (resolved.toLowerCase() !== commit.toLowerCase()) throw new Error("not a full object ID");
    return resolved;
  } catch (error) {
    throw gitFailure("INVALID_COMMIT", "The pinned update target is not available as a commit in this checkout.", error);
  }
}

/**
 * Creates an isolated `nova/update/<tag>` candidate from the current branch and merges the
 * release commit into it. The operator's checked-out branch and files are never checked out,
 * merged, reset, cleaned, stashed, or rewritten by this function.
 */
export async function prepareUpdateWorktree(
  repoRoot: string,
  options: {
    targetCommit: string;
    releaseTag: string;
    expectedHead?: string;
    worktreeParent?: string;
    /** Caller-selected durable location. If it exists, it must be an empty, non-symlink directory. */
    worktreePath?: string;
  },
): Promise<PreparedUpdateWorktree> {
  if (!RELEASE_TAG_PATTERN.test(options.releaseTag)) {
    throw new GitWorkspaceError("INVALID_RELEASE_TAG", "Select a stable release tag in vMAJOR.MINOR.PATCH form.");
  }
  const checkout = await inspectGitCheckout(repoRoot);
  if (checkout.dirtyPaths.length) {
    throw new GitWorkspaceError("DIRTY_WORKTREE", "Commit or safely back up all staged, modified, and untracked files before preparing an update.", {
      paths: checkout.dirtyPaths,
    });
  }
  if (options.expectedHead && options.expectedHead.toLowerCase() !== checkout.headCommit.toLowerCase()) {
    throw new GitWorkspaceError("HEAD_CHANGED", "The checkout changed after the update plan was created; review a fresh plan.", {
      expectedHead: options.expectedHead,
      currentHead: checkout.headCommit,
    });
  }
  const targetCommit = await validateCommit(checkout.root, options.targetCommit);
  if (await isAncestor(checkout.root, targetCommit, checkout.headCommit)) {
    return {
      status: "already-included",
      branch: null,
      path: null,
      baseCommit: checkout.headCommit,
      targetCommit,
      conflictedPaths: [],
    };
  }

  const candidateBranch = `${UPDATE_BRANCH_PREFIX}${options.releaseTag}`;
  const formatResult = await runGit(checkout.root, ["check-ref-format", "--branch", candidateBranch], [1]);
  if (formatResult.status !== 0) throw new GitWorkspaceError("INVALID_BRANCH", "The release identifier cannot be used to create a candidate branch.");
  const branchRef = `refs/heads/${candidateBranch}`;
  if ((await runGit(checkout.root, ["show-ref", "--verify", "--quiet", branchRef], [1])).status === 0) {
    throw new GitWorkspaceError("UPDATE_BRANCH_EXISTS", "A candidate branch for this release already exists; inspect it before retrying.", {
      branch: candidateBranch,
    });
  }

  let worktreePath: string;
  let hookDirectory: string;
  try {
    const rootPath = comparablePath(checkout.root);
    const assertOutsideRoot = (path: string) => {
      const candidate = comparablePath(path);
      if (candidate === rootPath || candidate.startsWith(`${rootPath}${process.platform === "win32" ? "\\" : "/"}`)) {
        throw new GitWorkspaceError("WORKTREE_PREPARATION_FAILED", "Place the update candidate outside the NOVA checkout so it cannot appear as operator working-tree content.");
      }
    };
    if (options.worktreePath && options.worktreeParent) {
      throw new GitWorkspaceError("WORKTREE_PREPARATION_FAILED", "Choose either a durable candidate path or a temporary candidate parent, not both.");
    }
    if (options.worktreePath) {
      const requestedPath = resolve(options.worktreePath);
      const parent = await realPathOrError(dirname(requestedPath));
      assertOutsideRoot(parent);
      const leaf = basename(requestedPath);
      if (!leaf || leaf === "." || leaf === "..") {
        throw new GitWorkspaceError("WORKTREE_PREPARATION_FAILED", "The exact candidate path must name a directory outside the NOVA checkout.");
      }
      worktreePath = join(parent, leaf);
      assertOutsideRoot(worktreePath);
      try {
        const existing = await lstat(worktreePath);
        if (existing.isSymbolicLink() || !existing.isDirectory() || (await readdir(worktreePath)).length > 0) {
          throw new GitWorkspaceError("WORKTREE_PREPARATION_FAILED", "The exact candidate path must be absent or an empty, non-symlink directory.", { path: worktreePath });
        }
      } catch (error) {
        if (error instanceof GitWorkspaceError) throw error;
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      }
    } else {
      const parent = options.worktreeParent ? await realPathOrError(options.worktreeParent) : tmpdir();
      assertOutsideRoot(parent);
      const safeTag = options.releaseTag.replace(/[^A-Za-z0-9.-]/g, "_");
      worktreePath = await mkdtemp(join(parent, `nova-update-${safeTag}-`));
    }
    try {
      hookDirectory = await mkdtemp(join(tmpdir(), "nova-updater-hooks-"));
    } catch {
      if (!options.worktreePath) await rmdir(worktreePath).catch(() => undefined);
      throw new Error("Could not create an isolated Git hooks directory.");
    }
  } catch (error) {
    if (error instanceof GitWorkspaceError) throw error;
    throw new GitWorkspaceError("WORKTREE_PREPARATION_FAILED", "Could not create a temporary directory for the isolated update candidate.");
  }

  try {
    await runGit(checkout.root, ["-c", `core.hooksPath=${hookDirectory}`, "worktree", "add", "-b", candidateBranch, worktreePath, checkout.headCommit]);
  } catch {
    // Remove only the freshly-created empty temp directory. Git may have partially registered
    // the worktree; in that case rmdir fails and we deliberately leave it for inspection.
    if (!options.worktreePath) await rmdir(worktreePath).catch(() => undefined);
    await rmdir(hookDirectory).catch(() => undefined);
    throw new GitWorkspaceError("WORKTREE_PREPARATION_FAILED", "Git could not create the isolated update worktree; the operator checkout was left unchanged.", {
      branch: candidateBranch,
      path: worktreePath,
    });
  }

  try {
    await runGit(worktreePath, ["-c", `core.hooksPath=${hookDirectory}`, "merge", "--no-verify", "--no-edit", "--no-gpg-sign", targetCommit]);
    await rmdir(hookDirectory).catch(() => undefined);
    return {
      status: "prepared",
      branch: candidateBranch,
      path: worktreePath,
      baseCommit: checkout.headCommit,
      targetCommit,
      conflictedPaths: [],
    };
  } catch {
    const unmerged = await runGit(worktreePath, ["diff", "--name-only", "--diff-filter=U", "-z"], [1]).catch(() => ({ stdout: "", stderr: "", status: -1 }));
    const conflictedPaths = unmerged.stdout.split("\0").filter(Boolean).sort((left, right) => left.localeCompare(right));
    await rmdir(hookDirectory).catch(() => undefined);
    if (!conflictedPaths.length) {
      throw new GitWorkspaceError("WORKTREE_PREPARATION_FAILED", "Git could not merge the pinned release into the candidate. The isolated candidate was retained for inspection; the operator checkout was left unchanged.", {
        branch: candidateBranch,
        path: worktreePath,
      });
    }
    return {
      status: "conflict",
      branch: candidateBranch,
      path: worktreePath,
      baseCommit: checkout.headCommit,
      targetCommit,
      conflictedPaths,
    };
  }
}

type CandidateHistoryState = "untouched" | "prepared";

async function inspectCandidateHistory(
  root: string,
  headCommit: string,
  originalHead: string,
  targetCommit: string,
): Promise<CandidateHistoryState | null> {
  if (headCommit.toLowerCase() === originalHead.toLowerCase()) return "untouched";
  if (headCommit.toLowerCase() === targetCommit.toLowerCase() && await isAncestor(root, originalHead, targetCommit)) {
    // A normal fast-forward is the exact pinned target itself, with no updater-created commit.
    return "prepared";
  }
  const fields = (await runGit(root, ["rev-list", "--parents", "-n", "1", headCommit])).stdout.trim().split(/\s+/);
  const parents = fields.slice(1).map((parent) => parent.toLowerCase());
  if (parents.length === 2
    && parents[0] === originalHead.toLowerCase()
    && parents[1] === targetCommit.toLowerCase()) {
    // This also accepts a manually resolved merge commit, while rejecting any commit on top of it.
    return "prepared";
  }
  return null;
}

async function mergePinnedTarget(candidatePath: string, targetCommit: string): Promise<void> {
  const hookDirectory = await mkdtemp(join(tmpdir(), "nova-updater-hooks-"));
  try {
    await runGit(candidatePath, ["-c", `core.hooksPath=${hookDirectory}`, "merge", "--no-verify", "--no-edit", "--no-gpg-sign", targetCommit]);
  } catch {
    const unmerged = await runGit(candidatePath, ["diff", "--name-only", "--diff-filter=U", "-z"], [1])
      .catch(() => ({ stdout: "", stderr: "", status: -1 }));
    const conflictedPaths = unmerged.stdout.split("\0").filter(Boolean).sort((left, right) => left.localeCompare(right));
    if (conflictedPaths.length) {
      throw new GitWorkspaceError("WORKTREE_CONFLICT", "The pinned release conflicts with the durable update candidate; resolve it manually before retrying.", {
        path: candidatePath,
        paths: conflictedPaths,
      });
    }
    throw new GitWorkspaceError("WORKTREE_PREPARATION_FAILED", "Git could not resume the pinned merge. The candidate was retained for inspection.", { path: candidatePath });
  } finally {
    await rmdir(hookDirectory).catch(() => undefined);
  }
}

export interface FindPreparedUpdateWorktreeOptions {
  expectedTargetCommit: string;
  expectedOriginalHead: string;
  /** Exact recorded candidate HEAD, if it has been journaled. The original base is also accepted as a pre-merge recovery state. */
  expectedCandidateHead?: string;
  /** Recovery-only: inspect a completed merge whose candidate HEAD was not journaled before interruption. */
  allowUnpinnedMerge?: boolean;
}

/** Finds a durable candidate and safely completes only its exact pinned merge after a pre-merge crash. */
export async function findPreparedUpdateWorktree(
  repoRoot: string,
  branch: string,
  options: FindPreparedUpdateWorktreeOptions,
): Promise<ExistingUpdateWorktree | null> {
  if (!branch.startsWith(UPDATE_BRANCH_PREFIX) || !RELEASE_TAG_PATTERN.test(branch.slice(UPDATE_BRANCH_PREFIX.length))) {
    throw new GitWorkspaceError("INVALID_BRANCH", `Candidate branches must use ${UPDATE_BRANCH_PREFIX}<stable-version>.`);
  }
  const base = await inspectGitCheckoutInternal(repoRoot, { allowLinkedWorktree: true });
  const root = base.root;
  await assertGitBranchName(root, branch);
  const targetCommit = await validateCommit(root, options.expectedTargetCommit);
  const originalHead = await validateCommit(root, options.expectedOriginalHead);
  const expectedCandidateHead = options.expectedCandidateHead
    ? await validateCommit(root, options.expectedCandidateHead)
    : undefined;
  const listed = (await runGit(root, ["worktree", "list", "--porcelain", "-z"])).stdout;
  const fields = listed.split("\0").filter(Boolean);
  const entries: Array<{ path?: string; branch?: string }> = [];
  let current: { path?: string; branch?: string } | undefined;
  for (const field of fields) {
    if (field.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: field.slice("worktree ".length) };
    } else if (field.startsWith("branch ")) {
      current ??= {};
      current.branch = field.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  if (current) entries.push(current);
  const candidate = entries.find((entry) => entry.branch === branch);
  if (!candidate?.path) return null;

  const candidatePath = await realPathOrError(candidate.path);
  const checkout = await inspectGitCheckoutInternal(candidatePath, { allowLinkedWorktree: true });
  if (!checkout.isLinkedWorktree) {
    throw new GitWorkspaceError("CANDIDATE_NOT_FOUND", "The selected update branch is not checked out in an isolated Git worktree.", { branch });
  }
  if (checkout.branch !== branch) {
    throw new GitWorkspaceError("CANDIDATE_BRANCH_MISMATCH", "The registered candidate worktree is checked out on another branch.", {
      expectedBranch: branch,
      currentBranch: checkout.branch,
    });
  }
  if (checkout.dirtyPaths.length) {
    throw new GitWorkspaceError("DIRTY_WORKTREE", "The prepared update worktree has uncommitted files and cannot be resumed automatically.", {
      paths: checkout.dirtyPaths,
      path: candidatePath,
    });
  }
  const [baseCommonDir, candidateCommonDir] = await Promise.all([
    runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    runGit(candidatePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  if (comparablePath(baseCommonDir.stdout.trim()) !== comparablePath(candidateCommonDir.stdout.trim())) {
    throw new GitWorkspaceError("CANDIDATE_NOT_FOUND", "The registered candidate belongs to a different Git checkout.", { branch });
  }
  let history = await inspectCandidateHistory(root, checkout.headCommit, originalHead, targetCommit);
  if (!history) {
    throw new GitWorkspaceError("CANDIDATE_HISTORY_INVALID", "The candidate contains commits outside the recorded base and pinned release; preserve it for manual review.", {
      branch,
      originalHead,
      targetCommit,
      candidateHead: checkout.headCommit,
    });
  }
  if (!expectedCandidateHead && history === "prepared" && checkout.headCommit.toLowerCase() !== targetCommit.toLowerCase()
    && options.allowUnpinnedMerge !== true) {
    throw new GitWorkspaceError("CANDIDATE_HEAD_UNPINNED", "The candidate is a merge whose exact HEAD was not saved. Review and explicitly adopt its commit before continuing.", {
      branch,
      candidateHead: checkout.headCommit,
      path: candidatePath,
    });
  }
  if (expectedCandidateHead
    && checkout.headCommit.toLowerCase() !== expectedCandidateHead.toLowerCase()
    && !(expectedCandidateHead.toLowerCase() === originalHead.toLowerCase() && history === "prepared")) {
    throw new GitWorkspaceError("CANDIDATE_HEAD_MISMATCH", "The durable candidate HEAD differs from the journal and is not the exact pinned merge recovery state.", {
      branch,
      expectedCandidateHead,
      candidateHead: checkout.headCommit,
    });
  }
  if (history === "untouched") {
    await mergePinnedTarget(candidatePath, targetCommit);
    const resumed = await inspectGitCheckoutInternal(candidatePath, { allowLinkedWorktree: true });
    if (resumed.dirtyPaths.length) {
      throw new GitWorkspaceError("WORKTREE_CONFLICT", "The pinned merge left the durable candidate with uncommitted changes; inspect it before continuing.", {
        path: candidatePath,
        paths: resumed.dirtyPaths,
      });
    }
    history = await inspectCandidateHistory(root, resumed.headCommit, originalHead, targetCommit);
    if (history !== "prepared") {
      throw new GitWorkspaceError("CANDIDATE_HISTORY_INVALID", "The resumed candidate does not end at the pinned target or its exact two-parent merge.", {
        branch,
        originalHead,
        targetCommit,
        candidateHead: resumed.headCommit,
      });
    }
    return { branch, path: candidatePath, headCommit: resumed.headCommit, originalHead, targetCommit };
  }
  return { branch, path: candidatePath, headCommit: checkout.headCommit, originalHead, targetCommit };
}

async function assertGitBranchName(root: string, branch: string): Promise<void> {
  const result = await runGit(root, ["check-ref-format", "--branch", branch], [1]);
  if (result.status !== 0) throw new GitWorkspaceError("INVALID_BRANCH", "The selected candidate branch name is invalid.");
}

/** Pushes a clean prepared candidate only, to the named configured remote, using a normal non-force push. */
export async function pushUpdateBranch(options: PushUpdateBranchOptions): Promise<PushedUpdateBranch> {
  const root = await realPathOrError(options.repoRoot);
  const candidatePath = await realPathOrError(options.worktreePath);
  const rootCheckout = await inspectGitCheckoutInternal(root, { allowLinkedWorktree: true });
  if (rootCheckout.headCommit.toLowerCase() !== options.expectedOriginalHead.toLowerCase() || rootCheckout.dirtyPaths.length) {
    throw new GitWorkspaceError("SOURCE_CHECKOUT_CHANGED", "The source checkout changed after the update was planned. The candidate was not pushed.", {
      expectedHead: options.expectedOriginalHead,
      currentHead: rootCheckout.headCommit,
      dirtyPaths: rootCheckout.dirtyPaths,
    });
  }
  const checkout = await inspectGitCheckoutInternal(candidatePath, { allowLinkedWorktree: true });
  if (!checkout.isLinkedWorktree) {
    throw new GitWorkspaceError("CANDIDATE_NOT_FOUND", "The selected update candidate is not a linked worktree of the NOVA checkout.");
  }
  const [baseCommonDir, candidateCommonDir] = await Promise.all([
    runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    runGit(candidatePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ]);
  if (comparablePath(baseCommonDir.stdout.trim()) !== comparablePath(candidateCommonDir.stdout.trim())) {
    throw new GitWorkspaceError("CANDIDATE_NOT_FOUND", "The selected candidate worktree does not belong to the requested NOVA checkout.");
  }
  if (checkout.dirtyPaths.length) {
    throw new GitWorkspaceError("DIRTY_WORKTREE", "The candidate update worktree has uncommitted files; review and commit them before pushing.", {
      paths: checkout.dirtyPaths,
    });
  }
  if (checkout.branch !== options.localBranch) {
    throw new GitWorkspaceError("CANDIDATE_BRANCH_MISMATCH", "The candidate worktree is not checked out on the branch selected for push.", {
      expectedBranch: options.localBranch,
      currentBranch: checkout.branch,
    });
  }
  if (!options.localBranch.startsWith(UPDATE_BRANCH_PREFIX)) {
    throw new GitWorkspaceError("INVALID_BRANCH", `Candidate branches must use the ${UPDATE_BRANCH_PREFIX} prefix.`);
  }
  await assertGitBranchName(root, options.localBranch);
  await assertGitBranchName(root, options.destinationBranch);
  const remote = await remoteInfo(root, options.remoteName);
  if (!remote) throw new GitWorkspaceError("REMOTE_NOT_FOUND", "The selected Git push remote is not configured.", { remoteName: options.remoteName });
  const configuredPushUrls = await rawPushUrls(root, options.remoteName);
  if (configuredPushUrls.length !== 1) {
    throw new GitWorkspaceError("PUSH_REMOTE_AMBIGUOUS", "The selected remote has multiple push destinations; configure one destination before pushing an update.", {
      remoteName: remote.name,
      pushUrls: remote.pushUrls,
    });
  }
  const pushUrl = configuredPushUrls[0]!;
  validateGitHubPushUrl(pushUrl);
  if (pushUrl !== options.confirmedPushUrl) {
    throw new GitWorkspaceError("PUSH_DESTINATION_CHANGED", "The configured GitHub push destination changed after confirmation. Review and confirm the new destination before retrying.", {
      remoteName: remote.name,
      confirmedUrl: redactRemoteUrl(options.confirmedPushUrl),
      currentUrl: redactRemoteUrl(pushUrl),
    });
  }
  const configuredRepository = githubRepositoryIdentity(pushUrl);
  if (!configuredRepository) {
    throw new GitWorkspaceError("PUSH_DESTINATION_UNSUPPORTED", "The configured push destination is not a recognized GitHub repository.");
  }
  if (configuredRepository === options.canonicalRepository.replace(/\.git$/i, "").toLowerCase()) {
    throw new GitWorkspaceError("PUSH_DESTINATION_CANONICAL", "The updater cannot push a customer update directly to the canonical NOVA repository.");
  }

  const expectedCandidateHead = await validateCommit(candidatePath, options.expectedCandidateHead);
  const expectedOriginalHead = await validateCommit(candidatePath, options.expectedOriginalHead);
  const expectedTargetCommit = await validateCommit(candidatePath, options.expectedTargetCommit);
  const lastCheck = await inspectGitCheckoutInternal(candidatePath, { allowLinkedWorktree: true });
  if (lastCheck.dirtyPaths.length) {
    throw new GitWorkspaceError("DIRTY_WORKTREE", "The candidate changed while the push was being prepared; review it before pushing.", {
      paths: lastCheck.dirtyPaths,
    });
  }
  if (lastCheck.branch !== options.localBranch
    || lastCheck.headCommit.toLowerCase() !== expectedCandidateHead.toLowerCase()) {
    throw new GitWorkspaceError("CANDIDATE_HEAD_MISMATCH", "The candidate HEAD changed after review; refresh the update plan before pushing.", {
      expectedCandidateHead,
      candidateHead: lastCheck.headCommit,
      expectedBranch: options.localBranch,
      currentBranch: lastCheck.branch,
    });
  }
  const history = await inspectCandidateHistory(candidatePath, lastCheck.headCommit, expectedOriginalHead, expectedTargetCommit);
  if (history !== "prepared") {
    throw new GitWorkspaceError("CANDIDATE_HISTORY_INVALID", "The push candidate no longer ends at the exact pinned release merge; refresh and review it before pushing.", {
      candidateHead: lastCheck.headCommit,
      expectedOriginalHead,
      expectedTargetCommit,
    });
  }

  const finalRootCheckout = await inspectGitCheckoutInternal(root, { allowLinkedWorktree: true });
  if (finalRootCheckout.headCommit.toLowerCase() !== options.expectedOriginalHead.toLowerCase()
    || finalRootCheckout.dirtyPaths.length) {
    throw new GitWorkspaceError("SOURCE_CHECKOUT_CHANGED", "The source checkout changed while migrations or preflight were running. The candidate was not pushed.", {
      expectedHead: options.expectedOriginalHead,
      currentHead: finalRootCheckout.headCommit,
      dirtyPaths: finalRootCheckout.dirtyPaths,
    });
  }

  try {
    await runGit(candidatePath, [
      "push",
      "--porcelain",
      "--",
      pushUrl,
      `${expectedCandidateHead}:refs/heads/${options.destinationBranch}`,
    ]);
  } catch {
    throw new GitWorkspaceError("PUSH_FAILED", "Git could not push the candidate branch. The candidate remains available locally; no force push was attempted.", {
      remoteName: remote.name,
      remoteUrl: redactRemoteUrl(pushUrl),
      branch: options.destinationBranch,
    });
  }

  return {
    localBranch: options.localBranch,
    commit: checkout.headCommit,
    destination: {
      remoteName: remote.name,
      remoteUrl: redactRemoteUrl(pushUrl),
      branch: options.destinationBranch,
    },
  };
}
