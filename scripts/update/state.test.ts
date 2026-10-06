import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { acquireUpdateLock, loadUpdateJournal, newUpdateJournal, saveUpdateJournal } from "./state.ts";

const temporaryRoots: string[] = [];
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalXdgStateHome = process.env.XDG_STATE_HOME;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
  if (originalXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalXdgStateHome;
});

describe("per-checkout updater recovery state", () => {
  test("keeps concurrent locks and attempt journals independent for separate NOVA clones", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "nova-update-state-test-"));
    temporaryRoots.push(stateRoot);
    process.env.LOCALAPPDATA = stateRoot;
    process.env.XDG_STATE_HOME = stateRoot;

    const firstRepo = join(stateRoot, "customer-one", "nova");
    const secondRepo = join(stateRoot, "customer-two", "nova");
    const releaseLock = await acquireUpdateLock(firstRepo);
    const releaseOtherLock = await acquireUpdateLock(secondRepo);
    await expect(acquireUpdateLock(firstRepo)).rejects.toThrow("UPDATE_ALREADY_RUNNING_OR_STALE_LOCK");

    const journal = newUpdateJournal({
      repoRoot: firstRepo,
      originalHead: "a".repeat(40),
      release: { tag: "v0.2.0", version: "0.2.0", commit: "b".repeat(40) },
      candidate: { branch: "nova/update/v0.2.0", path: join(stateRoot, "candidate") },
    });
    await saveUpdateJournal(journal);

    expect(await loadUpdateJournal(firstRepo)).toMatchObject({ id: journal.id, repoRoot: firstRepo });
    expect(await loadUpdateJournal(secondRepo)).toBeUndefined();
    await releaseLock();
    await releaseOtherLock();
  });
});
