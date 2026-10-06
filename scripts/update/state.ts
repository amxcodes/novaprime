import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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
  const directory = stateDirectory();
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
  if (
    typeof value !== "object" || value === null ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (value as { id?: unknown }).id !== "string" ||
    typeof (value as { repoRoot?: unknown }).repoRoot !== "string" ||
    !Array.isArray((value as { appliedMigrations?: unknown }).appliedMigrations)
  ) {
    throw new Error("UPDATE_JOURNAL_CORRUPT: preserve the file and inspect it before retrying");
  }
  return value as UpdateJournal;
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
