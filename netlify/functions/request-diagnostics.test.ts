import { expect, test } from "bun:test";
import { slowRequestDiagnostic } from "./request-diagnostics";

const request = (overrides: Partial<Parameters<typeof slowRequestDiagnostic>[0]> = {}) => ({
  method: "GET",
  pathname: "/api/ready",
  status: 200,
  durationMs: 300,
  appMs: 100,
  entryModuleLoadMs: 0,
  ...overrides,
});

test("omits normal request diagnostics", () => {
  expect(slowRequestDiagnostic(request())).toBeNull();
});

test("reports slow route timing without IDs or query data", () => {
  const diagnostic = slowRequestDiagnostic(request({
    pathname: "/api/people/00000000-0000-4000-8000-000000000002/history?email=private@example.test",
    durationMs: 1_650,
    appMs: 1_200,
  }));

  expect(diagnostic).toEqual({
    event: "NOVA_REQUEST_DIAGNOSTIC",
    method: "GET",
    route: "api.people",
    status: 200,
    handler_ms: 1_650,
    app_ms: 1_200,
    entry_module_load_ms: 0,
  });
});

test("records auth and server failure classes", () => {
  expect(slowRequestDiagnostic(request({
    pathname: "/api/auth/get-session",
    durationMs: 500,
    appMs: 120,
    status: 503,
  }))).toMatchObject({ route: "auth.get-session", status: 503 });
  expect(slowRequestDiagnostic(request({
    pathname: "/api/unrecognized/secret",
    method: "BAD\nHEADER",
    durationMs: 1_500,
  }))).toMatchObject({ route: "api.other", method: "OTHER" });
  expect(slowRequestDiagnostic(request({
    durationMs: 400,
    appMs: 150,
    entryModuleLoadMs: 0,
    authModuleLoadMs: 1_250,
  }))).toMatchObject({ auth_module_load_ms: 1_250 });
});

test("records aggregate database time and counts without request data", () => {
  const diagnostic = slowRequestDiagnostic(request({
    durationMs: 1_700,
    databaseDiagnostics: {
      nova: {
        poolAcquisitions: 2,
        poolAcquireMs: 15.4,
        poolAcquireFailures: 0,
        queries: 8,
        queryRoundTripMs: 422.8,
        queryFailures: 1,
        maxQueryRoundTripMs: 300.3,
      },
      auth: {
        poolAcquisitions: 1,
        poolAcquireMs: 5.2,
        poolAcquireFailures: 0,
        queries: 4,
        queryRoundTripMs: 615.5,
        queryFailures: 0,
        maxQueryRoundTripMs: 411.1,
      },
    },
  }));

  expect(diagnostic).toMatchObject({
    nova_db_pool_acquire_ms: 15,
    nova_db_pool_acquisitions: 2,
    nova_db_pool_acquire_failures: 0,
    nova_db_query_ms: 423,
    nova_db_queries: 8,
    nova_db_query_failures: 1,
    nova_db_max_query_ms: 300,
    auth_db_pool_acquire_ms: 5,
    auth_db_pool_acquisitions: 1,
    auth_db_query_ms: 616,
    auth_db_queries: 4,
  });
  expect(JSON.stringify(diagnostic)).not.toContain("request data");
});
