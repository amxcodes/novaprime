import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { dockerComposeStatusArgs, inspectDockerCompose, parseDockerComposePsOutput } from "./docker-inventory.ts";
import { inspectLocalDeployment } from "./inventory.ts";

test("parses only allowlisted Compose service status and drops container metadata", () => {
  const rows = [
    { ID: "private-container-id", Name: "nova-api-1", Service: "api", State: "running", Health: "healthy", ExitCode: 0, Publishers: [{ PublishedPort: 3001 }], Secret: "must-not-escape" },
    { Name: "nova-nginx-1", Service: "nginx", State: "running", Health: "", ExitCode: 0 },
    { Name: "customer-extra-1", Service: "customer-extra", State: "running", Health: "healthy", ExitCode: 0 },
  ];
  const status = parseDockerComposePsOutput(rows.map((row) => JSON.stringify(row)).join("\n"));
  expect(status).toEqual([
    { service: "api", state: "running", health: "healthy", exitCode: 0 },
    { service: "nginx", state: "running", health: null, exitCode: 0 },
  ]);
  expect(JSON.stringify(status)).not.toContain("private-container-id");
  expect(JSON.stringify(status)).not.toContain("must-not-escape");
});

test("accepts Compose's JSON array and empty-project output", () => {
  expect(parseDockerComposePsOutput(JSON.stringify([
    { service: "maintenance", state: "exited", exitCode: 1 },
  ]))).toEqual([{ service: "maintenance", state: "exited", health: null, exitCode: 1 }]);
  expect(parseDockerComposePsOutput("\r\n")).toEqual([]);
});

test("reports only sanitized Docker errors and never returns raw command output", async () => {
  const missingCli = await inspectDockerCompose("C:/nova", {
    run: async () => {
      throw Object.assign(new Error("docker failed with secret=hidden"), { code: "ENOENT" });
    },
  });
  expect(missingCli).toEqual({ state: "unavailable", services: [], detail: "DOCKER_CLI_NOT_FOUND" });

  const malformed = await inspectDockerCompose("C:/nova", { run: async () => "not-json" });
  expect(malformed).toEqual({ state: "unavailable", services: [], detail: "DOCKER_COMPOSE_OUTPUT_INVALID" });
  expect(JSON.stringify(malformed)).not.toContain("not-json");
});

test("explicit environment file is used for Compose status inspection", async () => {
  const repoRoot = resolve(import.meta.dir, "../..");
  const environmentFilePath = resolve(repoRoot, ".env.example");
  let selectedEnvironmentFile: string | undefined;
  const inspect = async (_root: string, path?: string) => {
    selectedEnvironmentFile = path;
    return JSON.stringify([{ service: "api", state: "running", health: "healthy", exitCode: 0 }]);
  };

  const inventory = await inspectDockerCompose(repoRoot, { environmentFilePath, run: inspect });
  expect(inventory.state).toBe("verified");
  expect(selectedEnvironmentFile).toBe(environmentFilePath);
  const args = dockerComposeStatusArgs(repoRoot, environmentFilePath);
  expect(args.slice(-6)).toEqual([
    "--env-file", environmentFilePath, "ps", "--all", "--format", "json",
  ]);
});

test("local deployment inventory inspects Compose only for a VPS runtime or scheduler", async () => {
  const repoRoot = resolve(import.meta.dir, "../..");
  let calls = 0;
  const inspect = async () => {
    calls += 1;
    return { state: "verified" as const, services: [{ service: "api", state: "running", health: "healthy", exitCode: 0 }] };
  };
  const vps = await inspectLocalDeployment(repoRoot, { NOVA_BACKGROUND_SCHEDULER: "vps" }, "test", { composeInspector: inspect });
  expect(vps.dockerCompose).toMatchObject({ state: "verified", services: [{ service: "api", state: "running" }] });
  const cloud = await inspectLocalDeployment(repoRoot, { NOVA_BACKGROUND_SCHEDULER: "supabase" }, "test", { composeInspector: inspect });
  expect(cloud.dockerCompose).toBeUndefined();
  expect(calls).toBe(1);
});

test("local deployment passes the selected environment file through to Compose", async () => {
  const repoRoot = resolve(import.meta.dir, "../..");
  const environmentFilePath = resolve(repoRoot, ".env.example");
  let selectedEnvironmentFile: string | undefined;
  const composeInspector = async (_root: string, options?: { environmentFilePath?: string }) => {
    selectedEnvironmentFile = options?.environmentFilePath;
    return { state: "verified" as const, services: [] };
  };
  const inventory = await inspectLocalDeployment(
    repoRoot,
    { NOVA_BACKGROUND_SCHEDULER: "vps" },
    "explicit --env-file",
    { environmentFilePath, composeInspector },
  );
  expect(inventory.dockerCompose?.state).toBe("verified");
  expect(selectedEnvironmentFile).toBe(environmentFilePath);
});
