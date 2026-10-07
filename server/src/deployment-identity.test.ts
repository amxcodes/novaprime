import { expect, test } from "bun:test";
import {
  createDeploymentIdentityHandler,
  databaseIdentityFingerprint,
} from "./deployment-identity";

const projectRef = "abcdefghijklmnopqrst";

test("database fingerprints are password-free and stable across password rotation", () => {
  const first = "postgresql://nova_app:first-password@db." + projectRef + ".supabase.co:5432/postgres?sslmode=require";
  const rotated = "postgresql://nova_app:rotated-password@db." + projectRef + ".supabase.co:5432/postgres?sslmode=require";
  const pooler = "postgresql://nova_app." + projectRef + ":pooler-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
  expect(databaseIdentityFingerprint(first)).toBe(databaseIdentityFingerprint(rotated));
  expect(databaseIdentityFingerprint(first)).toBe(databaseIdentityFingerprint(pooler));
  expect(databaseIdentityFingerprint(first)).not.toBe(databaseIdentityFingerprint(
    "postgresql://nova_app:pw@db.zbcdefghijklmnopqrst.supabase.co:5432/postgres",
  ));
  expect(databaseIdentityFingerprint(first, "zbcdefghijklmnopqrst")).toBeNull();
});

test("configured Supabase project ref cannot override an unidentifiable PostgreSQL endpoint", () => {
  const genericPostgres = "postgresql://nova_app:password@db.customer.example:5432/postgres";
  const supabase = "postgresql://nova_app:password@db." + projectRef + ".supabase.co:5432/postgres";
  expect(databaseIdentityFingerprint(genericPostgres, projectRef))
    .toBe(databaseIdentityFingerprint(genericPostgres));
  expect(databaseIdentityFingerprint(genericPostgres, projectRef))
    .not.toBe(databaseIdentityFingerprint(supabase, projectRef));
});

test("identity endpoint requires the deployment bearer secret and avoids migration-owner data", async () => {
  let reads = 0;
  const environment = {
    NOVA_BACKGROUND_JOB_SECRET: "deployment-only-test-secret",
    DATABASE_URL: "postgresql://nova_app:db-password@db." + projectRef + ".supabase.co:5432/postgres",
    NOVA_SUPABASE_PROJECT_REF: projectRef,
    NOVA_RUNTIME_ADAPTER: "cloudflare",
    NOVA_RUNTIME_ID: "worker-version-42",
    NOVA_RELEASE_SHA: "a".repeat(40),
    NOVA_BACKGROUND_SCHEDULER: "supabase",
  };
  const handler = createDeploymentIdentityHandler({
    environment,
    readDatabaseState: async () => {
      reads += 1;
      return { schemaReady: true, migrationLedgerPresent: true };
    },
    scheduler: () => "supabase",
  });

  const unauthorized = await handler(new Request("https://nova.example/api/internal/deployment/identity"));
  expect(unauthorized.status).toBe(401);
  expect(reads).toBe(0);

  const response = await handler(new Request("https://nova.example/api/internal/deployment/identity", {
    headers: { authorization: "Bearer deployment-only-test-secret" },
  }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    service: "nova-api",
    status: "identified",
    runtime: { adapter: "cloudflare", id: "worker-version-42", releaseSha: "a".repeat(40) },
    database: { schemaReady: true, migrationLedgerPresent: true },
    scheduler: "supabase",
  });
  expect(JSON.stringify(body)).not.toContain("db-password");
  expect(JSON.stringify(body)).not.toContain("deployment-only-test-secret");
  expect(JSON.stringify(body)).not.toContain("migrationHead");
  expect(JSON.stringify(body)).not.toContain(projectRef);
  expect(reads).toBe(1);
});

test("identity endpoint rejects a configured project ref that contradicts the actual DB endpoint", async () => {
  const handler = createDeploymentIdentityHandler({
    environment: {
      NOVA_BACKGROUND_JOB_SECRET: "deployment-only-test-secret",
      DATABASE_URL: "postgresql://nova_app:password@db." + projectRef + ".supabase.co:5432/postgres",
      NOVA_SUPABASE_PROJECT_REF: "zbcdefghijklmnopqrst",
    },
    readDatabaseState: async () => ({ schemaReady: true, migrationLedgerPresent: true }),
  });
  const response = await handler(new Request("https://nova.example/api/internal/deployment/identity", {
    headers: { authorization: "Bearer deployment-only-test-secret" },
  }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "DEPLOYMENT_IDENTITY_NOT_CONFIGURED" });
});
