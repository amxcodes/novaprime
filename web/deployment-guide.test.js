import { describe, expect, test } from "bun:test";
import { deploymentGuide, deploymentSchedulerActions } from "./deployment-guide.js";
import { DEPLOYMENT_PATHS, DEPLOYMENT_SCHEDULERS } from "./src/features/public/deployment/catalog.ts";
import { createVercelConfig } from "./vercel-config.ts";
import netlifySelection from "../netlify/plugins/nova-functions/selection.cjs";

const { selectFunctionsDirectory } = netlifySelection;

describe("curated NOVA deployment profiles", () => {
  test("the customer assistant presents only the three supported deployment profiles", () => {
    expect(DEPLOYMENT_PATHS.map(({ id }) => id)).toEqual([
      "netlify-supabase",
      "cloudflare-supabase",
      "vps-postgres",
    ]);
    expect(Object.values(DEPLOYMENT_SCHEDULERS)).toEqual(["supabase", "supabase", "vps"]);
    expect(deploymentGuide("vercel-supabase")).toBeNull();
    expect(deploymentGuide("local-docker")).toBeNull();
  });

  test("both hosted profiles explain their database binding and keep owner credentials off runtime", () => {
    const cloudflare = deploymentGuide("cloudflare-supabase")?.host;
    const netlify = deploymentGuide("netlify-supabase")?.host;

    expect(cloudflare?.connect).toContain("GitHub");
    expect(cloudflare?.runtimeSetup.join(" ")).toContain("HYPERDRIVE");
    expect(cloudflare?.runtimeSetup.join(" ")).toContain("MIGRATOR_DATABASE_URL");
    expect(cloudflare?.database).toContain("Direct connection");
    expect(cloudflare?.database).toContain("restricted nova_app");
    expect(netlify?.runtimeSetup.join(" ")).toContain("DATABASE_URL");
    expect(netlify?.runtimeSetup.join(" ")).toContain("non-secret");
    expect(netlify?.database).toContain("transaction-pooler DATABASE_URL");
    expect(netlify?.database).toContain("does not deploy the Netlify app");
  });

  test("hosted profiles use Supabase Cron and wait for readiness before activation", () => {
    for (const pathId of ["cloudflare-supabase", "netlify-supabase"]) {
      const plan = deploymentGuide(pathId, "supabase")?.scheduler;
      expect(plan?.actions.filter(({ phase }) => phase === "prepare").length).toBeGreaterThanOrEqual(1);
      expect(plan?.actions.filter(({ phase }) => phase === "activate")).toHaveLength(1);
      expect(plan?.actions.find(({ phase }) => phase === "activate")?.change).toContain("Only after `/api/ready` passes");
      expect(plan?.verify).toContain("cron.job_run_details");
      expect(plan?.verify).toContain("net._http_response");
    }

    expect(deploymentSchedulerActions("cloudflare-supabase", "supabase", 0, false)
      .some(({ change }) => change.includes("bun run supabase:scheduler"))).toBe(false);
    expect(deploymentSchedulerActions("cloudflare-supabase", "supabase", 4, false)).toHaveLength(0);
    expect(deploymentSchedulerActions("cloudflare-supabase", "supabase", 4, true)
      .some(({ change }) => change.includes("bun run supabase:scheduler"))).toBe(true);
    expect(deploymentGuide("cloudflare-supabase", "cloudflare")).toBeNull();
    expect(deploymentGuide("netlify-supabase", "netlify")).toBeNull();
  });

  test("self-hosted profile includes PostgreSQL, private secrets, Nginx, and one local worker", () => {
    const guide = deploymentGuide("vps-postgres")?.host;
    const runtime = guide?.runtimeSetup.join(" ") ?? "";

    expect(guide?.title).toBe("Self-hosted Docker + PostgreSQL");
    expect(guide?.files).toContain("docker/nginx/default.conf");
    expect(guide?.database).toContain("PostgreSQL 17");
    expect(runtime).toContain("loopback");
    expect(runtime).toContain("TLS-terminating Nginx");
    expect(deploymentGuide("vps-postgres", "vps")?.scheduler?.verify).toContain("exactly one maintenance service");
    expect(deploymentGuide("vps-postgres", "supabase")).toBeNull();
  });

  test("existing Netlify and Vercel runtime adapters remain testable without being offered as new profiles", () => {
    expect(createVercelConfig("vercel").crons).toEqual([{
      path: "/api/internal/background/tick",
      schedule: "*/5 * * * *",
    }]);
    expect(createVercelConfig("supabase").crons).toEqual([]);
    expect(selectFunctionsDirectory({ scheduler: "netlify", context: "production" }))
      .toBe("netlify/entrypoints/with-netlify-cron");
    expect(selectFunctionsDirectory({ scheduler: "supabase", context: "production" }))
      .toBe("netlify/entrypoints/without-native-cron");
    expect(selectFunctionsDirectory({ scheduler: "netlify", context: "deploy-preview" }))
      .toBe("netlify/entrypoints/without-native-cron");
    expect(() => selectFunctionsDirectory({ scheduler: undefined, context: "production" }))
      .toThrow("Set NOVA_BACKGROUND_SCHEDULER");
  });
});
