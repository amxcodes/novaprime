import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stateChangingRequestError } from "./request-security";

test("allows same-origin browser mutation requests with a session cookie", () => {
  const error = stateChangingRequestError(new Request("https://nova.test/api/leave", {
    method: "POST",
    headers: {
      cookie: "better-auth.session_token=session",
      origin: "https://nova.test",
    },
  }));

  expect(error).toBeUndefined();
});

test("preserves non-default loopback ports through the trusted Nginx origin guard", () => {
  const nginxConfiguration = readFileSync(
    new URL("../../docker/nginx/default.conf", import.meta.url),
    "utf8",
  );
  expect(nginxConfiguration).toContain("proxy_set_header X-Forwarded-Host $http_host;");

  const publicOrigin = "http://127.0.0.1:43181";
  const environment = {
    BETTER_AUTH_SECRET: "test-auth-secret-that-is-long-enough",
    BETTER_AUTH_URL: publicOrigin,
    DATABASE_URL: "postgresql://nova_app:test@db/nova",
    NOVA_ALLOWED_ORIGINS: publicOrigin,
  };
  const error = stateChangingRequestError(new Request(`${publicOrigin}/api/setup/register`, {
    method: "POST",
    headers: { origin: publicOrigin },
  }), environment);

  expect(error).toBeUndefined();
});

test("rejects cross-origin browser mutations before command authorization", () => {
  const error = stateChangingRequestError(new Request("https://nova.test/api/leave", {
    method: "POST",
    headers: {
      cookie: "better-auth.session_token=session",
      origin: "https://evil.test",
    },
  }));

  expect(error?.status).toBe(403);
});

test("rejects a session mutation with no origin metadata", () => {
  const error = stateChangingRequestError(new Request("https://nova.test/api/leave", {
    method: "POST",
    headers: { cookie: "better-auth.session_token=session" },
  }));

  expect(error?.status).toBe(403);
});

test("rejects cross-site fetch metadata even when the origin is omitted", () => {
  const error = stateChangingRequestError(new Request("https://nova.test/api/leave", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
  }));

  expect(error?.status).toBe(403);
});

test("keeps non-browser operator requests usable when no cookie or origin exists", () => {
  const error = stateChangingRequestError(new Request("https://nova.test/api/setup/register", {
    method: "POST",
    headers: { "x-nova-bootstrap-token": "operator-secret" },
  }));

  expect(error).toBeUndefined();
});

test("does not apply the custom guard to safe reads", () => {
  const error = stateChangingRequestError(new Request("https://nova.test/api/leave/mine", {
    headers: { cookie: "better-auth.session_token=session", origin: "https://evil.test" },
  }));

  expect(error).toBeUndefined();
});
