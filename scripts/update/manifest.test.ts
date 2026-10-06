import { describe, expect, test } from "bun:test";
import { assertManifestHistory, compareStableVersions } from "./manifest.js";
import type { ReleaseManifestV1 } from "./release.js";

const baseline: ReleaseManifestV1 = {
  schemaVersion: 1,
  version: "0.1.0",
  migrationClass: "online-compatible",
  impact: "Initial updater baseline.",
  migrations: [{ filename: "0001_initial.sql", sha256: "a".repeat(64) }],
};

describe("release manifest history", () => {
  test("compares numeric stable versions", () => {
    expect(compareStableVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  });

  test("allows only append-only migration history in a later release", () => {
    expect(() => assertManifestHistory(baseline, {
      ...baseline,
      version: "0.1.1",
      migrations: [...baseline.migrations, { filename: "0002_next.sql", sha256: "b".repeat(64) }],
    })).not.toThrow();
    expect(() => assertManifestHistory(baseline, {
      ...baseline,
      version: "0.1.1",
      migrations: [{ filename: "0001_initial.sql", sha256: "c".repeat(64) }],
    })).toThrow("RELEASE_MANIFEST_HISTORY_CHANGED:0001_initial.sql");
  });

  test("does not permit reusing or downgrading a manifest version", () => {
    expect(() => assertManifestHistory(baseline, { ...baseline, impact: "Changed" }))
      .toThrow("RELEASE_MANIFEST_VERSION_IMMUTABLE");
    expect(() => assertManifestHistory(baseline, { ...baseline, version: "0.0.9" }))
      .toThrow("RELEASE_MANIFEST_VERSION_DOWNGRADE");
  });
});
