import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { migrationSha256 } from "../../server/src/migration-checksum.js";

/** The updater trusts releases from this repository only. */
export const CANONICAL_REPOSITORY = "amxcodes/novaprime";
export const RELEASE_MANIFEST_PATH = "release-manifest.json";

const API_BASE = `https://api.github.com/repos/${CANONICAL_REPOSITORY}`;
const RELEASES_URL = `${API_BASE}/releases?per_page=100&page=1`;
const MANIFEST_LIMIT_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RELEASE_PAGES = 20;
const MAX_ANNOTATED_TAG_DEPTH = 8;

export type MigrationClass =
  | "online-compatible"
  | "long-running"
  | "maintenance-required";

export interface ReleaseMigration {
  filename: string;
  sha256: string;
}

/**
 * Version 1 is deliberately small and immutable. New required semantics need
 * a new schemaVersion; unknown optional JSON properties are ignored.
 */
export interface ReleaseManifestV1 {
  schemaVersion: 1;
  version: string;
  migrations: ReleaseMigration[];
  migrationClass: MigrationClass;
  impact: string;
  minimumStartingVersion?: string;
}

export interface StableRelease {
  tag: string;
  version: string;
  commit: string;
  publishedAt: string;
  releaseUrl: string;
  notes: string;
  manifest: ReleaseManifestV1;
}

export type ReleaseCheck =
  | { status: "update-available"; currentVersion: string; release: StableRelease }
  | { status: "up-to-date"; currentVersion: string; release: StableRelease };

export interface DiscoverReleaseOptions {
  currentVersion: string;
  /** When known, detects same-version tag movement or version reuse. */
  currentCommit?: string;
  /** Injectable for deterministic tests; the repository remains fixed. */
  fetcher?: ReleaseFetcher;
}

export interface DiscoverTaggedReleaseOptions extends DiscoverReleaseOptions {
  tag: string;
}

export interface DiscoverBaselineReleaseOptions {
  tag: string;
  version: string;
  fetcher?: ReleaseFetcher;
}

export type ReleaseFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface LocalMigrationSource {
  filename: string;
  source: string | Uint8Array;
}

export interface VerifiedReleaseTree {
  manifest: ReleaseManifestV1;
  /** Complete canonical inventory, keyed by SQL filename. */
  migrationHashes: ReadonlyMap<string, string>;
}

export type ReleaseErrorCode =
  | "INVALID_CURRENT_VERSION"
  | "RELEASE_SOURCE_UNAVAILABLE"
  | "RELEASE_RATE_LIMITED"
  | "RELEASE_DISCOVERY_INCOMPLETE"
  | "INVALID_RELEASE_METADATA"
  | "NO_STABLE_RELEASE"
  | "DOWNGRADE_BLOCKED"
  | "UNSUPPORTED_STARTING_VERSION"
  | "RELEASE_VERSION_REUSED"
  | "RELEASE_COMMIT_CHANGED"
  | "BASELINE_RELEASE_MISMATCH"
  | "RELEASE_NO_LONGER_STABLE"
  | "MISSING_RELEASE_MANIFEST"
  | "INVALID_RELEASE_MANIFEST"
  | "PACKAGE_VERSION_MISMATCH"
  | "MIGRATION_INTEGRITY_FAILED";

export class ReleaseIntegrityError extends Error {
  readonly code: ReleaseErrorCode;

  constructor(code: ReleaseErrorCode, message: string) {
    super(message);
    this.name = "ReleaseIntegrityError";
    this.code = code;
  }
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  body?: unknown;
}

interface ReleaseCandidate {
  tag: string;
  version: string;
  publishedAt: string;
  releaseUrl: string;
  notes: string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

function parseVersion(value: unknown): ParsedVersion | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return { major, minor, patch, text: value };
}

function compareVersion(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function releaseError(code: ReleaseErrorCode, message: string): never {
  throw new ReleaseIntegrityError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
}

function safePublishedAt(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function parseCandidate(value: unknown): ReleaseCandidate | undefined {
  if (!isRecord(value)) {
    releaseError("INVALID_RELEASE_METADATA", "The official NOVA release service returned a malformed release record.");
  }
  const release = value as GitHubRelease;
  if (typeof release.draft !== "boolean" || typeof release.prerelease !== "boolean") {
    releaseError("INVALID_RELEASE_METADATA", "The official NOVA release service omitted stable-release flags.");
  }
  if (release.draft || release.prerelease) return undefined;
  if (typeof release.tag_name !== "string") {
    releaseError("INVALID_RELEASE_METADATA", "A published stable NOVA release has no tag name.");
  }
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(release.tag_name);
  if (!match) {
    releaseError("INVALID_RELEASE_METADATA", "A published stable NOVA release uses a tag outside the documented vMAJOR.MINOR.PATCH format.");
  }
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  if (!parseVersion(version)) {
    return releaseError("INVALID_RELEASE_METADATA", `Stable release ${release.tag_name} has a version outside the supported numeric range.`);
  }
  const publishedAt = safePublishedAt(release.published_at);
  if (!publishedAt) {
    releaseError("INVALID_RELEASE_METADATA", `Stable release ${release.tag_name} has no valid publication date.`);
  }

  const canonicalReleaseUrl = `https://github.com/${CANONICAL_REPOSITORY}/releases/tag/${release.tag_name}`;
  // Do not display arbitrary URLs supplied by an API payload.
  const notes = typeof release.body === "string" ? release.body.slice(0, 40_000) : "";
  return {
    tag: release.tag_name,
    version,
    publishedAt,
    releaseUrl: canonicalReleaseUrl,
    notes: notes.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " "),
  };
}

function validateMigrationList(value: unknown): ReleaseMigration[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) {
    releaseError("INVALID_RELEASE_MANIFEST", "Release manifest must list at least one migration and no more than 10,000.");
  }
  const migrations: ReleaseMigration[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || typeof item.filename !== "string" || typeof item.sha256 !== "string") {
      releaseError("INVALID_RELEASE_MANIFEST", `Release manifest migration ${index + 1} is malformed.`);
    }
    const filename = item.filename;
    const sha256 = item.sha256;
    const match = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/.exec(filename);
    if (!match || !/^[a-f0-9]{64}$/i.test(sha256)) {
      releaseError("INVALID_RELEASE_MANIFEST", `Release manifest migration ${index + 1} has an invalid filename or SHA-256.`);
    }
    if (seen.has(filename)) {
      releaseError("INVALID_RELEASE_MANIFEST", `Release manifest repeats migration ${filename}.`);
    }
    const expectedSequence = String(index + 1).padStart(4, "0");
    if (match[1] !== expectedSequence) {
      releaseError("INVALID_RELEASE_MANIFEST", `Release manifest migrations must be ordered and contiguous; expected ${expectedSequence}_….sql.`);
    }
    seen.add(filename);
    migrations.push({ filename, sha256: sha256.toLowerCase() });
  }
  return migrations;
}

/** Parse and validate the in-tree manifest without trusting API metadata. */
export function parseReleaseManifest(raw: string): ReleaseManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return releaseError("INVALID_RELEASE_MANIFEST", "Release manifest is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    return releaseError("INVALID_RELEASE_MANIFEST", "Release manifest has an unsupported or missing schemaVersion.");
  }
  const version = parseVersion(parsed.version);
  if (!version) {
    return releaseError("INVALID_RELEASE_MANIFEST", "Release manifest version is invalid.");
  }
  const migrations = validateMigrationList(parsed.migrations);
  let minimumStartingVersion: string | undefined;
  if (parsed.minimumStartingVersion !== undefined) {
    const minimum = parseVersion(parsed.minimumStartingVersion);
    if (!minimum) {
      return releaseError("INVALID_RELEASE_MANIFEST", "Release manifest minimumStartingVersion is invalid.");
    }
    if (compareVersion(minimum, version) > 0) {
      return releaseError("INVALID_RELEASE_MANIFEST", "Release manifest minimumStartingVersion exceeds the release version.");
    }
    minimumStartingVersion = minimum.text;
  }
  if (parsed.migrationClass !== "online-compatible" && parsed.migrationClass !== "long-running" && parsed.migrationClass !== "maintenance-required") {
    return releaseError("INVALID_RELEASE_MANIFEST", "Release manifest migrationClass is missing or unsupported.");
  }
  if (typeof parsed.impact !== "string" || parsed.impact.trim().length === 0 || parsed.impact.length > 2_000 || /[\u0000-\u001f\u007f]/.test(parsed.impact)) {
    return releaseError("INVALID_RELEASE_MANIFEST", "Release manifest impact must be a non-empty string of at most 2,000 characters.");
  }
  return {
    schemaVersion: 1,
    version: version.text,
    migrations,
    migrationClass: parsed.migrationClass,
    impact: parsed.impact,
    ...(minimumStartingVersion ? { minimumStartingVersion } : {}),
  };
}

/** Verify the exact migration inventory and bytes in the pinned candidate tree. */
export function verifyReleaseMigrations(
  manifest: ReleaseManifestV1,
  localMigrations: readonly LocalMigrationSource[],
): void {
  if (!Array.isArray(localMigrations)) {
    releaseError("MIGRATION_INTEGRITY_FAILED", "Candidate migration sources are unavailable.");
  }
  const local = new Map<string, string | Uint8Array>();
  for (const item of localMigrations) {
    if (!item || typeof item.filename !== "string" || !(typeof item.source === "string" || item.source instanceof Uint8Array) || local.has(item.filename)) {
      releaseError("MIGRATION_INTEGRITY_FAILED", "Candidate migration inventory is malformed or contains duplicate filenames.");
    }
    local.set(item.filename, item.source);
  }
  if (local.size !== manifest.migrations.length) {
    releaseError("MIGRATION_INTEGRITY_FAILED", "Candidate migration inventory does not match the release manifest.");
  }
  for (const migration of manifest.migrations) {
    const source = local.get(migration.filename);
    if (source === undefined) {
      releaseError("MIGRATION_INTEGRITY_FAILED", `Candidate release is missing migration ${migration.filename}.`);
    }
    const actual = migrationSha256(source);
    if (actual !== migration.sha256) {
      releaseError("MIGRATION_INTEGRITY_FAILED", `Candidate migration ${migration.filename} does not match its published SHA-256.`);
    }
  }
}

/**
 * Load a manifest from either a trusted baseline checkout or a pinned release
 * checkout and prove that its complete local SQL directory matches the hashes.
 */
export async function loadVerifiedReleaseTree(
  manifestPath: string,
  migrationDirectory: string,
): Promise<VerifiedReleaseTree> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return releaseError("MISSING_RELEASE_MANIFEST", "The selected NOVA source tree has no readable release-manifest.json.");
  }
  const manifest = parseReleaseManifest(raw);
  let packageVersion: ParsedVersion | undefined;
  try {
    const packageMetadata: unknown = JSON.parse(await readFile(join(dirname(manifestPath), "package.json"), "utf8"));
    if (isRecord(packageMetadata)) packageVersion = parseVersion(packageMetadata.version);
  } catch {
    return releaseError("PACKAGE_VERSION_MISMATCH", "The selected NOVA source tree has no valid package.json version.");
  }
  if (!packageVersion || packageVersion.text !== manifest.version) {
    return releaseError("PACKAGE_VERSION_MISMATCH", "The selected NOVA package.json version does not match its release manifest.");
  }
  let filenames: string[];
  try {
    filenames = await readdir(migrationDirectory, { encoding: "utf8" });
  } catch {
    return releaseError("MIGRATION_INTEGRITY_FAILED", "The selected NOVA source tree has no readable database/migrations directory.");
  }
  const sources: LocalMigrationSource[] = [];
  for (const filename of filenames.filter((entry) => entry.endsWith(".sql"))) {
    try {
      const path = join(migrationDirectory, filename);
      if (!(await lstat(path)).isFile()) {
        return releaseError("MIGRATION_INTEGRITY_FAILED", "The SQL migration directory contains a non-regular .sql entry.");
      }
      sources.push({ filename, source: await readFile(path) });
    } catch {
      return releaseError("MIGRATION_INTEGRITY_FAILED", `Could not read candidate migration ${filename}.`);
    }
  }
  verifyReleaseMigrations(manifest, sources);
  return {
    manifest,
    migrationHashes: new Map(manifest.migrations.map(({ filename, sha256 }) => [filename, sha256])),
  };
}

/** Convenience entry point for a checked-out current or candidate source root. */
export function loadVerifiedReleaseTreeFromRoot(sourceRoot: string): Promise<VerifiedReleaseTree> {
  return loadVerifiedReleaseTree(
    join(sourceRoot, RELEASE_MANIFEST_PATH),
    join(sourceRoot, "database", "migrations"),
  );
}

async function fetchJson(fetcher: ReleaseFetcher, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NOVA-Update-Manager",
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return releaseError("RELEASE_SOURCE_UNAVAILABLE", "Could not reach the official NOVA release service.");
  }
  if (response.status === 403 || response.status === 429) {
    return releaseError("RELEASE_RATE_LIMITED", "The official NOVA release service rate-limited this check. Try again later.");
  }
  if (!response.ok) {
    return releaseError("RELEASE_SOURCE_UNAVAILABLE", `The official NOVA release service returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    return releaseError("INVALID_RELEASE_METADATA", "The official NOVA release service returned invalid JSON.");
  }
}

async function fetchPinnedText(
  fetcher: ReleaseFetcher,
  url: string,
  label: string,
  failureCode: ReleaseErrorCode,
): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "text/plain", "User-Agent": "NOVA-Update-Manager" },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return releaseError(failureCode, `Could not download the official NOVA ${label} from its pinned commit.`);
  }
  if (!response.ok) {
    return releaseError(failureCode, `Could not download the official NOVA ${label} (HTTP ${response.status}).`);
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MANIFEST_LIMIT_BYTES) {
    return releaseError("INVALID_RELEASE_MANIFEST", `Pinned release ${label} exceeds the 2 MiB safety limit.`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return releaseError("INVALID_RELEASE_MANIFEST", `Pinned release ${label} could not be read.`);
  }
  if (new TextEncoder().encode(text).byteLength > MANIFEST_LIMIT_BYTES) {
    return releaseError("INVALID_RELEASE_MANIFEST", `Pinned release ${label} exceeds the 2 MiB safety limit.`);
  }
  return text;
}

function nextReleasePage(response: Response, expectedPage: number): string | undefined {
  const link = response.headers.get("link");
  if (!link) return undefined;
  for (const part of link.split(/,\s*(?=<)/)) {
    const match = /^<([^>]+)>;\s*rel="?([^";]+)"?/.exec(part.trim());
    if (match?.[2].split(/\s+/).includes("next")) {
      let url: URL;
      try {
        url = new URL(match[1]);
      } catch {
        return releaseError("INVALID_RELEASE_METADATA", "Release pagination link is invalid.");
      }
      const page = Number(url.searchParams.get("page"));
      const queryKeys = [...url.searchParams.keys()].sort().join(",");
      if (url.origin !== "https://api.github.com" || url.pathname !== `/repos/${CANONICAL_REPOSITORY}/releases` || queryKeys !== "page,per_page" || url.searchParams.get("per_page") !== "100" || page !== expectedPage) {
        return releaseError("INVALID_RELEASE_METADATA", "Release pagination link did not remain within the official NOVA release endpoint.");
      }
      return url.toString();
    }
  }
  return undefined;
}

async function listStableCandidates(fetcher: ReleaseFetcher): Promise<ReleaseCandidate[]> {
  const candidates: ReleaseCandidate[] = [];
  let url: string | undefined = RELEASES_URL;
  let pages = 0;
  while (url) {
    if (++pages > MAX_RELEASE_PAGES) {
      return releaseError("RELEASE_DISCOVERY_INCOMPLETE", "There are too many NOVA releases to safely identify the latest stable release.");
    }
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "NOVA-Update-Manager",
        },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return releaseError("RELEASE_SOURCE_UNAVAILABLE", "Could not reach the official NOVA release service.");
    }
    if (response.status === 403 || response.status === 429) {
      return releaseError("RELEASE_RATE_LIMITED", "The official NOVA release service rate-limited this check. Try again later.");
    }
    if (!response.ok) {
      return releaseError("RELEASE_SOURCE_UNAVAILABLE", `The official NOVA release service returned HTTP ${response.status}.`);
    }
    let values: unknown;
    try {
      values = await response.json();
    } catch {
      return releaseError("INVALID_RELEASE_METADATA", "The official NOVA release service returned invalid JSON.");
    }
    if (!Array.isArray(values) || values.length > 100) {
      return releaseError("INVALID_RELEASE_METADATA", "The official NOVA release service returned an invalid release list.");
    }
    for (const value of values) {
      const candidate = parseCandidate(value);
      if (candidate) candidates.push(candidate);
    }
    url = nextReleasePage(response, pages + 1);
  }

  const byVersion = new Map<string, ReleaseCandidate>();
  for (const candidate of candidates) {
    const previous = byVersion.get(candidate.version);
    if (previous && previous.tag !== candidate.tag) {
      return releaseError("INVALID_RELEASE_METADATA", `More than one stable release claims version ${candidate.version}.`);
    }
    byVersion.set(candidate.version, candidate);
  }
  return [...byVersion.values()].sort((a, b) => compareVersion(parseVersion(a.version)!, parseVersion(b.version)!));
}

async function resolveTagCommit(fetcher: ReleaseFetcher, tag: string): Promise<string> {
  const encodedTag = encodeURIComponent(tag);
  const ref = await fetchJson(fetcher, `${API_BASE}/git/ref/tags/${encodedTag}`);
  if (!isRecord(ref) || !isRecord(ref.object) || !isObjectId(ref.object.sha) || typeof ref.object.type !== "string") {
    return releaseError("INVALID_RELEASE_METADATA", `Stable release ${tag} does not resolve to a valid Git object.`);
  }
  let objectSha = ref.object.sha.toLowerCase();
  let objectType = ref.object.type;
  let depth = 0;
  while (objectType === "tag") {
    if (++depth > MAX_ANNOTATED_TAG_DEPTH) {
      return releaseError("INVALID_RELEASE_METADATA", `Stable release ${tag} has excessive annotated-tag nesting.`);
    }
    const annotated = await fetchJson(fetcher, `${API_BASE}/git/tags/${objectSha}`);
    if (!isRecord(annotated) || !isRecord(annotated.object) || !isObjectId(annotated.object.sha) || typeof annotated.object.type !== "string") {
      return releaseError("INVALID_RELEASE_METADATA", `Stable release ${tag} has an invalid annotated tag object.`);
    }
    objectSha = annotated.object.sha.toLowerCase();
    objectType = annotated.object.type;
  }
  if (objectType !== "commit") {
    return releaseError("INVALID_RELEASE_METADATA", `Stable release ${tag} does not point to a commit.`);
  }
  return objectSha;
}

async function inspectReleaseCandidate(
  candidate: ReleaseCandidate,
  current: ParsedVersion,
  currentCommit: string | undefined,
  fetcher: ReleaseFetcher,
  allowSameVersionWithoutLocalCommit = false,
): Promise<ReleaseCheck> {
  const targetVersion = parseVersion(candidate.version)!;
  const relation = compareVersion(targetVersion, current);
  if (relation < 0) {
    return releaseError("DOWNGRADE_BLOCKED", `Latest stable NOVA release ${candidate.tag} is older than installed version ${current.text}; no downgrade was attempted.`);
  }

  const commit = await resolveTagCommit(fetcher, candidate.tag);
  const rawManifest = await fetchPinnedText(
    fetcher,
    `https://raw.githubusercontent.com/${CANONICAL_REPOSITORY}/${commit}/${RELEASE_MANIFEST_PATH}`,
    "release manifest",
    "MISSING_RELEASE_MANIFEST",
  );
  const manifest = parseReleaseManifest(rawManifest);
  if (manifest.version !== candidate.version) {
    return releaseError("INVALID_RELEASE_MANIFEST", `Release manifest version ${manifest.version} does not match tag ${candidate.tag}.`);
  }
  const rawPackage = await fetchPinnedText(
    fetcher,
    `https://raw.githubusercontent.com/${CANONICAL_REPOSITORY}/${commit}/package.json`,
    "package metadata",
    "INVALID_RELEASE_METADATA",
  );
  let packageVersion: ParsedVersion | undefined;
  try {
    const packageMetadata: unknown = JSON.parse(rawPackage);
    if (isRecord(packageMetadata)) packageVersion = parseVersion(packageMetadata.version);
  } catch {
    return releaseError("INVALID_RELEASE_METADATA", "Pinned NOVA package metadata is invalid JSON.");
  }
  if (!packageVersion || packageVersion.text !== candidate.version) {
    return releaseError("PACKAGE_VERSION_MISMATCH", `Pinned package.json version does not match stable release ${candidate.tag}.`);
  }
  if (manifest.minimumStartingVersion && compareVersion(current, parseVersion(manifest.minimumStartingVersion)!) < 0) {
    return releaseError("UNSUPPORTED_STARTING_VERSION", `Release ${candidate.tag} requires installed NOVA ${manifest.minimumStartingVersion} or newer.`);
  }
  if (relation === 0 && currentCommit && currentCommit.toLowerCase() !== commit) {
    return releaseError("RELEASE_VERSION_REUSED", `Installed version ${current.text} points to a different commit than the published stable release.`);
  }
  if (relation === 0 && !currentCommit && !allowSameVersionWithoutLocalCommit) {
    return releaseError("INVALID_CURRENT_VERSION", "Installed Git commit is required to verify that the current release is up to date.");
  }

  const release: StableRelease = {
    tag: candidate.tag,
    version: candidate.version,
    commit,
    publishedAt: candidate.publishedAt,
    releaseUrl: candidate.releaseUrl,
    notes: candidate.notes,
    manifest,
  };
  return relation === 0
    ? { status: "up-to-date", currentVersion: current.text, release }
    : { status: "update-available", currentVersion: current.text, release };
}

function validateCurrent(options: DiscoverReleaseOptions): ParsedVersion {
  const current = parseVersion(options.currentVersion);
  if (!current) return releaseError("INVALID_CURRENT_VERSION", "Installed NOVA version must use MAJOR.MINOR.PATCH stable semver.");
  if (options.currentCommit !== undefined && !isObjectId(options.currentCommit)) {
    return releaseError("INVALID_CURRENT_VERSION", "Installed NOVA commit must be a full Git object ID.");
  }
  return current;
}

/**
 * Discover only a published, stable GitHub release from the fixed canonical
 * repository. No branch head, fork, latest commit, or prerelease fallback exists.
 */
export async function discoverLatestStableRelease(options: DiscoverReleaseOptions): Promise<ReleaseCheck> {
  const current = validateCurrent(options);
  const fetcher = options.fetcher ?? fetch;
  const candidates = await listStableCandidates(fetcher);
  if (candidates.length === 0) {
    return releaseError("NO_STABLE_RELEASE", "NOVA has no published stable release yet; the updater will not substitute a moving branch.");
  }
  return inspectReleaseCandidate(candidates.at(-1)!, current, options.currentCommit, fetcher);
}

/** Resolve one explicitly requested stable release tag without consulting `latest`. */
export async function discoverStableReleaseByTag(options: DiscoverTaggedReleaseOptions): Promise<ReleaseCheck> {
  const current = validateCurrent(options);
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(options.tag)) {
    return releaseError("INVALID_RELEASE_METADATA", "Requested release must use the stable vMAJOR.MINOR.PATCH tag format.");
  }
  const fetcher = options.fetcher ?? fetch;
  const raw = await fetchJson(fetcher, `${API_BASE}/releases/tags/${encodeURIComponent(options.tag)}`);
  const candidate = parseCandidate(raw);
  if (!candidate || candidate.tag !== options.tag) {
    return releaseError("INVALID_RELEASE_METADATA", `Requested tag ${options.tag} is not a published stable NOVA release.`);
  }
  return inspectReleaseCandidate(candidate, current, options.currentCommit, fetcher);
}

/**
 * Validate the canonical stable source release matching the installed version.
 * A customer fork's HEAD is expected to differ from upstream, so baseline
 * verification checks the published tag, package version, and manifest rather
 * than equating the customer's commit with NOVA's upstream commit.
 */
export async function discoverStableBaselineRelease(options: DiscoverBaselineReleaseOptions): Promise<StableRelease> {
  const current = parseVersion(options.version);
  const tagMatch = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(options.tag);
  if (!current || !tagMatch || `${tagMatch[1]}.${tagMatch[2]}.${tagMatch[3]}` !== current.text) {
    return releaseError("BASELINE_RELEASE_MISMATCH", "Installed package version does not match its stable NOVA baseline tag.");
  }
  const fetcher = options.fetcher ?? fetch;
  const raw = await fetchJson(fetcher, `${API_BASE}/releases/tags/${encodeURIComponent(options.tag)}`);
  const candidate = parseCandidate(raw);
  if (!candidate || candidate.tag !== options.tag || candidate.version !== current.text) {
    return releaseError("BASELINE_RELEASE_MISMATCH", `Installed version ${current.text} has no matching published stable NOVA baseline.`);
  }
  const result = await inspectReleaseCandidate(candidate, current, undefined, fetcher, true);
  return result.release;
}

/** Reconfirm a previously reviewed release immediately before mutating state. */
export async function verifyPinnedReleaseStillCurrent(
  release: StableRelease,
  fetcher: ReleaseFetcher = fetch,
): Promise<void> {
  const raw = await fetchJson(fetcher, `${API_BASE}/releases/tags/${encodeURIComponent(release.tag)}`);
  const candidate = parseCandidate(raw);
  if (!candidate || candidate.tag !== release.tag || candidate.version !== release.version) {
    return releaseError("RELEASE_NO_LONGER_STABLE", `Pinned NOVA release ${release.tag} is no longer a published stable release.`);
  }
  const commit = await resolveTagCommit(fetcher, release.tag);
  if (commit !== release.commit.toLowerCase()) {
    return releaseError("RELEASE_COMMIT_CHANGED", `Pinned NOVA release ${release.tag} now resolves to a different commit; prepare a new update plan.`);
  }
}
