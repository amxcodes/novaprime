import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { findPreparedUpdateWorktree, githubRepositoryIdentity, inspectGitCheckout, prepareUpdateWorktree, pushUpdateBranch, validateGitHubPushUrl } from "./git.ts";

const temporaryRoots: string[] = [];

async function makeRepository(): Promise<{
  root: string;
  tempRoot: string;
  baseline: string;
  target: string;
  remote: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "nova-update-git-test-"));
  temporaryRoots.push(root);
  const remote = join(root, "remote.git");
  const repo = join(root, "checkout");
  await mkdir(repo);
  run(repo, ["init", "--initial-branch=main"]);
  run(repo, ["config", "user.name", "Updater Test"]);
  run(repo, ["config", "user.email", "updater-test@example.invalid"]);
  await writeFile(join(repo, "README.md"), "base\n");
  run(repo, ["add", "README.md"]);
  run(repo, ["commit", "-m", "base"]);
  const baseline = run(repo, ["rev-parse", "HEAD"]).trim();
  run(repo, ["branch", "operator"]);

  run(repo, ["clone", "--bare", repo, remote]);
  run(repo, ["remote", "add", "origin", remote]);
  await writeFile(join(repo, "release.txt"), "release\n");
  run(repo, ["add", "release.txt"]);
  run(repo, ["commit", "-m", "release"]);
  const target = run(repo, ["rev-parse", "HEAD"]).trim();
  run(repo, ["tag", "v0.2.0"]);
  run(repo, ["push", "origin", "main"]);
  run(repo, ["switch", "operator"]);
  return { root: repo, tempRoot: root, baseline, target, remote };
}

function run(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("safe Git update worktrees", () => {
  it("prepares a release candidate while leaving the operator checkout unchanged", async () => {
    const { root, tempRoot, baseline, target } = await makeRepository();
    const prepared = await prepareUpdateWorktree(root, { targetCommit: target, releaseTag: "v0.2.0", expectedHead: baseline, worktreeParent: tempRoot });

    expect(prepared.status).toBe("prepared");
    expect(prepared.branch).toBe("nova/update/v0.2.0");
    expect(prepared.path).not.toBe(root);
    expect(run(root, ["rev-parse", "HEAD"]).trim()).toBe(baseline);
    expect((await inspectGitCheckout(root)).dirtyPaths).toEqual([]);
    expect(run(prepared.path!, ["rev-parse", "HEAD"]).trim()).toBe(target);
    expect((await readFile(join(prepared.path!, "release.txt"), "utf8")).trim()).toBe("release");
    expect(await findPreparedUpdateWorktree(root, prepared.branch!, {
      expectedOriginalHead: baseline,
      expectedTargetCommit: target,
      expectedCandidateHead: target,
    })).toMatchObject({
      branch: prepared.branch,
      path: prepared.path,
      headCommit: target,
      originalHead: baseline,
      targetCommit: target,
    });
  }, 60_000);

  it("uses an exact durable path and resumes a clean pre-merge crash state", async () => {
    const { root, tempRoot, baseline, target } = await makeRepository();
    const candidatePath = join(tempRoot, "durable-candidate");
    await mkdir(candidatePath);
    run(root, ["worktree", "add", "-b", "nova/update/v0.2.0", candidatePath, baseline]);

    const resumed = await findPreparedUpdateWorktree(root, "nova/update/v0.2.0", {
      expectedOriginalHead: baseline,
      expectedTargetCommit: target,
      expectedCandidateHead: baseline,
    });

    expect(resumed).toMatchObject({ path: candidatePath, originalHead: baseline, targetCommit: target });
    expect(resumed!.headCommit).toBe(target);
    expect(run(candidatePath, ["rev-parse", "HEAD"]).trim()).toBe(target);
  }, 60_000);

  it("stops before creating a candidate when tracked or untracked work exists", async () => {
    const { root } = await makeRepository();
    await writeFile(join(root, "local-notes.txt"), "operator work\n");
    await expect(prepareUpdateWorktree(root, { targetCommit: "a".repeat(40), releaseTag: "v0.2.0" }))
      .rejects.toMatchObject({ code: "DIRTY_WORKTREE" });
    expect(run(root, ["branch", "--list", "nova/update/v0.2.0"]).trim()).toBe("");
    expect(await readFile(join(root, "local-notes.txt"), "utf8")).toBe("operator work\n");

    await rm(join(root, "local-notes.txt"));
    await writeFile(join(root, "README.md"), "tracked operator edit\n");
    await expect(prepareUpdateWorktree(root, { targetCommit: "a".repeat(40), releaseTag: "v0.2.0" }))
      .rejects.toMatchObject({ code: "DIRTY_WORKTREE" });
    expect((await readFile(join(root, "README.md"), "utf8")).trim()).toBe("tracked operator edit");
  }, 60_000);

  it("keeps a conflicted candidate for review and leaves the operator branch untouched", async () => {
    const { root, tempRoot, baseline } = await makeRepository();
    run(root, ["switch", "-c", "customer-work"]);
    await writeFile(join(root, "README.md"), "customer\n");
    run(root, ["add", "README.md"]);
    run(root, ["commit", "-m", "customer change"]);
    const customerHead = run(root, ["rev-parse", "HEAD"]).trim();
    run(root, ["switch", "operator"]);
    await writeFile(join(root, "README.md"), "release edit\n");
    run(root, ["add", "README.md"]);
    run(root, ["commit", "-m", "release edit"]);
    const target = run(root, ["rev-parse", "HEAD"]).trim();
    run(root, ["tag", "v0.3.0"]);
    run(root, ["switch", "customer-work"]);
    const prepared = await prepareUpdateWorktree(root, { targetCommit: target, releaseTag: "v0.3.0", expectedHead: customerHead, worktreeParent: tempRoot });

    expect(prepared.status).toBe("conflict");
    expect(prepared.path).toBeTruthy();
    expect(prepared.conflictedPaths).toContain("README.md");
    expect(run(root, ["rev-parse", "HEAD"]).trim()).toBe(customerHead);
    expect(run(root, ["rev-parse", "operator"]).trim()).not.toBe(baseline);
  }, 60_000);

  it("accepts only the exact two-parent merge for a divergent customer base", async () => {
    const { root, tempRoot, target } = await makeRepository();
    run(root, ["switch", "-c", "customer-work", "operator"]);
    await writeFile(join(root, "customer.txt"), "customer change\n");
    run(root, ["add", "customer.txt"]);
    run(root, ["commit", "-m", "customer change"]);
    const originalHead = run(root, ["rev-parse", "HEAD"]).trim();
    const prepared = await prepareUpdateWorktree(root, {
      targetCommit: target,
      releaseTag: "v0.2.0",
      expectedHead: originalHead,
      worktreeParent: tempRoot,
    });
    expect(prepared.status).toBe("prepared");
    const parentLine = run(prepared.path!, ["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
    expect(parentLine.slice(1)).toEqual([originalHead, target]);

    await expect(findPreparedUpdateWorktree(root, prepared.branch!, {
      expectedOriginalHead: originalHead,
      expectedTargetCommit: target,
      expectedCandidateHead: prepared.path ? run(prepared.path, ["rev-parse", "HEAD"]).trim() : undefined,
    })).resolves.toMatchObject({ originalHead, targetCommit: target, headCommit: parentLine[0] });
  }, 60_000);

  it("requires explicit adoption when a completed merge HEAD was not journaled", async () => {
    const { root, tempRoot, target } = await makeRepository();
    run(root, ["switch", "-c", "customer-work", "operator"]);
    await writeFile(join(root, "customer.txt"), "customer change\n");
    run(root, ["add", "customer.txt"]);
    run(root, ["commit", "-m", "customer change"]);
    const originalHead = run(root, ["rev-parse", "HEAD"]).trim();
    const prepared = await prepareUpdateWorktree(root, {
      targetCommit: target,
      releaseTag: "v0.2.0",
      expectedHead: originalHead,
      worktreeParent: tempRoot,
    });

    await expect(findPreparedUpdateWorktree(root, prepared.branch!, {
      expectedOriginalHead: originalHead,
      expectedTargetCommit: target,
    })).rejects.toMatchObject({ code: "CANDIDATE_HEAD_UNPINNED" });
    await expect(findPreparedUpdateWorktree(root, prepared.branch!, {
      expectedOriginalHead: originalHead,
      expectedTargetCommit: target,
      allowUnpinnedMerge: true,
    })).resolves.toMatchObject({ originalHead, targetCommit: target });
  }, 60_000);

  it("rejects a non-GitHub destination even when it is the configured push remote", async () => {
    const { root, tempRoot, baseline, target, remote } = await makeRepository();
    const prepared = await prepareUpdateWorktree(root, { targetCommit: target, releaseTag: "v0.2.0", expectedHead: baseline, worktreeParent: tempRoot });
    await expect(pushUpdateBranch({
      repoRoot: root,
      worktreePath: prepared.path!,
      remoteName: "origin",
      confirmedPushUrl: remote,
      canonicalRepository: "amxcodes/novaprime",
      localBranch: prepared.branch!,
      destinationBranch: "main",
      expectedOriginalHead: baseline,
      expectedCandidateHead: target,
      expectedTargetCommit: target,
    })).rejects.toMatchObject({ code: "PUSH_DESTINATION_UNSUPPORTED" });
    expect(run(remote, ["rev-parse", "refs/heads/main"]).trim()).toBe(target);
    expect(run(root, ["rev-parse", "HEAD"]).trim()).toBe(baseline);
  }, 60_000);

  it("rechecks the exact candidate HEAD immediately before a GitHub push", async () => {
    const { root, tempRoot, baseline, target } = await makeRepository();
    const prepared = await prepareUpdateWorktree(root, { targetCommit: target, releaseTag: "v0.2.0", expectedHead: baseline, worktreeParent: tempRoot });
    run(root, ["remote", "set-url", "--push", "origin", "ssh://git@github.com/customer/nova.git"]);
    await expect(pushUpdateBranch({
      repoRoot: root,
      worktreePath: prepared.path!,
      remoteName: "origin",
      confirmedPushUrl: "ssh://git@github.com/customer/nova.git",
      canonicalRepository: "amxcodes/novaprime",
      localBranch: prepared.branch!,
      destinationBranch: "main",
      expectedOriginalHead: baseline,
      expectedCandidateHead: baseline,
      expectedTargetCommit: target,
    })).rejects.toMatchObject({ code: "CANDIDATE_HEAD_MISMATCH" });
  }, 60_000);

  it("accepts only GitHub HTTPS and SSH push URLs", () => {
    expect(() => validateGitHubPushUrl("https://github.com/customer/nova.git")).not.toThrow();
    expect(() => validateGitHubPushUrl("ssh://git@github.com/customer/nova.git")).not.toThrow();
    expect(() => validateGitHubPushUrl("git@github.com:customer/nova.git")).not.toThrow();
    expect(() => validateGitHubPushUrl("ssh://github.com/customer/nova.git")).toThrow();
    expect(() => validateGitHubPushUrl("ssh://github.com/customer/nova.git", { displayOnly: true })).not.toThrow();
    for (const destination of [
      "http://github.com/customer/nova.git",
      "git://github.com/customer/nova.git",
      "file:///tmp/customer/nova.git",
      "ssh://git@example.com/customer/nova.git",
      "https://user:token@github.com/customer/nova.git",
      "https://github.com.evil.example/customer/nova.git",
    ]) {
      expect(() => validateGitHubPushUrl(destination)).toThrow();
    }
  });

  it("normalizes GitHub URL forms for canonical repository exclusion", () => {
    expect(githubRepositoryIdentity("https://github.com/amxcodes/novaprime.git")).toBe("amxcodes/novaprime");
    expect(githubRepositoryIdentity("ssh://git@github.com/Customer/NovaPrime.git")).toBe("customer/novaprime");
    expect(githubRepositoryIdentity("git@github.com:amxcodes/novaprime.git")).toBe("amxcodes/novaprime");
    expect(githubRepositoryIdentity("file:///tmp/repo.git")).toBeUndefined();
  });

  it("rejects a push URL that changed after the operator confirmed it", async () => {
    const { root, tempRoot, baseline, target } = await makeRepository();
    const prepared = await prepareUpdateWorktree(root, { targetCommit: target, releaseTag: "v0.2.0", expectedHead: baseline, worktreeParent: tempRoot });
    const confirmedPushUrl = "https://github.com/customer/nova.git";
    run(root, ["remote", "set-url", "--push", "origin", "https://github.com/other-customer/nova.git"]);

    await expect(pushUpdateBranch({
      repoRoot: root,
      worktreePath: prepared.path!,
      remoteName: "origin",
      confirmedPushUrl,
      canonicalRepository: "amxcodes/novaprime",
      localBranch: prepared.branch!,
      destinationBranch: "main",
      expectedOriginalHead: baseline,
      expectedCandidateHead: target,
      expectedTargetCommit: target,
    })).rejects.toMatchObject({ code: "PUSH_DESTINATION_CHANGED" });
  }, 60_000);

  it("refuses a push to the canonical NOVA repository in every supported URL form", async () => {
    const { root, tempRoot, baseline, target } = await makeRepository();
    const prepared = await prepareUpdateWorktree(root, { targetCommit: target, releaseTag: "v0.2.0", expectedHead: baseline, worktreeParent: tempRoot });
    const confirmedPushUrl = "git@github.com:amxcodes/novaprime.git";
    run(root, ["remote", "set-url", "--push", "origin", confirmedPushUrl]);

    await expect(pushUpdateBranch({
      repoRoot: root,
      worktreePath: prepared.path!,
      remoteName: "origin",
      confirmedPushUrl,
      canonicalRepository: "amxcodes/novaprime",
      localBranch: prepared.branch!,
      destinationBranch: "main",
      expectedOriginalHead: baseline,
      expectedCandidateHead: target,
      expectedTargetCommit: target,
    })).rejects.toMatchObject({ code: "PUSH_DESTINATION_CANONICAL" });
  }, 60_000);

  it("refuses a push after the source checkout head changes", async () => {
    const { root, tempRoot, baseline, target } = await makeRepository();
    const prepared = await prepareUpdateWorktree(root, { targetCommit: target, releaseTag: "v0.2.0", expectedHead: baseline, worktreeParent: tempRoot });
    const confirmedPushUrl = "https://github.com/customer/nova.git";
    run(root, ["remote", "set-url", "--push", "origin", confirmedPushUrl]);
    run(root, ["commit", "--allow-empty", "-m", "unexpected source movement"]);

    await expect(pushUpdateBranch({
      repoRoot: root,
      worktreePath: prepared.path!,
      remoteName: "origin",
      confirmedPushUrl,
      canonicalRepository: "amxcodes/novaprime",
      localBranch: prepared.branch!,
      destinationBranch: "main",
      expectedOriginalHead: baseline,
      expectedCandidateHead: target,
      expectedTargetCommit: target,
    })).rejects.toMatchObject({ code: "SOURCE_CHECKOUT_CHANGED" });
  }, 60_000);

  it("rejects extra candidate commits and incorrect recorded base or expected HEAD", async () => {
    const { root, tempRoot, baseline, target } = await makeRepository();
    const prepared = await prepareUpdateWorktree(root, { targetCommit: target, releaseTag: "v0.2.0", expectedHead: baseline, worktreeParent: tempRoot });
    run(root, ["switch", "-c", "other-base", "operator"]);
    await writeFile(join(root, "other-base.txt"), "divergent base\n");
    run(root, ["add", "other-base.txt"]);
    run(root, ["commit", "-m", "divergent base"]);
    const otherBase = run(root, ["rev-parse", "HEAD"]).trim();
    run(root, ["switch", "operator"]);

    await expect(findPreparedUpdateWorktree(root, prepared.branch!, {
      expectedOriginalHead: otherBase,
      expectedTargetCommit: target,
      expectedCandidateHead: target,
    })).rejects.toMatchObject({ code: "CANDIDATE_HISTORY_INVALID" });
    await expect(findPreparedUpdateWorktree(root, prepared.branch!, {
      expectedOriginalHead: baseline,
      expectedTargetCommit: target,
      expectedCandidateHead: otherBase,
    })).rejects.toMatchObject({ code: "CANDIDATE_HEAD_MISMATCH" });

    await writeFile(join(prepared.path!, "extra.txt"), "unexpected commit\n");
    run(prepared.path!, ["add", "extra.txt"]);
    run(prepared.path!, ["commit", "-m", "unexpected extra commit"]);
    const extraHead = run(prepared.path!, ["rev-parse", "HEAD"]).trim();

    await expect(findPreparedUpdateWorktree(root, prepared.branch!, {
      expectedOriginalHead: baseline,
      expectedTargetCommit: target,
      expectedCandidateHead: extraHead,
    })).rejects.toMatchObject({ code: "CANDIDATE_HISTORY_INVALID" });

    await expect(findPreparedUpdateWorktree(root, prepared.branch!, {
      expectedOriginalHead: baseline,
      expectedTargetCommit: target,
      expectedCandidateHead: baseline,
    })).rejects.toMatchObject({ code: "CANDIDATE_HISTORY_INVALID" });
  }, 60_000);
});
