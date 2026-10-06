import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadVerifiedReleaseTreeFromRoot, parseReleaseManifest, type MigrationClass, type ReleaseManifestV1 } from "./release.js";
import { migrationSha256 } from "../../server/src/migration-checksum.js";

const root = resolve(import.meta.dir, "../..");
const manifestPath = join(root, "release-manifest.json");
const migrationDirectory = join(root, "database", "migrations");
const migrationPattern = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

export function compareStableVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match) throw new Error("RELEASE_VERSION_INVALID");
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
}

export function assertManifestHistory(previous: ReleaseManifestV1, next: ReleaseManifestV1): void {
  const versionOrder = compareStableVersions(next.version, previous.version);
  if (versionOrder < 0) throw new Error("RELEASE_MANIFEST_VERSION_DOWNGRADE");
  if (versionOrder === 0) {
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      throw new Error("RELEASE_MANIFEST_VERSION_IMMUTABLE");
    }
    return;
  }
  if (next.migrations.length < previous.migrations.length) {
    throw new Error("RELEASE_MANIFEST_MIGRATION_REMOVED");
  }
  for (let index = 0; index < previous.migrations.length; index += 1) {
    const oldMigration = previous.migrations[index]!;
    const newMigration = next.migrations[index];
    if (!newMigration || oldMigration.filename !== newMigration.filename || oldMigration.sha256 !== newMigration.sha256) {
      throw new Error(`RELEASE_MANIFEST_HISTORY_CHANGED:${oldMigration.filename}`);
    }
  }
}

async function migrationInventory(): Promise<ReleaseManifestV1["migrations"]> {
  const entries = await readdir(migrationDirectory, { withFileTypes: true });
  const sqlFiles = entries.filter((entry) => entry.name.endsWith(".sql"));
  if (sqlFiles.some((entry) => !entry.isFile())) throw new Error("RELEASE_MIGRATION_NOT_REGULAR_FILE");
  const filenames = sqlFiles.map((entry) => entry.name).sort();
  const migrations: ReleaseManifestV1["migrations"] = [];
  for (let index = 0; index < filenames.length; index += 1) {
    const filename = filenames[index]!;
    const match = migrationPattern.exec(filename);
    if (!match || match[1] !== String(index + 1).padStart(4, "0")) {
      throw new Error(`RELEASE_MIGRATION_SEQUENCE_INVALID:${filename}`);
    }
    const source = await readFile(join(migrationDirectory, filename));
    migrations.push({ filename, sha256: migrationSha256(source) });
  }
  if (migrations.length === 0) throw new Error("RELEASE_MIGRATION_INVENTORY_EMPTY");
  return migrations;
}

function validateArguments(): { write: boolean; migrationClass: MigrationClass; impact: string; minimumStartingVersion?: string } {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help") continue;
    if (arg === "--write" || arg === "--check") {
      if (flags.has(arg)) throw new Error(`RELEASE_OPTION_DUPLICATE:${arg}`);
      flags.add(arg);
      continue;
    }
    if (!["--class", "--impact", "--minimum-starting-version"].includes(arg)) {
      throw new Error(`RELEASE_OPTION_UNSUPPORTED:${arg}`);
    }
    if (values.has(arg)) throw new Error(`RELEASE_OPTION_DUPLICATE:${arg}`);
    const value = args[++index]?.trim();
    if (!value || value.startsWith("--")) throw new Error(`RELEASE_OPTION_VALUE_REQUIRED:${arg}`);
    values.set(arg, value);
  }
  if (args.includes("--help")) {
    console.info("Usage: bun run update:manifest --check | --write --class <online-compatible|long-running|maintenance-required> --impact <reviewed-release-impact> [--minimum-starting-version <semver>]");
    process.exit(0);
  }
  const write = flags.has("--write");
  if (write === flags.has("--check")) throw new Error("RELEASE_MANIFEST_MODE_REQUIRED: choose exactly one of --check or --write");
  const migrationClass = values.get("--class");
  const impact = values.get("--impact");
  const minimumStartingVersion = values.get("--minimum-starting-version");
  if (!write) {
    if (values.size > 0) throw new Error("RELEASE_CHECK_DOES_NOT_ACCEPT_WRITE_METADATA");
    return { write, migrationClass: "online-compatible", impact: "check" };
  }
  if (
    migrationClass !== "online-compatible" &&
    migrationClass !== "long-running" &&
    migrationClass !== "maintenance-required"
  ) throw new Error("RELEASE_MIGRATION_CLASS_REQUIRED");
  if (!impact || impact.trim().length > 2_000) throw new Error("RELEASE_IMPACT_NOTE_REQUIRED");
  return { write, migrationClass, impact: impact.trim(), ...(minimumStartingVersion ? { minimumStartingVersion } : {}) };
}

async function generate(): Promise<void> {
  const args = validateArguments();
  const packageMetadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageMetadata.version !== "string") throw new Error("PACKAGE_VERSION_INVALID");

  if (!args.write) {
    const tree = await loadVerifiedReleaseTreeFromRoot(root);
    if (tree.manifest.version !== packageMetadata.version) throw new Error("RELEASE_MANIFEST_PACKAGE_VERSION_MISMATCH");
    console.info(`Release manifest verified: v${tree.manifest.version}, ${tree.manifest.migrations.length} canonical migrations.`);
    return;
  }

  let previous: ReleaseManifestV1 | undefined;
  try {
    previous = parseReleaseManifest(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next: ReleaseManifestV1 = {
    schemaVersion: 1,
    version: packageMetadata.version,
    migrations: await migrationInventory(),
    migrationClass: args.migrationClass,
    impact: args.impact,
    ...(args.minimumStartingVersion ? { minimumStartingVersion: args.minimumStartingVersion } : {}),
  };
  if (previous) assertManifestHistory(previous, next);

  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, manifestPath);
  console.info(`Wrote ${manifestPath} for v${next.version} (${next.migrations.length} migration hashes).`);
}

if (import.meta.main) {
  generate().catch((error: unknown) => {
    const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
      ? error.message
      : "RELEASE_MANIFEST_FAILED";
    console.error(code);
    process.exitCode = 1;
  });
}
