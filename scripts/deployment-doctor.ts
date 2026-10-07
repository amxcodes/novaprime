import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readExistingUpdateJournal, type UpdateJournal } from "./update/state.ts";

type CommandResult = { code: number; stdout: string; stderr: string };
type CheckResult = { status: "pass" | "warning" | "fail"; detail: string; repair?: string };
type DoctorOptions = { apiOrigin?: string; help: boolean };
type DoctorDependencies = {
  runPreflight?: () => Promise<CommandResult>;
  readUpdateAttempt?: () => Promise<UpdateJournal | undefined>;
  fetch?: typeof fetch;
  write?: (line: string) => void;
};

const PREFLIGHT_TIMEOUT_MS = 60_000;
const API_TIMEOUT_MS = 10_000;

const repairGuidance: ReadonlyArray<{ code: string; repair: string }> = [
  { code: "DATABASE_URL_REQUIRED", repair: "Load the intended private environment file and set DATABASE_URL to its restricted nova_app connection." },
  { code: "SUPABASE_DATABASE_URL_PROJECT_MISMATCH", repair: "Confirm the intended project ref, then run bun run setup:supabase with that exact ref. Do not copy credentials from another project." },
  { code: "SUPABASE_DATABASE_URL_PROJECT_UNVERIFIABLE", repair: "Recreate DATABASE_URL from the selected project's Connect panel and rerun bun run setup:supabase." },
  { code: "APPLICATION_DATABASE_ROLE_MISMATCH", repair: "Set DATABASE_URL to the restricted nova_app role; never use postgres or service_role for API traffic." },
  { code: "APPLICATION_ROLE_PRIVILEGE_TOO_BROAD", repair: "Re-run the reviewed Supabase setup or direct-PostgreSQL role provisioning, then rerun the doctor." },
  { code: "APPLICATION_ROLE_OWNS_OR_CAN_ASSUME_NOVA_OBJECT_OWNER", repair: "Restore separate migration-owner and nova_app roles using the deployment runbook; do not grant owner membership to the runtime role." },
  { code: "APPLICATION_ROLE_HAS_PRIVILEGED_MEMBERSHIP", repair: "Remove privileged role membership from nova_app using the migration owner, then rerun the doctor." },
  { code: "NOVA_SCHEMA_NOT_READY", repair: "Use bun run nova:update for a supported stable upgrade, or the documented migration procedure for this deployment. Back up first." },
  { code: "NOVA_MIGRATION_LEDGER_NOT_CURRENT", repair: "Inspect the exact target and ledger, take a restorable backup, then run the pinned updater. Do not edit migration rows manually." },
  { code: "SUPABASE_MIGRATION_VERIFICATION_CONFIGURATION_REQUIRED", repair: "For Supabase, provide the exact project ref and a project-scoped token with migration-ledger read access, or provide the separate migration-owner connection." },
  { code: "SUPABASE_MIGRATION_LEDGER_READ_FAILED", repair: "Check the selected project ref, token project access, and Supabase Management API availability; no database change was made." },
  { code: "NOVA_SECRETS_ENCRYPTION_KEY_INVALID", repair: "Restore the original valid key from the deployment secret manager. Do not generate a replacement without a credential re-encryption plan." },
  { code: "NOVA_BACKGROUND_JOB_SECRET_REQUIRED", repair: "Set the same strong background secret on the NOVA runtime and the selected scheduler, then redeploy/restart." },
  { code: "NOVA_BACKGROUND_SCHEDULER_INVALID", repair: "Choose one supported scheduler, set NOVA_BACKGROUND_SCHEDULER on the runtime, disable other schedules, and redeploy." },
  { code: "28P01", repair: "The database rejected the nova_app password. Coordinate setup:supabase --rotate-app-role-password with updating the host DATABASE_URL and redeploying before reopening traffic." },
  { code: "ECONNREFUSED", repair: "Verify the selected database host, port, project status, and network access. Do not point the app at another project to bypass the failure." },
  { code: "ETIMEDOUT", repair: "Verify database availability and network access from this operator machine; retry only after confirming the target." },
];

export function parseDoctorArguments(args: readonly string[]): DoctorOptions {
  let apiOrigin: string | undefined;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--api-origin") {
      if (apiOrigin !== undefined) throw new Error("DOCTOR_OPTION_DUPLICATE:--api-origin");
      const value = args[index + 1];
      if (!value) throw new Error("DOCTOR_API_ORIGIN_REQUIRED");
      apiOrigin = normalizeApiOrigin(value);
      index += 1;
      continue;
    }
    throw new Error(`DOCTOR_OPTION_UNSUPPORTED:${argument}`);
  }
  return { apiOrigin, help };
}

export function normalizeApiOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DOCTOR_API_ORIGIN_INVALID");
  }
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(localHost && url.protocol === "http:")) ||
    url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("DOCTOR_API_ORIGIN_INVALID");
  }
  return url.origin;
}

export function diagnosePreflight(result: CommandResult): CheckResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    parsed = undefined;
  }
  if (typeof parsed === "object" && parsed !== null && "status" in parsed) {
    const value = parsed as Record<string, unknown>;
    if (value.status === "ready") {
      const migration = typeof value.latestMigration === "string" ? `; latest migration ${value.latestMigration}` : "";
      return { status: "pass", detail: `Database role and schema are ready${migration}.` };
    }
    if (value.status === "migration_verification_required") {
      return {
        status: "warning",
        detail: "Database role and required schema objects passed, but the migration ledger was not verified.",
        repair: "Provide MIGRATOR_DATABASE_URL or the selected Supabase project's migration-read token, then rerun the doctor.",
      };
    }
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const guidance = repairGuidance.find(({ code }) => output.includes(code));
  if (guidance) {
    return { status: "fail", detail: `Database preflight failed (${guidance.code}).`, repair: guidance.repair };
  }
  return {
    status: "fail",
    detail: "Database preflight failed; raw driver output was suppressed to protect credentials.",
    repair: "Review docs/deployment-operations.md and rerun bun run deployment:doctor. If the issue persists, share the safe error code from the operator logs, not connection strings or tokens.",
  };
}

export function diagnoseUpdateAttempt(journal?: UpdateJournal): CheckResult {
  if (!journal) return { status: "pass", detail: "No updater attempt is recorded for this checkout." };
  const release = journal.release.tag;
  if (journal.phase === "complete") {
    return { status: "pass", detail: `The recorded updater attempt ${release} is terminal; it will not resume.` };
  }
  if (!journal.database) {
    return {
      status: "warning",
      detail: `Updater candidate ${release} is pending before a database target or migration was recorded.`,
      repair: "Review the retained candidate, confirm the intended database, then use bun run nova:update --resume.",
    };
  }
  const migrations = journal.appliedMigrations.length;
  const inFlight = journal.inFlightMigration ? `; ${journal.inFlightMigration.filename} may be in flight` : "";
  return {
    status: "warning",
    detail: `Updater ${release} is pending in phase ${journal.phase}, pinned to ${journal.database.label}; ${migrations} migration(s) recorded${inFlight}.`,
    repair: `Resume with bun run nova:update --resume and select exactly ${journal.database.label} so the ledger can reconcile. If that target is unavailable, preserve the journal and candidate for operator recovery; do not switch targets or edit migration history.`,
  };
}

export async function probeApi(
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  for (const [path, expected] of [["/api/health", "live"], ["/api/ready", "ready"]] as const) {
    try {
      const response = await fetcher(new URL(path, origin), {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      checks.push(response.ok
        ? { status: "pass", detail: `${path} returned HTTP ${response.status} (${expected}).` }
        : {
            status: "fail",
            detail: `${path} returned HTTP ${response.status}.`,
            repair: path === "/api/ready"
              ? "Check the selected host's function logs and DATABASE_URL, then rerun the database preflight before reopening traffic."
              : "Check the selected host's deployment and function logs, then redeploy the verified source."
          });
    } catch (error) {
      const code = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
      checks.push({
        status: "fail",
        detail: `${path} ${code}.`,
        repair: "Check the public HTTPS origin, DNS, TLS, host deployment status, and provider logs. The doctor sends no authorization or database credentials to this endpoint.",
      });
    }
  }
  return checks;
}

function runPreflight(): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, ["--no-env-file", resolve(import.meta.dir, "deployment-preflight.ts")], {
      cwd: resolve(import.meta.dir, ".."),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ code: 1, stdout, stderr: "PREFLIGHT_TIMEOUT" });
    }, PREFLIGHT_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", () => finish({ code: 1, stdout, stderr: "PREFLIGHT_START_FAILED" }));
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

function writeResult(write: (line: string) => void, label: string, result: CheckResult): void {
  write(`${result.status.toUpperCase()}: ${label} — ${result.detail}`);
  if (result.repair) write(`  Next: ${result.repair}`);
}

export async function runDeploymentDoctor(
  args: readonly string[] = process.argv.slice(2),
  dependencies: DoctorDependencies = {},
): Promise<number> {
  const options = parseDoctorArguments(args);
  const write = dependencies.write ?? console.info;
  if (options.help) {
    write("NOVA deployment doctor (read-only)\n  bun run deployment:doctor [--api-origin https://your-nova-domain.example]");
    return 0;
  }
  write("NOVA deployment doctor — read-only checks; no database, host, or scheduler changes are made.");
  const database = diagnosePreflight(await (dependencies.runPreflight ?? runPreflight)());
  writeResult(write, "Local database, runtime role, schema and migration state", database);
  const results = [database];
  let updateAttempt: CheckResult;
  try {
    const journal = await (dependencies.readUpdateAttempt ?? (() => readExistingUpdateJournal(resolve(import.meta.dir, ".."))))();
    updateAttempt = diagnoseUpdateAttempt(journal);
  } catch {
    updateAttempt = {
      status: "fail",
      detail: "The local updater journal could not be validated; its contents were not displayed.",
      repair: "Preserve the updater state file and candidate worktree. Do not delete them or retry against a different database; follow the recovery section in docs/update-manager.md.",
    };
  }
  writeResult(write, "Interrupted source/database update", updateAttempt);
  results.push(updateAttempt);
  if (options.apiOrigin) {
    const apiChecks = await probeApi(options.apiOrigin, dependencies.fetch);
    for (const [index, result] of apiChecks.entries()) {
      writeResult(write, index === 0 ? "Deployed API liveness" : "Deployed API readiness", result);
      results.push(result);
    }
  } else {
    write("SKIPPED: Hosted API checks — pass --api-origin to probe /api/health and /api/ready without credentials.");
  }
  if (results.some(({ status }) => status === "fail")) return 1;
  if (results.some(({ status }) => status === "warning")) return 2;
  return 0;
}

if (import.meta.main) {
  runDeploymentDoctor().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error: unknown) => {
    const message = error instanceof Error && /^DOCTOR_[A-Z0-9_:-]+$/.test(error.message)
      ? error.message
      : "DOCTOR_FAILED: check the command arguments and deployment runbook; sensitive output was suppressed.";
    console.error(message);
    process.exitCode = 1;
  });
}
