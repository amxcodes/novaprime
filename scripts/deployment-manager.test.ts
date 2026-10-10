import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  formatDockerComposeStatus,
  parseDeploymentManagerArguments,
  runDeploymentManager,
} from "./deployment-manager.ts";
import type { LocalDeploymentInventory } from "./deployment/inventory.ts";

function deploymentInventory(overrides: Partial<LocalDeploymentInventory> = {}): LocalDeploymentInventory {
  return {
    environmentSource: "test",
    source: { branch: "main", commit: "a".repeat(40), clean: true, dirtyPathCount: 0, packageVersion: "1.0.0" },
    runtimeHint: null,
    database: { configured: false, providerHint: "unknown" },
    schedulerHint: null,
    secretPresence: {},
    providerCredentialPresence: {},
    ...overrides,
  };
}

test("command parsing requires a target runtime and keeps apply as an explicit unavailable boundary", () => {
  expect(parseDeploymentManagerArguments(["--help"]).command).toBe("help");
  expect(() => parseDeploymentManagerArguments(["plan"])).toThrow("DEPLOYMENT_PLAN_RUNTIME_REQUIRED");
  expect(parseDeploymentManagerArguments(["apply", "plan-123e4567-e89b-42d3-a456-426614174000"]))
    .toMatchObject({ command: "apply", planId: "plan-123e4567-e89b-42d3-a456-426614174000" });
  expect(() => parseDeploymentManagerArguments(["apply", "preview-123"])).toThrow("DEPLOYMENT_PLAN_ID_REQUIRED");
  expect(() => parseDeploymentManagerArguments(["show", "plan-123e4567-e89b-42d3-a456-426614174000", "--json"]))
    .toThrow("DEPLOYMENT_PLAN_ID_REQUIRED");
  expect(parseDeploymentManagerArguments(["plan", "--runtime", "cloudflare", "--scheduler", "supabase"]))
    .toMatchObject({ command: "plan", runtime: "cloudflare", scheduler: "supabase", database: "keep" });
  expect(() => parseDeploymentManagerArguments(["plan", "--runtime", "vercel"]))
    .toThrow("DEPLOYMENT_RUNTIME_UNSUPPORTED");
  expect(parseDeploymentManagerArguments([
    "plan", "--runtime", "cloudflare", "--remote", "--confirm-scheduler-scope",
  ])).toMatchObject({ command: "plan", runtime: "cloudflare", remote: true, confirmSchedulerScope: true });
  expect(() => parseDeploymentManagerArguments([
    "plan", "--runtime", "cloudflare", "--confirm-scheduler-scope",
  ])).toThrow("DEPLOYMENT_SCHEDULER_SCOPE_CONFIRMATION_REQUIRES_REMOTE_PLAN");
  expect(() => parseDeploymentManagerArguments(["status", "--confirm-scheduler-scope"]))
    .toThrow("DEPLOYMENT_SCHEDULER_SCOPE_CONFIRMATION_REQUIRES_REMOTE_PLAN");
  expect(parseDeploymentManagerArguments(["status", "--remote", "--json"]))
    .toMatchObject({ command: "status", remote: true, json: true });
  expect(parseDeploymentManagerArguments([
    "verify", "plan-123e4567-e89b-42d3-a456-426614174000", "--env-file", ".env.qa", "--remote", "--json",
  ])).toMatchObject({
    command: "verify", planId: "plan-123e4567-e89b-42d3-a456-426614174000",
    environmentFile: ".env.qa", remote: true, json: true,
  });
  expect(() => parseDeploymentManagerArguments([
    "verify", "plan-123e4567-e89b-42d3-a456-426614174000", "--runtime", "cloudflare",
  ])).toThrow("DEPLOYMENT_PLAN_OPTIONS_REQUIRE_PLAN_COMMAND");
  expect(() => parseDeploymentManagerArguments(["plan", "--runtime", "netlify", "--runtime", "cloudflare"]))
    .toThrow("DEPLOYMENT_OPTION_DUPLICATE:--runtime");
});

test("new deployment plans expose only the three curated runtime profiles", () => {
  for (const runtime of ["netlify", "cloudflare", "vps"] as const) {
    expect(parseDeploymentManagerArguments(["plan", "--runtime", runtime]).runtime).toBe(runtime);
  }
  expect(parseDeploymentManagerArguments(["help"])).toMatchObject({ command: "help" });
});

test("status only prints credential presence and never values", async () => {
  const output: string[] = [];
  const password = "local-test-db-password-must-not-appear";
  const token = "provider-token-must-not-appear";
  const code = await runDeploymentManager(["status", "--json"], {
    environment: {
      DATABASE_URL: "postgresql://nova_app:" + password + "@127.0.0.1:5432/nova",
      CLOUDFLARE_API_TOKEN: token,
      NOVA_BACKGROUND_SCHEDULER: "supabase",
    },
    write: (line) => output.push(line),
    inspectDeployment: async () => deploymentInventory({
      database: { configured: true, providerHint: "postgresql" },
      schedulerHint: "supabase",
    }),
  });
  expect(code).toBe(0);
  expect(output.join("\n")).not.toContain(password);
  expect(output.join("\n")).not.toContain(token);
  expect(output.join("\n")).toContain('"configured": true');
  expect(output.join("\n")).toContain('"schedulerHint": "supabase"');
});

test("status passes the selected env file to local deployment inspection", async () => {
  const output: string[] = [];
  let selectedEnvironmentFile: string | undefined;
  const code = await runDeploymentManager(["status", "--env-file", ".env.example", "--json"], {
    environment: {},
    write: (line) => output.push(line),
    inspectDeployment: async (_root, _environment, _source, options) => {
      selectedEnvironmentFile = options.environmentFilePath;
      return {
        environmentSource: "explicit --env-file",
        source: { branch: "main", commit: "a".repeat(40), clean: true, dirtyPathCount: 0, packageVersion: "1.0.0" },
        runtimeHint: null,
        database: { configured: false, providerHint: "unknown" },
        schedulerHint: "vps",
        dockerCompose: { state: "verified", services: [] },
        secretPresence: {},
        providerCredentialPresence: {},
      } satisfies LocalDeploymentInventory;
    },
  });
  expect(code).toBe(0);
  expect(selectedEnvironmentFile).toBe(resolve(import.meta.dir, "..", ".env.example"));
});

test("remote status prompts only for configured targets and keeps entered tokens in memory", async () => {
  const output: string[] = [];
  const prompts: string[] = [];
  const callerEnvironment: NodeJS.ProcessEnv = {
    NETLIFY_SITE_ID: "site-123",
    CLOUDFLARE_ACCOUNT_ID: "cf-account",
    CLOUDFLARE_WORKER_NAME: "nova-api",
    CLOUDFLARE_API_TOKEN: "existing-cf-token",
    VERCEL_PROJECT_ID: "vercel-project",
    NOVA_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  };
  let discovered: Record<string, string> | undefined;
  const code = await runDeploymentManager(["status", "--remote"], {
    environment: callerEnvironment,
    write: (line) => output.push(line),
    interactive: true,
    promptSecret: async (label) => {
      prompts.push(label);
      return "  entered-token-" + prompts.length + "  ";
    },
    inspectDeployment: async () => deploymentInventory(),
    discoverProviders: async (environment) => {
      discovered = { ...environment };
      return [];
    },
  });

  expect(code).toBe(0);
  expect(prompts).toEqual([
    "Netlify site site-123 management token (press Enter to skip)",
    "Vercel project vercel-project management token (press Enter to skip)",
    "Supabase project abcdefghijklmnopqrst management token (press Enter to skip)",
  ]);
  expect(discovered).toMatchObject({
    NETLIFY_AUTH_TOKEN: "entered-token-1",
    CLOUDFLARE_API_TOKEN: "existing-cf-token",
    VERCEL_TOKEN: "entered-token-2",
    SUPABASE_ACCESS_TOKEN: "entered-token-3",
  });
  expect(callerEnvironment).not.toHaveProperty("NETLIFY_AUTH_TOKEN");
  expect(callerEnvironment).not.toHaveProperty("VERCEL_TOKEN");
  expect(callerEnvironment).not.toHaveProperty("SUPABASE_ACCESS_TOKEN");
  expect(output.join("\n")).not.toContain("entered-token-");
  expect(output.join("\n")).toContain("NETLIFY_AUTH_TOKEN=set");
});

test("JSON and noninteractive remote status never prompt for provider credentials", async () => {
  for (const options of [
    { args: ["status", "--remote", "--json"], interactive: true },
    { args: ["status", "--remote"], interactive: false },
  ] as const) {
    const prompts: string[] = [];
    const code = await runDeploymentManager(options.args, {
      environment: { NETLIFY_SITE_ID: "site-123" },
      write: () => {},
      interactive: options.interactive,
      promptSecret: async (label) => { prompts.push(label); return "unused"; },
      inspectDeployment: async () => deploymentInventory(),
      discoverProviders: async () => [],
    });
    expect(code).toBe(0);
    expect(prompts).toEqual([]);
  }
});

test("remote status rejects malformed entered credentials without echoing them", async () => {
  const output: string[] = [];
  const code = await runDeploymentManager(["status", "--remote"], {
    environment: { NETLIFY_SITE_ID: "site-123" },
    write: (line) => output.push(line),
    interactive: true,
    promptSecret: async () => "sensitive\ntoken",
    inspectDeployment: async () => deploymentInventory(),
    discoverProviders: async () => [],
  });
  expect(code).toBe(1);
  expect(output.join("\n")).toContain("DEPLOYMENT_REMOTE_CREDENTIAL_INVALID:NETLIFY_AUTH_TOKEN");
  expect(output.join("\n")).not.toContain("sensitive");
});

test("remote status treats whitespace-only credentials as missing and reports masked-prompt cancellation", async () => {
  const output: string[] = [];
  const prompts: string[] = [];
  const code = await runDeploymentManager(["status", "--remote"], {
    environment: { NETLIFY_SITE_ID: "site-123", NETLIFY_AUTH_TOKEN: "   " },
    write: (line) => output.push(line),
    interactive: true,
    promptSecret: async (label) => {
      prompts.push(label);
      throw new Error("UPDATE_CANCELLED");
    },
    inspectDeployment: async () => deploymentInventory(),
    discoverProviders: async () => [],
  });
  expect(code).toBe(1);
  expect(prompts).toEqual(["Netlify site site-123 management token (press Enter to skip)"]);
  expect(output).toEqual(["DEPLOYMENT_REMOTE_CREDENTIAL_CANCELLED"]);
});

test("human-readable local Compose status explains unknown scope and includes safe exit codes", () => {
  expect(formatDockerComposeStatus(undefined)).toContain("no VPS runtime or scheduler hint is set");
  expect(formatDockerComposeStatus({
    state: "verified",
    services: [
      { service: "api", state: "exited", health: null, exitCode: 1 },
      { service: "postgres", state: "running", health: "healthy", exitCode: null },
    ],
  })).toBe("Docker Compose services (read-only): api=exited (exit code 1), postgres=running/healthy");
  expect(formatDockerComposeStatus({
    state: "unavailable",
    services: [],
    detail: "DOCKER_CLI_NOT_FOUND",
  })).toContain("unavailable (DOCKER_CLI_NOT_FOUND)");
});
