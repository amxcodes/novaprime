import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type UpdatePhase = "prepared" | "applying-database" | "database-applied" | "database-verified" | "complete";

export interface UpdateJournal {
  schemaVersion: 1;
  id: string;
  repoRoot: string;
  originalHead: string;
  release: { tag: string; version: string; commit: string };
  candidate: { branch: string; path: string; expectedHead?: string };
  phase: UpdatePhase;
  database?: { kind: "postgres" | "supabase"; targetFingerprint: string; label: string };
  inFlightMigration?: { filename: string; sha256: string };
  appliedMigrations: Array<{ filename: string; sha256: string }>;
  backupReference?: string;
  backupConfirmedAt?: string;
  updatedAt: string;
}

const migrationFilenamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const objectIdPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const updatePhases = new Set<UpdatePhase>([
  "prepared",
  "applying-database",
  "database-applied",
  "database-verified",
  "complete",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isStableVersion(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match !== null && match.slice(1).every((part) => Number.isSafeInteger(Number(part)));
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(resolve(parent), resolve(candidate));
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isMigrationHash(value: unknown): value is { filename: string; sha256: string } {
  return isRecord(value) && hasOnlyKeys(value, ["filename", "sha256"]) &&
    typeof value.filename === "string" && migrationFilenamePattern.test(value.filename) &&
    typeof value.sha256 === "string" && sha256Pattern.test(value.sha256);
}

function validateUpdateJournal(value: unknown, repoRoot: string, worktreeRoot: string): UpdateJournal {
  const corrupt = (): never => {
    throw new Error("UPDATE_JOURNAL_CORRUPT: preserve the file and inspect it before retrying");
  };
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion", "id", "repoRoot", "originalHead", "release", "candidate", "phase",
    "database", "inFlightMigration", "appliedMigrations", "backupReference", "backupConfirmedAt", "updatedAt",
  ])) return corrupt();

  if (
    value.schemaVersion !== 1 || typeof value.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
    typeof value.repoRoot !== "string" || !isAbsolute(value.repoRoot) || !samePath(value.repoRoot, repoRoot) ||
    typeof value.originalHead !== "string" || !objectIdPattern.test(value.originalHead) ||
    typeof value.phase !== "string" || !updatePhases.has(value.phase as UpdatePhase) ||
    !isTimestamp(value.updatedAt) || !Array.isArray(value.appliedMigrations) ||
    !value.appliedMigrations.every(isMigrationHash)
  ) return corrupt();

  if (!isRecord(value.release) || !hasOnlyKeys(value.release, ["tag", "version", "commit"]) ||
      !isStableVersion(value.release.version) || value.release.tag !== `v${value.release.version}` ||
      typeof value.release.commit !== "string" || !objectIdPattern.test(value.release.commit)) return corrupt();

  if (!isRecord(value.candidate) || !hasOnlyKeys(value.candidate, ["branch", "path", "expectedHead"]) ||
      value.candidate.branch !== `nova/update/${value.release.tag}` ||
      typeof value.candidate.path !== "string" || !isAbsolute(value.candidate.path) ||
      !isWithin(worktreeRoot, value.candidate.path) ||
      (value.candidate.expectedHead !== undefined &&
        (typeof value.candidate.expectedHead !== "string" || !objectIdPattern.test(value.candidate.expectedHead)))) return corrupt();

  const applied = value.appliedMigrations as Array<{ filename: string; sha256: string }>;
  if (new Set(applied.map(({ filename }) => filename)).size !== applied.length) return corrupt();
  const inFlight = value.inFlightMigration;
  if (inFlight !== undefined && (!isMigrationHash(inFlight) || applied.some(({ filename }) => filename === inFlight.filename))) {
    return corrupt();
  }

  if (value.database !== undefined) {
    if (!isRecord(value.database) || !hasOnlyKeys(value.database, ["kind", "targetFingerprint", "label"]) ||
        (value.database.kind !== "postgres" && value.database.kind !== "supabase") ||
        typeof value.database.label !== "string" || value.database.label.length < 1 || value.database.label.length > 512 ||
        /[\u0000-\u001f\u007f]/.test(value.database.label) ||
        typeof value.database.targetFingerprint !== "string" || !sha256Pattern.test(value.database.targetFingerprint) ||
        updateTargetFingerprint(value.database.label) !== value.database.targetFingerprint ||
        (value.database.kind === "supabase" && !/^Supabase project [a-z0-9]{20}$/.test(value.database.label)) ||
        (value.database.kind === "postgres" && !value.database.label.startsWith("PostgreSQL "))) return corrupt();
  }

  const backupReference = value.backupReference;
  const backupConfirmedAt = value.backupConfirmedAt;
  if ((backupReference === undefined) !== (backupConfirmedAt === undefined) ||
      (backupReference !== undefined && (typeof backupReference !== "string" ||
        backupReference.length < 4 || backupReference.length > 160 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/ -]{2,159}$/.test(backupReference) || backupReference.includes("://"))) ||
      (backupConfirmedAt !== undefined && !isTimestamp(backupConfirmedAt)) ||
      (backupReference !== undefined && value.database === undefined)) return corrupt();

  if (
    (value.phase === "prepared" && (value.database !== undefined || applied.length > 0 ||
      value.inFlightMigration !== undefined || value.backupReference !== undefined)) ||
    (applied.length > 0 && value.database === undefined) ||
    ((value.phase === "applying-database" || value.phase === "database-applied" || value.phase === "database-verified") &&
      (value.database === undefined || value.candidate.expectedHead === undefined)) ||
    (value.phase === "applying-database" && (value.backupReference === undefined || value.backupConfirmedAt === undefined)) ||
    ((value.phase === "database-applied" || value.phase === "database-verified") && applied.length === 0) ||
    (value.inFlightMigration !== undefined && value.phase !== "applying-database") ||
    (value.phase === "complete" && value.database === undefined &&
      (value.candidate.expectedHead !== undefined || applied.length > 0 || value.inFlightMigration !== undefined || value.backupReference !== undefined)) ||
    (value.phase === "complete" && value.database !== undefined &&
      (value.candidate.expectedHead === undefined || applied.length === 0))
  ) return corrupt();

  return value as unknown as UpdateJournal;
}

function stateDirectory(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) throw new Error("UPDATE_STATE_DIRECTORY_UNAVAILABLE");
    return join(localAppData, "NOVA", "update-manager");
  }
  const stateHome = process.env.XDG_STATE_HOME;
  return stateHome
    ? join(stateHome, "nova", "update-manager")
    : join(homedir(), ".local", "state", "nova", "update-manager");
}

function redactErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]{1,120}$/.test(error.message)) return error.message;
  if (error instanceof Error && /^[A-Z0-9_]+$/.test((error as Error & { code?: string }).code ?? "")) {
    return (error as Error & { code: string }).code;
  }
  return "UPDATE_STATE_ERROR";
}

async function ensureDirectory(): Promise<string> {
  const directory = resolve(stateDirectory());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
}

function repoKey(repoRoot: string): string {
  const normalized = repoRoot.replace(/[\\/]+$/, "");
  const identity = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return createHash("sha256").update(identity, "utf8").digest("hex");
}

async function ensureRepoDirectory(repoRoot: string): Promise<string> {
  const directory = join(await ensureDirectory(), repoKey(repoRoot));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
}

/** Durable, private storage for this checkout's candidate Git worktrees. */
export async function getUpdateWorktreeDirectory(repoRoot: string): Promise<string> {
  // Keep Windows paths short enough for deep node_modules layouts while using
  // a 96-bit checkout key to make collisions vanishingly unlikely.
  const directory = join(await ensureDirectory(), "worktrees", repoKey(repoRoot).slice(0, 24));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
}

export async function acquireUpdateLock(repoRoot: string): Promise<() => Promise<void>> {
  const directory = await ensureRepoDirectory(repoRoot);
  const path = join(directory, "update.lock");
  const lockId = randomUUID();
  let handle: FileHandle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("UPDATE_ALREADY_RUNNING_OR_STALE_LOCK: inspect and remove the local lock after confirming no updater process is active");
    }
    throw new Error(`UPDATE_LOCK_CREATE_FAILED:${redactErrorCode(error)}`);
  }
  await handle.writeFile(JSON.stringify({ id: lockId, pid: process.pid, startedAt: new Date().toISOString() }));
  await handle.close();
  return async () => {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch {
      return;
    }
    if (typeof value === "object" && value !== null && (value as { id?: unknown }).id === lockId) {
      await rm(path, { force: true });
    }
  };
}

export async function loadUpdateJournal(repoRoot: string): Promise<UpdateJournal | undefined> {
  const path = join(await ensureRepoDirectory(repoRoot), "attempt.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`UPDATE_JOURNAL_READ_FAILED:${redactErrorCode(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("UPDATE_JOURNAL_CORRUPT: preserve the file and inspect it before retrying");
  }
  const worktreeRoot = join(await ensureDirectory(), "worktrees", repoKey(repoRoot).slice(0, 24));
  return validateUpdateJournal(value, repoRoot, worktreeRoot);
}

export async function saveUpdateJournal(journal: UpdateJournal): Promise<void> {
  const directory = await ensureRepoDirectory(journal.repoRoot);
  const path = join(directory, "attempt.json");
  const temporaryPath = join(directory, `attempt-${journal.id}.tmp`);
  const value = { ...journal, updatedAt: new Date().toISOString() };
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

export function updateTargetFingerprint(label: string): string {
  return createHash("sha256").update(label, "utf8").digest("hex");
}

export function newUpdateJournal(input: Omit<UpdateJournal, "schemaVersion" | "id" | "updatedAt" | "phase" | "appliedMigrations">): UpdateJournal {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    phase: "prepared",
    appliedMigrations: [],
    updatedAt: new Date().toISOString(),
    ...input,
  };
}
