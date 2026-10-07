import { expect, test } from "bun:test";
import { environmentForDeploymentConfig, parseDeploymentEnvironment } from "./config.ts";

test("parses NOVA env files without expansion and rejects duplicate deployment keys", () => {
  expect(parseDeploymentEnvironment([
    "# selected target",
    "DATABASE_URL=postgresql://role:password@host/postgres?sslmode=require",
    "NOVA_BACKGROUND_SCHEDULER='supabase'",
    "EMPTY=",
  ].join("\n"))).toEqual({
    DATABASE_URL: "postgresql://role:password@host/postgres?sslmode=require",
    NOVA_BACKGROUND_SCHEDULER: "supabase",
    EMPTY: "",
  });
  expect(() => parseDeploymentEnvironment("DATABASE_URL=first\nDATABASE_URL=second"))
    .toThrow("DEPLOYMENT_ENV_DUPLICATE_KEY:DATABASE_URL");
  expect(() => parseDeploymentEnvironment("NOT AN ENV LINE"))
    .toThrow("DEPLOYMENT_ENV_LINE_INVALID:1");
});

test("an explicitly selected target cannot inherit credentials for another target", () => {
  const output = environmentForDeploymentConfig({
    PATH: "path",
    DATABASE_URL: "postgresql://wrong-target",
    SUPABASE_ACCESS_TOKEN: "wrong-token",
    NOVA_BACKGROUND_JOB_SECRET: "wrong-tick-secret",
    BETTER_AUTH_SECRET: "wrong-auth-secret",
    NETLIFY_SITE_ID: "wrong-site",
    CLOUDFLARE_ACCOUNT_ID: "wrong-account",
    VERCEL_PROJECT_ID: "wrong-project",
    unrelated: "keep-runtime",
  }, {
    DATABASE_URL: "postgresql://selected-target",
    NOVA_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  });
  expect(output).toEqual({
    PATH: "path",
    unrelated: "keep-runtime",
    DATABASE_URL: "postgresql://selected-target",
    NOVA_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  });
  expect(JSON.stringify(output)).not.toContain("wrong-");
});
