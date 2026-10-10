import { expect, test } from "bun:test";
import type { ProviderFetcher } from "../deployment/providers/types.ts";
import { normalizeHostedDeploymentOrigin, waitForHostedCommit } from "./host-verification.ts";

const expectedCommit = "a".repeat(40);
const oldCommit = "b".repeat(40);
const expectedDatabaseFingerprint = "c".repeat(64);

function identityResponse(
  releaseSha: string | undefined,
  databaseFingerprint = expectedDatabaseFingerprint,
  schemaReady = true,
  migrationLedgerPresent = true,
): Response {
  return Response.json({
    service: "nova-api",
    status: "identified",
    runtime: { adapter: "netlify", id: "deploy-123", ...(releaseSha ? { releaseSha } : {}) },
    database: { fingerprint: databaseFingerprint, schemaReady, migrationLedgerPresent },
    scheduler: "supabase",
  });
}

function readinessResponse(status = 200): Response {
  return Response.json({ service: "nova-api", status: status === 200 ? "ready" : "not_ready" }, { status });
}

test("host verification accepts only an exact HTTPS origin", () => {
  expect(normalizeHostedDeploymentOrigin("https://nova.example/")).toBe("https://nova.example");
  for (const value of [
    "http://nova.example",
    "https://nova.example/path",
    "https://user:secret@nova.example",
    "https://nova.example?next=other",
    "not an origin",
  ]) expect(normalizeHostedDeploymentOrigin(value)).toBeUndefined();
});

test("polls the protected deployment identity until the exact pushed commit is live", async () => {
  let identityCalls = 0;
  let readinessCalls = 0;
  const waits: number[] = [];
  const fetcher: ProviderFetcher = async (input, init) => {
    expect(new URL(String(input)).origin).toBe("https://nova.example");
    expect(init?.redirect).toBe("error");
    if (new URL(String(input)).pathname === "/api/ready") {
      readinessCalls += 1;
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      return readinessResponse();
    }
    identityCalls += 1;
    expect(new URL(String(input)).pathname).toBe("/api/internal/deployment/identity");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer background-secret");
    return identityResponse(identityCalls === 1 ? oldCommit : expectedCommit);
  };
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher,
    wait: async (milliseconds) => { waits.push(milliseconds); },
    intervalMs: 100,
    maxChecks: 3,
  });
  expect(result).toEqual({
    status: "verified", checks: 2, release: expectedCommit, runtime: "netlify", origin: "https://nova.example",
  });
  expect(identityCalls).toBe(2);
  expect(readinessCalls).toBe(1);
  expect(waits).toEqual([100]);
});

test("does not claim verification from an abbreviated runtime SHA", async () => {
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher: async () => identityResponse(expectedCommit.slice(0, 12)),
    maxChecks: 3,
  });
  expect(result).toMatchObject({ status: "unverifiable", checks: 1, detail: "RUNTIME_RELEASE_COMMIT_NOT_FULL_SHA" });
});

test("leaves a deployment pending when the host still serves an older full commit", async () => {
  let calls = 0;
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher: async (input) => {
      expect(new URL(String(input)).pathname).toBe("/api/internal/deployment/identity");
      calls += 1;
      return identityResponse(oldCommit);
    },
    wait: async () => {},
    maxChecks: 3,
  });
  expect(result).toMatchObject({ status: "pending", checks: 3, observedRelease: oldCommit, origin: "https://nova.example" });
  expect(calls).toBe(3);
});

test("requires the public API to become ready after the exact commit is deployed", async () => {
  let identityCalls = 0;
  let readinessCalls = 0;
  const waits: number[] = [];
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/ready") {
        readinessCalls += 1;
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        if (readinessCalls === 1) return readinessResponse(502);
        return readinessCalls === 2 ? readinessResponse(503) : readinessResponse();
      }
      identityCalls += 1;
      return identityResponse(expectedCommit);
    },
    wait: async (milliseconds) => { waits.push(milliseconds); },
    intervalMs: 100,
    maxChecks: 3,
  });
  expect(result).toMatchObject({ status: "verified", checks: 3, release: expectedCommit, origin: "https://nova.example" });
  expect(identityCalls).toBe(3);
  expect(readinessCalls).toBe(3);
  expect(waits).toEqual([100, 100]);
});

test("does not mark an exact deployment ready when the public readiness response is invalid", async () => {
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher: async (input) => new URL(String(input)).pathname === "/api/ready"
      ? Response.json({ service: "another-app", status: "ready" })
      : identityResponse(expectedCommit),
  });
  expect(result).toMatchObject({
    status: "unverifiable", checks: 1, detail: "PUBLIC_READINESS_RESPONSE_INVALID", origin: "https://nova.example",
  });
});

test("reports readiness as pending when the exact deployed commit never becomes ready", async () => {
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher: async (input) => new URL(String(input)).pathname === "/api/ready"
      ? readinessResponse(503)
      : identityResponse(expectedCommit),
    wait: async () => {},
    maxChecks: 2,
  });
  expect(result).toMatchObject({
    status: "pending", checks: 2, observedRelease: expectedCommit, detail: "PUBLIC_API_NOT_READY", origin: "https://nova.example",
  });
});

test("stops on an invalid identity credential without repeated requests", async () => {
  let calls = 0;
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "bad-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher: async () => { calls += 1; return Response.json({ error: "unauthorized" }, { status: 401 }); },
    maxChecks: 5,
  });
  expect(result).toMatchObject({ status: "unverifiable", checks: 1, detail: "CREDENTIAL_REJECTED" });
  expect(calls).toBe(1);
});

test("refuses to verify a commit when the hosted runtime serves a different database", async () => {
  let readinessCalls = 0;
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher: async (input) => {
      if (new URL(String(input)).pathname === "/api/ready") {
        readinessCalls += 1;
        return readinessResponse();
      }
      return identityResponse(expectedCommit, "d".repeat(64));
    },
  });
  expect(result).toMatchObject({
    status: "unverifiable", checks: 1, detail: "RUNTIME_DATABASE_TARGET_MISMATCH", origin: "https://nova.example",
  });
  expect(readinessCalls).toBe(0);
});

test("waits for database schema and migration-ledger readiness before verifying", async () => {
  let identityCalls = 0;
  let readinessCalls = 0;
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher: async (input) => {
      if (new URL(String(input)).pathname === "/api/ready") {
        readinessCalls += 1;
        return readinessResponse();
      }
      identityCalls += 1;
      return identityResponse(expectedCommit, expectedDatabaseFingerprint, identityCalls > 1, true);
    },
    wait: async () => {},
    maxChecks: 2,
  });
  expect(result).toMatchObject({ status: "verified", checks: 2 });
  expect(identityCalls).toBe(2);
  expect(readinessCalls).toBe(1);
});

test("rejects an invalid origin or abbreviated expected commit before making a request", async () => {
  let calls = 0;
  const fetcher: ProviderFetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  await expect(waitForHostedCommit({
    origin: "http://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint,
    fetcher,
  })).rejects.toThrow("UPDATE_HOST_ORIGIN_INVALID");
  await expect(waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit: expectedCommit.slice(0, 12),
    expectedDatabaseFingerprint,
    fetcher,
  })).rejects.toThrow("UPDATE_HOST_COMMIT_INVALID");
  await expect(waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    expectedDatabaseFingerprint: "invalid",
    fetcher,
  })).rejects.toThrow("UPDATE_HOST_DATABASE_FINGERPRINT_INVALID");
  expect(calls).toBe(0);
});
