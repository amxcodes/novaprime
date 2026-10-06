import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  applyPostgresUpdate,
  applySupabaseUpdate,
  planPostgresUpdate,
  planSupabaseUpdate,
  postgresTargetLabel,
  postgresUrlsReferToSameDatabase,
  supabaseUrlBelongsToProject,
  type MigrationHashManifest,
  type MigrationPlan,
} from "./update/database.js";
import {
  fetchPinnedRelease,
  findPreparedUpdateWorktree,
  githubRepositoryIdentity,
  inspectGitCheckout,
  prepareUpdateWorktree,
  pushUpdateBranch,
  validateGitHubPushUrl,
  GitWorkspaceError,
  type GitCheckoutInfo,
  type GitRemoteInfo,
} from "./update/git.js";
import {
  CANONICAL_REPOSITORY,
  discoverStableBaselineRelease,
  discoverLatestStableRelease,
  discoverStableReleaseByTag,
  loadVerifiedReleaseTreeFromRoot,
  verifyPinnedReleaseStillCurrent,
  type ReleaseManifestV1,
  type StableRelease,
  type VerifiedReleaseTree,
} from "./update/release.js";
import {
  acquireUpdateLock,
  getUpdateWorktreeDirectory,
  loadUpdateJournal,
  newUpdateJournal,
  saveUpdateJournal,
  updateTargetFingerprint,
  type UpdateJournal,
} from "./update/state.js";
import { confirm, promptLine, promptSecret, requireInteractiveTerminal } from "./update/terminal.js";

const repoRoot = resolve(import.meta.dir, "..");
const canonicalUrl = `https://github.com/${CANONICAL_REPOSITORY}.git`;
const checksumMigration = "0076_operator_update_checksums.sql";
const sensitiveValues = new Set<string>();

type Mode = "check" | "plan" | "apply";
interface Options { mode: Mode; releaseTag?: string; resume: boolean; help: boolean }
type DatabaseTarget =
  | { kind: "postgres"; url: string; label: string }
  | { kind: "supabase"; projectRef: string; accessToken: string; label: string };

interface OfferPushAdapters {
  repoRoot: string;
  inspectGitCheckout: typeof inspectGitCheckout;
  confirm: typeof confirm;
  promptLine: typeof promptLine;
  verifyCandidateApplicationRole: typeof verifyCandidateApplicationRole;
  verifyPinnedReleaseStillCurrent: typeof verifyPinnedReleaseStillCurrent;
  pushUpdateBranch: typeof pushUpdateBranch;
  saveUpdateJournal: typeof saveUpdateJournal;
}

interface MigrationApplyAdapters {
  confirm: typeof confirm;
  promptLine: typeof promptLine;
  confirmBackup: typeof confirmBackup;
  saveUpdateJournal: typeof saveUpdateJournal;
  applyPostgresUpdate: typeof applyPostgresUpdate;
  applySupabaseUpdate: typeof applySupabaseUpdate;
}

/** Narrow orchestration seam: production defaults remain the real local services. */
export interface UpdateRuntimeOverrides {
  repoRoot?: string;
  confirm?: typeof confirm;
  promptLine?: typeof promptLine;
  requireInteractiveTerminal?: typeof requireInteractiveTerminal;
  acquireUpdateLock?: typeof acquireUpdateLock;
  inspectGitCheckout?: typeof inspectGitCheckout;
  readPackageVersion?: typeof readPackageVersion;
  loadUpdateJournal?: typeof loadUpdateJournal;
  discoverRelease?: typeof discoverRelease;
  verifyBaseline?: typeof verifyBaseline;
  verifyPinnedReleaseStillCurrent?: typeof verifyPinnedReleaseStillCurrent;
  fetchPinnedRelease?: typeof fetchPinnedRelease;
  getUpdateWorktreeDirectory?: typeof getUpdateWorktreeDirectory;
  findPreparedUpdateWorktree?: typeof findPreparedUpdateWorktree;
  prepareUpdateWorktree?: typeof prepareUpdateWorktree;
  newUpdateJournal?: typeof newUpdateJournal;
  saveUpdateJournal?: typeof saveUpdateJournal;
  loadVerifiedReleaseTreeFromRoot?: typeof loadVerifiedReleaseTreeFromRoot;
  buildCandidate?: typeof buildCandidate;
  chooseDatabaseTarget?: typeof chooseDatabaseTarget;
  planDatabase?: typeof planDatabase;
  applyMigrations?: typeof applyMigrations;
  migrationApplyAdapters?: Partial<MigrationApplyAdapters>;
  offerPushAdapters?: Partial<OfferPushAdapters>;
}

export function parseArguments(args: readonly string[]): Options {
  let mode: Mode = "apply";
  let modeSeen = false;
  let resume = false;
  let help = false;
  let releaseTag: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--check" || arg === "--plan") {
      if (modeSeen) throw new Error("UPDATE_MODE_CONFLICT");
      mode = arg === "--check" ? "check" : "plan";
      modeSeen = true;
      continue;
    }
    if (arg === "--resume") {
      if (resume) throw new Error("UPDATE_OPTION_DUPLICATE:--resume");
      resume = true;
      continue;
    }
    if (arg === "--release") {
      if (releaseTag) throw new Error("UPDATE_OPTION_DUPLICATE:--release");
      releaseTag = args[++index]?.trim();
      if (!releaseTag || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(releaseTag)) {
        throw new Error("UPDATE_RELEASE_TAG_INVALID: use a stable vMAJOR.MINOR.PATCH tag");
      }
      continue;
    }
    throw new Error(`UPDATE_OPTION_UNSUPPORTED:${arg}`);
  }
  if (help && (modeSeen || resume || releaseTag)) throw new Error("UPDATE_HELP_CANNOT_BE_COMBINED");
  if (mode === "check" && resume) throw new Error("UPDATE_CHECK_CANNOT_RESUME");
  if (resume && releaseTag) throw new Error("UPDATE_RESUME_RELEASE_CONFLICT: omit --release; resume uses the release pinned in the journal");
  if (mode === "check" && releaseTag && help) throw new Error("UPDATE_HELP_CANNOT_BE_COMBINED");
  return { mode, releaseTag, resume, help };
}

function printHelp(): void {
  console.info([
    "NOVA Update Manager",
    "  bun run nova:update --check             Check the latest stable release; no DB or checkout writes.",
    "  bun run nova:update --plan              Prepare an isolated candidate and show a read-only DB plan.",
    "  bun run nova:update                     Guide through a staged update, DB migration, and optional push.",
    "  bun run nova:update --release vX.Y.Z    Pin the guided update to a specific stable release.",
    "  bun run nova:update --resume             Resume the recorded pinned update after inspecting Git and DB state.",
    "",
    "No automatic push, force push, downgrade, reverse migration, or --yes mode is supported.",
  ].join("\n"));
}

function recordErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]{1,160}$/.test(error.message)) return error.message;
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_:-]{1,160}$/.test(code)) return code;
    const stable = (error as Error & { code?: unknown }).code;
    if (stable === undefined && error.name === "ReleaseIntegrityError") {
      const releaseCode = (error as Error & { code?: unknown }).code;
      if (typeof releaseCode === "string") return releaseCode;
    }
  }
  return "UPDATE_FAILED";
}

function scrub(output: string): string {
  let text = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  for (const secret of sensitiveValues) {
    if (secret) text = text.replaceAll(secret, "[REDACTED]");
  }
  return text
    .replace(/(postgres(?:ql)?:\/\/[^\s:/@]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sbp|sb_secret|eyJ)[A-Za-z0-9._-]{12,}/g, "[REDACTED]")
    .slice(0, 8_000);
}

function userSafeError(error: unknown): string {
  if (error instanceof Error) {
    const message = scrub(error.message);
    const typedCode = (error as Error & { code?: unknown }).code;
    if (typeof typedCode === "string" && /^[A-Z0-9_:-]{1,120}$/.test(typedCode)) {
      return `${typedCode}${message && message !== typedCode ? `: ${message}` : ""}`;
    }
    if (/^[A-Z0-9_:-]{1,160}$/.test(message)) return message;
    if (/^[A-Z][A-Z0-9_:-]{1,120}:/.test(message)) return message;
    if (error.name === "GitWorkspaceError" || error.name === "ReleaseIntegrityError") {
      return scrub(`${typedCode ?? error.name}: ${message}`);
    }
  }
  return "UPDATE_FAILED: details were omitted because they could contain credentials; rerun with the relevant provider or Git diagnostics visible.";
}

function terminalText(value: string): string {
  return scrub(value).replace(/[\u202A-\u202E\u2066-\u2069]/g, "").trim();
}

function manifestMap(tree: VerifiedReleaseTree): MigrationHashManifest {
  return Object.fromEntries(tree.migrationHashes);
}

function assertSameManifest(left: ReleaseManifestV1, right: ReleaseManifestV1): void {
  const sameMigrations = left.migrations.length === right.migrations.length &&
    left.migrations.every((migration, index) => {
      const other = right.migrations[index];
      return other?.filename === migration.filename && other.sha256 === migration.sha256;
    });
  if (
    left.schemaVersion !== right.schemaVersion || left.version !== right.version ||
    left.migrationClass !== right.migrationClass || left.impact !== right.impact ||
    left.minimumStartingVersion !== right.minimumStartingVersion || !sameMigrations
  ) throw new Error("RELEASE_MANIFEST_SOURCE_MISMATCH: local source differs from the canonical published release");
}

async function readPackageVersion(sourceRoot: string): Promise<string> {
  const metadata = JSON.parse(await readFile(resolve(sourceRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof metadata.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(metadata.version)) {
    throw new Error("PACKAGE_VERSION_INVALID: package.json must contain stable MAJOR.MINOR.PATCH");
  }
  return metadata.version;
}

async function discoverRelease(currentVersion: string, options: Options, currentCommit?: string): Promise<StableRelease | undefined> {
  const check = options.releaseTag
    ? await discoverStableReleaseByTag({ tag: options.releaseTag, currentVersion })
    : await discoverLatestStableRelease({ currentVersion, currentCommit });
  if (check.status === "up-to-date") {
    console.info(`NOVA ${currentVersion} is already at the selected stable release ${check.release.tag}.`);
    return undefined;
  }
  return check.release;
}

function printCheckout(checkout: GitCheckoutInfo, currentVersion: string): void {
  console.info(`Checkout: ${checkout.root}`);
  console.info(`Branch: ${checkout.branch ?? "detached"}; source: ${checkout.headCommit.slice(0, 12)}; package version: ${currentVersion}`);
  console.info(`Git shape: shallow=${checkout.isShallow}, sparse=${checkout.isSparseCheckout}, linked-worktree=${checkout.isLinkedWorktree}, submodules=${checkout.hasSubmodules}`);
  if (checkout.dirtyPaths.length) {
    console.info(`Local changes: ${checkout.dirtyPaths.length} staged, modified, or untracked path(s); apply will stop until the checkout is clean.`);
    for (const path of checkout.dirtyPaths.slice(0, 20)) console.info(`  ${terminalText(path)}`);
    if (checkout.dirtyPaths.length > 20) console.info(`  … ${checkout.dirtyPaths.length - 20} additional path(s)`);
  } else {
    console.info("Local changes: none.");
  }
  for (const remote of checkout.remotes) {
    console.info(`Remote ${terminalText(remote.name)}: ${(remote.fetchUrls[0] ?? "URL unavailable")}`);
  }
}

export async function runCheck(options: Options, overrides: UpdateRuntimeOverrides = {}): Promise<void> {
  const root = overrides.repoRoot ?? repoRoot;
  const readVersion = overrides.readPackageVersion ?? readPackageVersion;
  const inspect = overrides.inspectGitCheckout ?? inspectGitCheckout;
  const findRelease = overrides.discoverRelease ?? discoverRelease;
  const verifyRelease = overrides.verifyPinnedReleaseStillCurrent ?? verifyPinnedReleaseStillCurrent;
  const currentVersion = await readVersion(root);
  let checkout: GitCheckoutInfo;
  try {
    checkout = await inspect(root);
  } catch (error) {
    console.error(`Checkout unsupported: ${userSafeError(error)}`);
    process.exitCode = 2;
    return;
  }
  printCheckout(checkout, currentVersion);
  let release: StableRelease | undefined;
  try {
    release = await findRelease(currentVersion, options, checkout.headCommit);
  } catch (error) {
    if (recordErrorCode(error).startsWith("NO_STABLE_RELEASE")) {
      console.info("No published stable NOVA release is available yet; no branch or database fallback was used.");
      return;
    }
    throw error;
  }
  if (!release) return;
  await verifyRelease(release);
  console.info(`Update available: ${currentVersion} → ${release.version}`);
  console.info(`Release: ${release.tag}; commit ${release.commit}; published ${release.publishedAt}`);
  console.info(`Compatibility: ${release.manifest.migrationClass} — ${terminalText(release.manifest.impact)}`);
  console.info(`Release notes: ${terminalText(release.notes || "No notes provided.").slice(0, 5_000)}`);
  console.info(`Details: ${release.releaseUrl}`);
  if (checkout.dirtyPaths.length) process.exitCode = 2;
}

function ensureRootCheckout(checkout: GitCheckoutInfo): void {
  if (checkout.dirtyPaths.length) throw new Error("DIRTY_WORKTREE: commit or back up all staged, modified, and untracked files, then retry");
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left).replace(/[\\/]+$/, "");
  const b = resolve(right).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isWithinPath(parent: string, candidate: string): boolean {
  const root = resolve(parent).replace(/[\\/]+$/, "");
  const target = resolve(candidate).replace(/[\\/]+$/, "");
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const normalizedTarget = process.platform === "win32" ? target.toLowerCase() : target;
  return normalizedTarget.startsWith(`${normalizedRoot}${process.platform === "win32" ? "\\" : "/"}`);
}

async function verifyBaseline(currentVersion: string, sourceRoot = repoRoot): Promise<VerifiedReleaseTree> {
  const localTree = await loadVerifiedReleaseTreeFromRoot(sourceRoot);
  if (localTree.manifest.version !== currentVersion) throw new Error("BASELINE_VERSION_MISMATCH");
  const baseline = await discoverStableBaselineRelease({ tag: `v${currentVersion}`, version: currentVersion });
  assertSameManifest(localTree.manifest, baseline.manifest);
  return localTree;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  const env = safeBuildEnvironment();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", shell: false, windowsHide: true });
    child.once("error", () => rejectPromise(new Error(`CANDIDATE_COMMAND_START_FAILED:${command}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`CANDIDATE_COMMAND_FAILED:${command}:${code ?? signal ?? "unknown"}`));
    });
  });
}

function safeBuildEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA", "LOCALAPPDATA",
    "BUN_INSTALL", "CI",
  ]);
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (allowed.has(name.toUpperCase()) && value !== undefined) environment[name] = value;
  }
  environment.CI = "true";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

async function buildCandidate(candidateRoot: string): Promise<void> {
  const privateEnvironmentNames = new Set([
    ".env", ".env.local", ".env.development", ".env.development.local",
    ".env.test", ".env.test.local", ".env.production", ".env.production.local",
  ]);
  for (const directory of [candidateRoot, resolve(candidateRoot, "server")]) {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error("CANDIDATE_ENVIRONMENT_SCAN_FAILED");
    }
    for (const name of entries) {
      if (!privateEnvironmentNames.has(name)) continue;
      const details = await lstat(resolve(directory, name)).catch(() => undefined);
      if (details) throw new Error("CANDIDATE_PRIVATE_ENV_FILE_PRESENT: remove tracked environment files from the release before building it");
    }
  }
  console.info("Installing the pinned candidate dependencies in its isolated worktree (the operator .env is not passed to build steps)…");
  await runCommand("bun", ["install", "--frozen-lockfile"], candidateRoot);
  console.info("Checking candidate types, tests, and production build before any database write…");
  await runCommand("bun", ["run", "typecheck"], candidateRoot);
  await runCommand("bun", ["run", "test"], candidateRoot);
  await runCommand("bun", ["run", "--cwd", "server", "build"], candidateRoot);
}

function applicationDatabaseMatchesTarget(target: DatabaseTarget, applicationUrl: string): boolean {
  return target.kind === "postgres"
    ? postgresUrlsReferToSameDatabase(target.url, applicationUrl)
    : supabaseUrlBelongsToProject(applicationUrl, target.projectRef);
}

async function verifyCandidateApplicationRole(candidateRoot: string, target: DatabaseTarget): Promise<void> {
  let applicationUrl = process.env.DATABASE_URL;
  if (!applicationUrl) applicationUrl = await promptSecret("Restricted nova_app DATABASE_URL for post-migration preflight");
  if (!applicationUrl) throw new Error("APPLICATION_DATABASE_URL_REQUIRED: application-role preflight is required before push");
  sensitiveValues.add(applicationUrl);
  if (!applicationDatabaseMatchesTarget(target, applicationUrl)) {
    throw new Error("APPLICATION_DATABASE_TARGET_MISMATCH: the restricted app URL does not identify the confirmed migration target");
  }

  const environment = safeBuildEnvironment();
  environment.DATABASE_URL = applicationUrl;
  environment.NOVA_APPLICATION_DATABASE_ROLE = "nova_app";
  if (target.kind === "postgres") {
    environment.MIGRATOR_DATABASE_URL = target.url;
  } else {
    environment.NOVA_SUPABASE_PROJECT_REF = target.projectRef;
    environment.SUPABASE_ACCESS_TOKEN = target.accessToken;
  }

  console.info("Checking candidate schema and restricted nova_app access before offering a push…");
  let childOutput = "";
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise, rejectPromise) => {
    const child = spawn("bun", ["--no-env-file", "scripts/deployment-preflight.ts", "--migration-update"], {
      cwd: candidateRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectPromise(new Error("APPLICATION_PREFLIGHT_TIMEOUT: candidate role check exceeded 120 seconds"));
    }, 120_000);
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(new Error("APPLICATION_PREFLIGHT_START_FAILED"));
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer | string) => {
        childOutput = (childOutput + String(chunk)).slice(-8_000);
      });
    }
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      resolvePromise({ code, signal });
    });
  });
  const output = scrub(childOutput).trim();
  if (outcome.code !== 0) {
    throw new Error(`APPLICATION_ROLE_PREFLIGHT_FAILED${output ? `: ${output}` : ` (${outcome.code ?? outcome.signal ?? "unknown"})`}`);
  }
  const summaryLine = output.split(/\r?\n/).at(-1);
  let summary: { status?: unknown; applicationRole?: unknown } | undefined;
  try {
    summary = summaryLine ? JSON.parse(summaryLine) as typeof summary : undefined;
  } catch {
    throw new Error("APPLICATION_PREFLIGHT_RESPONSE_INVALID");
  }
  if (summary?.status !== "ready" || summary.applicationRole !== environment.NOVA_APPLICATION_DATABASE_ROLE) {
    throw new Error("APPLICATION_ROLE_PREFLIGHT_FAILED: restricted database role or schema readiness did not pass");
  }
  console.info("Restricted application-role preflight passed for the selected target. Check the deployed /api/ready endpoint after deployment.");
}

function printPlan(plan: MigrationPlan, release: StableRelease): void {
  console.info(`Database target: ${plan.target}`);
  console.info(`Already recorded migrations: ${plan.applied.length}`);
  console.info(`Pending migrations: ${plan.pending.length}`);
  for (const migration of plan.pending) console.info(`  ${migration.filename}  sha256:${migration.sha256}`);
  if (plan.pending.length === 0) console.info("The database migration ledger already matches this release.");
  console.info(`Release compatibility: ${release.manifest.migrationClass} — ${terminalText(release.manifest.impact)}`);
}

async function chooseDatabaseTarget(): Promise<DatabaseTarget> {
  requireInteractiveTerminal();
  const postgresUrl = process.env.MIGRATOR_DATABASE_URL;
  const envProjectRef = process.env.NOVA_SUPABASE_PROJECT_REF;
  let kind: "postgres" | "supabase";
  if (postgresUrl && envProjectRef) {
    const answer = await promptLine("Database target: [1] direct PostgreSQL, [2] Supabase Cloud", "1");
    if (answer !== "1" && answer !== "2") throw new Error("DATABASE_TARGET_CHOICE_INVALID");
    kind = answer === "1" ? "postgres" : "supabase";
  } else if (postgresUrl) {
    kind = "postgres";
  } else if (envProjectRef) {
    const answer = await promptLine("Database target: [1] Supabase Cloud Management API, [2] direct PostgreSQL connection", "1");
    if (answer !== "1" && answer !== "2") throw new Error("DATABASE_TARGET_CHOICE_INVALID");
    kind = answer === "1" ? "supabase" : "postgres";
  } else {
    const answer = await promptLine("Database target: [1] direct PostgreSQL, [2] Supabase Cloud");
    if (answer !== "1" && answer !== "2") throw new Error("DATABASE_TARGET_CHOICE_INVALID");
    kind = answer === "1" ? "postgres" : "supabase";
  }

  if (kind === "postgres") {
    let url = postgresUrl;
    if (!url) {
      url = await promptSecret("Migration-owner PostgreSQL connection URL");
      if (url) sensitiveValues.add(url);
    }
    if (!url) throw new Error("MIGRATOR_DATABASE_URL_REQUIRED");
    const label = postgresTargetLabel(url);
    return { kind, url, label };
  }

  const projectRef = (envProjectRef ?? await promptLine("Supabase project ref (20 lowercase letters/digits)")).trim();
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("NOVA_SUPABASE_PROJECT_REF_INVALID");
  let accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? process.env.Supabaseaccesstoken;
  if (!accessToken) accessToken = await promptSecret("Supabase project-scoped Management API token");
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN_REQUIRED");
  sensitiveValues.add(accessToken);
  return { kind, projectRef, accessToken, label: `Supabase project ${projectRef}` };
}

async function planDatabase(
  target: DatabaseTarget,
  baselineManifest: MigrationHashManifest,
  targetManifest: MigrationHashManifest,
  migrationDirectory: string,
  verifiedMigrationHashes: MigrationHashManifest,
): Promise<MigrationPlan> {
  if (target.kind === "postgres") {
    const confirmation = await promptLine(`Type the exact PostgreSQL target to confirm: ${target.label}`);
    return planPostgresUpdate({
      databaseUrl: target.url,
      confirmation,
      baselineManifest,
      targetManifest,
      migrationDirectory,
      verifiedMigrationHashes,
    });
  }
  const confirmation = await promptLine(`Type the exact Supabase project ref to confirm: ${target.projectRef}`);
  return planSupabaseUpdate({
    projectRef: target.projectRef,
    accessToken: target.accessToken,
    confirmation,
    baselineManifest,
    targetManifest,
    migrationDirectory,
    verifiedMigrationHashes,
  });
}

async function confirmBackup(targetLabel: string): Promise<{ reference: string; confirmedAt: string }> {
  console.info(`Forward-only migration safety: NOVA will not create, store, or restore a database backup for ${targetLabel}.`);
  const reference = (await promptLine("Backup/PITR restore-point ID or safe label (required; do not enter a URL or credentials)")).trim();
  if (reference.length < 4) throw new Error("BACKUP_REFERENCE_REQUIRED");
  if (
    reference.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:/ -]{2,159}$/.test(reference) ||
    reference.includes("://")
  ) {
    throw new Error("BACKUP_REFERENCE_INVALID: use a short ID or label without a URL or credentials");
  }
  const createdAt = await promptLine("Backup/restore-point creation time in ISO 8601 format");
  const timestamp = Date.parse(createdAt);
  const age = Date.now() - timestamp;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(createdAt) || !Number.isFinite(timestamp) || age < 0 || age > 24 * 60 * 60 * 1000) {
    throw new Error("BACKUP_MUST_BE_RECENT: provide a restorable backup from the last 24 hours");
  }
  if (!await confirm("Have you confirmed that this backup/restore point is available and restorable?")) {
    throw new Error("BACKUP_NOT_CONFIRMED");
  }
  return { reference, confirmedAt: new Date(timestamp).toISOString() };
}

function verifiedJournalHashes(journal: UpdateJournal): MigrationHashManifest {
  const values: Record<string, string> = {};
  for (const entry of journal.appliedMigrations) values[entry.filename] = entry.sha256;
  if (journal.inFlightMigration) values[journal.inFlightMigration.filename] = journal.inFlightMigration.sha256;
  return values;
}

function journalForResume(journal: UpdateJournal, checkout: GitCheckoutInfo, release: StableRelease): void {
  if (journal.phase === "complete") throw new Error("NO_INCOMPLETE_UPDATE_TO_RESUME");
  if (!samePath(journal.repoRoot, checkout.root) || journal.originalHead.toLowerCase() !== checkout.headCommit.toLowerCase()) {
    throw new Error("UPDATE_RESUME_CHECKOUT_CHANGED: return to the exact source commit recorded in the attempt journal");
  }
  if (journal.release.tag !== release.tag || journal.release.commit.toLowerCase() !== release.commit.toLowerCase()) {
    throw new Error("UPDATE_RESUME_RELEASE_MISMATCH: resume only the exact pinned release recorded in the journal");
  }
}

function assertAttemptTarget(journal: UpdateJournal, target: DatabaseTarget): void {
  const fingerprint = updateTargetFingerprint(target.label);
  if (journal.database && journal.database.targetFingerprint !== fingerprint) {
    throw new Error("UPDATE_RESUME_DATABASE_TARGET_MISMATCH: choose the same confirmed database target as the incomplete attempt");
  }
}

async function applyMigrations(
  target: DatabaseTarget,
  plan: MigrationPlan,
  journal: UpdateJournal,
  baselineManifest: MigrationHashManifest,
  targetManifest: MigrationHashManifest,
  migrationDirectory: string,
  overrides: Partial<MigrationApplyAdapters> = {},
): Promise<void> {
  const services: MigrationApplyAdapters = {
    confirm,
    promptLine,
    confirmBackup,
    saveUpdateJournal,
    applyPostgresUpdate,
    applySupabaseUpdate,
    ...overrides,
  };
  if (plan.pending.length > 0 && journal.release && journal.release.version && !plan.pending.every((migration) => migration.sha256 === targetManifest[migration.filename])) {
    throw new Error("MIGRATION_PLAN_HASH_MISMATCH");
  }
  if (plan.pending.length > 0 && !await services.confirm(`Are you ready to apply ${plan.pending.length} migration(s) to ${target.label} after the backup check?`)) {
    throw new Error("UPDATE_CANCELLED");
  }
  if (plan.pending.length > 0) {
    const expectedPhrase = `APPLY ${target.kind === "supabase" ? target.projectRef : target.label}`;
    const answer = await services.promptLine(`Type exactly: ${expectedPhrase}`);
    if (answer !== expectedPhrase) throw new Error("DATABASE_WRITE_CONFIRMATION_MISMATCH");
    const backup = await services.confirmBackup(target.label);
    journal.backupReference = backup.reference;
    journal.backupConfirmedAt = backup.confirmedAt;
  }

  journal.database = {
    kind: target.kind,
    targetFingerprint: updateTargetFingerprint(target.label),
    label: target.label,
  };
  if (plan.pending.length === 0) {
    const appliedInPlan = new Set(plan.applied);
    const previousHashes = new Map(journal.appliedMigrations.map(({ filename, sha256 }) => [filename, sha256]));
    if (journal.inFlightMigration) {
      const { filename, sha256 } = journal.inFlightMigration;
      if (!appliedInPlan.has(filename) || targetManifest[filename] !== sha256) {
        throw new Error(`UPDATE_JOURNAL_MIGRATION_NOT_RECONCILED:${filename}`);
      }
      previousHashes.set(filename, sha256);
    }
    for (const [filename, sha256] of previousHashes) {
      const expected = targetManifest[filename] ?? baselineManifest[filename];
      if (!appliedInPlan.has(filename) || expected !== sha256) {
        throw new Error(`UPDATE_JOURNAL_MIGRATION_MISMATCH:${filename}`);
      }
    }
    journal.appliedMigrations = plan.applied.map((filename) => {
      const sha256 = targetManifest[filename] ?? baselineManifest[filename];
      if (!sha256) throw new Error(`MIGRATION_HASH_NOT_FOUND:${filename}`);
      return { filename, sha256 };
    });
    journal.inFlightMigration = undefined;
    journal.phase = "database-applied";
    await services.saveUpdateJournal(journal);
    return;
  }

  journal.phase = "applying-database";
  await services.saveUpdateJournal(journal);
  const onMigrationStarting = async (filename: string, sha256: string) => {
    journal.inFlightMigration = { filename, sha256 };
    journal.phase = "applying-database";
    await services.saveUpdateJournal(journal);
    console.info(`Applying ${filename}…`);
  };
  const onMigrationApplied = async (filename: string) => {
    const hash = journal.inFlightMigration?.filename === filename
      ? journal.inFlightMigration.sha256
      : targetManifest[filename];
    if (!hash) throw new Error(`MIGRATION_HASH_NOT_FOUND:${filename}`);
    if (!journal.appliedMigrations.some((migration) => migration.filename === filename)) {
      journal.appliedMigrations.push({ filename, sha256: hash });
    }
    journal.inFlightMigration = undefined;
    await services.saveUpdateJournal(journal);
    console.info(`Verified ${filename}.`);
  };
  const common = {
    baselineManifest,
    targetManifest,
    migrationDirectory,
    verifiedMigrationHashes: verifiedJournalHashes(journal),
    onMigrationStarting,
    onMigrationApplied,
  };
  const result = target.kind === "postgres"
    ? await services.applyPostgresUpdate({
      databaseUrl: target.url,
      confirmation: target.label,
      ...common,
    })
    : await services.applySupabaseUpdate({
      projectRef: target.projectRef,
      accessToken: target.accessToken,
      confirmation: target.projectRef,
      ...common,
    });
  for (const filename of result.alreadyApplied) {
    const hash = targetManifest[filename];
    if (hash && !journal.appliedMigrations.some((migration) => migration.filename === filename)) {
      journal.appliedMigrations.push({ filename, sha256: hash });
    }
  }
  journal.inFlightMigration = undefined;
  journal.phase = "database-applied";
  await services.saveUpdateJournal(journal);
  console.info(`Database migrations applied: ${result.applied.length} applied, ${result.alreadyApplied.length} already recorded; migration ledger reconciled.`);
}

function isCanonicalRemote(remote: GitRemoteInfo): boolean {
  return remote.pushUrl !== undefined && githubRepositoryIdentity(remote.pushUrl) === CANONICAL_REPOSITORY.toLowerCase();
}

function isSupportedCustomerPushRemote(remote: GitRemoteInfo): boolean {
  if (isCanonicalRemote(remote) || remote.pushUrls.length !== 1 || !remote.pushUrl) return false;
  try {
    validateGitHubPushUrl(remote.pushUrl);
    return true;
  } catch {
    return false;
  }
}

async function offerPush(
  checkout: GitCheckoutInfo,
  candidatePath: string,
  candidateBranch: string,
  journal: UpdateJournal,
  release: StableRelease,
  target: DatabaseTarget,
  overrides: Partial<OfferPushAdapters> = {},
): Promise<void> {
  const services: OfferPushAdapters = {
    repoRoot,
    inspectGitCheckout,
    confirm,
    promptLine,
    verifyCandidateApplicationRole,
    verifyPinnedReleaseStillCurrent,
    pushUpdateBranch,
    saveUpdateJournal,
    ...overrides,
  };
  const sourceBeforePush = await services.inspectGitCheckout(services.repoRoot);
  if (sourceBeforePush.headCommit.toLowerCase() !== journal.originalHead.toLowerCase() || sourceBeforePush.dirtyPaths.length) {
    console.info(`Source checkout changed after the database update. No push was offered; candidate ${candidateBranch} remains at ${candidatePath} for manual review.`);
    return;
  }
  const eligible = checkout.remotes.filter(isSupportedCustomerPushRemote);
  if (eligible.length === 0) {
    console.info("No customer push remote is configured. The update candidate remains local; review/merge it manually when ready.");
    return;
  }
  if (!await services.confirm("Database migrations are applied. Would you like to prepare a GitHub push? Restricted application-role preflight will run before the push.")) {
    console.info(`Push skipped. Candidate ${candidateBranch} is retained at ${candidatePath}; the running hosted app remains on its previous deployed commit.`);
    return;
  }
  let remote = eligible[0]!;
  if (eligible.length > 1) {
    const names = eligible.map(({ name }) => name).join(", ");
    const answer = await services.promptLine(`Choose a configured customer remote (${names})`);
    const chosen = eligible.find(({ name }) => name === answer);
    if (!chosen) throw new Error("PUSH_REMOTE_CHOICE_INVALID");
    remote = chosen;
  }
  const destinationBranch = await services.promptLine("Destination branch for the candidate", candidateBranch);
  if (!destinationBranch) throw new Error("PUSH_BRANCH_REQUIRED");
  console.info(`Push target: ${remote.name}/${destinationBranch}`);
  console.info(`Remote: ${remote.pushUrl}`);
  console.info("This may start a preview or production deployment if your host watches the selected branch. NOVA cannot confirm provider deployment from a Git push.");
  const phrase = `PUSH ${remote.name}/${destinationBranch} ${remote.pushUrl}`;
  if (await services.promptLine(`Type exactly: ${phrase}`) !== phrase) throw new Error("PUSH_CONFIRMATION_MISMATCH");
  await services.verifyCandidateApplicationRole(candidatePath, target);
  await services.verifyPinnedReleaseStillCurrent(release);
  let pushed;
  try {
    pushed = await services.pushUpdateBranch({
      repoRoot: services.repoRoot,
      worktreePath: candidatePath,
      remoteName: remote.name,
      confirmedPushUrl: remote.pushUrl!,
      canonicalRepository: CANONICAL_REPOSITORY,
      localBranch: candidateBranch,
      destinationBranch,
      expectedOriginalHead: journal.originalHead,
      expectedCandidateHead: journal.candidate.expectedHead!,
      expectedTargetCommit: release.commit,
    });
  } catch (error) {
    if (error instanceof GitWorkspaceError && error.code === "SOURCE_CHECKOUT_CHANGED") {
      journal.phase = "complete";
      await services.saveUpdateJournal(journal);
      console.info(`Source checkout changed before the push. No push was made; candidate ${candidateBranch} remains at ${candidatePath} for manual review.`);
      return;
    }
    throw error;
  }
  journal.phase = "complete";
  await services.saveUpdateJournal(journal);
  console.info(`Push accepted: ${pushed.commit.slice(0, 12)} → ${pushed.destination.remoteName}/${pushed.destination.branch}. Provider deployment is pending and unverified.`);
}

export async function runGuided(options: Options, overrides: UpdateRuntimeOverrides = {}): Promise<void> {
  if (options.resume && options.releaseTag) {
    throw new Error("UPDATE_RESUME_RELEASE_CONFLICT: omit --release; resume uses the release pinned in the journal");
  }
  const root = overrides.repoRoot ?? repoRoot;
  const askConfirm = overrides.confirm ?? confirm;
  const askLine = overrides.promptLine ?? promptLine;
  const requireTerminal = overrides.requireInteractiveTerminal ?? requireInteractiveTerminal;
  const acquireLock = overrides.acquireUpdateLock ?? acquireUpdateLock;
  const inspect = overrides.inspectGitCheckout ?? inspectGitCheckout;
  const readVersion = overrides.readPackageVersion ?? readPackageVersion;
  const loadJournal = overrides.loadUpdateJournal ?? loadUpdateJournal;
  const findRelease = overrides.discoverRelease ?? discoverRelease;
  const getBaseline = overrides.verifyBaseline ?? ((version: string) => verifyBaseline(version, root));
  const verifyRelease = overrides.verifyPinnedReleaseStillCurrent ?? verifyPinnedReleaseStillCurrent;
  const fetchRelease = overrides.fetchPinnedRelease ?? fetchPinnedRelease;
  const worktreeDirectory = overrides.getUpdateWorktreeDirectory ?? getUpdateWorktreeDirectory;
  const findCandidate = overrides.findPreparedUpdateWorktree ?? findPreparedUpdateWorktree;
  const prepareCandidate = overrides.prepareUpdateWorktree ?? prepareUpdateWorktree;
  const createJournal = overrides.newUpdateJournal ?? newUpdateJournal;
  const saveJournal = overrides.saveUpdateJournal ?? saveUpdateJournal;
  const loadReleaseTree = overrides.loadVerifiedReleaseTreeFromRoot ?? loadVerifiedReleaseTreeFromRoot;
  const build = overrides.buildCandidate ?? buildCandidate;
  const chooseTarget = overrides.chooseDatabaseTarget ?? chooseDatabaseTarget;
  const planTarget = overrides.planDatabase ?? planDatabase;
  const applyTarget = overrides.applyMigrations ?? (
    (target: DatabaseTarget, plan: MigrationPlan, journal: UpdateJournal,
      baselineManifest: MigrationHashManifest, targetManifest: MigrationHashManifest, migrationDirectory: string) =>
      applyMigrations(target, plan, journal, baselineManifest, targetManifest, migrationDirectory, {
        confirm: askConfirm,
        promptLine: askLine,
        saveUpdateJournal: saveJournal,
        ...overrides.migrationApplyAdapters,
      })
  );
  const pushAdapters: Partial<OfferPushAdapters> = {
    repoRoot: root,
    inspectGitCheckout: inspect,
    verifyPinnedReleaseStillCurrent: verifyRelease,
    saveUpdateJournal: saveJournal,
    ...overrides.offerPushAdapters,
  };

  requireTerminal();
  const releaseGuard = await acquireLock(root);
  try {
    const checkout = await inspect(root);
    ensureRootCheckout(checkout);
    const currentVersion = await readVersion(root);
    const oldJournal = await loadJournal(checkout.root);
    if (options.resume) {
      if (!oldJournal) throw new Error("UPDATE_JOURNAL_NOT_FOUND");
    } else if (oldJournal && oldJournal.phase !== "complete") {
      throw new Error("UPDATE_ATTEMPT_PENDING: rerun with --resume to continue the pinned attempt");
    }

    const selectedTag = options.resume ? oldJournal!.release.tag : options.releaseTag;
    const releaseOptions: Options = { ...options, releaseTag: selectedTag };
    const release = await findRelease(currentVersion, releaseOptions, checkout.headCommit);
    if (!release) throw new Error("NO_UPDATE_AVAILABLE");
    if (release.manifest.migrationClass !== "online-compatible") {
      throw new Error(`AUTOMATED_UPDATE_CLASS_BLOCKED: ${release.manifest.migrationClass} requires a separately coordinated maintenance procedure`);
    }
    if (options.resume) journalForResume(oldJournal!, checkout, release);

    const baseline = await getBaseline(currentVersion);
    const baselineManifest = manifestMap(baseline);
    const targetManifest = Object.fromEntries(release.manifest.migrations.map(({ filename, sha256 }) => [filename, sha256]));
    await verifyRelease(release);
    await fetchRelease(root, canonicalUrl, release.tag, release.commit);

    let journal: UpdateJournal;
    let candidatePath: string;
    let candidateBranch: string;
    if (options.resume) {
      journal = oldJournal!;
      const durableWorktreeRoot = await worktreeDirectory(checkout.root);
      if (!isWithinPath(durableWorktreeRoot, journal.candidate.path)) {
        throw new Error("UPDATE_CANDIDATE_PATH_UNTRUSTED: the saved candidate path is outside NOVA's updater state directory");
      }
      let existing = await findCandidate(root, journal.candidate.branch, {
        expectedOriginalHead: journal.originalHead,
        expectedTargetCommit: release.commit,
        expectedCandidateHead: journal.candidate.expectedHead,
        allowUnpinnedMerge: !journal.candidate.expectedHead,
      });
      let candidateCreatedThisRun = false;
      if (!existing) {
        await prepareCandidate(root, {
          targetCommit: release.commit,
          releaseTag: release.tag,
          expectedHead: checkout.headCommit,
          worktreePath: journal.candidate.path,
        });
        candidateCreatedThisRun = true;
        existing = await findCandidate(root, journal.candidate.branch, {
          expectedOriginalHead: journal.originalHead,
          expectedTargetCommit: release.commit,
          expectedCandidateHead: journal.candidate.expectedHead,
          allowUnpinnedMerge: !journal.candidate.expectedHead,
        });
      }
      if (!existing) throw new Error("UPDATE_CANDIDATE_NOT_FOUND: preserve the journal and candidate branch for manual inspection");
      if (!samePath(existing.path, journal.candidate.path)) {
        throw new Error("UPDATE_CANDIDATE_PATH_MISMATCH: the durable candidate moved; preserve it for manual inspection");
      }
      candidatePath = existing.path;
      candidateBranch = existing.branch;
      if (!journal.candidate.expectedHead) {
        if (!candidateCreatedThisRun && existing.headCommit.toLowerCase() !== release.commit.toLowerCase()) {
          const adoption = `ADOPT CANDIDATE ${existing.headCommit}`;
          console.info(`The candidate merge HEAD was not saved before the previous run stopped. Review the candidate diff at ${existing.path} before adopting it.`);
          if (await askLine(`After review, type exactly: ${adoption}`) !== adoption) {
            throw new Error(`UPDATE_CANDIDATE_REVIEW_REQUIRED: candidate retained at ${existing.path}`);
          }
        }
        journal.candidate.expectedHead = existing.headCommit;
        await saveJournal(journal);
      }
    } else {
      if (!await askConfirm(`Prepare isolated update candidate ${release.tag} at ${release.commit.slice(0, 12)}?`)) {
        throw new Error("UPDATE_CANCELLED");
      }
      const worktreeParent = await worktreeDirectory(checkout.root);
      candidatePath = await mkdtemp(join(worktreeParent, `nova-update-${release.version}-`));
      candidateBranch = `nova/update/${release.tag}`;
      journal = createJournal({
        repoRoot: checkout.root,
        originalHead: checkout.headCommit,
        release: { tag: release.tag, version: release.version, commit: release.commit },
        candidate: { branch: candidateBranch, path: candidatePath },
      });
      // Journal the exact durable path before Git creates a branch or worktree.
      // A restart can then distinguish an untouched empty path from a partial merge.
      await saveJournal(journal);
      let candidate;
      try {
        candidate = await prepareCandidate(root, {
          targetCommit: release.commit,
          releaseTag: release.tag,
          expectedHead: checkout.headCommit,
          worktreePath: candidatePath,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("UPDATE_BRANCH_EXISTS")) {
          journal.phase = "complete";
          await saveJournal(journal);
        }
        throw error;
      }
      if (candidate.status === "conflict") {
        throw new Error(`UPDATE_MERGE_CONFLICT:${candidate.conflictedPaths.join(", ")}: candidate retained at ${candidate.path}`);
      }
      if (candidate.status !== "prepared" || !candidate.path || !candidate.branch) {
        journal.phase = "complete";
        await saveJournal(journal);
        throw new Error("UPDATE_RELEASE_ALREADY_INCLUDED: this checkout already contains the pinned release; verify the package version and database state manually");
      }
      candidatePath = candidate.path;
      candidateBranch = candidate.branch;
      const prepared = await findCandidate(root, candidateBranch, {
        expectedOriginalHead: checkout.headCommit,
        expectedTargetCommit: release.commit,
        allowUnpinnedMerge: true,
      });
      if (!prepared) throw new Error("UPDATE_CANDIDATE_NOT_FOUND: candidate preparation could not be verified");
      journal.candidate.expectedHead = prepared.headCommit;
      await saveJournal(journal);
    }

    const pinnedCandidate = await findCandidate(root, candidateBranch, {
      expectedOriginalHead: journal.originalHead,
      expectedTargetCommit: release.commit,
      expectedCandidateHead: journal.candidate.expectedHead,
    });
    if (!pinnedCandidate || !samePath(pinnedCandidate.path, candidatePath)) {
      throw new Error("UPDATE_CANDIDATE_NOT_FOUND: the exact reviewed candidate is unavailable");
    }
    if (!journal.candidate.expectedHead) {
      journal.candidate.expectedHead = pinnedCandidate.headCommit;
      await saveJournal(journal);
    }

    const targetTree = await loadReleaseTree(candidatePath);
    assertSameManifest(targetTree.manifest, release.manifest);
    const candidateVersion = await readVersion(candidatePath);
    if (candidateVersion !== release.version) throw new Error("CANDIDATE_PACKAGE_VERSION_MISMATCH");
    console.info(`Candidate ready: branch ${candidateBranch}; source ${release.commit.slice(0, 12)}; path ${candidatePath}`);
    console.info(`Migrations and manifest verified: ${targetTree.manifest.migrations.length} canonical files.`);

    if (options.mode === "apply") {
      await build(candidatePath);
      const builtCandidate = await findCandidate(root, candidateBranch, {
        expectedOriginalHead: journal.originalHead,
        expectedTargetCommit: release.commit,
        expectedCandidateHead: journal.candidate.expectedHead,
      });
      if (!builtCandidate || !samePath(builtCandidate.path, candidatePath)) {
        throw new Error("CANDIDATE_BUILD_DIRTY: candidate files or HEAD changed during build; inspect the retained worktree");
      }
      const currentCheckout = await inspect(root);
      if (currentCheckout.headCommit !== checkout.headCommit || currentCheckout.dirtyPaths.length) {
        throw new Error("SOURCE_CHECKOUT_CHANGED: the source checkout changed while the candidate was being built; no database write was made");
      }
    }

    const target = await chooseTarget();
    assertAttemptTarget(journal, target);
    const migrationDirectory = resolve(candidatePath, "database", "migrations");
    const pendingPlan = await planTarget(
      target,
      baselineManifest,
      targetManifest,
      migrationDirectory,
      verifiedJournalHashes(journal),
    );
    printPlan(pendingPlan, release);
    if (options.mode === "plan") {
      console.info(`Plan only: no database migration or push was performed. Candidate ${candidateBranch} is retained; continue with bun run nova:update --resume.`);
      return;
    }

    const sourceAgain = await inspect(root);
    if (sourceAgain.headCommit !== checkout.headCommit || sourceAgain.dirtyPaths.length) {
      throw new Error("SOURCE_CHECKOUT_CHANGED: source changed after review; no database write was made");
    }
    const reviewedCandidate = await findCandidate(root, candidateBranch, {
      expectedOriginalHead: journal.originalHead,
      expectedTargetCommit: release.commit,
      expectedCandidateHead: journal.candidate.expectedHead,
    });
    if (!reviewedCandidate || !samePath(reviewedCandidate.path, candidatePath)) {
      throw new Error("CANDIDATE_HEAD_MISMATCH: candidate changed after review; no database write was made");
    }
    await verifyRelease(release);
    await applyTarget(target, pendingPlan, journal, baselineManifest, targetManifest, migrationDirectory);
    await offerPush(checkout, candidatePath, candidateBranch, journal, release, target, pushAdapters);
    if (journal.phase !== "complete") {
      journal.phase = "complete";
      await saveJournal(journal);
    }
    console.info(`Update operation complete for ${target.label}. Database and source are staged separately; check your deployment provider before calling the app updated.`);
  } finally {
    await releaseGuard();
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return printHelp();
  if (options.mode === "check") return runCheck(options);
  await runGuided(options);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(userSafeError(error));
    process.exitCode = 1;
  });
}
