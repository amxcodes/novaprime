import { expect, test } from "bun:test";
import {
  formatDockerComposeStatus,
  parseDeploymentManagerArguments,
  runDeploymentManager,
} from "./deployment-manager.ts";

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
  });
  expect(code).toBe(0);
  expect(output.join("\n")).not.toContain(password);
  expect(output.join("\n")).not.toContain(token);
  expect(output.join("\n")).toContain('"configured": true');
  expect(output.join("\n")).toContain('"schedulerHint": "supabase"');
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
