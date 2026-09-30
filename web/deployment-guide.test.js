import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { deploymentGuide, deploymentSchedulerActions } from "./deployment-guide.js";
import { createVercelConfig } from "./vercel-config.ts";
import novaNetlifyPlugin from "../netlify/plugins/nova-functions/index.js";
import netlifySelection from "../netlify/plugins/nova-functions/selection.cjs";

const { selectFunctionsDirectory } = netlifySelection;

describe("deployment guide provider handoff", () => {
  test("every supported hosting shape explains GitHub, secrets, database, domain and auth/email setup", () => {
    for (const path of [
      "cloudflare-supabase",
      "netlify-supabase",
      "vercel-supabase",
      "vps-postgres",
      "local-docker",
    ]) {
      const guide = deploymentGuide(path);
      expect(guide?.host.connect).toBeTruthy();
      expect(guide?.host.publish).toBeTruthy();
      expect(guide?.host.runtimeSetup?.length).toBeGreaterThan(0);
      expect(guide?.host.database).toBeTruthy();
      expect(guide?.host.domain).toBeTruthy();
      expect(guide?.host.postSetup).toContain("Better Auth");
      if (path.endsWith("-supabase")) {
        expect(guide?.host.database).toContain("requires you to type it to confirm");
      }
    }
  });

  test("shows runtime configuration in the correct host and keeps migration credentials off it", () => {
    const cloudflare = deploymentGuide("cloudflare-supabase")?.host.runtimeSetup?.join(" ") ?? "";
    const netlify = deploymentGuide("netlify-supabase")?.host.runtimeSetup?.join(" ") ?? "";
    const vercel = deploymentGuide("vercel-supabase")?.host.runtimeSetup?.join(" ") ?? "";

    expect(cloudflare).toContain("HYPERDRIVE");
    expect(cloudflare).toContain("NOVA_SECRETS_ENCRYPTION_KEY");
    expect(cloudflare).toContain("HYPERDRIVE binding, not DATABASE_URL");
    expect(netlify).toContain("DATABASE_URL");
    expect(netlify).toContain("NOVA_BACKGROUND_SCHEDULER");
    expect(netlify).toContain("regular, non-secret variable");
    expect(netlify).toContain("Builds and Functions");
    expect(netlify).toContain("delete it and recreate it as a regular variable");
    expect(netlify).toContain("NOVA_APPLICATION_DATABASE_ROLE");
    expect(netlify).toContain("MIGRATOR_DATABASE_URL");
    expect(vercel).toContain("Only when Vercel Cron is selected");
    expect(vercel).toContain("Never add SUPABASE_ACCESS_TOKEN");
  });

  test("hosted runtime templates distinguish credentials from plain configuration", () => {
    for (const path of ["cloudflare-supabase", "netlify-supabase", "vercel-supabase"]) {
      const instructions = deploymentGuide(path)?.host.runtimeSetup?.join(" ") ?? "";
      expect(instructions).toContain("BETTER_AUTH_SECRET");
      expect(instructions).toContain("BETTER_AUTH_URL");
      expect(instructions).toContain("non-secret");
      expect(instructions).toContain("SUPABASE_ACCESS_TOKEN");
      expect(instructions).toContain("MIGRATOR_DATABASE_URL");
    }
  });

  test("separates Supabase database bootstrap from hosted API deployment", () => {
    for (const path of ["cloudflare-supabase", "netlify-supabase", "vercel-supabase"]) {
      const database = deploymentGuide(path)?.host.database ?? "";
      expect(database).toContain("does not deploy or start the hosted API");
      expect(database).toContain("private local .env");
      expect(database).not.toContain("Copy only the runtime values into");
    }
    expect(deploymentGuide("local-docker")?.host.database).toContain("starts the API");
  });

  test("distinguishes Cloudflare Hyperdrive's direct connection from Node-host pooler URLs", () => {
    const cloudflareDatabase = deploymentGuide("cloudflare-supabase")?.host.database ?? "";
    const nodeDatabase = deploymentGuide("netlify-supabase")?.host.database ?? "";
    expect(cloudflareDatabase).toContain("Supabase Connect → Direct connection");
    expect(cloudflareDatabase).toContain("do not use the transaction-pooler DATABASE_URL");
    expect(cloudflareDatabase).toContain("nova_app");
    expect(cloudflareDatabase).toContain("origin connection limit within the Supabase project's connection budget");
    expect(nodeDatabase).toContain("transaction-pooler DATABASE_URL");
  });

  test("scheduler choices map to concrete provider files/actions and verification steps", () => {
    const combinations = [
      ["cloudflare-supabase", "cloudflare", "wrangler.toml"],
      ["cloudflare-supabase", "supabase", "wrangler.supabase-cron.toml"],
      ["netlify-supabase", "netlify", "entrypoints/with-netlify-cron/nova-background-tick.mts"],
      ["netlify-supabase", "supabase", "API-only function directory"],
      ["vercel-supabase", "vercel", "vercel.ts"],
      ["vercel-supabase", "supabase", "vercel.ts"],
      ["vps-postgres", "vps", "compose.yaml"],
      ["local-docker", "vps", "compose.yaml"],
    ];
    for (const [path, scheduler, fileOrAction] of combinations) {
      const plan = deploymentGuide(path, scheduler);
      const sourceAndActions = [
        plan?.scheduler?.file,
        ...(plan?.scheduler?.actions ?? []).flatMap((action) => [action.where, action.change, action.result]),
      ].join(" ");
      expect(sourceAndActions).toContain(fileOrAction);
      expect(plan?.scheduler?.actions.length).toBeGreaterThan(0);
      expect(plan?.scheduler?.verify).toBeTruthy();
      for (const action of plan?.scheduler?.actions ?? []) {
        expect(action.where).toBeTruthy();
        expect(action.change).toBeTruthy();
        expect(action.result).toBeTruthy();
      }
    }
  });

  test("scheduler choice distinguishes the browser checklist from provider changes", () => {
    const cloudflare = deploymentGuide("cloudflare-supabase", "cloudflare")?.scheduler;
    const supabase = deploymentGuide("netlify-supabase", "supabase")?.scheduler;
    const vercel = deploymentGuide("vercel-supabase", "vercel")?.scheduler;

    expect(cloudflare?.actions.map((action) => action.change).join(" ")).toContain("wrangler@4.141.0 deploy --config cloudflare/wrangler.toml");
    expect(supabase?.actions.map((action) => action.change).join(" ")).toContain("bun run supabase:scheduler");
    expect(supabase?.actions.map((action) => action.change).join(" ")).toContain("before the first production deploy");
    expect(supabase?.actions.map((action) => action.change).join(" ")).toContain("hidden input");
    expect(supabase?.actions.map((action) => action.change).join(" ")).toContain("requires you to type it exactly before any write");
    expect(supabase?.actions.map((action) => action.change).join(" ")).not.toContain("Remove the");
    expect(supabase?.verify).toContain("net._http_response");
    expect(supabase?.verify).toContain("timed_out=false");
    expect(supabase?.verify).toContain("only means pg_net queued");
    expect(vercel?.actions.map((action) => action.change).join(" ")).toContain("CRON_SECRET");
    expect(vercel?.verify).toContain("Cron Jobs");
  });

  test("keeps scheduler configuration before deploy and Supabase job creation after readiness", () => {
    for (const [path, scheduler] of [
      ["cloudflare-supabase", "cloudflare"],
      ["netlify-supabase", "netlify"],
      ["vercel-supabase", "vercel"],
      ["vps-postgres", "vps"],
    ]) {
      expect(deploymentGuide(path, scheduler)?.scheduler?.actions.every((action) => action.phase === "prepare")).toBe(true);
    }

    for (const path of ["cloudflare-supabase", "netlify-supabase", "vercel-supabase"]) {
      const actions = deploymentGuide(path, "supabase")?.scheduler?.actions ?? [];
      expect(actions.filter((action) => action.phase === "prepare")).toHaveLength(2);
      expect(actions.filter((action) => action.phase === "activate")).toHaveLength(1);
      expect(actions.find((action) => action.phase === "activate")?.change).toContain("Only after the deployed API passes `/api/ready`");
      expect(actions.find((action) => action.phase === "activate")?.change).toContain("bun run supabase:scheduler");
    }

    const beforeDeploy = deploymentSchedulerActions("cloudflare-supabase", "supabase", 0, false);
    const beforeReady = deploymentSchedulerActions("cloudflare-supabase", "supabase", 4, false);
    const afterReady = deploymentSchedulerActions("cloudflare-supabase", "supabase", 4, true);
    expect(beforeDeploy.some((action) => action.change.includes("bun run supabase:scheduler"))).toBe(false);
    expect(beforeReady).toHaveLength(0);
    expect(afterReady).toHaveLength(1);
    expect(afterReady[0]?.change).toContain("bun run supabase:scheduler");
    expect(deploymentSchedulerActions("cloudflare-supabase", "cloudflare", 4, true)).toHaveLength(0);
    expect(deploymentSchedulerActions("cloudflare-supabase", "supabase", 2, true)).toHaveLength(0);
  });

  test("identifies the account or computer where every scheduler choice is actually applied", () => {
    expect(deploymentGuide("cloudflare-supabase", "cloudflare")?.scheduler?.actions[0]?.where).toContain("Cloudflare");
    expect(deploymentGuide("netlify-supabase", "netlify")?.scheduler?.actions[0]?.where).toContain("Netlify");
    expect(deploymentGuide("vercel-supabase", "vercel")?.scheduler?.actions[1]?.where).toContain("Vercel");
    expect(deploymentGuide("cloudflare-supabase", "supabase")?.scheduler?.actions[2]?.where).toContain("Trusted operator computer");
    expect(deploymentGuide("vps-postgres", "vps")?.scheduler?.actions[0]?.where).toContain("VPS/local machine");
  });

  test("refuses impossible host/scheduler combinations and warns about Vercel Hobby cadence", () => {
    expect(deploymentGuide("vps-postgres", "supabase")).toBeNull();
    expect(deploymentGuide("vercel-supabase", "vercel")?.scheduler?.warning).toContain("once-daily");
    expect(deploymentGuide("cloudflare-supabase", "cloudflare")?.scheduler?.warning).toContain("remote Hyperdrive binding");
  });

  test("Vercel deploy config registers only the selected native scheduler", () => {
    expect(createVercelConfig("vercel").crons).toEqual([{
      path: "/api/internal/background/tick",
      schedule: "*/5 * * * *",
    }]);
    expect(createVercelConfig("supabase").crons).toEqual([]);
    expect(createVercelConfig(undefined).crons).toEqual([]);
    expect(createVercelConfig("supabase").rewrites).toContainEqual({
      source: "/api/:path*",
      destination: "/api/[...path]",
    });
  });

  test("Netlify build selection deploys exactly the selected production scheduler", async () => {
    expect(selectFunctionsDirectory({ scheduler: "netlify", context: "production" })).toBe("netlify/entrypoints/with-netlify-cron");
    expect(selectFunctionsDirectory({ scheduler: "supabase", context: "production" })).toBe("netlify/entrypoints/without-native-cron");
    expect(selectFunctionsDirectory({ scheduler: "netlify", context: "deploy-preview" })).toBe("netlify/entrypoints/without-native-cron");
    expect(selectFunctionsDirectory({ scheduler: undefined, context: "branch-deploy" })).toBe("netlify/entrypoints/without-native-cron");
    expect(() => selectFunctionsDirectory({ scheduler: undefined, context: "production" })).toThrow("Set NOVA_BACKGROUND_SCHEDULER");
    expect(() => selectFunctionsDirectory({ scheduler: "cloudflare", context: "production" })).toThrow("must be `netlify` or `supabase`");
    expect(existsSync(new URL("../netlify/entrypoints/with-netlify-cron/nova-background-tick.mts", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../netlify/entrypoints/without-native-cron/nova-background-tick.mts", import.meta.url))).toBe(false);
    const netlifyCronEntrypoint = await import("../netlify/entrypoints/with-netlify-cron/nova-background-tick.mts");
    expect(netlifyCronEntrypoint.config).toEqual({ schedule: "*/5 * * * *" });

    const previousScheduler = process.env.NOVA_BACKGROUND_SCHEDULER;
    const previousContext = process.env.CONTEXT;
    try {
      process.env.NOVA_BACKGROUND_SCHEDULER = "supabase";
      process.env.CONTEXT = "production";
      const netlifyConfig = { functions: { directory: "netlify/functions" } };
      let status = "";
      novaNetlifyPlugin.onBuild({
        netlifyConfig,
        utils: {
          build: { failBuild(message) { throw new Error(message); } },
          status: { show(message) { status = message.summary; } },
        },
      });
      expect(netlifyConfig.functions.directory).toBe("netlify/entrypoints/without-native-cron");
      expect(status).toContain("non-production builds never register a scheduled function");
    } finally {
      if (previousScheduler === undefined) delete process.env.NOVA_BACKGROUND_SCHEDULER;
      else process.env.NOVA_BACKGROUND_SCHEDULER = previousScheduler;
      if (previousContext === undefined) delete process.env.CONTEXT;
      else process.env.CONTEXT = previousContext;
    }
  });
});
