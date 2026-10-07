import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { acquireUpdateLock, getUpdateWorktreeDirectory, loadUpdateJournal, newUpdateJournal, readExistingUpdateJournal, saveUpdateJournal } from "./state.ts";

const temporaryRoots: string[] = [];
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalXdgStateHome = process.env.XDG_STATE_HOME;

function attemptPath(stateRoot: string, repoRoot: string): string {
  const normalized = repoRoot.replace(/[\\/]+$/, "");
  const identity = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  const key = createHash("sha256").update(identity, "utf8").digest("hex");
  const directory = process.platform === "win32"
    ? join(stateRoot, "NOVA", "update-manager")
    : join(stateRoot, "nova", "update-manager");
  return join(directory, key, "attempt.json");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
  if (originalXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalXdgStateHome;
});

describe("per-checkout updater recovery state", () => {
  test("read-only journal inspection reports absence without creating operator state", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "nova-update-doctor-readonly-"));
    temporaryRoots.push(stateRoot);
    process.env.LOCALAPPDATA = stateRoot;
    process.env.XDG_STATE_HOME = stateRoot;

    const repoRoot = join(stateRoot, "checkout");
    expect(await readExistingUpdateJournal(repoRoot)).toBeUndefined();
    expect(existsSync(join(stateRoot, "NOVA"))).toBe(false);
    expect(existsSync(join(stateRoot, "nova"))).toBe(false);
  });

  test("keeps concurrent locks and attempt journals independent for separate NOVA clones", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "nova-update-state-test-"));
    temporaryRoots.push(stateRoot);
    process.env.LOCALAPPDATA = stateRoot;
    process.env.XDG_STATE_HOME = stateRoot;

    const firstRepo = join(stateRoot, "customer-one", "nova");
    const secondRepo = join(stateRoot, "customer-two", "nova");
    const worktreeRoot = await getUpdateWorktreeDirectory(firstRepo);
    const releaseLock = await acquireUpdateLock(firstRepo);
    const releaseOtherLock = await acquireUpdateLock(secondRepo);
    await expect(acquireUpdateLock(firstRepo)).rejects.toThrow("UPDATE_ALREADY_RUNNING_OR_STALE_LOCK");

    const journal = newUpdateJournal({
      repoRoot: firstRepo,
      originalHead: "a".repeat(40),
      release: { tag: "v0.2.0", version: "0.2.0", commit: "b".repeat(40) },
      candidate: { branch: "nova/update/v0.2.0", path: join(worktreeRoot, "candidate") },
    });
    await saveUpdateJournal(journal);

    expect(await loadUpdateJournal(firstRepo)).toMatchObject({ id: journal.id, repoRoot: firstRepo });
    expect(await loadUpdateJournal(secondRepo)).toBeUndefined();
    await releaseLock();
    await releaseOtherLock();
  });

  test("rejects malformed journal fields and paths before they can be resumed", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "nova-update-journal-validation-"));
    temporaryRoots.push(stateRoot);
    process.env.LOCALAPPDATA = stateRoot;
    process.env.XDG_STATE_HOME = stateRoot;

    const repoRoot = join(stateRoot, "checkout");
    const worktreeRoot = await getUpdateWorktreeDirectory(repoRoot);
    const journal = newUpdateJournal({
      repoRoot,
      originalHead: "a".repeat(40),
      release: { tag: "v0.2.0", version: "0.2.0", commit: "b".repeat(40) },
      candidate: {
        branch: "nova/update/v0.2.0",
        path: join(worktreeRoot, "candidate"),
        expectedHead: "c".repeat(40),
      },
    });
    await saveUpdateJournal(journal);

    const invalidCases: Array<[string, (value: Record<string, unknown>) => void]> = [
      ["phase", (value) => { value.phase = "finished"; }],
      ["complete phase before database work", (value) => { value.phase = "complete"; }],
      ["attempt id path traversal", (value) => { value.id = "../../outside"; }],
      ["repository path mismatch", (value) => { value.repoRoot = join(stateRoot, "other-checkout"); }],
      ["release tag/version mismatch", (value) => { (value.release as Record<string, unknown>).tag = "v0.3.0"; }],
      ["invalid release commit", (value) => { (value.release as Record<string, unknown>).commit = "not-a-commit"; }],
      ["candidate branch mismatch", (value) => { (value.candidate as Record<string, unknown>).branch = "main"; }],
      ["candidate path traversal", (value) => { (value.candidate as Record<string, unknown>).path = join(worktreeRoot, "..", "outside"); }],
      ["invalid candidate head", (value) => { (value.candidate as Record<string, unknown>).expectedHead = "bad"; }],
      ["invalid migration filename", (value) => { value.appliedMigrations = [{ filename: "../../migration.sql", sha256: "d".repeat(64) }]; }],
      ["invalid migration digest", (value) => { value.appliedMigrations = [{ filename: "0001_initial.sql", sha256: "bad" }]; }],
      ["duplicate migration rows", (value) => { value.appliedMigrations = [
        { filename: "0001_initial.sql", sha256: "d".repeat(64) },
        { filename: "0001_initial.sql", sha256: "e".repeat(64) },
      ]; }],
      ["inconsistent target fingerprint", (value) => { value.database = {
        kind: "postgres", label: "PostgreSQL localhost:5432/nova as migrator", targetFingerprint: "f".repeat(64),
      }; }],
      ["incomplete backup metadata", (value) => { value.backupReference = "backup-1234"; }],
      ["extra journal property", (value) => { value.accessToken = "must-not-be-journaled"; }],
      ["invalid updated timestamp", (value) => { value.updatedAt = "yesterday"; }],
    ];

    const path = attemptPath(stateRoot, repoRoot);
    for (const [label, mutate] of invalidCases) {
      const candidate = structuredClone(journal) as unknown as Record<string, unknown>;
      mutate(candidate);
      await writeFile(path, JSON.stringify(candidate));
      await expect(loadUpdateJournal(repoRoot), label).rejects.toThrow("UPDATE_JOURNAL_CORRUPT");
    }
  });

  test("accepts resumable database phases and the existing pre-database terminal case", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "nova-update-journal-phases-"));
    temporaryRoots.push(stateRoot);
    process.env.LOCALAPPDATA = stateRoot;
    process.env.XDG_STATE_HOME = stateRoot;

    const repoRoot = join(stateRoot, "checkout");
    const worktreeRoot = await getUpdateWorktreeDirectory(repoRoot);
    const journal = newUpdateJournal({
      repoRoot,
      originalHead: "a".repeat(40),
      release: { tag: "v0.2.0", version: "0.2.0", commit: "b".repeat(40) },
      candidate: { branch: "nova/update/v0.2.0", path: join(worktreeRoot, "candidate"), expectedHead: "c".repeat(40) },
    });
    await saveUpdateJournal(journal);
    const path = attemptPath(stateRoot, repoRoot);
    const applying = {
      ...journal,
      phase: "applying-database",
      database: {
        kind: "postgres",
        label: "PostgreSQL localhost:5432/nova as migrator",
        targetFingerprint: createHash("sha256").update("PostgreSQL localhost:5432/nova as migrator").digest("hex"),
      },
      backupReference: "local-backup-1234",
      backupConfirmedAt: new Date().toISOString(),
    };
    await writeFile(path, JSON.stringify(applying));
    expect(await loadUpdateJournal(repoRoot)).toMatchObject({ phase: "applying-database", backupReference: "local-backup-1234" });

    const inFlight = {
      ...applying,
      inFlightMigration: { filename: "0002_feature.sql", sha256: "d".repeat(64) },
    };
    await writeFile(path, JSON.stringify(inFlight));
    expect(await loadUpdateJournal(repoRoot)).toMatchObject({ inFlightMigration: { filename: "0002_feature.sql" } });
    await writeFile(path, JSON.stringify({
      ...inFlight,
      inFlightMigration: { filename: "0002_feature.sql", sha256: "bad" },
    }));
    await expect(loadUpdateJournal(repoRoot)).rejects.toThrow("UPDATE_JOURNAL_CORRUPT");

    await writeFile(path, JSON.stringify({ ...applying, backupConfirmedAt: "yesterday" }));
    await expect(loadUpdateJournal(repoRoot)).rejects.toThrow("UPDATE_JOURNAL_CORRUPT");

    const terminal = structuredClone(journal) as unknown as Record<string, unknown>;
    terminal.phase = "complete";
    delete (terminal.candidate as Record<string, unknown>).expectedHead;
    await writeFile(path, JSON.stringify(terminal));
    expect(await loadUpdateJournal(repoRoot)).toMatchObject({ phase: "complete" });
  });
});
