import { afterEach, expect, test } from "bun:test";
import { handleRequest } from "./app";

const previousBackgroundSecret = process.env.NOVA_BACKGROUND_JOB_SECRET;
const previousBackgroundScheduler = process.env.NOVA_BACKGROUND_SCHEDULER;
const previousSecretsEncryptionKey = process.env.NOVA_SECRETS_ENCRYPTION_KEY;

afterEach(() => {
  if (previousBackgroundSecret === undefined) delete process.env.NOVA_BACKGROUND_JOB_SECRET;
  else process.env.NOVA_BACKGROUND_JOB_SECRET = previousBackgroundSecret;
  if (previousBackgroundScheduler === undefined) delete process.env.NOVA_BACKGROUND_SCHEDULER;
  else process.env.NOVA_BACKGROUND_SCHEDULER = previousBackgroundScheduler;
  if (previousSecretsEncryptionKey === undefined) delete process.env.NOVA_SECRETS_ENCRYPTION_KEY;
  else process.env.NOVA_SECRETS_ENCRYPTION_KEY = previousSecretsEncryptionKey;
});

test.each(["/health", "/api/health"])(
  "reports API health at %s without exposing implementation details",
  async (path) => {
    const response = await handleRequest(new Request(`http://nova.test${path}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "nova-api", status: "ok" });
  },
);

test("reports readiness as unavailable when the database is not configured", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/ready"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ service: "nova-api", status: "not_ready" });
});

test("readiness fails closed for an invalid secret-encryption key", async () => {
  process.env.NOVA_BACKGROUND_SCHEDULER = "vps";
  process.env.NOVA_SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("hex");
  const response = await handleRequest(new Request("http://nova.test/api/ready"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ service: "nova-api", status: "not_ready" });
});

test("returns a deterministic domain-shaped error for an unknown route", async () => {
  const response = await handleRequest(new Request("http://nova.test/not-a-route"));

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: "ROUTE_NOT_FOUND",
    message: "No NOVA command matches this route.",
  });
});

test("directs stale per-definition billing clients to the canonical policy route", async () => {
  const response = await handleRequest(new Request(
    "http://nova.test/api/workstreams/client/00000000-0000-4000-8000-000000000001/task-billing-rules/00000000-0000-4000-8000-000000000002",
    { method: "PATCH" },
  ));

  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({
    error: "TASK_BILLING_RULES_ROUTE_REPLACED",
    replacement: "/api/workstreams/client/:workstreamId/billing-policy/definitions/:entryId",
  });
});

test("protects the background tick behind the deployment-only secret", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/internal/background/tick", {
    method: "POST",
  }));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "BACKGROUND_JOB_UNAUTHORIZED" });
});

test("blocks a valid scheduler secret from an unselected provider", async () => {
  process.env.NOVA_BACKGROUND_JOB_SECRET = "tick-secret";
  process.env.NOVA_BACKGROUND_SCHEDULER = "supabase";
  const response = await handleRequest(new Request("http://nova.test/api/internal/background/tick", {
    method: "POST",
    headers: {
      authorization: "Bearer tick-secret",
      "x-nova-background-scheduler": "vercel",
    },
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "BACKGROUND_SCHEDULER_NOT_SELECTED" });
});

test("fails closed when the scheduler selection is missing", async () => {
  process.env.NOVA_BACKGROUND_JOB_SECRET = "tick-secret";
  delete process.env.NOVA_BACKGROUND_SCHEDULER;
  const response = await handleRequest(new Request("http://nova.test/api/internal/background/tick", {
    method: "POST",
    headers: {
      authorization: "Bearer tick-secret",
      "x-nova-background-scheduler": "supabase",
    },
  }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "BACKGROUND_SCHEDULER_NOT_CONFIGURED" });
});

test("does not expose an auth handler without its required deployment configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/auth/get-session"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose the role command without its required deployment configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/roles", {
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
    method: "POST",
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose the signed-in actor's permission grants without authentication configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/me/permission-grants"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose email connection management without authentication configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/email-connections"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose public-origin management without authentication configuration", async () => {
  const read = await handleRequest(new Request("http://nova.test/api/organisation/public-origin"));
  const update = await handleRequest(new Request("http://nova.test/api/organisation/public-origin", {
    body: JSON.stringify({ origin: "https://nova.test" }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  }));
  expect(read.status).toBe(503);
  expect(update.status).toBe(503);
});

test("does not expose availability configuration without authentication configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/availability/config"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose the bounded availability agenda without authentication configuration", async () => {
  const response = await handleRequest(new Request(
    "http://nova.test/api/availability/agenda?startDate=2026-10-01&endDate=2026-10-31",
  ));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose office geofence selector data without authentication configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/offices/geofence-options"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("keeps the general office directory behind its existing authentication contract", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/offices"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose attendance state without authentication configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/attendance/today"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });

  const actionContext = await handleRequest(new Request("http://nova.test/api/attendance/action-context"));
  expect(actionContext.status).toBe(503);
  expect(await actionContext.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose leave commands without authentication configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/leave", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});

test("does not expose collaboration or recovery commands without authentication configuration", async () => {
  const workContext = await handleRequest(new Request("http://nova.test/api/work-context"));
  const task = await handleRequest(new Request("http://nova.test/api/tasks", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
  }));
  const recovery = await handleRequest(new Request("http://nova.test/api/attendance/recover", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
  }));
  const work = await handleRequest(new Request("http://nova.test/api/work/assignments/mine"));
  const visibleTasks = await handleRequest(new Request("http://nova.test/api/work/tasks/visible"));
  const tasks = await handleRequest(new Request("http://nova.test/api/tasks"));
  const pendingReviews = await handleRequest(new Request("http://nova.test/api/reviews/pending"));
  const reviewDetail = await handleRequest(new Request("http://nova.test/api/task-assignments/00000000-0000-4000-8000-000000000001/review"));
  const reviewerRequests = await handleRequest(new Request("http://nova.test/api/task-reviewer-requests"));
  const handoverRequests = await handleRequest(new Request("http://nova.test/api/task-handover-requests"));
  const authHandoffs = await handleRequest(new Request("http://nova.test/api/auth-handoffs"));
  const candidates = await handleRequest(new Request("http://nova.test/api/task-assignments/00000000-0000-4000-8000-000000000001/candidates"));
  const dueDateEdit = await handleRequest(new Request("http://nova.test/api/tasks/00000000-0000-4000-8000-000000000001/due-date", {
    method: "PATCH",
    body: JSON.stringify({ dueDate: null, expectedDueDate: null, expectedDueDateRevision: 0 }),
    headers: { "content-type": "application/json" },
  }));
  const submission = await handleRequest(new Request("http://nova.test/api/task-assignments/00000000-0000-4000-8000-000000000001/submit", {
    method: "POST",
  }));

  expect(workContext.status).toBe(503);
  expect(task.status).toBe(503);
  expect(recovery.status).toBe(503);
  expect(work.status).toBe(503);
  expect(visibleTasks.status).toBe(503);
  expect(tasks.status).toBe(503);
  expect(pendingReviews.status).toBe(503);
  expect(reviewDetail.status).toBe(503);
  expect(reviewDetail.headers.get("cache-control")).toBe("no-store");
  expect(reviewerRequests.status).toBe(503);
  expect(handoverRequests.status).toBe(503);
  expect(authHandoffs.status).toBe(503);
  expect(candidates.status).toBe(503);
  expect(dueDateEdit.status).toBe(503);
  expect(submission.status).toBe(503);
});

test("review detail route accepts one UUID and rejects malformed or wrong-method requests", async () => {
  const assignmentId = "00000000-0000-4000-8000-000000000001";
  const valid = await handleRequest(new Request(`http://nova.test/api/task-assignments/${assignmentId}/review`));
  expect(valid.status).toBe(503);
  expect(valid.headers.get("cache-control")).toBe("no-store");

  for (const path of [
    "/api/task-assignments/not-a-uuid/review",
    "/api/task-assignments/00000000-0000-4000-8000-00000000000z/review",
    `/api/task-assignments/${assignmentId}/review/extra`,
    `/api/task-assignments/${assignmentId}/review/`,
    `/api/task-assignments/${assignmentId}%2Fextra/review`,
  ]) {
    expect((await handleRequest(new Request(`http://nova.test${path}`))).status).toBe(404);
  }
  expect((await handleRequest(new Request(`http://nova.test/api/task-assignments/${assignmentId}/review`, { method: "PATCH" }))).status).toBe(404);
});

test("routes only a strict task-detail UUID and keeps the detail read authenticated", async () => {
  const taskId = "00000000-0000-4000-8000-000000000001";
  const valid = await handleRequest(new Request(`http://nova.test/api/tasks/${taskId}`));
  expect(valid.status).toBe(503);
  expect(valid.headers.get("cache-control")).toBe("no-store");

  for (const path of [
    "/api/tasks/not-a-uuid",
    "/api/tasks/00000000-0000-4000-8000-00000000000z",
    `/api/tasks/${taskId}/extra`,
    `/api/tasks/${taskId}/`,
    `/api/tasks/${taskId}%2Fextra`,
  ]) {
    const response = await handleRequest(new Request(`http://nova.test${path}`));
    expect(response.status).toBe(404);
  }

  const wrongMethod = await handleRequest(new Request(`http://nova.test/api/tasks/${taskId}`, {
    method: "POST",
    body: "{}",
  }));
  expect(wrongMethod.status).toBe(404);
});

test("routes task assignment options through the authenticated task command", async () => {
  const taskId = "00000000-0000-4000-8000-000000000001";
  const valid = await handleRequest(new Request(
    `http://nova.test/api/tasks/${taskId}/assignment-options`,
  ));
  expect(valid.status).toBe(503);
  expect(valid.headers.get("cache-control")).toBe("no-store");

  for (const path of [
    "/api/tasks/not-a-uuid/assignment-options",
    `/api/tasks/${taskId}/assignment-options/extra`,
    `/api/tasks/${taskId}/assignment-options/`,
    `/api/tasks/${taskId}%2Fextra/assignment-options`,
  ]) {
    expect((await handleRequest(new Request(`http://nova.test${path}`))).status).toBe(404);
  }

  expect((await handleRequest(new Request(
    `http://nova.test/api/tasks/${taskId}/assignment-options`,
    { method: "POST" },
  ))).status).toBe(404);
});

test("does not expose lifecycle offboarding without authentication configuration", async () => {
  const response = await handleRequest(new Request(
    "http://nova.test/api/people/00000000-0000-4000-8000-000000000001/offboard",
    { method: "POST", body: JSON.stringify({}) },
  ));
  expect(response.status).toBe(503);
});

test("does not expose owner transfer without authentication configuration", async () => {
  const response = await handleRequest(new Request("http://nova.test/api/organisation/owner-transfer", {
    method: "POST",
    body: JSON.stringify({}),
  }));
  expect(response.status).toBe(503);
});

test("does not expose availability policy or exception commands without authentication configuration", async () => {
  const wfh = await handleRequest(new Request("http://nova.test/api/availability/wfh-policies"));
  const wfhRequest = await handleRequest(new Request("http://nova.test/api/availability/wfh", {
    method: "POST",
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
  }));
  const exceptions = await handleRequest(new Request("http://nova.test/api/historical-exceptions"));

  expect(wfh.status).toBe(503);
  expect(wfhRequest.status).toBe(503);
  expect(exceptions.status).toBe(503);
});

test("fails an HTML Gmail callback safely when authentication is unconfigured", async () => {
  const response = await handleRequest(new Request(
    "http://nova.test/api/email-connections/gmail/callback",
    { headers: { accept: "text/html" } },
  ));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" });
});
