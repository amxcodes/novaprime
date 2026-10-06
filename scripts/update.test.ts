import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { runCheck, runGuided, type UpdateRuntimeOverrides } from "./update.ts";
import { prepareUpdateWorktree } from "./update/git.ts";
import { newUpdateJournal, updateTargetFingerprint, type UpdateJournal } from "./update/state.ts";
import type { MigrationPlan } from "./update/database.ts";
import type { StableRelease, VerifiedReleaseTree } from "./update/release.ts";

const temporaryRoots: string[] = [];
const migrationFilename = "0002_update_fixture.sql";
const migrationSource = "CREATE TABLE nova.update_fixture (id integer PRIMARY KEY);\n";
const migrationHash = createHash("sha256").update(migrationSource).digest("hex");

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function makeRepository() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "nova-update-coordinator-"));
  temporaryRoots.push(temporaryRoot);
  const root = join(temporaryRoot, "checkout");
  await mkdir(join(root, "database", "migrations"), { recursive: true });
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "NOVA updater test"]);
  git(root, ["config", "user.email", "updater-test@example.invalid"]);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "nova-test", version: "0.1.0" }, null, 2) + "\n");
  await writeFile(join(root, "database", "migrations", "0001_baseline.sql"), "SELECT 1;\n");
  git(root, ["add", "--all"]);
  git(root, ["commit", "-m", "baseline"]);
  const baselineCommit = git(root, ["rev-parse", "HEAD"]);

  git(root, ["switch", "-c", "release"]);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "nova-test", version: "0.2.0" }, null, 2) + "\n");
  await writeFile(join(root, "database", "migrations", migrationFilename), migrationSource);
  git(root, ["add", "--all"]);
  git(root, ["commit", "-m", "release v0.2.0"]);
  const releaseCommit = git(root, ["rev-parse", "HEAD"]);
  git(root, ["tag", "v0.2.0"]);
  git(root, ["switch", "main"]);

  const bareRemote = join(temporaryRoot, "customer-origin.git");
  git(temporaryRoot, ["init", "--bare", bareRemote]);
  git(root, ["remote", "add", "origin", bareRemote]);
  // This is configuration only; every test uses fake push adapters and performs no network access.
  git(root, ["remote", "set-url", "--push", "origin", "https://github.com/customer/nova-test.git"]);

  const baselineManifest = {
    schemaVersion: 1 as const,
    version: "0.1.0",
    migrations: [{ filename: "0001_baseline.sql", sha256: createHash("sha256").update("SELECT 1;\n").digest("hex") }],
    migrationClass: "online-compatible" as const,
    impact: "Test baseline.",
  };
  const releaseManifest = {
    schemaVersion: 1 as const,
    version: "0.2.0",
    migrations: [{ filename: migrationFilename, sha256: migrationHash }],
    migrationClass: "online-compatible" as const,
    impact: "Test update.",
    minimumStartingVersion: "0.1.0",
  };
  const release: StableRelease = {
    tag: "v0.2.0",
    version: "0.2.0",
    commit: releaseCommit,
    publishedAt: "2026-10-01T00:00:00Z",
    releaseUrl: "https://example.invalid/release/v0.2.0",
    notes: "Temporary integration fixture.",
    manifest: releaseManifest,
  };
  const baselineTree: VerifiedReleaseTree = {
    manifest: baselineManifest,
    migrationHashes: new Map(baselineManifest.migrations.map(({ filename, sha256 }) => [filename, sha256])),
  };
  const targetTree: VerifiedReleaseTree = {
    manifest: releaseManifest,
    migrationHashes: new Map(releaseManifest.migrations.map(({ filename, sha256 }) => [filename, sha256])),
  };
  return { temporaryRoot, root, baselineCommit, releaseCommit, release, baselineTree, targetTree };
}

function planFor(release: StableRelease, targetLabel: string): MigrationPlan {
  return {
    target: targetLabel,
    applied: [],
    pending: [{ filename: migrationFilename, sha256: migrationHash, source: migrationSource }],
  };
}

function databaseTarget(label = "temporary integration target") {
  return { kind: "postgres" as const, url: "postgres://test.invalid/nova", label };
}

function makeRuntime(
  fixture: Awaited<ReturnType<typeof makeRepository>>,
  options: {
    journal?: UpdateJournal;
    target?: ReturnType<typeof databaseTarget>;
    promptLine?: (prompt: string) => string | Promise<string>;
    confirm?: (prompt: string) => boolean | Promise<boolean>;
    migrationResult?: "success" | "failure";
    onPushConsent?: (prompt: string) => boolean | Promise<boolean>;
  } = {},
) {
  let journal = options.journal;
  const savedJournals: UpdateJournal[] = [];
  const events: string[] = [];
  const releaseSelections: Array<string | undefined> = [];
  let planCalls = 0;
  let databaseWriteCalls = 0;
  let pushCalls = 0;
  let preflightCalls = 0;
  const worktreeRoot = join(fixture.temporaryRoot, "updater-state", "worktrees");
  const release = fixture.release;
  const runtime: UpdateRuntimeOverrides = {
    repoRoot: fixture.root,
    requireInteractiveTerminal() {},
    acquireUpdateLock: async () => async () => { events.push("unlock"); },
    loadUpdateJournal: async () => journal,
    saveUpdateJournal: async (next) => {
      journal = structuredClone(next);
      savedJournals.push(structuredClone(next));
    },
    discoverRelease: async (_version, selected) => {
      releaseSelections.push(selected.releaseTag);
      return release;
    },
    verifyBaseline: async () => fixture.baselineTree,
    verifyPinnedReleaseStillCurrent: async () => { events.push("release-verified"); },
    fetchPinnedRelease: async () => { events.push("release-fetch-skipped-by-test-adapter"); },
    getUpdateWorktreeDirectory: async () => {
      await mkdir(worktreeRoot, { recursive: true });
      return worktreeRoot;
    },
    loadVerifiedReleaseTreeFromRoot: async () => fixture.targetTree,
    buildCandidate: async () => { events.push("candidate-build-adapted"); },
    chooseDatabaseTarget: async () => options.target ?? databaseTarget(),
    planDatabase: async (target) => {
      planCalls += 1;
      events.push(`database-plan:${target.label}`);
      return planFor(release, target.label);
    },
    confirm: options.confirm ?? (async () => true),
    promptLine: options.promptLine ?? (async (prompt) => prompt.replace(/^Type exactly: /, "")),
    migrationApplyAdapters: {
      confirmBackup: async () => "2026-10-06T00:00:00.000Z",
      applyPostgresUpdate: async (input) => {
        databaseWriteCalls += 1;
        events.push("database-write");
        await input.onMigrationStarting?.(migrationFilename, migrationHash);
        if (options.migrationResult === "failure") throw new Error("FAKE_MIGRATION_FAILURE");
        await input.onMigrationApplied?.(migrationFilename);
        return {
          target: "fake",
          applied: [migrationFilename],
          alreadyApplied: [],
          pendingBeforeApply: [migrationFilename],
        };
      },
      applySupabaseUpdate: async () => { throw new Error("Unexpected Supabase adapter use"); },
    },
    offerPushAdapters: {
      confirm: options.onPushConsent ?? (async () => false),
      verifyCandidateApplicationRole: async () => { preflightCalls += 1; },
      pushUpdateBranch: async () => {
        pushCalls += 1;
        throw new Error("The fake Git push adapter should not be invoked in these scenarios.");
      },
    },
  };
  return {
    runtime,
    events,
    releaseSelections,
    savedJournals,
    getJournal: () => journal,
    counts: () => ({ planCalls, databaseWriteCalls, pushCalls, preflightCalls }),
    worktreeRoot,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("update coordinator integration", () => {
  it("checks a clean checkout without changing Git state or invoking database adapters", async () => {
    const fixture = await makeRepository();
    const headBefore = git(fixture.root, ["rev-parse", "HEAD"]);
    const refsBefore = git(fixture.root, ["show-ref"]);
    const statusBefore = git(fixture.root, ["status", "--porcelain"]);
    const events: string[] = [];
    await runCheck({ mode: "check", resume: false, help: false }, {
      repoRoot: fixture.root,
      discoverRelease: async () => { events.push("release-read"); return fixture.release; },
      verifyPinnedReleaseStillCurrent: async () => { events.push("release-verified"); },
      planDatabase: async () => { events.push("unexpected-db-plan"); throw new Error("DB adapter must not run during check"); },
      applyMigrations: async () => { events.push("unexpected-db-write"); throw new Error("DB adapter must not run during check"); },
    });
    expect(git(fixture.root, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(git(fixture.root, ["show-ref"])).toBe(refsBefore);
    expect(git(fixture.root, ["status", "--porcelain"])).toBe(statusBefore);
    expect(events).toEqual(["release-read", "release-verified"]);
  }, 60_000);

  it("refuses an unbound database write phrase before calling the database adapter", async () => {
    const fixture = await makeRepository();
    const harness = makeRuntime(fixture, {
      promptLine: async (prompt) => prompt.startsWith("Type exactly: APPLY ") ? "APPLY another target" : prompt.replace(/^Type exactly: /, ""),
    });
    await expect(runGuided({ mode: "apply", resume: false, help: false }, harness.runtime))
      .rejects.toThrow("DATABASE_WRITE_CONFIRMATION_MISMATCH");
    expect(harness.counts()).toMatchObject({ planCalls: 1, databaseWriteCalls: 0, pushCalls: 0 });
    expect(git(fixture.root, ["rev-parse", "HEAD"])).toBe(fixture.baselineCommit);
    expect(git(fixture.root, ["status", "--porcelain"])).toBe("");
  }, 60_000);

  it("retains the pinned candidate and journal after a migration failure and never offers a push", async () => {
    const fixture = await makeRepository();
    const harness = makeRuntime(fixture, { migrationResult: "failure" });
    await expect(runGuided({ mode: "apply", resume: false, help: false }, harness.runtime))
      .rejects.toThrow("FAKE_MIGRATION_FAILURE");
    const journal = harness.getJournal();
    expect(journal).toMatchObject({ phase: "applying-database", release: { tag: "v0.2.0", commit: fixture.releaseCommit } });
    expect(journal?.inFlightMigration).toEqual({ filename: migrationFilename, sha256: migrationHash });
    expect(journal?.candidate.path.startsWith(harness.worktreeRoot)).toBe(true);
    expect(await readFile(join(journal!.candidate.path, "package.json"), "utf8")).toContain('"version": "0.2.0"');
    expect(git(fixture.root, ["rev-parse", "HEAD"])).toBe(fixture.baselineCommit);
    expect(git(fixture.root, ["status", "--porcelain"])).toBe("");
    expect(harness.counts()).toMatchObject({ databaseWriteCalls: 1, pushCalls: 0, preflightCalls: 0 });
  }, 60_000);

  it("does not invoke the Git push adapter when the operator declines push consent", async () => {
    const fixture = await makeRepository();
    let consentPromptCount = 0;
    const harness = makeRuntime(fixture, {
      migrationResult: "success",
      onPushConsent: async () => { consentPromptCount += 1; return false; },
    });
    await runGuided({ mode: "apply", resume: false, help: false }, harness.runtime);
    expect(consentPromptCount).toBe(1);
    expect(harness.counts()).toMatchObject({ databaseWriteCalls: 1, pushCalls: 0, preflightCalls: 0 });
    expect(harness.getJournal()?.phase).toBe("complete");
    expect(git(fixture.root, ["rev-parse", "HEAD"])).toBe(fixture.baselineCommit);
    expect(git(fixture.root, ["status", "--porcelain"])).toBe("");
  }, 60_000);

  it("resume selects the journaled release and refuses a different fingerprinted target before planning writes", async () => {
    const fixture = await makeRepository();
    const worktreeRoot = join(fixture.temporaryRoot, "updater-state", "worktrees");
    await mkdir(worktreeRoot, { recursive: true });
    const candidate = await prepareUpdateWorktree(fixture.root, {
      targetCommit: fixture.releaseCommit,
      releaseTag: fixture.release.tag,
      expectedHead: fixture.baselineCommit,
      worktreeParent: worktreeRoot,
    });
    const recordedTarget = databaseTarget("previously confirmed target");
    const journal = newUpdateJournal({
      repoRoot: fixture.root,
      originalHead: fixture.baselineCommit,
      release: { tag: fixture.release.tag, version: fixture.release.version, commit: fixture.release.commit },
      candidate: { branch: candidate.branch!, path: candidate.path!, expectedHead: fixture.releaseCommit },
    });
    journal.phase = "applying-database";
    journal.database = {
      kind: "postgres",
      label: recordedTarget.label,
      targetFingerprint: updateTargetFingerprint(recordedTarget.label),
    };
    const selectedTarget = databaseTarget("different unbound target");
    const harness = makeRuntime(fixture, { journal, target: selectedTarget });
    await expect(runGuided({ mode: "apply", resume: true, help: false }, harness.runtime))
      .rejects.toThrow("UPDATE_RESUME_DATABASE_TARGET_MISMATCH");
    expect(harness.releaseSelections).toEqual([fixture.release.tag]);
    expect(harness.counts()).toMatchObject({ planCalls: 0, databaseWriteCalls: 0, pushCalls: 0 });
    expect(git(fixture.root, ["rev-parse", "HEAD"])).toBe(fixture.baselineCommit);
    expect(await readFile(join(candidate.path!, "package.json"), "utf8")).toContain('"version": "0.2.0"');
  }, 60_000);
});
