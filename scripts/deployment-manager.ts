import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { LocalDeploymentInventory, RuntimeAdapter, SchedulerAdapter } from "./deployment/inventory.ts";
import { deploymentProviderCredentialKeys, inspectLocalDeployment } from "./deployment/inventory.ts";
import { buildDeploymentPreview, type DatabaseChange } from "./deployment/plan.ts";
import {
  environmentForDeploymentConfig,
  readDeploymentEnvironmentFile,
} from "./deployment/config.ts";
import { runDeploymentDoctor } from "./deployment-doctor.ts";
import { discoverProviderResources } from "./deployment/providers.ts";
import { loadDeploymentPlan, saveDeploymentPlan } from "./deployment/state.ts";
import { verifyDeploymentPlanSnapshot } from "./deployment/verification.ts";
import { promptSecret } from "./update/terminal.ts";

const repoRoot = resolve(import.meta.dir, "..");
const preflightPath = resolve(repoRoot, "scripts/deployment-preflight.ts");

type Command = "status" | "doctor" | "plan" | "show" | "verify" | "apply" | "help";
interface Options {
  command: Command;
  environmentFile?: string;
  apiOrigin?: string;
  runtime?: RuntimeAdapter;
  database: DatabaseChange;
  scheduler: SchedulerAdapter | "keep";
  planId?: string;
  remote: boolean;
  json: boolean;
  confirmSchedulerScope: boolean;
}

const runtimes = new Set<RuntimeAdapter>(["netlify", "cloudflare", "vps"]);
const schedulers = new Set<SchedulerAdapter | "keep">(["cloudflare", "netlify", "vercel", "supabase", "vps", "keep"]);
const databaseChanges = new Set<DatabaseChange>(["keep", "provision-supabase", "move"]);

async function promptRemoteCredentials(
  environment: Record<string, string>,
  databaseProjectRef: string | undefined,
  prompt: typeof promptSecret,
  interactive: boolean,
): Promise<void> {
  if (!interactive) return;
  const supabaseProjectRef = databaseProjectRef ?? environment.NOVA_SUPABASE_PROJECT_REF;
  const targets: Partial<Record<(typeof deploymentProviderCredentialKeys)[number], string>> = {
    ...(environment.NETLIFY_SITE_ID ? { NETLIFY_AUTH_TOKEN: "Netlify site " + environment.NETLIFY_SITE_ID } : {}),
    ...(environment.CLOUDFLARE_ACCOUNT_ID && environment.CLOUDFLARE_WORKER_NAME
      ? { CLOUDFLARE_API_TOKEN: "Cloudflare Worker " + environment.CLOUDFLARE_WORKER_NAME }
      : {}),
    ...(environment.VERCEL_PROJECT_ID ? { VERCEL_TOKEN: "Vercel project " + environment.VERCEL_PROJECT_ID } : {}),
    ...(supabaseProjectRef ? { SUPABASE_ACCESS_TOKEN: "Supabase project " + supabaseProjectRef } : {}),
  };
  for (const key of deploymentProviderCredentialKeys) {
    const target = targets[key];
    if (target && !environment[key]?.trim()) {
      const entered = await prompt(`${target} management token (press Enter to skip)`);
      if (/[\r\n\0]/.test(entered) || entered.length > 8_192) {
        throw new Error("DEPLOYMENT_REMOTE_CREDENTIAL_INVALID:" + key);
      }
      const value = entered.trim();
      if (value) environment[key] = value;
    }
  }
}

function inventoryWithCredentialPresence(
  inventory: LocalDeploymentInventory,
  environment: Readonly<Record<string, string>>,
): LocalDeploymentInventory {
  return {
    ...inventory,
    providerCredentialPresence: Object.fromEntries(
      deploymentProviderCredentialKeys.map((key) => [key, Boolean(environment[key])]),
    ),
  };
}

async function remoteInventory(
  options: Options,
  environment: Record<string, string>,
  inventory: LocalDeploymentInventory,
  dependencies: {
    promptSecret?: typeof promptSecret;
    interactive?: boolean;
    discoverProviders?: typeof discoverProviderResources;
  },
  probePublicReadiness = false,
): Promise<Awaited<ReturnType<typeof discoverProviderResources>> | undefined> {
  if (!options.remote) return undefined;
  await promptRemoteCredentials(
    environment,
    inventory.database.projectRef,
    dependencies.promptSecret ?? promptSecret,
    Boolean(!options.json && (dependencies.interactive ?? (process.stdin.isTTY && process.stdout.isTTY))),
  );
  return await (dependencies.discoverProviders ?? discoverProviderResources)(
    environment,
    fetch,
    probePublicReadiness ? { probePublicReadiness: true } : {},
  );
}

export function formatDockerComposeStatus(
  inventory: Awaited<ReturnType<typeof inspectLocalDeployment>>["dockerCompose"],
): string {
  if (!inventory) {
    return "Docker Compose services: not queried; no VPS runtime or scheduler hint is set in the selected environment. Use --env-file to select the deployment configuration.";
  }
  if (inventory.state === "unavailable") {
    return "Docker Compose services: unavailable (" + (inventory.detail ?? "DOCKER_COMPOSE_UNAVAILABLE") + "); no raw command output or environment values were exposed.";
  }
  const services = inventory.services;
  return "Docker Compose services (read-only): " + (services.length
    ? services.map(({ service, state, health, exitCode }) =>
      `${service}=${state}${health ? `/${health}` : ""}${exitCode === null ? "" : ` (exit code ${exitCode})`}`,
    ).join(", ")
    : "no NOVA services observed in this Compose project");
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error("DEPLOYMENT_OPTION_VALUE_REQUIRED:" + option);
  return value;
}

export function parseDeploymentManagerArguments(args: readonly string[]): Options {
  const command = args[0] === "--help" || args[0] === "-h" ? "help" : args[0] ?? "help";
  if (command !== "status" && command !== "doctor" && command !== "plan" && command !== "show" && command !== "verify" && command !== "apply" && command !== "help") {
    throw new Error("DEPLOYMENT_COMMAND_NOT_AVAILABLE:" + command);
  }
  if (command === "help" && args.length > 1) throw new Error("DEPLOYMENT_HELP_CANNOT_BE_COMBINED");
  const options: Options = { command, database: "keep", scheduler: "keep", remote: false, json: false, confirmSchedulerScope: false };
  if (command === "show" || command === "apply") {
    if (args.length !== 2 || !/^plan-[0-9a-f-]{36}$/i.test(args[1]!)) throw new Error("DEPLOYMENT_PLAN_ID_REQUIRED");
    options.planId = args[1];
    return options;
  }
  let firstOption = 1;
  if (command === "verify") {
    if (args.length < 2 || !/^plan-[0-9a-f-]{36}$/i.test(args[1]!)) throw new Error("DEPLOYMENT_PLAN_ID_REQUIRED");
    options.planId = args[1];
    firstOption = 2;
  }
  const seen = new Set<string>();
  for (let index = firstOption; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      if (args.length !== 2) throw new Error("DEPLOYMENT_HELP_CANNOT_BE_COMBINED");
      return { ...options, command: "help" };
    }
    if (argument === "--json") {
      if (seen.has(argument)) throw new Error("DEPLOYMENT_OPTION_DUPLICATE:" + argument);
      seen.add(argument);
      options.json = true;
      continue;
    }
    if (argument === "--remote") {
      if (seen.has(argument)) throw new Error("DEPLOYMENT_OPTION_DUPLICATE:" + argument);
      seen.add(argument);
      options.remote = true;
      continue;
    }
    if (argument === "--confirm-scheduler-scope") {
      if (seen.has(argument)) throw new Error("DEPLOYMENT_OPTION_DUPLICATE:" + argument);
      seen.add(argument);
      options.confirmSchedulerScope = true;
      continue;
    }
    if (argument === "--env-file" || argument === "--api-origin" ||
        argument === "--runtime" || argument === "--database" || argument === "--scheduler") {
      if (seen.has(argument)) throw new Error("DEPLOYMENT_OPTION_DUPLICATE:" + argument);
      seen.add(argument);
      const value = requiredValue(args, index, argument);
      index += 1;
      if (argument === "--env-file") options.environmentFile = value;
      else if (argument === "--api-origin") options.apiOrigin = value;
      else if (argument === "--runtime") {
        if (!runtimes.has(value as RuntimeAdapter)) throw new Error("DEPLOYMENT_RUNTIME_UNSUPPORTED");
        options.runtime = value as RuntimeAdapter;
      } else if (argument === "--database") {
        if (!databaseChanges.has(value as DatabaseChange)) throw new Error("DEPLOYMENT_DATABASE_ACTION_UNSUPPORTED");
        options.database = value as DatabaseChange;
      } else {
        if (!schedulers.has(value as SchedulerAdapter | "keep")) throw new Error("DEPLOYMENT_SCHEDULER_UNSUPPORTED");
        options.scheduler = value as SchedulerAdapter | "keep";
      }
      continue;
    }
    throw new Error("DEPLOYMENT_OPTION_UNSUPPORTED:" + argument);
  }
  if (options.command === "plan" && !options.runtime) throw new Error("DEPLOYMENT_PLAN_RUNTIME_REQUIRED");
  if (options.confirmSchedulerScope && (options.command !== "plan" || !options.remote)) {
    throw new Error("DEPLOYMENT_SCHEDULER_SCOPE_CONFIRMATION_REQUIRES_REMOTE_PLAN");
  }
  if (options.command !== "plan" && (options.runtime || seen.has("--database") || seen.has("--scheduler"))) {
    throw new Error("DEPLOYMENT_PLAN_OPTIONS_REQUIRE_PLAN_COMMAND");
  }
  if (options.command !== "doctor" && options.apiOrigin) throw new Error("DEPLOYMENT_API_ORIGIN_REQUIRES_DOCTOR");
  if (options.command !== "status" && options.command !== "verify" && options.json) throw new Error("DEPLOYMENT_JSON_OPTION_REQUIRES_STATUS");
  if (options.command !== "status" && options.command !== "plan" && options.command !== "verify" && options.remote) throw new Error("DEPLOYMENT_REMOTE_OPTION_NOT_SUPPORTED_FOR_COMMAND");
  return options;
}

async function loadSelectedEnvironment(
  options: Options,
  base: NodeJS.ProcessEnv,
): Promise<{ values: Record<string, string>; label: string; isolated: boolean; path?: string }> {
  if (options.environmentFile) {
    const file = await readDeploymentEnvironmentFile(repoRoot, options.environmentFile);
    return { values: file.values, label: "explicit --env-file", isolated: true, path: file.path };
  }
  const values = Object.fromEntries(
    Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { values, label: "current process environment only; .env was not auto-loaded", isolated: false };
}

function reportStatus(
  inventory: Awaited<ReturnType<typeof inspectLocalDeployment>>,
  json: boolean,
  write: (value: string) => void,
  remote?: Awaited<ReturnType<typeof discoverProviderResources>>,
): void {
  if (json) {
    write(JSON.stringify({ local: inventory, ...(remote ? { providers: remote } : {}) }, null, 2));
    return;
  }
  write("NOVA Deployment Manager — read-only local inventory");
  write("Environment: " + inventory.environmentSource);
  write("Source: " + (inventory.source.branch ?? "detached HEAD") + " @ " +
    inventory.source.commit.slice(0, 12) + " (" + (inventory.source.clean ? "clean" : inventory.source.dirtyPathCount + " changed path(s)") + ")");
  write("Version: " + (inventory.source.packageVersion ?? "unknown"));
  write("Runtime hint: " + (inventory.runtimeHint ?? "unknown; live provider inventory is not connected yet"));
  write("Database: " + (inventory.database.endpointLabel ?? (inventory.database.configured ? "configured but not safely identifiable" : "not configured in selected environment")));
  write("Scheduler hint: " + (inventory.schedulerHint ?? "unknown; all active providers must be inventoried"));
  write(formatDockerComposeStatus(inventory.dockerCompose));
  write("Runtime secrets (presence only): " + Object.entries(inventory.secretPresence)
    .map(([key, present]) => key + "=" + (present ? "set" : "missing")).join(", "));
  write("Provider credentials (presence only): " + Object.entries(inventory.providerCredentialPresence)
    .map(([key, present]) => key + "=" + (present ? "set" : "missing")).join(", "));
  if (!remote) write("Remote provider state: not requested; no provider account was contacted.");
  else {
    write("Remote provider inventory (read-only):");
    for (const provider of remote) {
      const scheduler = provider.schedulerInventory
        ? `Cron inventory ${provider.schedulerInventory.state}/${provider.schedulerInventory.completeness} (${provider.schedulerInventory.triggers.length} observed)`
        : undefined;
      const migrations = provider.migrationInventory
        ? `Migrations ${provider.migrationInventory.state} (${provider.migrationInventory.appliedCount ?? "?"} applied; head ${provider.migrationInventory.migrationHead ?? "none"}; expected ${provider.migrationInventory.expectedHead ?? "unknown"})`
        : undefined;
      const runtimeBindings = provider.runtimeBindings
        ? `Runtime bindings ${provider.runtimeBindings.state}/${provider.runtimeBindings.completeness} (${provider.runtimeBindings.bindings.length} names${provider.runtimeBindings.configuredScheduler ? `; selector ${provider.runtimeBindings.configuredScheduler}` : ""}${provider.runtimeBindings.hyperdrive ? `; Hyperdrive ${provider.runtimeBindings.hyperdrive.configurationId} targets ${provider.runtimeBindings.hyperdrive.databaseTarget}, app role ${provider.runtimeBindings.hyperdrive.runtimeRole}` : ""})`
        : undefined;
      const domains = provider.domainRoutes
        ? `Custom domains ${provider.domainRoutes.state}/${provider.domainRoutes.completeness} (${provider.domainRoutes.domains.map(({ hostname }) => hostname).join(", ") || "none observed"})`
        : undefined;
      const cloudflareRouting = provider.domainRoutes?.cloudflareRouting
        ? `Cloudflare route/DNS inventory ${provider.domainRoutes.cloudflareRouting.state}/${provider.domainRoutes.cloudflareRouting.completeness} (${provider.domainRoutes.cloudflareRouting.zones.length} selected zone(s); ${provider.domainRoutes.cloudflareRouting.zones.reduce((count, zone) => count + zone.routes.length, 0)} routes; ${provider.domainRoutes.cloudflareRouting.zones.reduce((count, zone) => count + zone.dnsRecords.length, 0)} exact-host records)`
        : undefined;
      const summary = [provider.provider, provider.state, provider.target, provider.revision ? `revision ${provider.revision}` : undefined,
        provider.runtimeId ? `runtime ${provider.runtimeId}` : undefined,
        provider.release ? `release ${provider.release.slice(0, 12)}` : undefined, provider.configuredScheduler
        ? `configured scheduler ${provider.configuredScheduler}` : undefined, scheduler, provider.schedulerInventory?.detail,
        runtimeBindings, provider.runtimeBindings?.detail, domains, provider.domainRoutes?.detail, cloudflareRouting,
        provider.domainRoutes?.cloudflareRouting?.detail,
        migrations, provider.migrationInventory?.detail,
        provider.publicReadiness ? `public readiness ${provider.publicReadiness}` : undefined,
        provider.detail]
        .filter(Boolean).join(" — ");
      write("  " + summary);
    }
  }
}

function runPreflight(environment: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, ["--no-env-file", preflightPath], {
      cwd: repoRoot,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ code: 1, stdout, stderr: "PREFLIGHT_TIMEOUT" });
    }, 60_000);
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 256_000) {
        child.kill();
        finish({ code: 1, stdout: "", stderr: "PREFLIGHT_OUTPUT_LIMIT" });
      }
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 256_000) {
        child.kill();
        finish({ code: 1, stdout: "", stderr: "PREFLIGHT_OUTPUT_LIMIT" });
      }
    });
    child.on("error", () => finish({ code: 1, stdout: "", stderr: "PREFLIGHT_START_FAILED" }));
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

export async function runDeploymentManager(
  args: readonly string[] = process.argv.slice(2),
  dependencies: {
    environment?: NodeJS.ProcessEnv;
    write?: (value: string) => void;
    runDoctor?: typeof runDeploymentDoctor;
    inspectDeployment?: typeof inspectLocalDeployment;
    promptSecret?: typeof promptSecret;
    interactive?: boolean;
    discoverProviders?: typeof discoverProviderResources;
  } = {},
): Promise<number> {
  const write = dependencies.write ?? console.info;
  try {
    const options = parseDeploymentManagerArguments(args);
    if (options.command === "help") {
      write([
        "NOVA Deployment Manager — local deployment inventory and planning",
        "  bun run nova:deployment status [--env-file <path>] [--remote] [--json]",
        "  bun run nova:deployment doctor [--env-file <path>] [--api-origin https://nova.example]",
        "  bun run nova:deployment plan --runtime <netlify|cloudflare|vps> [--database <keep|provision-supabase|move>] [--scheduler <keep|provider>] [--env-file <path>] [--remote] [--confirm-scheduler-scope]",
        "  bun run nova:deployment show <plan-id>",
        "  bun run nova:deployment verify <plan-id> [--env-file <path>] [--remote] [--json]",
        "  bun run nova:deployment apply <plan-id>  (not enabled; provider writes are not implemented)",
        "",
        "Remote inventory is read-only and requires explicit target IDs in the selected environment. --confirm-scheduler-scope attests that these are the complete NOVA runtime/scheduler resources for this database; unselected systems are not searched. No deploy, DNS, scheduler, or database-move write is enabled.",
        "Interactive remote commands request missing target tokens with masked input and keep them in memory only; JSON and non-interactive commands never prompt.",
      ].join("\n"));
      return 0;
    }

    const baseEnvironment = dependencies.environment ?? process.env;
    const selected = await loadSelectedEnvironment(options, baseEnvironment);
    const inspectDeployment = dependencies.inspectDeployment ?? inspectLocalDeployment;
    const inspectionOptions = { environmentFilePath: selected.path };
    if (options.command === "status") {
      let inventory = await inspectDeployment(repoRoot, selected.values, selected.label, inspectionOptions);
      const remote = await remoteInventory(options, selected.values, inventory, dependencies);
      if (options.remote) inventory = inventoryWithCredentialPresence(inventory, selected.values);
      reportStatus(inventory, options.json, write, remote);
      return 0;
    }

    if (options.command === "doctor") {
      const childEnvironment = selected.isolated
        ? environmentForDeploymentConfig(baseEnvironment, selected.values)
        : Object.fromEntries(Object.entries(baseEnvironment).filter((entry): entry is [string, string] => entry[1] !== undefined));
      const doctorArgs = options.apiOrigin ? ["--api-origin", options.apiOrigin] : [];
      return await (dependencies.runDoctor ?? runDeploymentDoctor)(doctorArgs, {
        runPreflight: () => runPreflight(childEnvironment),
        write,
      });
    }

    if (options.command === "show") {
      const plan = await loadDeploymentPlan(repoRoot, options.planId!, { allowExpired: true });
      write(JSON.stringify(plan, null, 2));
      return 0;
    }

    if (options.command === "verify") {
      const plan = await loadDeploymentPlan(repoRoot, options.planId!);
      const inventory = await inspectDeployment(repoRoot, selected.values, selected.label, inspectionOptions);
      const remote = await remoteInventory(options, selected.values, inventory, dependencies, true);
      const verification = verifyDeploymentPlanSnapshot(plan, inventory, remote);
      const result = {
        planId: plan.id,
        ...verification,
        applyEnabled: false,
        providerWritesPerformed: false,
      };
      write(JSON.stringify(result, null, 2));
      return verification.valid ? 0 : 2;
    }

    if (options.command === "apply") {
      const plan = await loadDeploymentPlan(repoRoot, options.planId!);
      write(JSON.stringify({
        planId: plan.id,
        status: "not-executable",
        reason: "DEPLOYMENT_PROVIDER_WRITE_ADAPTERS_NOT_IMPLEMENTED",
        message: "The saved plan is intact. No provider or customer resource was changed.",
      }, null, 2));
      return 2;
    }

    const inventory = await inspectDeployment(repoRoot, selected.values, selected.label, inspectionOptions);
    const providerInventory = await remoteInventory(options, selected.values, inventory, dependencies, true);
    const preview = buildDeploymentPreview(inventory, {
      runtime: options.runtime!,
      database: options.database,
      scheduler: options.scheduler,
    }, providerInventory, options.confirmSchedulerScope);
    const stored = await saveDeploymentPlan(repoRoot, preview);
    write(JSON.stringify(stored, null, 2));
    write("Saved immutable, private plan; " + (options.remote
      ? "only explicitly targeted read-only provider inventory was requested"
      : "no provider was contacted") + (options.confirmSchedulerScope
        ? "; operator-confirmed scheduler footprint recorded"
        : "; scheduler footprint is unconfirmed") + "; no provider resource was changed. Review with `bun run nova:deployment show " + stored.id + "`. Apply remains disabled until provider write adapters and live transition verification are implemented.");
    return preview.blockers.length > 0 || preview.actions.some(({ execution }) => execution !== "locally-verified") ? 2 : 0;
  } catch (error) {
    const message = error instanceof Error && error.message === "UPDATE_CANCELLED"
      ? "DEPLOYMENT_REMOTE_CREDENTIAL_CANCELLED"
      : error instanceof Error && error.message === "UPDATE_HIDDEN_SECRET_INPUT_UNAVAILABLE"
        ? "DEPLOYMENT_REMOTE_CREDENTIAL_INPUT_UNAVAILABLE"
        : error instanceof Error && /^DEPLOYMENT_[A-Z0-9_:-]+$/.test(error.message)
          ? error.message
          : "DEPLOYMENT_MANAGER_FAILED: check command arguments and the local deployment runbook.";
    write(message);
    return 1;
  }
}

if (import.meta.main) {
  runDeploymentManager().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
