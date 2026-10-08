import { expect, test } from "bun:test";
import type { ProviderFetcher } from "../deployment/providers/types.ts";
import { normalizeHostedDeploymentOrigin, waitForHostedCommit } from "./host-verification.ts";

const expectedCommit = "a".repeat(40);
const oldCommit = "b".repeat(40);

function identityResponse(releaseSha: string | undefined): Response {
  return Response.json({
    service: "nova-api",
    status: "identified",
    runtime: { adapter: "netlify", id: "deploy-123", ...(releaseSha ? { releaseSha } : {}) },
    database: { fingerprint: "c".repeat(64), schemaReady: true, migrationLedgerPresent: true },
    scheduler: "supabase",
  });
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
  let calls = 0;
  const waits: number[] = [];
  const fetcher: ProviderFetcher = async (input, init) => {
    calls += 1;
    expect(new URL(String(input)).origin).toBe("https://nova.example");
    expect(new URL(String(input)).pathname).toBe("/api/internal/deployment/identity");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer background-secret");
    expect(init?.redirect).toBe("error");
    return identityResponse(calls === 1 ? oldCommit : expectedCommit);
  };
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
    fetcher,
    wait: async (milliseconds) => { waits.push(milliseconds); },
    intervalMs: 100,
    maxChecks: 3,
  });
  expect(result).toEqual({
    status: "verified", checks: 2, release: expectedCommit, runtime: "netlify", origin: "https://nova.example",
  });
  expect(calls).toBe(2);
  expect(waits).toEqual([100]);
});

test("does not claim verification from an abbreviated runtime SHA", async () => {
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit,
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
    fetcher: async () => { calls += 1; return identityResponse(oldCommit); },
    wait: async () => {},
    maxChecks: 3,
  });
  expect(result).toMatchObject({ status: "pending", checks: 3, observedRelease: oldCommit, origin: "https://nova.example" });
  expect(calls).toBe(3);
});

test("stops on an invalid identity credential without repeated requests", async () => {
  let calls = 0;
  const result = await waitForHostedCommit({
    origin: "https://nova.example",
    secret: "bad-secret",
    expectedCommit,
    fetcher: async () => { calls += 1; return Response.json({ error: "unauthorized" }, { status: 401 }); },
    maxChecks: 5,
  });
  expect(result).toMatchObject({ status: "unverifiable", checks: 1, detail: "CREDENTIAL_REJECTED" });
  expect(calls).toBe(1);
});

test("rejects an invalid origin or abbreviated expected commit before making a request", async () => {
  let calls = 0;
  const fetcher: ProviderFetcher = async () => { calls += 1; throw new Error("must not fetch"); };
  await expect(waitForHostedCommit({
    origin: "http://nova.example",
    secret: "background-secret",
    expectedCommit,
    fetcher,
  })).rejects.toThrow("UPDATE_HOST_ORIGIN_INVALID");
  await expect(waitForHostedCommit({
    origin: "https://nova.example",
    secret: "background-secret",
    expectedCommit: expectedCommit.slice(0, 12),
    fetcher,
  })).rejects.toThrow("UPDATE_HOST_COMMIT_INVALID");
  expect(calls).toBe(0);
});
