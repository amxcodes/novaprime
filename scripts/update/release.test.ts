import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  CANONICAL_REPOSITORY,
  ReleaseIntegrityError,
  discoverStableBaselineRelease,
  discoverLatestStableRelease,
  discoverStableReleaseByTag,
  loadVerifiedReleaseTree,
  loadVerifiedReleaseTreeFromRoot,
  parseReleaseManifest,
  verifyReleaseMigrations,
  verifyPinnedReleaseStillCurrent,
  type ReleaseFetcher,
} from "./release.ts";

const migrationSource = "CREATE TABLE nova.example (id integer PRIMARY KEY);\n";
const migrationName = "0001_example.sql";
const migrationHash = createHash("sha256").update(migrationSource).digest("hex");
const commit = "a".repeat(40);

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    version: "0.4.0",
    migrations: [{ filename: migrationName, sha256: migrationHash }],
    migrationClass: "online-compatible",
    impact: "Adds the example table without blocking application traffic.",
    ...overrides,
  };
}

function githubRelease(tag: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: "2026-09-30T10:00:00Z",
    html_url: `https://github.com/${CANONICAL_REPOSITORY}/releases/tag/${tag}`,
    body: `Release ${tag}`,
    assets: [],
    ...overrides,
  };
}

function json(value: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status: 200, headers });
}

function makeFetcher(options: {
  releases?: unknown[];
  tagObject?: { sha: string; type: string };
  annotatedTag?: { sha: string; type: string };
  manifest?: unknown;
  packageVersion?: string;
} = {}): { fetcher: ReleaseFetcher; calls: string[] } {
  const calls: string[] = [];
  const tagObject = options.tagObject ?? { sha: commit, type: "commit" };
  const fetcher: ReleaseFetcher = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/releases/tags/v0.4.0")) return json(githubRelease("v0.4.0"));
    if (url.startsWith(`https://api.github.com/repos/${CANONICAL_REPOSITORY}/releases?`)) {
      return json(options.releases ?? [githubRelease("v0.4.0")]);
    }
    if (url.endsWith("/git/ref/tags/v0.4.0")) {
      return json({ object: options.annotatedTag ?? tagObject });
    }
    if (url.includes("/git/tags/")) return json({ object: tagObject });
    if (url.endsWith(`/${commit}/release-manifest.json`)) return json(options.manifest ?? manifest());
    if (url.endsWith(`/${commit}/package.json`)) return json({ version: options.packageVersion ?? "0.4.0" });
    return new Response("not found", { status: 404 });
  };
  return { fetcher, calls };
}

async function getError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("release manifest validation", () => {
  test("accepts a well-formed immutable migration inventory and compatibility note", () => {
    const result = parseReleaseManifest(JSON.stringify(manifest({ minimumStartingVersion: "0.2.0" })));
    expect(result).toEqual({
      schemaVersion: 1,
      version: "0.4.0",
      migrations: [{ filename: migrationName, sha256: migrationHash }],
      migrationClass: "online-compatible",
      impact: "Adds the example table without blocking application traffic.",
      minimumStartingVersion: "0.2.0",
    });
  });

  test("rejects missing or unknown migration classes and malformed ordered hashes", () => {
    for (const broken of [
      manifest({ migrationClass: undefined }),
      manifest({ migrationClass: "fast" }),
      manifest({ migrations: [{ filename: migrationName, sha256: "abc" }] }),
      manifest({ migrations: [{ filename: "0002_gap.sql", sha256: migrationHash }] }),
      manifest({ migrations: [{ filename: migrationName, sha256: migrationHash }, { filename: migrationName, sha256: migrationHash }] }),
      manifest({ impact: "   " }),
      manifest({ minimumStartingVersion: "0.5.0" }),
      manifest({ schemaVersion: 2 }),
    ]) {
      expect(() => parseReleaseManifest(JSON.stringify(broken))).toThrow(ReleaseIntegrityError);
    }
  });

  test("verifies exact candidate migration bytes and rejects extra or altered files", () => {
    const parsed = parseReleaseManifest(JSON.stringify(manifest()));
    expect(() => verifyReleaseMigrations(parsed, [{ filename: migrationName, source: migrationSource }])).not.toThrow();
    expect(() => verifyReleaseMigrations(parsed, [{ filename: migrationName, source: `${migrationSource}-- changed` }])).toThrow(/SHA-256/);
    expect(() => verifyReleaseMigrations(parsed, [{ filename: "0001_other.sql", source: migrationSource }])).toThrow(/missing migration/);
    expect(() => verifyReleaseMigrations(parsed, [
      { filename: migrationName, source: migrationSource },
      { filename: "0002_extra.sql", source: "SELECT 1;" },
    ])).toThrow(/does not match/);
  });

  test("loads and verifies both a baseline or candidate source tree into a hash map", async () => {
    const root = await mkdtemp(join(tmpdir(), "nova-release-tree-"));
    const migrationDirectory = join(root, "database", "migrations");
    try {
      await mkdir(migrationDirectory, { recursive: true });
      await writeFile(join(root, "release-manifest.json"), JSON.stringify(manifest()));
      await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.4.0" }));
      await writeFile(join(migrationDirectory, migrationName), migrationSource);
      const tree = await loadVerifiedReleaseTreeFromRoot(root);
      expect(tree.manifest.version).toBe("0.4.0");
      expect(tree.migrationHashes.get(migrationName)).toBe(migrationHash);
      await writeFile(join(migrationDirectory, migrationName), `${migrationSource}-- tampered`);
      await expect(loadVerifiedReleaseTree(join(root, "release-manifest.json"), migrationDirectory)).rejects.toMatchObject({ code: "MIGRATION_INTEGRITY_FAILED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("official stable release discovery", () => {
  test("verifies a fork's baseline against its canonical release without matching fork HEAD", async () => {
    const forkedCheckout = "c".repeat(40);
    const fetcher = makeFetcher();
    const baseline = await discoverStableBaselineRelease({
      tag: "v0.4.0",
      version: "0.4.0",
      fetcher: fetcher.fetcher,
    });

    expect(baseline.commit).toBe(commit);
    expect(baseline.version).toBe("0.4.0");
    expect(forkedCheckout).not.toBe(baseline.commit);
    expect(fetcher.calls).toContain(`https://api.github.com/repos/${CANONICAL_REPOSITORY}/releases/tags/v0.4.0`);
  });

  test("chooses the highest stable semver, resolves annotated tags, and reads metadata at that commit", async () => {
    const annotated = "b".repeat(40);
    const fetcher = makeFetcher({
      releases: [
        githubRelease("v0.9.0-beta.1", { prerelease: true }),
        githubRelease("v0.3.0"),
        githubRelease("v0.4.0"),
      ],
      annotatedTag: { sha: annotated, type: "tag" },
      tagObject: { sha: commit, type: "commit" },
    });
    const result = await discoverLatestStableRelease({ currentVersion: "0.2.9", currentCommit: "c".repeat(40), fetcher: fetcher.fetcher });

    expect(result.status).toBe("update-available");
    expect(result.release.version).toBe("0.4.0");
    expect(result.release.commit).toBe(commit);
    expect(result.release.manifest.migrationClass).toBe("online-compatible");
    expect(fetcher.calls).toContain(`https://api.github.com/repos/${CANONICAL_REPOSITORY}/git/tags/${annotated}`);
    expect(fetcher.calls).toContain(`https://raw.githubusercontent.com/${CANONICAL_REPOSITORY}/${commit}/release-manifest.json`);
    expect(fetcher.calls).toContain(`https://raw.githubusercontent.com/${CANONICAL_REPOSITORY}/${commit}/package.json`);
    expect(fetcher.calls.some((url) => url.includes("main"))).toBe(false);
  });

  test("reports no stable release without substituting the moving main branch", async () => {
    const { fetcher, calls } = makeFetcher({ releases: [githubRelease("v0.5.0-rc.1", { prerelease: true })] });
    await getError(discoverLatestStableRelease({ currentVersion: "0.1.0", fetcher }), "NO_STABLE_RELEASE");
    expect(calls).toHaveLength(1);
  });

  test("fails closed when offline and keeps the diagnostic free of credential-bearing URLs", async () => {
    const fetcher: ReleaseFetcher = async () => { throw new Error("https://user:secret@example.invalid/path"); };
    let captured: unknown;
    try {
      await discoverLatestStableRelease({ currentVersion: "0.1.0", fetcher });
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({ code: "RELEASE_SOURCE_UNAVAILABLE" });
    expect((captured as Error).message).not.toContain("secret");
  });

  test("blocks downgrades before resolving or downloading a release", async () => {
    const { fetcher, calls } = makeFetcher({ releases: [githubRelease("v0.4.0")] });
    await getError(discoverLatestStableRelease({ currentVersion: "0.5.0", fetcher }), "DOWNGRADE_BLOCKED");
    expect(calls).toHaveLength(1);
  });

  test("rejects mismatched release, manifest, and package versions", async () => {
    const badManifest = makeFetcher({ manifest: manifest({ version: "0.3.0" }) });
    await getError(discoverLatestStableRelease({ currentVersion: "0.2.0", fetcher: badManifest.fetcher }), "INVALID_RELEASE_MANIFEST");

    const badPackage = makeFetcher({ packageVersion: "0.3.0" });
    await getError(discoverLatestStableRelease({ currentVersion: "0.2.0", fetcher: badPackage.fetcher }), "PACKAGE_VERSION_MISMATCH");
  });

  test("rejects a release when installed version is below its declared starting version", async () => {
    const { fetcher } = makeFetcher({ manifest: manifest({ minimumStartingVersion: "0.3.0" }) });
    await getError(discoverLatestStableRelease({ currentVersion: "0.2.0", fetcher }), "UNSUPPORTED_STARTING_VERSION");
  });

  test("detects a published tag reused for a different local commit", async () => {
    const { fetcher } = makeFetcher();
    await getError(discoverLatestStableRelease({ currentVersion: "0.4.0", currentCommit: "c".repeat(40), fetcher }), "RELEASE_VERSION_REUSED");
  });

  test("returns up-to-date only when version and pinned commit agree", async () => {
    const { fetcher } = makeFetcher();
    const result = await discoverLatestStableRelease({ currentVersion: "0.4.0", currentCommit: commit, fetcher });
    expect(result.status).toBe("up-to-date");
    await getError(discoverLatestStableRelease({ currentVersion: "0.4.0", fetcher }), "INVALID_CURRENT_VERSION");
  });

  test("resolves an explicit stable tag without listing releases or consulting latest", async () => {
    const { fetcher, calls } = makeFetcher();
    const result = await discoverStableReleaseByTag({ tag: "v0.4.0", currentVersion: "0.2.0", fetcher });
    expect(result.status).toBe("update-available");
    expect(result.release.tag).toBe("v0.4.0");
    expect(calls[0]).toBe(`https://api.github.com/repos/${CANONICAL_REPOSITORY}/releases/tags/v0.4.0`);
    expect(calls.some((url) => url.includes("/releases?"))).toBe(false);
  });

  test("rechecks release publication and tag SHA before any mutation", async () => {
    const first = makeFetcher();
    const planned = await discoverLatestStableRelease({ currentVersion: "0.2.0", fetcher: first.fetcher });
    const moved = makeFetcher({ tagObject: { sha: "d".repeat(40), type: "commit" } });
    await getError(verifyPinnedReleaseStillCurrent(planned.release, moved.fetcher), "RELEASE_COMMIT_CHANGED");
    const withdrawn: ReleaseFetcher = async () => json(githubRelease("v0.4.0", { prerelease: true }));
    await getError(verifyPinnedReleaseStillCurrent(planned.release, withdrawn), "RELEASE_NO_LONGER_STABLE");
  });

  test("rejects explicit prerelease or malformed tags", async () => {
    const { fetcher, calls } = makeFetcher();
    await getError(discoverStableReleaseByTag({ tag: "main", currentVersion: "0.2.0", fetcher }), "INVALID_RELEASE_METADATA");
    expect(calls).toHaveLength(0);
    const prereleaseFetcher: ReleaseFetcher = async () => json(githubRelease("v0.4.0", { prerelease: true }));
    await getError(discoverStableReleaseByTag({ tag: "v0.4.0", currentVersion: "0.2.0", fetcher: prereleaseFetcher }), "INVALID_RELEASE_METADATA");
  });

  test("stops when the release manifest is missing or unsupported", async () => {
    const missing = makeFetcher({ manifest: undefined });
    // `undefined` selects the fixture default, so return a genuine 404 for the manifest.
    const noManifest: ReleaseFetcher = async (input) => String(input).endsWith("release-manifest.json")
      ? new Response("missing", { status: 404 })
      : missing.fetcher(input);
    await getError(discoverLatestStableRelease({ currentVersion: "0.2.0", fetcher: noManifest }), "MISSING_RELEASE_MANIFEST");

    const unsupported = makeFetcher({ manifest: manifest({ schemaVersion: 3 }) });
    await getError(discoverLatestStableRelease({ currentVersion: "0.2.0", fetcher: unsupported.fetcher }), "INVALID_RELEASE_MANIFEST");
  });
});
