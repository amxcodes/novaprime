import { createHash, randomUUID } from "node:crypto";
import { rolePresetDraft, rolePresets } from "../web/role-grants.js";

const migrationUrl = process.env.MIGRATOR_DATABASE_URL;
const applicationPassword = process.env.NOVA_APP_PASSWORD;
const configuredBaseUrl = process.env.BETTER_AUTH_URL;
const bootstrapToken = process.env.NOVA_BOOTSTRAP_TOKEN;
const backgroundSecret = process.env.NOVA_BACKGROUND_JOB_SECRET;

if (!migrationUrl || !applicationPassword || !configuredBaseUrl || !bootstrapToken || !backgroundSecret) {
  throw new Error("NOVA_LIFECYCLE_SMOKE_CONFIGURATION_REQUIRED");
}

const applicationUrl = new URL(migrationUrl);
applicationUrl.username = "nova_app";
applicationUrl.password = applicationPassword;
process.env.DATABASE_URL = applicationUrl.toString();
const requestScopedDatabase = process.env.NOVA_QA_REQUEST_SCOPED === "true";
if (requestScopedDatabase) process.env.NOVA_DATABASE_REQUEST_SCOPED = "true";
const smokeOrigin = new URL(configuredBaseUrl).origin;
type FixturePool = {
  query<T extends Record<string, unknown>>(query: string, values?: unknown[]): Promise<{ rows: T[] }>;
  connect(): Promise<{
    query<T extends Record<string, unknown>>(query: string, values?: unknown[]): Promise<{ rows: T[] }>;
    release(): void;
  }>;
  end(): Promise<void>;
};
const pgModulePath = "../server/node_modules/pg/lib/index.js";
const pg = await import(pgModulePath) as unknown as {
  Pool: new (configuration: { connectionString: string; max: number }) => FixturePool;
};
const fixtureDatabase = new pg.Pool({ connectionString: migrationUrl, max: 2 });
const { handleRequest } = await import("../server/src/app.ts");
const { createDatabaseAuthRateLimitStorage } = await import("../server/src/auth-rate-limit-storage.ts");
const { database, withDatabaseRequest, withRequestScopedDatabase } = await import("../server/src/db.ts");
const { requestActor } = await import("../server/src/request-actor.ts");

async function handleSmokeRequest(request: Request): Promise<Response> {
  return requestScopedDatabase
    ? withRequestScopedDatabase(process.env.DATABASE_URL!, () => handleRequest(request))
    : handleRequest(request);
}

type ApiResult = Readonly<{ status: number; body: any; cookie?: string; location?: string }>;

let checks = 0;
let suppressStatusLogs = false;
const loadEmployeeCount = Number(process.env.NOVA_QA_LOAD_EMPLOYEES ?? "0");

if (!Number.isSafeInteger(loadEmployeeCount) || loadEmployeeCount < 0 || loadEmployeeCount > 100) {
  throw new Error("NOVA_QA_LOAD_EMPLOYEES_MUST_BE_BETWEEN_0_AND_100");
}

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`LIFECYCLE_ASSERTION_FAILED_${label}`);
  checks += 1;
}

function assertStatus(label: string, result: ApiResult, expected: number | readonly number[]): void {
  const allowed = typeof expected === "number" ? [expected] : expected;
  if (!allowed.includes(result.status)) {
    const safeError = ["error", "code", "message", "details"]
      .filter((key) => typeof result.body?.[key] === "string")
      .map((key) => `${key}=${String(result.body[key]).slice(0, 160)}`)
      .join(";");
    throw new Error(`${label}_EXPECTED_${allowed.join("_OR_")}_GOT_${result.status}_${safeError}`);
  }
  checks += 1;
  if (!suppressStatusLogs) console.info(`${label}: ${result.status}`);
}

function cookieFrom(response: Response): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const value = cookies.map((cookie) => cookie.split(";", 1)[0]?.trim()).filter(Boolean).join("; ");
  return value || undefined;
}

function isolatedSmokeIp(identity: string): string {
  const digest = createHash("sha256").update(identity).digest();
  // RFC 2544 benchmarking range; the in-process harness uses it only to keep
  // unrelated disposable actors from sharing Better Auth's per-IP buckets.
  return `198.18.${digest[0]}.${digest[1]}`;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  useBootstrapToken = false,
  extraHeaders?: Readonly<Record<string, string>>,
): Promise<ApiResult> {
  const headers = new Headers({ origin: smokeOrigin });
  const email = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
    ? body.email.toLowerCase()
    : undefined;
  headers.set("x-nova-remote-ip", isolatedSmokeIp(email ?? `${method}:${path}:${cookie ?? ""}`));
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  if (useBootstrapToken) headers.set("x-nova-bootstrap-token", bootstrapToken!);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) headers.set(name, value);
  const response = await handleSmokeRequest(new Request(`${smokeOrigin}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const raw = await response.text();
  let parsed: any = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: "non-json response" }; }
  return {
    status: response.status,
    body: parsed,
    ...(cookieFrom(response) ? { cookie: cookieFrom(response) } : {}),
    ...(response.headers.get("location") ? { location: response.headers.get("location")! } : {}),
  };
}

async function requestUrl(url: string, cookie?: string): Promise<ApiResult> {
  const headers = new Headers({
    origin: smokeOrigin,
    "x-nova-remote-ip": isolatedSmokeIp(url),
  });
  if (cookie) headers.set("cookie", cookie);
  const response = await handleSmokeRequest(new Request(url, { method: "GET", headers }));
  const raw = await response.text();
  let parsed: any = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw: "non-json response" }; }
  return {
    status: response.status,
    body: parsed,
    ...(cookieFrom(response) ? { cookie: cookieFrom(response) } : {}),
    ...(response.headers.get("location") ? { location: response.headers.get("location")! } : {}),
  };
}

function field(label: string, result: ApiResult, name: string): string {
  const value = result.body?.[name];
  if (typeof value !== "string" || !value) throw new Error(`${label}_FIELD_MISSING_${name}`);
  return value;
}

async function pendingReviewCycleId(label: string, assignmentId: string, reviewerCookie: string): Promise<string> {
  const pending = await request("GET", `/reviews/pending?assignmentId=${assignmentId}`, undefined, reviewerCookie);
  assertStatus(`${label}_pending_reviews`, pending, 200);
  const cycleId = pending.body?.reviews?.find((review: any) => review.assignmentId === assignmentId)?.reviewCycleId;
  assert(typeof cycleId === "string" && cycleId.length > 0, `${label}_cycle_id_read`);
  return cycleId;
}

function numberField(label: string, result: ApiResult, name: string): number {
  const value = result.body?.[name];
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label}_FIELD_MISSING_${name}`);
  return value;
}

async function sql<T extends Record<string, unknown>>(query: string, values: readonly unknown[] = []): Promise<T[]> {
  return (await fixtureDatabase.query<T>(query, [...values])).rows;
}

async function verifySharedAuthRateLimitStorage(): Promise<void> {
  const prefix = `qa-auth-rate-limit:${randomUUID()}:`;
  const keys = {
    burst: `${prefix}burst`,
    sensitive: `${prefix}sensitive`,
    expired: `${prefix}expired`,
    concurrentReset: `${prefix}concurrent-reset`,
  };
  const storage = createDatabaseAuthRateLimitStorage((statement, parameters) =>
    database().query(statement, [...parameters]));
  try {
    const burstResults = await Promise.all(
      Array.from({ length: 25 }, () => storage.consume(keys.burst, { window: 10, max: 10 })),
    );
    assert(burstResults.filter((result) => result.allowed).length === 10,
      "auth_rate_limit_concurrent_burst_admits_exact_limit");
    const burstRow = (await sql<{ count: number; last_request: string }>(
      `SELECT count, "lastRequest" AS last_request
       FROM nova_auth."rateLimit" WHERE key = $1`,
      [keys.burst],
    ))[0];
    assert(burstRow?.count === 10, "auth_rate_limit_burst_persists_exact_count");

    const denied = await storage.consume(keys.burst, { window: 10, max: 10 });
    const afterDenial = (await sql<{ count: number; last_request: string }>(
      `SELECT count, "lastRequest" AS last_request
       FROM nova_auth."rateLimit" WHERE key = $1`,
      [keys.burst],
    ))[0];
    assert(!denied.allowed && Number(denied.retryAfter) >= 1,
      "auth_rate_limit_denial_has_retry_seconds");
    assert(afterDenial?.count === burstRow.count
      && afterDenial.last_request === burstRow.last_request,
    "auth_rate_limit_denial_does_not_mutate_window");

    const sensitiveResults = await Promise.all(
      Array.from({ length: 8 }, () => storage.consume(keys.sensitive, { window: 10, max: 3 })),
    );
    assert(sensitiveResults.filter((result) => result.allowed).length === 3,
      "auth_rate_limit_preserves_sensitive_endpoint_limit");

    await fixtureDatabase.query(
      `INSERT INTO nova_auth."rateLimit" (id, key, count, "lastRequest")
       VALUES ($1, $2, 10,
         (extract(epoch FROM statement_timestamp()) * 1000)::bigint - $3::bigint)`,
      [randomUUID(), keys.expired, 10_000],
    );
    const reset = await storage.consume(keys.expired, { window: 10, max: 10 });
    const resetRow = (await sql<{ count: number }>(
      `SELECT count FROM nova_auth."rateLimit" WHERE key = $1`,
      [keys.expired],
    ))[0];
    assert(reset.allowed && resetRow?.count === 1, "auth_rate_limit_expiry_resets_to_one");

    await fixtureDatabase.query(
      `INSERT INTO nova_auth."rateLimit" (id, key, count, "lastRequest")
       VALUES ($1, $2, 10,
         (extract(epoch FROM statement_timestamp()) * 1000)::bigint - $3::bigint)`,
      [randomUUID(), keys.concurrentReset, 10_000],
    );
    const resetResults = await Promise.all(
      Array.from({ length: 25 }, () => storage.consume(keys.concurrentReset, { window: 10, max: 10 })),
    );
    const concurrentResetRow = (await sql<{ count: number }>(
      `SELECT count FROM nova_auth."rateLimit" WHERE key = $1`,
      [keys.concurrentReset],
    ))[0];
    assert(resetResults.filter((result) => result.allowed).length === 10
      && concurrentResetRow?.count === 10,
    "auth_rate_limit_concurrent_expiry_admits_exact_limit");
  } finally {
    await fixtureDatabase.query(
      `DELETE FROM nova_auth."rateLimit" WHERE key = ANY($1::text[])`,
      [Object.values(keys)],
    );
  }
}

async function assertNoGroupOrTaskWrites(label: string, groupName: string, taskTitle: string): Promise<void> {
  const rows = await sql<{ group_count: string; task_count: string }>(
    `SELECT (SELECT count(*)::text FROM nova.work_groups WHERE name = $1) AS group_count,
            (SELECT count(*)::text FROM nova.tasks WHERE title = $2) AS task_count`,
    [groupName, taskTitle],
  );
  assert(rows[0]?.group_count === "0" && rows[0]?.task_count === "0", label);
}

async function revealOnceConcurrently(handoffId: string, cookie: string, useBootstrapToken = false): Promise<any> {
  const responses = await Promise.all([
    request("POST", `/auth-handoffs/${handoffId}/reveal`, undefined, cookie, useBootstrapToken),
    request("POST", `/auth-handoffs/${handoffId}/reveal`, undefined, cookie, useBootstrapToken),
  ]);
  const successful = responses.filter((response) => response.status === 200);
  const rejected = responses.filter((response) => response.status === 409);
  assert(successful.length === 1 && rejected.length === 1, "handoff_reveal_is_atomic_one_time");
  return successful[0]!.body.handoff;
}

async function listHandoffs(cookie: string, purpose: string, personId?: string, useBootstrapToken = false): Promise<any> {
  const result = await request("GET", "/auth-handoffs", undefined, cookie, useBootstrapToken);
  assertStatus("handoffs_list", result, 200);
  const handoff = result.body?.handoffs?.find((item: any) =>
    item.purpose === purpose && (!personId || item.targetPersonId === personId));
  assert(Boolean(handoff?.id), `handoff_${purpose}_listed_without_url`);
  assert(!("url" in handoff), `handoff_${purpose}_list_does_not_expose_secret`);
  return handoff;
}

async function completeInviteAndOnboard(input: Readonly<{
  adminCookie: string;
  departmentId: string;
  displayName: string;
  email: string;
  officeId: string;
  password: string;
  invitationResult?: ApiResult;
  roleId: string;
  founderId: string;
  employmentDate: string;
  concurrentOnboarding?: boolean;
}>): Promise<{ cookie: string; personId: string; password: string }> {
  const invitation = input.invitationResult ?? await request("POST", "/people/invitations", {
    displayName: input.displayName,
    email: input.email,
    deliveryMode: "manual",
  }, input.adminCookie);
  assertStatus("invitation_manual_handoff", invitation, 201);
  const personId = field("invitation", invitation, "personId");
  const handoffId = field("invitation", invitation, "manualHandoffId");
  const invitationHandoff = await revealOnceConcurrently(handoffId, input.adminCookie);
  const token = new URL(invitationHandoff.url).hash.slice(1);
  const invitationToken = new URLSearchParams(token).get("token");
  assert(Boolean(invitationToken), "invitation_token_is_fragment_only");

  const mismatchedEmailAcceptance = await request("POST", "/invitations/accept", {
    email: `wrong-${input.email}`,
    name: input.displayName,
    password: input.password,
    invitationToken,
  });
  assertStatus("invitation_rejects_email_mismatch", mismatchedEmailAcceptance, 422);
  assert(mismatchedEmailAcceptance.body?.error === "INVITATION_INVALID_OR_EXPIRED", "invitation_email_mismatch_is_non_enumerating");

  // Model a shared browser where an administrator is still signed in while
  // the invited person accepts their own invitation. The internal verification
  // request must not inherit that administrator's session identity.
  const accepted = await request("POST", "/invitations/accept", {
    email: input.email,
    name: input.displayName,
    password: input.password,
    invitationToken,
  }, input.adminCookie);
  assertStatus("invitation_accept_without_email", accepted, 202);
  assert(accepted.body?.verificationSent === false, "verification_falls_back_to_manual_handoff");
  const invitationReplay = await request("POST", "/invitations/accept", {
    email: input.email,
    name: input.displayName,
    password: input.password,
    invitationToken,
  });
  assertStatus("invitation_token_replay_rejected", invitationReplay, 422);
  assert(invitationReplay.body?.error === "INVITATION_INVALID_OR_EXPIRED", "invitation_replay_is_non_enumerating");

  const verification = await listHandoffs(input.adminCookie, "verification", personId);
  const verificationHandoff = await revealOnceConcurrently(verification.id, input.adminCookie);
  const verified = await requestUrl(verificationHandoff.url);
  assertStatus("email_verification_callback", verified, [302, 303]);

  const verifiedState = await sql<{ status: string; accepted_at: Date | null }>(
    `SELECT statuses.status, invitations.accepted_at
     FROM nova.person_status_periods statuses
     JOIN nova.people people ON people.id = statuses.person_id
     LEFT JOIN LATERAL (
       SELECT accepted_at FROM nova.person_invitations
       WHERE person_id = people.id ORDER BY invited_at DESC LIMIT 1
     ) invitations ON true
     WHERE people.id = $1::uuid AND statuses.ended_at IS NULL`,
    [personId],
  );
  assert(verifiedState[0]?.status === "onboarding" && verifiedState[0]?.accepted_at, "verified_invitation_enters_onboarding");

  const onboardingBody = {
    designation: "NOVA lifecycle test employee",
    employmentStartsOn: input.employmentDate,
    managerPersonId: input.founderId,
    officeId: input.officeId,
    organisationDepartmentId: input.departmentId,
    roleId: input.roleId,
  };
  const onboarding = input.concurrentOnboarding
    ? await Promise.all([
      request("POST", `/people/${personId}/complete-onboarding`, onboardingBody, input.adminCookie),
      request("POST", `/people/${personId}/complete-onboarding`, onboardingBody, input.adminCookie),
    ])
    : [await request("POST", `/people/${personId}/complete-onboarding`, onboardingBody, input.adminCookie)];
  if (input.concurrentOnboarding) {
    console.info("concurrent_onboarding_results", onboarding.map(({ status, body }) => ({
      status,
      error: typeof body?.error === "string" ? body.error : undefined,
    })));
    assert(onboarding.filter((result) => result.status === 201).length === 1, "concurrent_onboarding_exactly_one_activation");
    assert(onboarding.filter((result) => result.status === 409).length === 1, "concurrent_onboarding_rejects_second_activation");
  } else {
    assertStatus("complete_onboarding", onboarding[0]!, 201);
  }

  const signIn = await request("POST", "/auth/sign-in/email", { email: input.email, password: input.password });
  assertStatus("employee_first_sign_in", signIn, 200);
  assert(Boolean(signIn.cookie), "employee_session_cookie_issued_after_activation");
  return { cookie: signIn.cookie!, personId, password: input.password };
}

async function runEmployeeLoadSmoke(input: Readonly<{
  founderCookie: string;
  founderId: string;
  officeId: string;
  departmentId: string;
  employmentDate: string;
}>): Promise<void> {
  if (loadEmployeeCount === 0) return;

  const role = await request("POST", "/roles", {
    key: `qa_load_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    name: "NOVA isolated load-test employee",
    permissionGrants: [
      { permissionKey: "tasks.create", scope: "organisation" },
      { permissionKey: "tasks.create.billable", scope: "organisation" },
      { permissionKey: "tasks.view", scope: "organisation" },
      { permissionKey: "tasks.start", scope: "assigned_work" },
    ],
    operationalPolicy: {
      workEnabled: true,
      canReceiveAssignments: true,
      attendanceRequired: false,
      wfhAllowed: false,
      canWorkWithoutAttendance: true,
      payrollApplicable: false,
      payrollAttendanceContributes: false,
      payrollOvertimeApplicable: false,
    },
  }, input.founderCookie);
  assertStatus("load_role_create", role, 201);
  const loadRoleId = field("load_role", role, "roleId");
  const client = await request("POST", "/clients", {
    name: `NOVA isolated load client ${randomUUID().slice(0, 8)}`,
  }, input.founderCookie);
  assertStatus("load_client_create", client, 201);
  const clientId = field("load_client", client, "clientId");
  const workstream = await request("POST", "/workstreams/client", {
    clientId,
    name: `NOVA isolated load workstream ${randomUUID().slice(0, 8)}`,
  }, input.founderCookie);
  assertStatus("load_workstream_create", workstream, 201);
  const workstreamId = field("load_workstream", workstream, "workstreamId");
  const billingPolicy = await request("PATCH", `/workstreams/client/${workstreamId}/billing-policy`, {
    policyClass: "billable", expectedRevision: 0,
    reason: "Load profile verifies policy-classified client work at concurrency.",
  }, input.founderCookie);
  assertStatus("load_workstream_billing_policy", billingPolicy, 200);

  const employees: Array<{ cookie: string; personId: string }> = [];
  suppressStatusLogs = true;
  try {
    for (let offset = 0; offset < loadEmployeeCount; offset += 5) {
      const batch = Array.from({ length: Math.min(5, loadEmployeeCount - offset) }, (_, index) => offset + index);
      employees.push(...await Promise.all(batch.map((index) => {
        const email = `nova-load-${index}-${randomUUID()}@example.test`;
        return completeInviteAndOnboard({
          adminCookie: input.founderCookie,
          departmentId: input.departmentId,
          displayName: `NOVA Load Employee ${index + 1}`,
          email,
          officeId: input.officeId,
          password: `NOVA-Load-${randomUUID()}-Aa9!`,
          roleId: loadRoleId,
          founderId: input.founderId,
          employmentDate: input.employmentDate,
        });
      })));
    }
  } finally {
    suppressStatusLogs = false;
  }

  const timed = async (operation: () => Promise<ApiResult>) => {
    const startedAt = performance.now();
    const result = await operation();
    return { result, elapsedMs: performance.now() - startedAt };
  };
  const reportBatch = (name: string, results: Awaited<ReturnType<typeof timed>>[], expectedStatus: number) => {
    const failed = results.filter(({ result }) => result.status !== expectedStatus);
    if (results.length !== loadEmployeeCount || failed.length) {
      throw new Error(`LOAD_BATCH_FAILED_${name}_${failed.slice(0, 5).map(({ result }) => result.status).join(",")}`);
    }
    checks += 1;
    const values = results.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
    const percentile = (fraction: number) => values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] ?? 0;
    console.info(`load_${name}: employees=${results.length} p50_ms=${percentile(0.50).toFixed(1)} p95_ms=${percentile(0.95).toFixed(1)} max_ms=${(values.at(-1) ?? 0).toFixed(1)}`);
  };

  const contexts = await Promise.all(employees.map((employee) => timed(() =>
    request("GET", "/work-context", undefined, employee.cookie))));
  reportBatch("work_context", contexts, 200);

  const createdTasks = await Promise.all(employees.map((employee, index) => timed(() =>
    request("POST", "/tasks", {
      clientWorkstreamId: workstreamId,
      title: `NOVA load task ${index + 1}`,
      assignToSelf: true,
    }, employee.cookie))));
  reportBatch("task_create_and_self_assign", createdTasks, 201);
  const assignmentIds = createdTasks.map(({ result }, index) =>
    field(`load_task_${index + 1}`, result, "assignmentId"));

  const sessions = await Promise.all(employees.map((employee, index) => timed(() =>
    request("POST", "/work-sessions/start", { assignmentId: assignmentIds[index] }, employee.cookie))));
  reportBatch("timer_start", sessions, 201);
  const sessionIds = sessions.map(({ result }, index) =>
    field(`load_session_${index + 1}`, result, "sessionId"));

  const stopped = await Promise.all(employees.map((employee, index) => timed(() =>
    request("POST", `/work-sessions/${sessionIds[index]}/stop`, {}, employee.cookie))));
  reportBatch("timer_stop", stopped, 200);

  const assignmentReads = await Promise.all(employees.map((employee) => timed(() =>
    request("GET", "/work/assignments/mine", undefined, employee.cookie))));
  reportBatch("assignments_read", assignmentReads, 200);

  const integrity = (await sql<{
    task_count: number; assignment_count: number; session_count: number; open_session_count: number;
    billable_task_count: number; policy_revision_count: number;
  }>(
    `SELECT count(DISTINCT tasks.id)::integer AS task_count,
            count(DISTINCT assignments.id)::integer AS assignment_count,
            count(DISTINCT sessions.id)::integer AS session_count,
            count(DISTINCT sessions.id) FILTER (WHERE sessions.ended_at IS NULL)::integer AS open_session_count,
            count(DISTINCT tasks.id) FILTER (WHERE tasks.billing_class = 'billable')::integer AS billable_task_count,
            count(DISTINCT tasks.id) FILTER (WHERE tasks.billing_policy_revision = 1
              AND tasks.billing_policy_source = 'client_workstream')::integer AS policy_revision_count
     FROM nova.tasks tasks
     JOIN nova.task_assignments assignments ON assignments.task_id = tasks.id
     LEFT JOIN nova.work_sessions sessions ON sessions.assignment_id = assignments.id
     WHERE tasks.client_workstream_id = $1::uuid
       AND tasks.created_by_person_id = ANY($2::uuid[])`,
    [workstreamId, employees.map((employee) => employee.personId)],
  ))[0];
  assert(integrity?.task_count === loadEmployeeCount
    && integrity.assignment_count === loadEmployeeCount
    && integrity.session_count === loadEmployeeCount
    && integrity.open_session_count === 0
    && integrity.billable_task_count === loadEmployeeCount
    && integrity.policy_revision_count === loadEmployeeCount,
  "load_burst_persists_one_policy_classified_billable_task_assignment_and_closed_timer_per_employee");
  console.info(`load_integrity: employees=${loadEmployeeCount} tasks=${integrity?.task_count} billable_tasks=${integrity?.billable_task_count} policy_revision_1_tasks=${integrity?.policy_revision_count} assignments=${integrity?.assignment_count} closed_timers=${integrity?.session_count} open_timers=${integrity?.open_session_count}`);
}

async function main(): Promise<void> {
  await verifySharedAuthRateLimitStorage();
  const founderEmail = process.env.NOVA_LIFECYCLE_FOUNDER_EMAIL ?? `nova-founder-${randomUUID()}@example.test`;
  const founderPassword = process.env.NOVA_LIFECYCLE_FOUNDER_PASSWORD ?? `N0va-Founder-${randomUUID()}-Aa!`;
  const registration = await request("POST", "/setup/register", {
    email: founderEmail,
    name: "NOVA Isolated Runtime Founder",
    password: founderPassword,
  }, undefined, true);
  assertStatus("founder_registration", registration, [200, 201, 202]);
  assert(Boolean(registration.cookie), "founder_setup_session_cookie_issued");
  let founderCookie = registration.cookie!;

  const bootstrap = await request("POST", "/organisation/bootstrap", {
    organisationName: `NOVA Isolated Runtime ${randomUUID().slice(0, 8)}`,
    attendanceMode: "scheduled",
    requiredAttendanceMinutes: 480,
  }, founderCookie, true);
  assertStatus("founder_organisation_bootstrap", bootstrap, 201);
  const organisationId = field("bootstrap", bootstrap, "organisationId");
  const founder = (await sql<{ id: string }>(
    "SELECT id FROM nova.people WHERE organisation_id = $1::uuid AND email = $2",
    [organisationId, founderEmail],
  ))[0];
  assert(Boolean(founder?.id), "founder_people_record_created");

  const origin = await request("PATCH", "/organisation/public-origin", { origin: smokeOrigin }, founderCookie, true);
  assertStatus("public_origin_setup", origin, 200);
  assertStatus("founder_verification_requested_after_origin_setup", await request(
    "POST", "/auth/send-verification-email", { email: founderEmail }, founderCookie,
  ), 200);
  const founderVerification = await listHandoffs(founderCookie, "verification", founder.id, true);
  const founderVerificationHandoff = await revealOnceConcurrently(founderVerification.id, founderCookie, true);
  let expiredVerification: ApiResult;
  const actualDateForVerification = Date;
  const verificationClockOffset = 2 * 60 * 60 * 1_000;
  const expiredVerificationDate = new Proxy(actualDateForVerification, {
    construct(target, args) {
      return Reflect.construct(target, args.length ? args : [actualDateForVerification.now() + verificationClockOffset]);
    },
    get(target, property, receiver) {
      if (property === "now") return () => actualDateForVerification.now() + verificationClockOffset;
      return Reflect.get(target, property, receiver);
    },
  });
  try {
    Object.defineProperty(globalThis, "Date", { configurable: true, writable: true, value: expiredVerificationDate });
    expiredVerification = await requestUrl(founderVerificationHandoff.url);
  } finally {
    Object.defineProperty(globalThis, "Date", { configurable: true, writable: true, value: actualDateForVerification });
  }
  assertStatus("expired_email_verification_link", expiredVerification!, [302, 303]);
  assert(new URL(expiredVerification!.location!, smokeOrigin).searchParams.get("error") === "TOKEN_EXPIRED",
    "expired_email_verification_returns_explicit_expiry_result");
  const unverifiedFounder = await sql<{ email_verified: boolean }>(
    `SELECT auth_user."emailVerified" AS email_verified
     FROM nova_auth."user" auth_user
     JOIN nova.person_identities identities ON identities.subject = auth_user.id
     WHERE identities.person_id = $1::uuid`,
    [founder.id],
  );
  assert(unverifiedFounder[0]?.email_verified === false, "expired_email_verification_does_not_verify_identity");
  assertStatus("verification_resent_after_expiry", await request(
    "POST", "/auth/send-verification-email", { email: founderEmail }, founderCookie,
  ), 200);
  const replacementVerification = await listHandoffs(founderCookie, "verification", founder.id, true);
  const replacementVerificationHandoff = await revealOnceConcurrently(
    replacementVerification.id, founderCookie, true,
  );
  assertStatus("founder_email_verification", await requestUrl(replacementVerificationHandoff.url), [302, 303]);
  const founderSignIn = await request("POST", "/auth/sign-in/email", { email: founderEmail, password: founderPassword });
  assertStatus("verified_founder_sign_in", founderSignIn, 200);
  founderCookie = founderSignIn.cookie ?? founderCookie;
  assert(Boolean(founderSignIn.cookie), "founder_session_after_verification");

  const gmailConnection = await request("POST", "/email-connections", {
    credentials: {
      clientId: "nova-qa.apps.googleusercontent.com",
      clientSecret: "synthetic-google-client-secret",
    },
    name: "NOVA Gmail OAuth lifecycle QA",
    provider: "gmail_oauth2",
    senderEmail: founderEmail,
  }, founderCookie);
  assertStatus("gmail_oauth_connection_create", gmailConnection, 201);
  const gmailConnectionId = gmailConnection.body?.connection?.id;
  assert(typeof gmailConnectionId === "string", "gmail_oauth_connection_id_returned");
  assert(!("credentials" in gmailConnection.body.connection), "gmail_credentials_not_returned_on_create");

  const gmailConnect = await request(
    "POST", `/email-connections/${gmailConnectionId}/gmail/connect`, undefined, founderCookie,
  );
  assertStatus("gmail_oauth_authorization_start", gmailConnect, 200);
  const gmailAuthorizationUrl = new URL(field("gmail_oauth_authorization", gmailConnect, "authorizationUrl"));
  const gmailState = gmailAuthorizationUrl.searchParams.get("state") ?? "";
  const gmailChallenge = gmailAuthorizationUrl.searchParams.get("code_challenge") ?? "";
  assert(gmailAuthorizationUrl.origin === "https://accounts.google.com"
    && gmailAuthorizationUrl.pathname === "/o/oauth2/v2/auth", "gmail_oauth_uses_google_authorization_endpoint");
  assert(gmailAuthorizationUrl.searchParams.get("redirect_uri")
    === smokeOrigin + "/api/email-connections/gmail/callback", "gmail_oauth_redirect_uses_configured_public_origin");
  assert(gmailAuthorizationUrl.searchParams.get("client_id")
    === "nova-qa.apps.googleusercontent.com", "gmail_oauth_uses_configured_client_id");
  assert(gmailAuthorizationUrl.searchParams.get("scope") === "https://www.googleapis.com/auth/gmail.send"
    && gmailAuthorizationUrl.searchParams.get("access_type") === "offline"
    && gmailAuthorizationUrl.searchParams.get("prompt") === "consent", "gmail_oauth_requests_offline_mail_consent");
  assert(/^[A-Za-z0-9_-]{43}$/.test(gmailState)
    && /^[A-Za-z0-9_-]{43}$/.test(gmailChallenge)
    && gmailAuthorizationUrl.searchParams.get("code_challenge_method") === "S256"
    && !gmailAuthorizationUrl.searchParams.has("code_verifier"), "gmail_oauth_uses_opaque_state_and_pkce_s256");

  let tokenExchangeCalls = 0;
  let tokenExchangeForm: URLSearchParams | undefined;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert(String(input) === "https://oauth2.googleapis.com/token", "gmail_oauth_posts_only_to_google_token_endpoint");
    tokenExchangeCalls += 1;
    tokenExchangeForm = new URLSearchParams(String(init?.body ?? ""));
    return new Response(JSON.stringify({
      access_token: "synthetic-google-access-token",
      expires_in: 3600,
      refresh_token: "synthetic-google-refresh-token",
      scope: "https://www.googleapis.com/auth/gmail.send",
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const gmailCallbackUrl = new URL("/api/email-connections/gmail/callback", smokeOrigin);
    gmailCallbackUrl.searchParams.set("code", "synthetic-google-authorization-code");
    gmailCallbackUrl.searchParams.set("state", gmailState);
    const gmailCallback = await requestUrl(gmailCallbackUrl.toString());
    assertStatus("gmail_oauth_callback", gmailCallback, 200);
    assert(gmailCallback.body?.connected === true
      && gmailCallback.body?.connectionId === gmailConnectionId, "gmail_oauth_callback_connects_expected_connection");
    assert(tokenExchangeCalls === 1
      && tokenExchangeForm?.get("grant_type") === "authorization_code"
      && tokenExchangeForm.get("client_id") === "nova-qa.apps.googleusercontent.com"
      && tokenExchangeForm.get("client_secret") === "synthetic-google-client-secret"
      && tokenExchangeForm.get("code") === "synthetic-google-authorization-code"
      && tokenExchangeForm.get("redirect_uri") === smokeOrigin + "/api/email-connections/gmail/callback",
    "gmail_oauth_token_exchange_uses_bound_client_code_and_redirect");
    const submittedVerifier = tokenExchangeForm?.get("code_verifier") ?? "";
    assert(gmailChallenge === createHash("sha256").update(submittedVerifier).digest("base64url"),
      "gmail_oauth_token_exchange_proves_pkce_verifier");

    const consumedStateReplay = await requestUrl(gmailCallbackUrl.toString());
    assertStatus("gmail_oauth_state_replay", consumedStateReplay, 400);
    assert(consumedStateReplay.body?.error === "GMAIL_OAUTH_STATE_INVALID"
      && tokenExchangeCalls === 1, "gmail_oauth_state_is_one_time_and_replay_skips_exchange");

    const savedCredentials = (await sql<{ credentials_ciphertext: Buffer }>(
      "SELECT credentials_ciphertext FROM nova.email_provider_connections WHERE id = $1::uuid",
      [gmailConnectionId],
    ))[0]?.credentials_ciphertext;
    assert(Buffer.isBuffer(savedCredentials)
      && !savedCredentials.toString("utf8").includes("synthetic-google-refresh-token"),
    "gmail_refresh_token_is_encrypted_at_rest");
    const emailConnections = await request("GET", "/email-connections", undefined, founderCookie);
    assertStatus("gmail_oauth_connection_list", emailConnections, 200);
    const listedGmailConnection = emailConnections.body?.connections?.find(
      (connection: any) => connection.id === gmailConnectionId,
    );
    assert(Boolean(listedGmailConnection) && !("credentials" in listedGmailConnection)
      && !("credentialsCiphertext" in listedGmailConnection), "gmail_credentials_never_appear_in_connection_metadata");

    const previousEmailRuntime = process.env.NOVA_EMAIL_RUNTIME;
    process.env.NOVA_EMAIL_RUNTIME = "https";
    try {
      const workerConnections = await request("GET", "/email-connections", undefined, founderCookie);
      assertStatus("https_runtime_email_connection_list", workerConnections, 200);
      assert(JSON.stringify(workerConnections.body?.supportedProviders) === JSON.stringify(["gmail_oauth2", "resend"])
        && workerConnections.body?.connections?.some((connection: any) => connection.id === gmailConnectionId),
      "https_runtime_advertises_https_providers_and_preserves_existing_connection_metadata");

      const workerGmailName = `NOVA HTTPS Gmail ${randomUUID()}`;
      const workerGmail = await request("POST", "/email-connections", {
        credentials: { clientId: "nova-qa.apps.googleusercontent.com", clientSecret: "synthetic-worker-secret" },
        name: workerGmailName,
        provider: "gmail_oauth2",
        senderEmail: founderEmail,
      }, founderCookie);
      assertStatus("https_runtime_accepts_gmail_connection", workerGmail, 201);
      const workerGmailConnect = await request(
        "POST", `/email-connections/${workerGmail.body?.connection?.id}/gmail/connect`, undefined, founderCookie,
      );
      assertStatus("https_runtime_starts_gmail_oauth", workerGmailConnect, 200);
      const workerGmailAuthorizationUrl = new URL(field("https_gmail_authorization", workerGmailConnect, "authorizationUrl"));
      assert(workerGmailAuthorizationUrl.searchParams.get("scope") === "https://www.googleapis.com/auth/gmail.send"
        && workerGmailAuthorizationUrl.searchParams.get("redirect_uri")
          === smokeOrigin + "/api/email-connections/gmail/callback",
      "https_runtime_uses_the_same_least_privilege_gmail_flow");

      const unsupportedSmtpName = `NOVA unsupported HTTPS SMTP ${randomUUID()}`;
      const unsupportedSmtp = await request("POST", "/email-connections", {
        credentials: { host: "smtp.example.test", password: "synthetic", port: 587, secure: false, username: "qa" },
        name: unsupportedSmtpName,
        provider: "smtp",
        senderEmail: founderEmail,
      }, founderCookie);
      assertStatus("https_runtime_rejects_smtp_connection", unsupportedSmtp, 422);
      assert(unsupportedSmtp.body?.error === "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME",
        "https_runtime_smtp_rejection_is_clear_and_stable");
      const rejectedProviderRow = await sql<{ count: string }>(
        `SELECT count(*)::text AS count FROM nova.email_provider_connections
         WHERE name = $1`,
        [unsupportedSmtpName],
      );
      assert(rejectedProviderRow[0]?.count === "0", "https_runtime_rejection_does_not_persist_credentials");
    } finally {
      if (previousEmailRuntime === undefined) delete process.env.NOVA_EMAIL_RUNTIME;
      else process.env.NOVA_EMAIL_RUNTIME = previousEmailRuntime;
    }

    const reconnect = await request(
      "POST", `/email-connections/${gmailConnectionId}/gmail/connect`, undefined, founderCookie,
    );
    assertStatus("gmail_oauth_reconnect_start", reconnect, 200);
    const reconnectUrl = new URL(field("gmail_oauth_reconnect", reconnect, "authorizationUrl"));
    const reconnectCallbackUrl = new URL("/api/email-connections/gmail/callback", smokeOrigin);
    reconnectCallbackUrl.searchParams.set("code", "synthetic-reconnect-code");
    reconnectCallbackUrl.searchParams.set("state", reconnectUrl.searchParams.get("state") ?? "");
    globalThis.fetch = (async () => new Response(JSON.stringify({
      access_token: "synthetic-google-access-token",
      expires_in: 3600,
      refresh_token: "synthetic-insufficient-scope-refresh-token",
      scope: "openid email",
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const missingSendScope = await requestUrl(reconnectCallbackUrl.toString());
    assertStatus("gmail_oauth_missing_send_scope", missingSendScope, 422);
    const credentialsAfterFailedReconnect = (await sql<{ credentials_ciphertext: Buffer }>(
      "SELECT credentials_ciphertext FROM nova.email_provider_connections WHERE id = $1::uuid",
      [gmailConnectionId],
    ))[0]?.credentials_ciphertext;
    assert(credentialsAfterFailedReconnect?.equals(savedCredentials) === true,
      "gmail_failed_reconnect_preserves_existing_encrypted_credentials");

    const expiredConnect = await request(
      "POST", `/email-connections/${gmailConnectionId}/gmail/connect`, undefined, founderCookie,
    );
    assertStatus("gmail_oauth_expired_attempt_start", expiredConnect, 200);
    const expiredUrl = new URL(field("gmail_oauth_expired_attempt", expiredConnect, "authorizationUrl"));
    const expiredStateHash = createHash("sha256").update(expiredUrl.searchParams.get("state") ?? "").digest();
    const expiredAttempt = await sql<{ id: string }>(
      `UPDATE nova.email_oauth_attempts
       SET created_at = now() - interval '20 minutes', expires_at = now() - interval '1 second'
       WHERE state_hash = $1 AND consumed_at IS NULL
       RETURNING id`,
      [expiredStateHash],
    );
    assert(expiredAttempt.length === 1, "gmail_oauth_attempt_expiry_fixture_created");
    let expiredTokenExchangeCalls = 0;
    globalThis.fetch = (async () => {
      expiredTokenExchangeCalls += 1;
      return new Response("unexpected token exchange", { status: 500 });
    }) as unknown as typeof fetch;
    const expiredCallbackUrl = new URL("/api/email-connections/gmail/callback", smokeOrigin);
    expiredCallbackUrl.searchParams.set("code", "synthetic-expired-code");
    expiredCallbackUrl.searchParams.set("state", expiredUrl.searchParams.get("state") ?? "");
    const expiredCallback = await requestUrl(expiredCallbackUrl.toString());
    assertStatus("gmail_oauth_expired_state", expiredCallback, 400);
    assert(expiredCallback.body?.error === "GMAIL_OAUTH_STATE_INVALID"
      && expiredTokenExchangeCalls === 0, "gmail_expired_state_is_rejected_before_external_exchange");
  } finally {
    globalThis.fetch = previousFetch;
  }

  const actorGrants = await request("GET", "/me/permission-grants", undefined, founderCookie);
  assertStatus("current_actor_permission_grants", actorGrants, 200);
  assert(actorGrants.body?.actorPersonId === founder.id, "permission_grants_are_bound_to_authenticated_actor");
  assert(actorGrants.body?.isSuperAdmin === true, "protected_owner_capability_is_server_resolved");
  assert(actorGrants.body?.grants?.some((grant: any) => grant.permissionKey === "roles.view" && grant.scope === "organisation"),
    "actor_grants_include_active_organisation_role_permission");
  const permissionCatalogue = await request("GET", "/permissions", undefined, founderCookie);
  assertStatus("canonical_permission_catalogue_for_role_starters", permissionCatalogue, 200);
  for (const preset of rolePresets) {
    const draft = rolePresetDraft(preset.id, permissionCatalogue.body?.permissions);
    assert(Boolean(draft), `role_starter_${preset.id}_resolves`);
    assert(draft?.omitted.length === 0, `role_starter_${preset.id}_uses_current_catalogue_scopes`);
    assert((draft?.grants.length || 0) > 0, `role_starter_${preset.id}_has_permissions`);
    console.info(`role_starter_${preset.id}: ${draft?.grants.length} grants; ${draft?.targetGrantCount} exact targets required`);
  }
  const existingRoles = await request("GET", "/roles", undefined, founderCookie);
  assertStatus("role_starter_existing_roles_read", existingRoles, 200);
  assert(Array.isArray(existingRoles.body?.roles), "role_starter_existing_roles_have_list_shape");
  const employeeDraft = rolePresetDraft("employee", permissionCatalogue.body?.permissions);
  assert(Boolean(employeeDraft) && employeeDraft!.targetGrantCount === 0,
    "employee_starter_has_no_unselected_scope_targets");
  const employeeStarterKey = `qa_${employeeDraft!.key}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const employeeStarterName = `NOVA QA ${employeeDraft!.name} starter ${randomUUID().slice(0, 8)}`;
  const employeeStarter = await request("POST", "/roles", {
    key: employeeStarterKey,
    name: employeeStarterName,
    permissionGrants: employeeDraft!.grants,
    operationalPolicy: employeeDraft!.operationalPolicy,
  }, founderCookie);
  assertStatus("employee_starter_role_created_through_normal_role_api", employeeStarter, 201);
  const employeeStarterRoleId = field("employee_starter_role", employeeStarter, "roleId");
  const rolesAfterStarterCreate = await request("GET", "/roles", undefined, founderCookie);
  assertStatus("employee_starter_role_readback", rolesAfterStarterCreate, 200);
  const savedEmployeeStarter = rolesAfterStarterCreate.body?.roles?.find((item: any) => item.id === employeeStarterRoleId);
  const expectedEmployeeGrants = employeeDraft!.grants
    .map((grant: any) => `${grant.permissionKey}:${grant.scope}`).sort();
  const actualEmployeeGrants = (savedEmployeeStarter?.permissionGrants ?? [])
    .map((grant: any) => `${grant.permissionKey}:${grant.scope}`).sort();
  assert(savedEmployeeStarter?.key === employeeStarterKey
    && savedEmployeeStarter?.revision === 1
    && JSON.stringify(actualEmployeeGrants) === JSON.stringify(expectedEmployeeGrants),
  "employee_starter_permissions_and_role_key_persist_exactly");
  assert(Object.entries(employeeDraft!.operationalPolicy).every(([key, value]) =>
    savedEmployeeStarter?.operationalPolicy?.[key] === value),
  "employee_starter_operational_policy_persists_exactly");

  const hrDraft = rolePresetDraft("hr", permissionCatalogue.body?.permissions);
  assert(Boolean(hrDraft) && hrDraft!.targetGrantCount > 0,
    "scoped_starter_requires_explicit_targets");
  const hrStarterKey = `qa_${hrDraft!.key}_incomplete_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const incompleteHrStarter = await request("POST", "/roles", {
    key: hrStarterKey,
    name: `NOVA QA ${hrDraft!.name} incomplete ${randomUUID().slice(0, 8)}`,
    permissionGrants: hrDraft!.grants,
    operationalPolicy: hrDraft!.operationalPolicy,
  }, founderCookie);
  assertStatus("hr_starter_without_scope_targets_rejected", incompleteHrStarter, 400);
  assert(incompleteHrStarter.body?.error === "ROLE_INPUT_INVALID",
    "hr_starter_without_scope_targets_returns_stable_validation_error");
  const rolesAfterIncompleteStarter = await request("GET", "/roles", undefined, founderCookie);
  assertStatus("incomplete_hr_starter_no_partial_role_read", rolesAfterIncompleteStarter, 200);
  assert(!rolesAfterIncompleteStarter.body?.roles?.some((item: any) => item.key === hrStarterKey),
    "hr_starter_missing_targets_creates_no_partial_role");
  const organisation = await request("GET", "/organisation", undefined, founderCookie);
  assertStatus("organisation_read", organisation, 200);
  assert(organisation.body?.organisation?.attendancePolicy?.mode === "scheduled", "selected_attendance_mode_persisted");

  const officeResponse = await request("POST", "/offices", {
    name: `NOVA Lifecycle Office ${randomUUID().slice(0, 8)}`,
    location: "Disposable direct PostgreSQL runtime test",
    timezone: "Asia/Kolkata",
    latitude: 12.9716,
    longitude: 77.5946,
    geofenceRadiusMeters: 100,
  }, founderCookie);
  assertStatus("lifecycle_office_create", officeResponse, 201);
  const officeId = field("lifecycle_office", officeResponse, "officeId");
  const departmentResponse = await request("POST", "/organisation-departments", {
    name: `NOVA Lifecycle Department ${randomUUID().slice(0, 8)}`,
  }, founderCookie);
  assertStatus("lifecycle_department_create", departmentResponse, 201);
  const departmentId = field("lifecycle_department", departmentResponse, "organisationDepartmentId");
  const today = (await sql<{ today: string }>(
    "SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today",
  ))[0]?.today;
  assert(Boolean(today), "office_business_date_available");

  const grants: Array<{
    permissionKey: string;
    scope: string;
    organisationDepartmentId?: string;
    clientWorkstreamId?: string;
  }> = [
    { permissionKey: "people.view", scope: "organisation_department", organisationDepartmentId: departmentId },
    { permissionKey: "tasks.start", scope: "assigned_work" },
    { permissionKey: "tasks.submit", scope: "assigned_work" },
    { permissionKey: "tasks.review", scope: "assigned_work" },
    { permissionKey: "tasks.reviewer_request", scope: "assigned_work" },
    { permissionKey: "tasks.handover_request", scope: "assigned_work" },
    { permissionKey: "tasks.handover_accept", scope: "assigned_work" },
  ];
  const operationalPolicy = {
    workEnabled: true,
    canReceiveAssignments: true,
    attendanceRequired: false,
    wfhAllowed: false,
    canWorkWithoutAttendance: true,
    payrollApplicable: false,
    payrollAttendanceContributes: false,
    payrollOvertimeApplicable: false,
  };
  const roleInput = {
    key: `lifecycle_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    name: "NOVA Lifecycle Least Privilege",
    permissionGrants: grants,
    operationalPolicy,
  };
  const role = await request("POST", "/roles", roleInput, founderCookie);
  assertStatus("least_privilege_role_create", role, 201);
  const roleId = field("role_create", role, "roleId");
  assert(role.body?.revision === 1, "new_role_starts_at_revision_one");
  let roleRevision = role.body.revision as number;
  const updateRole = async (input: typeof roleInput | typeof roleInput & { permissionGrants: typeof grants }) => {
    const result = await request("PATCH", `/roles/${roleId}`, {
      ...input,
      expectedRevision: roleRevision,
    }, founderCookie);
    if (result.status === 200 && Number.isSafeInteger(result.body?.revision)) {
      roleRevision = result.body.revision;
    }
    return result;
  };
  const listedRoles = await request("GET", "/roles", undefined, founderCookie);
  assertStatus("role_readback", listedRoles, 200);
  const storedRole = listedRoles.body?.roles?.find((item: any) => item.id === roleId);
  assert(Boolean(storedRole), "created_role_readable");
  assert(storedRole.revision === roleRevision, "role_readback_includes_revision");
  assert(storedRole.permissionGrants.length === grants.length, "role_grants_retained_exactly");
  assert(storedRole.operationalPolicy.workEnabled === true && storedRole.operationalPolicy.canReceiveAssignments === true, "role_operational_policy_retained");

  const emptyRole = { ...roleInput, permissionGrants: [], operationalPolicy: {
    workEnabled: false, canReceiveAssignments: false, attendanceRequired: false, wfhAllowed: false,
    canWorkWithoutAttendance: false, payrollApplicable: false, payrollAttendanceContributes: false,
    payrollOvertimeApplicable: false,
  } };
  const raceFullRole = { ...roleInput, name: `NOVA Lifecycle Role Full ${randomUUID().slice(0, 8)}` };
  const raceEmptyRole = { ...emptyRole, name: `NOVA Lifecycle Role Empty ${randomUUID().slice(0, 8)}` };
  const expectedRoleRevision = roleRevision;
  const [raceFullUpdate, raceEmptyUpdate] = await Promise.all([
    request("PATCH", `/roles/${roleId}`, { ...raceFullRole, expectedRevision: expectedRoleRevision }, founderCookie),
    request("PATCH", `/roles/${roleId}`, { ...raceEmptyRole, expectedRevision: expectedRoleRevision }, founderCookie),
  ]);
  const roleRaceWinners = [raceFullUpdate, raceEmptyUpdate].filter((result) => result.status === 200);
  const roleRaceLosers = [raceFullUpdate, raceEmptyUpdate].filter((result) => result.status === 409);
  assert(roleRaceWinners.length === 1, "concurrent_role_edits_have_one_winner");
  assert(roleRaceLosers.length === 1 && roleRaceLosers[0]?.body?.error === "ROLE_VERSION_CONFLICT",
    "stale_concurrent_role_edit_has_stable_conflict");
  const winningRoleInput = raceFullUpdate.status === 200 ? raceFullRole : raceEmptyRole;
  const roleAfterRace = await request("GET", "/roles", undefined, founderCookie);
  assertStatus("concurrent_role_edit_readback", roleAfterRace, 200);
  const savedRoleAfterRace = roleAfterRace.body?.roles?.find((item: any) => item.id === roleId);
  assert(savedRoleAfterRace?.revision === expectedRoleRevision + 1
    && savedRoleAfterRace.name === winningRoleInput.name
    && savedRoleAfterRace.permissionGrants.length === winningRoleInput.permissionGrants.length
    && savedRoleAfterRace.operationalPolicy.workEnabled === winningRoleInput.operationalPolicy.workEnabled,
  "concurrent_role_edit_persists_one_complete_revision_without_mixed_fields");
  roleRevision = savedRoleAfterRace.revision;

  const removed = await updateRole(emptyRole);
  assertStatus("role_permission_revoke", removed, 200);
  const roleRevocationAudit = (await sql<{
    before_grants: Array<{ permissionKey: string }>;
    after_grants: Array<{ permissionKey: string }>;
    before_policy: { workEnabled: boolean };
    after_policy: { workEnabled: boolean };
  }>(
    `SELECT details->'before'->'permissionGrants' AS before_grants,
            details->'after'->'permissionGrants' AS after_grants,
            details->'before'->'operationalPolicy' AS before_policy,
            details->'after'->'operationalPolicy' AS after_policy
     FROM nova.audit_events
     WHERE target_id = $1::uuid AND action = 'roles.update'
       AND details->'after'->'permissionGrants' = '[]'::jsonb
       AND details->'after'->>'revision' = $2::text
     LIMIT 1`,
    [roleId, roleRevision],
  ))[0];
  assert(roleRevocationAudit?.before_grants.length === winningRoleInput.permissionGrants.length
    && roleRevocationAudit.after_grants.length === 0,
  "role_edit_audit_captures_exact_before_and_after_grants");
  assert(roleRevocationAudit?.before_policy.workEnabled === winningRoleInput.operationalPolicy.workEnabled
    && roleRevocationAudit.after_policy.workEnabled === false,
  "role_edit_audit_captures_operational_policy_change");
  const personListAfterRevoke = await request("GET", "/people", undefined, founderCookie);
  assertStatus("admin_people_read_after_role_revoke", personListAfterRevoke, 200);
  const restored = await updateRole(roleInput);
  assertStatus("role_permission_restore", restored, 200);

  const expiredInviteEmail = `nova-expired-invite-${randomUUID()}@example.test`;
  const expiredInvite = await request("POST", "/people/invitations", {
    displayName: "NOVA Expired Invitation Fixture",
    email: expiredInviteEmail,
    deliveryMode: "manual",
  }, founderCookie);
  assertStatus("expired_invitation_fixture_create", expiredInvite, 201);
  const expiredInviteTokenHandoff = await revealOnceConcurrently(field("expired_invitation", expiredInvite, "manualHandoffId"), founderCookie);
  const expiredInviteFragment = new URL(expiredInviteTokenHandoff.url).hash.slice(1);
  const expiredInviteToken = new URLSearchParams(expiredInviteFragment).get("token");
  assert(Boolean(expiredInviteToken), "expired_invitation_token_is_fragment_only");
  const expiredInviteRow = await sql<{ id: string }>(
    `UPDATE nova.person_invitations
     SET expires_at = clock_timestamp() - interval '1 microsecond'
     WHERE id = $1::uuid
     RETURNING id`,
    [field("expired_invitation", expiredInvite, "invitationId")],
  );
  assert(expiredInviteRow.length === 1, "expired_invitation_fixture_targets_one_database_row");
  const expiredInviteAcceptance = await request("POST", "/invitations/accept", {
    email: expiredInviteEmail,
    name: "NOVA Expired Invitation Fixture",
    password: `N0va-Expired-${randomUUID()}-Xx!`,
    invitationToken: expiredInviteToken,
  });
  assertStatus("expired_invitation_token_rejected", expiredInviteAcceptance, 422);
  assert(expiredInviteAcceptance.body?.error === "INVITATION_INVALID_OR_EXPIRED", "expired_invitation_has_generic_failure");

  const firstEmail = `nova-worker-a-${randomUUID()}@example.test`;
  const firstPassword = `N0va-Worker-${randomUUID()}-Aa!`;
  const firstEmployee = await completeInviteAndOnboard({
    adminCookie: founderCookie,
    departmentId,
    displayName: "NOVA Lifecycle Employee A",
    email: firstEmail,
    officeId,
    password: firstPassword,
    roleId,
    founderId: founder.id,
    employmentDate: today!,
    concurrentOnboarding: true,
  });

  const duplicateInviteEmail = `nova-worker-b-${randomUUID()}@example.test`;
  const secondPassword = `N0va-Worker-${randomUUID()}-Bb!`;
  const competingInvites = await Promise.all([
    request("POST", "/people/invitations", { displayName: "NOVA Lifecycle Employee B", email: duplicateInviteEmail, deliveryMode: "manual" }, founderCookie),
    request("POST", "/people/invitations", { displayName: "NOVA Lifecycle Employee B", email: duplicateInviteEmail, deliveryMode: "manual" }, founderCookie),
  ]);
  assert(competingInvites.filter((result) => result.status === 201).length === 1, "concurrent_duplicate_invites_create_one_person");
  assert(competingInvites.filter((result) => result.status === 409).length === 1, "concurrent_duplicate_invites_reject_duplicate");
  const successfulInvite = competingInvites.find((result) => result.status === 201)!;
  const secondEmployee = await completeInviteAndOnboard({
    adminCookie: founderCookie,
    departmentId,
    displayName: "NOVA Lifecycle Employee B",
    email: duplicateInviteEmail,
    officeId,
    password: secondPassword,
    roleId,
    founderId: founder.id,
    employmentDate: today!,
    invitationResult: successfulInvite,
  });
  const thirdEmail = `nova-worker-c-${randomUUID()}@example.test`;
  const thirdEmployee = await completeInviteAndOnboard({
    adminCookie: founderCookie,
    departmentId,
    displayName: "NOVA Lifecycle Employee C",
    email: thirdEmail,
    officeId,
    password: `N0va-Worker-${randomUUID()}-Dd!`,
    roleId,
    founderId: founder.id,
    employmentDate: today!,
  });

  const restrictedPeople = await request("GET", "/people", undefined, firstEmployee.cookie);
  assertStatus("department_scoped_people_read", restrictedPeople, 200);
  assert(restrictedPeople.body?.people?.some((person: any) => person.id === firstEmployee.personId), "employee_can_see_own_department");
  assert(!restrictedPeople.body?.people?.some((person: any) => person.id === founder.id), "employee_cannot_see_out_of_scope_founder");
  assertStatus("employee_role_read_denied", await request("GET", "/roles", undefined, firstEmployee.cookie), 403);
  assertStatus("employee_role_escalation_denied", await request("POST", "/roles", {
    key: `attempt_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    name: "Unauthorized role escalation",
    permissionGrants: [],
    operationalPolicy,
  }, firstEmployee.cookie), 403);

  const deniedRole = await updateRole(emptyRole);
  assertStatus("role_permission_live_revocation", deniedRole, 200);
  assertStatus("revoked_role_permission_effective_immediately", await request("GET", "/people", undefined, firstEmployee.cookie), 403);
  const regrantedRole = await updateRole(roleInput);
  assertStatus("role_permission_live_regrant", regrantedRole, 200);
  assertStatus("regranted_role_permission_effective", await request("GET", "/people", undefined, firstEmployee.cookie), 200);

  await request("POST", "/auth/request-password-reset", {
    email: firstEmail,
    redirectTo: `${smokeOrigin}/reset-password`,
  }, firstEmployee.cookie).then((result) => assertStatus("password_reset_request", result, 200));
  const resetHandoff = await listHandoffs(founderCookie, "password_reset", firstEmployee.personId);
  const resetLink = await revealOnceConcurrently(resetHandoff.id, founderCookie);
  const resetRedirect = await requestUrl(resetLink.url);
  assertStatus("password_reset_link_redirect", resetRedirect, [302, 303]);
  assert(Boolean(resetRedirect.location), "password_reset_redirect_location_present");
  const resetTarget = new URL(resetRedirect.location!);
  assert(resetTarget.pathname === "/reset-password" && Boolean(resetTarget.searchParams.get("token")), "password_reset_opens_reset_screen_with_token");
  const resetToken = resetTarget.searchParams.get("token")!;
  const resetPassword = `N0va-Reset-${randomUUID()}-Cc!`;
  const resets = await Promise.all([
    request("POST", "/auth/reset-password", { newPassword: resetPassword, token: resetToken }),
    request("POST", "/auth/reset-password", { newPassword: resetPassword, token: resetToken }),
  ]);
  assert(resets.filter((result) => result.status === 200).length === 1, "password_reset_token_consumed_once_under_race");
  assert(resets.filter((result) => result.status !== 200).length === 1, "password_reset_replay_rejected");
  const staleSession = await request("GET", "/auth/get-session", undefined, firstEmployee.cookie);
  assertStatus("old_session_after_password_reset", staleSession, 200);
  assert(!staleSession.body?.session, "password_reset_revokes_existing_session");
  const firstSignInAfterReset = await request("POST", "/auth/sign-in/email", { email: firstEmail, password: resetPassword });
  assertStatus("new_password_sign_in", firstSignInAfterReset, 200);
  firstEmployee.cookie = firstSignInAfterReset.cookie!;

  const expiryReset = await request("POST", "/auth/request-password-reset", {
    email: firstEmail,
    redirectTo: `${smokeOrigin}/reset-password`,
  }, firstEmployee.cookie);
  assertStatus("expiry_password_reset_request", expiryReset, 200);
  const expiryResetHandoff = await listHandoffs(founderCookie, "password_reset", firstEmployee.personId);
  const expiryResetLink = await revealOnceConcurrently(expiryResetHandoff.id, founderCookie);
  const expiryResetTokenMatch = new URL(expiryResetLink.url).pathname.match(/\/reset-password\/([^/]+)$/);
  const expiryResetToken = expiryResetTokenMatch?.[1];
  assert(Boolean(expiryResetToken), "expiry_password_reset_token_found_in_route");
  const expiredResetTokenRow = await sql<{ id: string }>(
    `UPDATE nova_auth.verification
     SET "expiresAt" = clock_timestamp() - interval '1 microsecond'
     WHERE identifier = $1
     RETURNING id`,
    [`reset-password:${expiryResetToken}`],
  );
  assert(expiredResetTokenRow.length === 1, "expired_password_reset_fixture_targets_one_database_row");
  const expiredResetAttempt = await request("POST", "/auth/reset-password", {
    newPassword: `N0va-Expired-Reset-${randomUUID()}-Xx!`,
    token: expiryResetToken,
  });
  assertStatus("expired_password_reset_token_rejected", expiredResetAttempt, 400);
  const priorPasswordStillWorks = await request("POST", "/auth/sign-in/email", {
    email: firstEmail,
    password: resetPassword,
  });
  assertStatus("expired_password_reset_leaves_credential_unchanged", priorPasswordStillWorks, 200);
  await sql(
    `UPDATE nova.auth_handoffs
     SET created_at = clock_timestamp() - interval '1 day',
         expires_at = clock_timestamp() - interval '1 microsecond'
     WHERE id = $1::uuid`,
    [expiryResetHandoff.id],
  );
  const expiredAuthHandoffReveal = await request(
    "POST", `/auth-handoffs/${expiryResetHandoff.id}/reveal`, undefined, founderCookie,
  );
  assertStatus("expired_auth_handoff_reveal", expiredAuthHandoffReveal, 409);
  assert(expiredAuthHandoffReveal.body?.error === "AUTH_HANDOFF_NOT_AVAILABLE"
    && !expiredAuthHandoffReveal.body?.handoff?.url,
  "expired_auth_handoff_never_reveals_secret");
  const visibleAuthHandoffs = await request("GET", "/auth-handoffs", undefined, founderCookie);
  assertStatus("auth_handoffs_after_expiry", visibleAuthHandoffs, 200);
  assert(!visibleAuthHandoffs.body?.handoffs?.some((handoff: any) => handoff.id === expiryResetHandoff.id),
    "expired_auth_handoff_is_not_listed");

  const client = await request("POST", "/clients", { name: `NOVA Lifecycle Client ${randomUUID().slice(0, 8)}` }, founderCookie);
  assertStatus("lifecycle_client_create", client, 201);
  const clientId = field("lifecycle_client", client, "clientId");
  const workstream = await request("POST", "/workstreams/client", { clientId, name: "Lifecycle workstream" }, founderCookie);
  assertStatus("lifecycle_workstream_create", workstream, 201);
  const workstreamId = field("lifecycle_workstream", workstream, "workstreamId");
  const group = await request("POST", "/work-groups", {
    clientWorkstreamId: workstreamId, name: "Lifecycle group",
  }, founderCookie);
  assertStatus("lifecycle_group_create_under_active_workstream", group, 201);
  const groupId = field("lifecycle_group", group, "groupId");
  const archivedWorkstream = await sql<{ id: string }>(
    "UPDATE nova.client_workstreams SET archived_at = clock_timestamp() WHERE id = $1::uuid RETURNING id",
    [workstreamId],
  );
  assert(archivedWorkstream.length === 1, "archive_workstream_fixture_ready");
  try {
    const hiddenWorkContext = await request("GET", "/work-context", undefined, founderCookie);
    assertStatus("archived_workstream_removed_from_work_context", hiddenWorkContext, 200);
    assert(!hiddenWorkContext.body?.clientWorkstreams?.some((item: any) => item.id === workstreamId)
      && !hiddenWorkContext.body?.groups?.some((item: any) => item.id === groupId),
    "archived_parent_hides_workstream_and_group_creation_targets");
    const groupUnderArchivedWorkstream = await request("POST", "/work-groups", {
      clientWorkstreamId: workstreamId, name: "Must not attach to archived workstream",
    }, founderCookie);
    assertStatus("group_create_under_archived_workstream", groupUnderArchivedWorkstream, 404);
    assert(groupUnderArchivedWorkstream.body?.error === "WORKSTREAM_NOT_FOUND",
      "archived_workstream_group_create_has_stable_not_found");
    const taskUnderArchivedWorkstream = await request("POST", "/tasks", {
      clientWorkstreamId: workstreamId, workGroupId: groupId,
      title: "Must not create work under archived workstream", assignToSelf: false,
    }, founderCookie);
    assertStatus("task_create_under_archived_workstream", taskUnderArchivedWorkstream, 409);
    assert(taskUnderArchivedWorkstream.body?.error === "TASK_CONTEXT_INVALID",
      "archived_workstream_task_create_has_stable_conflict");
    await assertNoGroupOrTaskWrites("archived_workstream_rejections_leave_no_partial_records",
      "Must not attach to archived workstream", "Must not create work under archived workstream");
  } finally {
    await sql("UPDATE nova.client_workstreams SET archived_at = NULL WHERE id = $1::uuid", [workstreamId]);
  }
  const archivedClient = await sql<{ id: string }>(
    "UPDATE nova.clients SET archived_at = clock_timestamp() WHERE id = $1::uuid RETURNING id",
    [clientId],
  );
  assert(archivedClient.length === 1, "archive_client_fixture_ready");
  try {
    const archivedClientPolicy = (await sql<{
      billing_policy_class: string | null; billing_policy_revision: number;
    }>(
      "SELECT billing_policy_class, billing_policy_revision FROM nova.client_workstreams WHERE id = $1::uuid",
      [workstreamId],
    ))[0];
    assert(archivedClientPolicy !== undefined, "archived_client_billing_policy_fixture_ready");
    const hiddenClientContext = await request("GET", "/work-context", undefined, founderCookie);
    assertStatus("archived_client_removed_from_work_context", hiddenClientContext, 200);
    assert(!hiddenClientContext.body?.clients?.some((item: any) => item.id === clientId)
      && !hiddenClientContext.body?.clientWorkstreams?.some((item: any) => item.id === workstreamId)
      && !hiddenClientContext.body?.groups?.some((item: any) => item.id === groupId),
    "archived_client_hides_all_new_work_targets");
    const streamUnderArchivedClient = await request("POST", "/workstreams/client", {
      clientId, name: "Must not add stream to archived client",
    }, founderCookie);
    assertStatus("client_workstream_create_under_archived_client", streamUnderArchivedClient, 404);
    assert(streamUnderArchivedClient.body?.error === "CLIENT_NOT_FOUND",
      "archived_client_workstream_create_has_stable_not_found");
    const groupUnderArchivedClient = await request("POST", "/work-groups", {
      clientWorkstreamId: workstreamId, name: "Must not attach to archived client",
    }, founderCookie);
    assertStatus("group_create_under_archived_client", groupUnderArchivedClient, 404);
    const taskUnderArchivedClient = await request("POST", "/tasks", {
      clientWorkstreamId: workstreamId, title: "Must not create work under archived client", assignToSelf: false,
    }, founderCookie);
    assertStatus("task_create_under_archived_client", taskUnderArchivedClient, 409);
    assert(taskUnderArchivedClient.body?.error === "TASK_CONTEXT_INVALID",
      "archived_client_task_create_has_stable_conflict");
    const billingPolicyUnderArchivedClient = await request("PATCH", `/workstreams/client/${workstreamId}/billing-policy`, {
      policyClass: "billable", expectedRevision: archivedClientPolicy.billing_policy_revision,
      reason: "Archived client billing policy must remain immutable through active APIs.",
    }, founderCookie);
    assertStatus("billing_policy_update_under_archived_client", billingPolicyUnderArchivedClient, 404);
    assert(billingPolicyUnderArchivedClient.body?.error === "WORKSTREAM_NOT_FOUND",
      "archived_client_billing_policy_update_has_stable_not_found");
    const billingDefinitionsUnderArchivedClient = await request(
      "GET", `/workstreams/client/${workstreamId}/billing-policy/definitions`, undefined, founderCookie,
    );
    assertStatus("billing_definitions_read_under_archived_client", billingDefinitionsUnderArchivedClient, 404);
    assert(billingDefinitionsUnderArchivedClient.body?.error === "WORKSTREAM_NOT_FOUND",
      "archived_client_billing_definitions_have_stable_not_found");
    const billingDefinitionUpdateUnderArchivedClient = await request(
      "PATCH", `/workstreams/client/${workstreamId}/billing-policy/definitions/${randomUUID()}`, {
        policyClass: null, expectedRevision: 0,
        reason: "Archived client task billing definitions must remain immutable through active APIs.",
      }, founderCookie,
    );
    assertStatus("billing_definition_update_under_archived_client", billingDefinitionUpdateUnderArchivedClient, 404);
    assert(billingDefinitionUpdateUnderArchivedClient.body?.error === "WORKSTREAM_NOT_FOUND",
      "archived_client_billing_definition_update_has_stable_not_found");
    const unchangedArchivedClientPolicy = (await sql<{
      billing_policy_class: string | null; billing_policy_revision: number;
    }>(
      "SELECT billing_policy_class, billing_policy_revision FROM nova.client_workstreams WHERE id = $1::uuid",
      [workstreamId],
    ))[0];
    assert(unchangedArchivedClientPolicy?.billing_policy_class === archivedClientPolicy.billing_policy_class
      && unchangedArchivedClientPolicy.billing_policy_revision === archivedClientPolicy.billing_policy_revision,
    "archived_client_billing_policy_rejections_leave_no_partial_change");
    await assertNoGroupOrTaskWrites("archived_client_rejections_leave_no_partial_records",
      "Must not attach to archived client", "Must not create work under archived client");
  } finally {
    await sql("UPDATE nova.clients SET archived_at = NULL WHERE id = $1::uuid", [clientId]);
  }
  const organisationWorkstream = await request("POST", "/workstreams/organisation", {
    name: "Lifecycle organisation workstream",
  }, founderCookie);
  assertStatus("lifecycle_organisation_workstream_create", organisationWorkstream, 201);
  const organisationWorkstreamId = field("lifecycle_organisation_workstream", organisationWorkstream, "workstreamId");
  const organisationGroup = await request("POST", "/work-groups", {
    organisationWorkstreamId, name: "Lifecycle organisation group",
  }, founderCookie);
  assertStatus("lifecycle_group_create_under_active_organisation_workstream", organisationGroup, 201);
  const organisationGroupId = field("lifecycle_organisation_group", organisationGroup, "groupId");
  const archivedOrganisationWorkstream = await sql<{ id: string }>(
    "UPDATE nova.organisation_workstreams SET archived_at = clock_timestamp() WHERE id = $1::uuid RETURNING id",
    [organisationWorkstreamId],
  );
  assert(archivedOrganisationWorkstream.length === 1, "archive_organisation_workstream_fixture_ready");
  try {
    const hiddenOrganisationContext = await request("GET", "/work-context", undefined, founderCookie);
    assertStatus("archived_organisation_workstream_removed_from_context", hiddenOrganisationContext, 200);
    assert(!hiddenOrganisationContext.body?.organisationWorkstreams?.some((item: any) => item.id === organisationWorkstreamId)
      && !hiddenOrganisationContext.body?.groups?.some((item: any) => item.id === organisationGroupId),
    "archived_organisation_parent_hides_group_creation_targets");
    const groupUnderArchivedOrganisationWorkstream = await request("POST", "/work-groups", {
      organisationWorkstreamId, name: "Must not attach to archived organisation workstream",
    }, founderCookie);
    assertStatus("group_create_under_archived_organisation_workstream", groupUnderArchivedOrganisationWorkstream, 404);
    const taskUnderArchivedOrganisationWorkstream = await request("POST", "/tasks", {
      organisationWorkstreamId, workGroupId: organisationGroupId,
      title: "Must not create work under archived organisation workstream", assignToSelf: false,
    }, founderCookie);
    assertStatus("task_create_under_archived_organisation_workstream", taskUnderArchivedOrganisationWorkstream, 409);
    assert(taskUnderArchivedOrganisationWorkstream.body?.error === "TASK_CONTEXT_INVALID",
      "archived_organisation_workstream_task_create_has_stable_conflict");
    await assertNoGroupOrTaskWrites("archived_organisation_workstream_rejections_leave_no_partial_records",
      "Must not attach to archived organisation workstream", "Must not create work under archived organisation workstream");
  } finally {
    await sql("UPDATE nova.organisation_workstreams SET archived_at = NULL WHERE id = $1::uuid", [organisationWorkstreamId]);
  }
  const archivedGroup = await sql<{ id: string }>(
    "UPDATE nova.work_groups SET archived_at = clock_timestamp() WHERE id = $1::uuid RETURNING id",
    [groupId],
  );
  assert(archivedGroup.length === 1, "archive_group_fixture_ready");
  try {
    const taskUnderArchivedGroup = await request("POST", "/tasks", {
      clientWorkstreamId: workstreamId, workGroupId: groupId,
      title: "Must not create work under archived group", assignToSelf: false,
    }, founderCookie);
    assertStatus("task_create_under_archived_group", taskUnderArchivedGroup, 409);
    assert(taskUnderArchivedGroup.body?.error === "TASK_CONTEXT_INVALID",
      "archived_group_task_create_has_stable_conflict");
    await assertNoGroupOrTaskWrites("archived_group_rejection_leaves_no_partial_task",
      "unused archived-group name", "Must not create work under archived group");
  } finally {
    await sql("UPDATE nova.work_groups SET archived_at = NULL WHERE id = $1::uuid", [groupId]);
  }
  const unconfiguredPolicyTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Must wait for billing policy",
    assignToSelf: false,
  }, founderCookie);
  assertStatus("client_workstream_requires_policy_before_task_creation", unconfiguredPolicyTask, 409);
  assert(unconfiguredPolicyTask.body?.error === "TASK_BILLING_POLICY_NOT_CONFIGURED",
    "missing_policy_blocks_task_creation_with_stable_error");
  const missingPolicyRows = (await sql<{ count: string }>(
    "SELECT count(*)::text AS count FROM nova.tasks WHERE title = $1",
    ["Must wait for billing policy"],
  ))[0]?.count;
  assert(missingPolicyRows === "0", "missing_policy_leaves_no_partial_task");
  const configuredWorkstreamPolicy = await request("PATCH", `/workstreams/client/${workstreamId}/billing-policy`, {
    policyClass: "billable",
    expectedRevision: 0,
    reason: "This client workstream is covered by a billable delivery agreement.",
  }, founderCookie);
  assertStatus("authorized_admin_configures_client_workstream_policy", configuredWorkstreamPolicy, 200);
  assert(configuredWorkstreamPolicy.body?.policyClass === "billable"
    && configuredWorkstreamPolicy.body?.revision === 1
    && configuredWorkstreamPolicy.body?.changed === true,
  "policy_setup_is_revisioned_and_applies_to_future_tasks");
  const employeeCannotChangeBillingPolicy = await request("PATCH", `/workstreams/client/${workstreamId}/billing-policy`, {
    policyClass: "non_billable", expectedRevision: 1,
    reason: "An ordinary task editor must not control the workstream billing policy.",
  }, firstEmployee.cookie);
  assertStatus("task_editor_cannot_change_billing_policy_without_permission", employeeCannotChangeBillingPolicy, 403);
  assert(employeeCannotChangeBillingPolicy.body?.error === "PERMISSION_DENIED",
    "billing_policy_management_is_a_separate_role_permission");
  grants.push({ permissionKey: "tasks.create", scope: "client_workstream", clientWorkstreamId: workstreamId });
  grants.push({ permissionKey: "tasks.view", scope: "client_workstream", clientWorkstreamId: workstreamId });
  grants.push({ permissionKey: "tasks.catalog.view", scope: "organisation" });
  grants.push({ permissionKey: "tasks.catalog.propose", scope: "organisation" });
  grants.push({ permissionKey: "tasks.catalog.review", scope: "organisation" });
  const editorRole = await updateRole(roleInput);
  assertStatus("client_workstream_task_editor_permission_grant", editorRole, 200);
  const taskTemplateProposal = await request("POST", "/task-catalog", {
    title: "Client handoff checklist",
    description: "Confirm the deliverables and acceptance notes.",
    priority: "high",
    reason: "The team repeats this handoff work each month.",
  }, firstEmployee.cookie);
  assertStatus("employee_proposes_reusable_task_defaults", taskTemplateProposal, 201);
  assert(taskTemplateProposal.body?.status === "pending", "proposal_does_not_publish_catalog_entry");
  const taskTemplateProposalId = field("task_catalog_proposal", taskTemplateProposal, "proposalId");
  const selfReviewTaskTemplate = await request("POST", `/task-catalog/proposals/${taskTemplateProposalId}/review`, {
    decision: "approved",
  }, firstEmployee.cookie);
  assertStatus("catalog_proposer_cannot_approve_own_proposal", selfReviewTaskTemplate, 403);
  assert(selfReviewTaskTemplate.body?.error === "TASK_CATALOG_SELF_REVIEW", "catalog_self_review_has_stable_denial");
  const approveTaskTemplate = await request("POST", `/task-catalog/proposals/${taskTemplateProposalId}/review`, {
    decision: "approved",
  }, secondEmployee.cookie);
  assertStatus("separate_catalog_reviewer_approves_proposal", approveTaskTemplate, 200);
  const taskCatalogEntryId = field("task_catalog_approved", approveTaskTemplate, "entryId");
  const taskCatalogRevision = numberField("task_catalog_approved", approveTaskTemplate, "revision");
  const taskCatalogBillingInjection = await request("POST", "/task-catalog", {
    title: "A task definition cannot select billing",
    billingClass: "billable",
    priority: "normal",
    reason: "This field is not an authorized classification source.",
  }, founderCookie);
  assertStatus("task_definition_author_cannot_set_billing_class", taskCatalogBillingInjection, 400);
  assert(taskCatalogBillingInjection.body?.error === "TASK_CATALOG_INPUT_INVALID",
    "task_definition_billing_field_is_rejected");
  const employeeDefinitionBillingRuleEdit = await request(
    "PATCH", `/workstreams/client/${workstreamId}/billing-policy/definitions/${taskCatalogEntryId}`, {
      policyClass: "non_billable", expectedRevision: 0,
      reason: "An ordinary task editor cannot classify a reusable task.",
    }, firstEmployee.cookie,
  );
  assertStatus("ordinary_task_editor_cannot_set_definition_billing_rule", employeeDefinitionBillingRuleEdit, 403);
  assert(employeeDefinitionBillingRuleEdit.body?.error === "PERMISSION_DENIED",
    "per_definition_policy_requires_the_separate_billing_policy_permission");
  const definitionBillingRule = await request(
    "PATCH", `/workstreams/client/${workstreamId}/billing-policy/definitions/${taskCatalogEntryId}`, {
      policyClass: "non_billable", expectedRevision: 0,
      reason: "This predefined checklist is included in the client delivery agreement.",
    }, founderCookie,
  );
  assertStatus("authorized_policy_manager_sets_definition_billing_rule", definitionBillingRule, 200);
  assert(definitionBillingRule.body?.policyClass === "non_billable"
    && definitionBillingRule.body?.revision === 1
    && definitionBillingRule.body?.changed === true,
  "definition_rule_is_versioned_separately_from_the_workstream_default");
  const definitionRulesRead = await request(
    "GET", `/workstreams/client/${workstreamId}/billing-policy/definitions`, undefined, founderCookie,
  );
  assertStatus("policy_manager_reads_predefined_task_rules", definitionRulesRead, 200);
  assert(definitionRulesRead.body?.entries?.some((entry: any) => entry.entryId === taskCatalogEntryId
    && entry.billingClass === "non_billable" && entry.ruleRevision === 1),
  "read_model_exposes_admin_rule_and_its_revision_not_a_user_selector");
  const employeeDefinitionRulesRead = await request(
    "GET", `/workstreams/client/${workstreamId}/billing-policy/definitions`, undefined, firstEmployee.cookie,
  );
  assertStatus("ordinary_employee_cannot_manage_or_enumerate_billing_rules", employeeDefinitionRulesRead, 403);
  const billableTaskDefinition = await request("POST", "/task-catalog", {
    title: "Billable deliverable task",
    description: "Deliver a client-scoped work item.",
    priority: "normal",
    reason: "Reusable client work definition.",
  }, founderCookie);
  assertStatus("admin_creates_second_reusable_task_definition", billableTaskDefinition, 201);
  const billableTaskDefinitionId = field("billable_task_definition", billableTaskDefinition, "entryId");
  const billableTaskDefinitionRevision = numberField("billable_task_definition", billableTaskDefinition, "revision");
  const billableTaskDefinitionRule = await request(
    "PATCH", `/workstreams/client/${workstreamId}/billing-policy/definitions/${billableTaskDefinitionId}`, {
      policyClass: "billable", expectedRevision: 0,
      reason: "This reusable deliverable is billable under the signed client agreement.",
    }, founderCookie,
  );
  assertStatus("administrator_classifies_another_definition_as_billable", billableTaskDefinitionRule, 200);
  const staleDefinitionRule = await request(
    "PATCH", `/workstreams/client/${workstreamId}/billing-policy/definitions/${taskCatalogEntryId}`, {
      policyClass: "billable", expectedRevision: 0,
      reason: "A stale editor must not overwrite the current definition policy.",
    }, founderCookie,
  );
  assertStatus("stale_definition_billing_edit_returns_conflict", staleDefinitionRule, 409);
  assert(staleDefinitionRule.body?.error === "TASK_BILLING_RULE_VERSION_CONFLICT",
    "definition_rule_updates_use_optimistic_revision");
  const restrictedCatalog = await request("GET", "/task-catalog", undefined, firstEmployee.cookie);
  assertStatus("catalog_view_is_independent_of_billing_class", restrictedCatalog, 200);
  assert(restrictedCatalog.body?.permissions?.["tasks.catalog.view"] === true
    && restrictedCatalog.body?.permissions?.["tasks.create.billable"] === undefined
    && restrictedCatalog.body?.entries?.some((entry: any) => entry.id === taskCatalogEntryId
      && entry.billingClass === undefined),
  "catalog_content_has_no_billing_field_and_task_visibility_is_not_a_billing_grant");
  const billableDefinitionDenied = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    taskCatalogEntryId: billableTaskDefinitionId,
    taskCatalogRevision: billableTaskDefinitionRevision,
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("definition_billable_rule_requires_action_permission", billableDefinitionDenied, 403);
  assert(billableDefinitionDenied.body?.error === "PERMISSION_DENIED",
    "task_definition_selection_does_not_bypass_billable_action_permission");
  const nonBillableDefinitionTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId, taskCatalogEntryId, taskCatalogRevision, assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("definition_non_billable_rule_creates_without_billable_action_grant", nonBillableDefinitionTask, 201);
  assert(nonBillableDefinitionTask.body?.billingClass === "non_billable"
    && nonBillableDefinitionTask.body?.billingPolicySource === "client_workstream_task_definition",
  "selected_predefined_task_uses_admin_rule_without_client_supplied_class");
  grants.push({ permissionKey: "tasks.create.billable", scope: "organisation" });
  assertStatus("role_grants_action_permission_for_policy_classified_work", await updateRole(roleInput), 200);
  const catalogViewGrantIndex = grants.findIndex((grant) => grant.permissionKey === "tasks.catalog.view");
  assert(catalogViewGrantIndex >= 0, "catalog_view_grant_fixture_exists");
  const catalogViewGrant = grants.splice(catalogViewGrantIndex, 1)[0]!;
  assertStatus("role_revokes_catalog_visibility", await updateRole(roleInput), 200);
  const hiddenBillableCatalog = await request("GET", "/task-catalog", undefined, firstEmployee.cookie);
  assertStatus("catalog_visibility_is_separate_from_task_creation", hiddenBillableCatalog, 200);
  assert(hiddenBillableCatalog.body?.permissions?.view === false
    && hiddenBillableCatalog.body?.entries?.length === 0,
  "task_creation_permission_does_not_grant_catalog_visibility");
  const tasksBeforeHiddenDefinitionAttempt = (await sql<{ count: number }>(
    `SELECT count(*)::integer AS count FROM nova.tasks
     WHERE organisation_id = $1::uuid AND task_catalog_entry_id = $2::uuid`,
    [organisationId, taskCatalogEntryId],
  ))[0]?.count;
  const hiddenBillableDefinitionAttempt = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    taskCatalogEntryId,
    taskCatalogRevision,
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("billable_definition_use_requires_catalog_visibility", hiddenBillableDefinitionAttempt, 403);
  assert(hiddenBillableDefinitionAttempt.body?.error === "PERMISSION_DENIED",
    "missing_catalog_visibility_has_stable_denial");
  const tasksAfterHiddenDefinitionAttempt = (await sql<{ count: number }>(
    `SELECT count(*)::integer AS count FROM nova.tasks
     WHERE organisation_id = $1::uuid AND task_catalog_entry_id = $2::uuid`,
    [organisationId, taskCatalogEntryId],
  ))[0]?.count;
  assert(tasksAfterHiddenDefinitionAttempt === tasksBeforeHiddenDefinitionAttempt,
    "denied_hidden_definition_does_not_create_partial_task");
  const billableWithoutCatalog = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Policy-classified task without catalog visibility",
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("task_creator_without_catalog_visibility_uses_automatic_policy", billableWithoutCatalog, 201);
  const billableWithoutCatalogId = field("billable_without_catalog", billableWithoutCatalog, "taskId");
  const billableWithoutCatalogClass = (await sql<{ billing_class: string }>(
    "SELECT billing_class::text FROM nova.tasks WHERE id = $1::uuid", [billableWithoutCatalogId],
  ))[0]?.billing_class;
  assert(billableWithoutCatalogClass === "billable",
    "task_creation_without_catalog_is_classified_by_admin_managed_workstream_policy");
  grants.splice(catalogViewGrantIndex, 0, catalogViewGrant);
  assertStatus("role_restores_catalog_visibility", await updateRole(roleInput), 200);
  const templateTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    taskCatalogEntryId,
    taskCatalogRevision,
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("task_create_from_catalog_uses_normal_scoped_create", templateTask, 201);
  assert(templateTask.body?.billingClass === "non_billable"
    && templateTask.body?.billingPolicySource === "client_workstream_task_definition",
  "task_create_response_confirms_server_assigned_predefined_task_class");
  const templateTaskId = field("task_from_catalog", templateTask, "taskId");
  const templateTaskState = (await sql<{
    title: string; description: string | null; priority: string; billing_class: string;
    correction_of_task_id: string | null; task_catalog_entry_id: string; task_catalog_revision: number;
  }>(
    `SELECT title, description, priority, billing_class::text, correction_of_task_id,
            task_catalog_entry_id, task_catalog_revision
     FROM nova.tasks WHERE id = $1::uuid`,
    [templateTaskId],
  ))[0];
  assert(templateTaskState?.title === "Client handoff checklist"
    && templateTaskState.description === "Confirm the deliverables and acceptance notes."
    && templateTaskState.priority === "high", "catalog_only_prefills_approved_task_defaults");
  assert(templateTaskState?.billing_class === "non_billable"
    && templateTaskState.correction_of_task_id === null
    && templateTaskState.task_catalog_entry_id === taskCatalogEntryId
    && templateTaskState.task_catalog_revision === taskCatalogRevision,
  "template_content_revision_and_admin_billing_rule_are_separate_provenance");
  const revisedTaskTemplate = await request("PATCH", `/task-catalog/${taskCatalogEntryId}`, {
    title: "Client handoff checklist revised",
    description: "Confirm deliverables, acceptance notes, and owner.",
    priority: "urgent",
    reason: "The handoff checklist has changed.",
    expectedRevision: taskCatalogRevision,
  }, founderCookie);
  assertStatus("catalog_manager_uses_optimistic_revision", revisedTaskTemplate, 200);
  assert(numberField("task_catalog_revised", revisedTaskTemplate, "revision") === taskCatalogRevision + 1,
    "catalog_revision_advances_once_after_edit");
  const staleTaskTemplate = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Stale template must not be used",
    taskCatalogEntryId,
    taskCatalogRevision,
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("stale_catalog_revision_is_rejected", staleTaskTemplate, 409);
  assert(staleTaskTemplate.body?.error === "TASK_CATALOG_VERSION_CONFLICT", "stale_catalog_use_has_stable_conflict");
  const originalTaskAfterTemplateEdit = (await sql<{
    title: string; task_catalog_revision: number; billing_class: string;
  }>(
    `SELECT title, task_catalog_revision, billing_class::text FROM nova.tasks WHERE id = $1::uuid`,
    [templateTaskId],
  ))[0];
  assert(originalTaskAfterTemplateEdit?.title === "Client handoff checklist"
    && originalTaskAfterTemplateEdit.task_catalog_revision === taskCatalogRevision
    && originalTaskAfterTemplateEdit.billing_class === "non_billable",
  "catalog_edit_never_rewrites_existing_task_or_its_billing_decision");
  const reclassifiedTemplateRevision = numberField("task_catalog_revised", revisedTaskTemplate, "revision");
  const nextTemplateTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    taskCatalogEntryId,
    taskCatalogRevision: reclassifiedTemplateRevision,
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("task_create_uses_current_template_revision", nextTemplateTask, 201);
  const nextTemplateTaskId = field("task_from_current_catalog", nextTemplateTask, "taskId");
  const nextTemplateTaskState = (await sql<{ billing_class: string; task_catalog_revision: number }>(
    `SELECT billing_class::text, task_catalog_revision FROM nova.tasks WHERE id = $1::uuid`,
    [nextTemplateTaskId],
  ))[0];
  assert(nextTemplateTaskState?.billing_class === "non_billable"
    && nextTemplateTaskState.task_catalog_revision === reclassifiedTemplateRevision,
    "task_content_edits_do_not_change_the_independent_workstream_definition_rule");
  const billableTemplateTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    taskCatalogEntryId: billableTaskDefinitionId,
    taskCatalogRevision: billableTaskDefinitionRevision,
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("billable_predefined_task_uses_its_policy_after_role_grant", billableTemplateTask, 201);
  assert(billableTemplateTask.body?.billingClass === "billable"
    && billableTemplateTask.body?.billingPolicySource === "client_workstream_task_definition",
  "billable_definition_rule_is_independent_of_the_non_billable_definition_rule");
  const oneOffTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "One-off task follows the workstream policy",
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("one_off_task_create", oneOffTask, 201);
  const oneOffTaskId = field("one_off_task", oneOffTask, "taskId");
  const oneOffTaskClass = (await sql<{ billing_class: string; task_catalog_entry_id: string | null }>(
    "SELECT billing_class::text, task_catalog_entry_id FROM nova.tasks WHERE id = $1::uuid",
    [oneOffTaskId],
  ))[0];
  assert(oneOffTaskClass?.billing_class === "billable" && oneOffTaskClass.task_catalog_entry_id === null,
    "one_off_task_uses_the_workstream_default_without_catalog_provenance");
  assert(oneOffTask.body?.billingClass === "billable", "one_off_create_response_confirms_server_policy_classification");
  const editorWorkContext = await request("GET", "/work-context", undefined, firstEmployee.cookie);
  assertStatus("employee_work_context_with_task_creation_scope", editorWorkContext, 200);
  assert(editorWorkContext.body?.canReceiveAssignments === true,
    "work_context_reports_current_self_assignment_eligibility");
  assert(
    editorWorkContext.body?.taskCreationTargets?.some((target: any) => target.id === workstreamId && target.kind === "client"),
    "work_page_lists_only_authorized_task_creation_targets",
  );
  const nonAssignableRole = {
    ...roleInput,
    operationalPolicy: { ...operationalPolicy, canReceiveAssignments: false },
  };
  assertStatus("role_edit_remove_self_assignment_eligibility", await updateRole(nonAssignableRole), 200);
  const ineligibleWorkContext = await request("GET", "/work-context", undefined, firstEmployee.cookie);
  assertStatus("work_context_after_assignment_policy_change", ineligibleWorkContext, 200);
  assert(ineligibleWorkContext.body?.canReceiveAssignments === false,
    "work_context_reports_role_assignment_ineligibility");
  const rejectedSelfAssignmentTitle = "Rejected self-assignment leaves no partial task";
  const rejectedSelfAssignment = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: rejectedSelfAssignmentTitle,
    assignToSelf: true,
  }, firstEmployee.cookie);
  assertStatus("role_ineligible_self_assignment_rejected", rejectedSelfAssignment, 409);
  assert(rejectedSelfAssignment.body?.error === "PERSON_NOT_ASSIGNABLE",
    "role_ineligible_self_assignment_has_stable_error");
  const rejectedTaskRows = await sql<{ task_count: number }>(
    "SELECT count(*)::int AS task_count FROM nova.tasks WHERE organisation_id = $1::uuid AND title = $2",
    [organisationId, rejectedSelfAssignmentTitle],
  );
  assert(rejectedTaskRows[0]?.task_count === 0, "rejected_self_assignment_does_not_leave_unassigned_task");
  const unassignedTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Creator adds work without receiving assignments",
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("ineligible_creator_can_create_without_self_assignment", unassignedTask, 201);
  assert(unassignedTask.body?.assignmentId === null,
    "unassigned_task_response_has_no_assignment_id");
  assertStatus("restore_self_assignment_eligibility", await updateRole(roleInput), 200);
  const restoredWorkContext = await request("GET", "/work-context", undefined, firstEmployee.cookie);
  assert(restoredWorkContext.body?.canReceiveAssignments === true,
    "work_context_reflects_role_assignment_eligibility_regrant");
  const employeeTaskKey = `employee-task:${randomUUID()}`;
  const employeeTaskPayload = {
    clientWorkstreamId: workstreamId,
    title: "Employee-authored task is self-assigned atomically",
    assignToSelf: true,
  };
  const [employeeTask, employeeTaskReplay] = await Promise.all([
    request("POST", "/tasks", employeeTaskPayload, firstEmployee.cookie, false, {
      "idempotency-key": employeeTaskKey,
    }),
    request("POST", "/tasks", {
      assignToSelf: true,
      title: employeeTaskPayload.title,
      clientWorkstreamId: workstreamId,
    }, firstEmployee.cookie, false, { "idempotency-key": employeeTaskKey }),
  ]);
  assertStatus("client_workstream_editor_creates_and_self_assigns_task", employeeTask, 201);
  assertStatus("concurrent_idempotent_task_replay", employeeTaskReplay, 201);
  const employeeTaskId = field("employee_task", employeeTask, "taskId");
  const employeeAssignmentId = field("employee_task", employeeTask, "assignmentId");
  assert(field("employee_task_replay", employeeTaskReplay, "taskId") === employeeTaskId
    && field("employee_task_replay", employeeTaskReplay, "assignmentId") === employeeAssignmentId,
  "concurrent_task_replay_returns_original_task_and_assignment");
  const reusedTaskKey = await request("POST", "/tasks", {
    ...employeeTaskPayload,
    title: "Different task must not reuse the same idempotency key",
  }, firstEmployee.cookie, false, { "idempotency-key": employeeTaskKey });
  assertStatus("task_idempotency_key_reuse_with_different_payload", reusedTaskKey, 409);
  assert(reusedTaskKey.body?.error === "IDEMPOTENCY_KEY_REUSED", "task_key_reuse_is_explicit_conflict");
  const taskAndAssignmentCount = (await sql<{ task_count: number; assignment_count: number }>(
    `SELECT count(DISTINCT tasks.id)::int AS task_count,
            count(assignments.id)::int AS assignment_count
     FROM nova.tasks tasks
     LEFT JOIN nova.task_assignments assignments ON assignments.task_id = tasks.id
     WHERE tasks.id = $1::uuid`,
    [employeeTaskId],
  ))[0];
  assert(taskAndAssignmentCount?.task_count === 1 && taskAndAssignmentCount.assignment_count === 1,
    "concurrent_task_retry_persists_one_task_and_one_self_assignment");
  const employeeReviewerRequest = await request("POST", `/task-assignments/${employeeAssignmentId}/reviewer-requests`, {
    candidateReviewerPersonId: secondEmployee.personId,
    reason: "The task author requests the client coordinator as reviewer.",
  }, firstEmployee.cookie);
  assertStatus("employee_created_task_reviewer_request", employeeReviewerRequest, 201);
  const employeeReviewerRequestId = field("employee_task_reviewer_request", employeeReviewerRequest, "requestId");
  assertStatus("employee_created_task_reviewer_accept", await request(
    "POST", `/task-reviewer-requests/${employeeReviewerRequestId}/accept`, {}, secondEmployee.cookie,
  ), 200);
  const employeeTaskState = (await sql<{
    created_by_person_id: string;
    person_id: string;
    review_required: boolean;
    reviewer_person_id: string | null;
  }>(
    `SELECT tasks.created_by_person_id, assignments.person_id,
            assignments.review_required, assignments.reviewer_person_id
     FROM nova.tasks tasks
     JOIN nova.task_assignments assignments ON assignments.task_id = tasks.id
     WHERE tasks.id = $1::uuid AND assignments.id = $2::uuid`,
    [employeeTaskId, employeeAssignmentId],
  ))[0];
  assert(employeeTaskState?.created_by_person_id === firstEmployee.personId, "employee_task_audit_owner_is_creator");
  assert(employeeTaskState.person_id === firstEmployee.personId, "employee_task_is_self_assigned_in_same_command");
  assert(employeeTaskState.review_required && employeeTaskState.reviewer_person_id === secondEmployee.personId, "client_task_keeps_review_gate_and_records_explicit_reviewer_acceptance");
  const employeeAssignments = await request("GET", "/work/assignments/mine", undefined, firstEmployee.cookie);
  assertStatus("employee_can_load_self_assigned_task", employeeAssignments, 200);
  assert(
    employeeAssignments.body?.assignments?.some((entry: any) => entry.assignmentId === employeeAssignmentId),
    "new_task_appears_in_employee_work_page",
  );
  const otherWorkstream = await request("POST", "/workstreams/client", { clientId, name: "Out-of-scope workstream" }, founderCookie);
  assertStatus("out_of_scope_workstream_fixture", otherWorkstream, 201);
  const outOfScopeWorkstreamId = field("other_workstream", otherWorkstream, "workstreamId");
  const outOfScopePolicy = await request("PATCH", `/workstreams/client/${outOfScopeWorkstreamId}/billing-policy`, {
    policyClass: "non_billable", expectedRevision: 0,
    reason: "Fixture policy lets the test reach task-scope authorization.",
  }, founderCookie);
  assertStatus("out_of_scope_fixture_policy_setup", outOfScopePolicy, 200);
  const outOfScopeTask = await request("POST", "/tasks", {
    clientWorkstreamId: outOfScopeWorkstreamId,
    title: "Out-of-scope task must be denied",
    assignToSelf: true,
  }, firstEmployee.cookie);
  assertStatus("client_workstream_editor_cannot_create_out_of_scope_task", outOfScopeTask, 403);
  const workContextAfterScopeCheck = await request("GET", "/work-context", undefined, firstEmployee.cookie);
  assertStatus("work_context_after_out_of_scope_fixture", workContextAfterScopeCheck, 200);
  assert(
    !workContextAfterScopeCheck.body?.taskCreationTargets?.some((target: any) => target.id === field("other_workstream", otherWorkstream, "workstreamId")),
    "out_of_scope_workstream_not_offered_in_work_page",
  );
  const returnHandoverTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Return handover creates a new historical assignment",
  }, founderCookie);
  assertStatus("return_handover_task_create", returnHandoverTask, 201);
  const returnTaskId = field("return_handover_task", returnHandoverTask, "taskId");
  const initialReturnAssignment = await request("POST", `/tasks/${returnTaskId}/assignments`, {
    personId: firstEmployee.personId,
    reviewerPersonId: founder.id,
    reviewRequired: true,
  }, founderCookie);
  assertStatus("return_handover_initial_assignment", initialReturnAssignment, 201);
  const initialReturnAssignmentId = field("return_handover_initial_assignment", initialReturnAssignment, "assignmentId");
  const outboundHandoverRequest = await request("POST", `/task-assignments/${initialReturnAssignmentId}/handover-requests`, {
    targetPersonId: secondEmployee.personId,
    reason: "Transfer work to the second employee.",
  }, firstEmployee.cookie);
  assertStatus("return_handover_outbound_request", outboundHandoverRequest, 201);
  const outboundHandoverId = field("return_handover_outbound_request", outboundHandoverRequest, "requestId");
  const outboundHandoverAccept = await request(
    "POST", `/task-handover-requests/${outboundHandoverId}/accept`, {}, secondEmployee.cookie,
  );
  assertStatus("return_handover_outbound_accept", outboundHandoverAccept, 200);
  const intermediateAssignmentId = field("return_handover_outbound_accept", outboundHandoverAccept, "assignmentId");
  const returnHandoverRequest = await request("POST", `/task-assignments/${intermediateAssignmentId}/handover-requests`, {
    targetPersonId: firstEmployee.personId,
    reason: "Return the work to the original employee as a new assignment.",
  }, secondEmployee.cookie);
  assertStatus("return_handover_request", returnHandoverRequest, 201);
  const returnHandoverId = field("return_handover_request", returnHandoverRequest, "requestId");
  const returnHandoverAccept = await request(
    "POST", `/task-handover-requests/${returnHandoverId}/accept`, {}, firstEmployee.cookie,
  );
  assertStatus("return_handover_accept", returnHandoverAccept, 200);
  const returnedAssignmentId = field("return_handover_accept", returnHandoverAccept, "assignmentId");
  assert(returnedAssignmentId !== initialReturnAssignmentId && returnedAssignmentId !== intermediateAssignmentId,
    "return_handover_inserts_a_distinct_assignment_record");
  const returnHandoverHistory = (await sql<{
    assignment_count: number;
    cancelled_count: number;
    active_count: number;
    first_status: string;
    intermediate_status: string;
    returned_status: string;
    returned_person_id: string;
  }>(
    `SELECT count(*)::int AS assignment_count,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
            count(*) FILTER (WHERE status <> 'cancelled')::int AS active_count,
            (SELECT status::text FROM nova.task_assignments WHERE id = $2::uuid) AS first_status,
            (SELECT status::text FROM nova.task_assignments WHERE id = $3::uuid) AS intermediate_status,
            (SELECT status::text FROM nova.task_assignments WHERE id = $4::uuid) AS returned_status,
            (SELECT person_id::text FROM nova.task_assignments WHERE id = $4::uuid) AS returned_person_id
     FROM nova.task_assignments WHERE task_id = $1::uuid`,
    [returnTaskId, initialReturnAssignmentId, intermediateAssignmentId, returnedAssignmentId],
  ))[0];
  assert(returnHandoverHistory?.assignment_count === 3 && returnHandoverHistory.cancelled_count === 2
    && returnHandoverHistory.active_count === 1 && returnHandoverHistory.first_status === "cancelled"
    && returnHandoverHistory.intermediate_status === "cancelled" && returnHandoverHistory.returned_status === "assigned"
    && returnHandoverHistory.returned_person_id === firstEmployee.personId,
  "return_handover_preserves_two_cancelled_records_and_one_new_active_assignment");
  assertStatus("return_handover_fixture_cleanup", await request(
    "POST", `/tasks/${returnTaskId}/cancel`, {}, founderCookie,
  ), 200);

  const competingHandoverTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Concurrent handovers cannot duplicate a recipient assignment",
  }, founderCookie);
  assertStatus("competing_handover_task_create", competingHandoverTask, 201);
  const competingTaskId = field("competing_handover_task", competingHandoverTask, "taskId");
  const competingAssignments = await Promise.all([firstEmployee, secondEmployee].map((employee) =>
    request("POST", `/tasks/${competingTaskId}/assignments`, {
      personId: employee.personId,
      reviewerPersonId: founder.id,
    }, founderCookie)));
  assert(competingAssignments.every((result) => result.status === 201), "multi_assignee_task_accepts_distinct_people");
  const competingAssignmentIds = competingAssignments.map((result, index) =>
    field(`competing_assignment_${index}`, result, "assignmentId"));
  const competingRequests = await Promise.all(competingAssignmentIds.map((assignmentId, index) =>
    request("POST", `/task-assignments/${assignmentId}/handover-requests`, {
      targetPersonId: thirdEmployee.personId,
      reason: `Concurrent handover contender ${index + 1}.`,
    }, index === 0 ? firstEmployee.cookie : secondEmployee.cookie)));
  assert(competingRequests.every((result) => result.status === 201), "distinct_assignments_can_request_same_replacement");
  const competingRequestIds = competingRequests.map((result, index) =>
    field(`competing_handover_request_${index}`, result, "requestId"));
  const competingAccepts = await Promise.all(competingRequestIds.map((requestId) =>
    request("POST", `/task-handover-requests/${requestId}/accept`, {}, thirdEmployee.cookie)));
  assert(competingAccepts.filter((result) => result.status === 200).length === 1,
    "same_recipient_concurrent_handovers_have_one_winner");
  const competingLosers = competingAccepts.map((result, index) => ({ result, index }))
    .filter((entry) => entry.result.status === 409 && entry.result.body?.error === "PERSON_ALREADY_ASSIGNED");
  assert(competingLosers.length === 1, "same_recipient_concurrent_handover_loser_is_stable_conflict");
  const competingHandoverState = (await sql<{
    assignment_count: number;
    cancelled_count: number;
    active_count: number;
    recipient_active_count: number;
    accepted_request_count: number;
    pending_request_count: number;
  }>(
    `SELECT count(*)::int AS assignment_count,
            count(*) FILTER (WHERE assignments.status = 'cancelled')::int AS cancelled_count,
            count(*) FILTER (WHERE assignments.status <> 'cancelled')::int AS active_count,
            count(*) FILTER (WHERE assignments.person_id = $2::uuid AND assignments.status <> 'cancelled')::int AS recipient_active_count,
            (SELECT count(*)::int FROM nova.task_assignment_handover_requests WHERE assignment_id = ANY($3::uuid[]) AND status = 'accepted') AS accepted_request_count,
            (SELECT count(*)::int FROM nova.task_assignment_handover_requests WHERE assignment_id = ANY($3::uuid[]) AND status = 'pending') AS pending_request_count
     FROM nova.task_assignments assignments WHERE assignments.task_id = $1::uuid`,
    [competingTaskId, thirdEmployee.personId, competingAssignmentIds],
  ))[0];
  assert(competingHandoverState?.assignment_count === 3 && competingHandoverState.cancelled_count === 1
    && competingHandoverState.active_count === 2 && competingHandoverState.recipient_active_count === 1
    && competingHandoverState.accepted_request_count === 1 && competingHandoverState.pending_request_count === 1,
  "losing_handover_preserves_source_assignment_and_pending_request_without_duplicate_recipient");
  const losingRequestIndex = competingLosers[0]!.index;
  assertStatus("losing_handover_request_withdrawn", await request(
    "POST", `/task-handover-requests/${competingRequestIds[losingRequestIndex]}/withdraw`, {},
    losingRequestIndex === 0 ? firstEmployee.cookie : secondEmployee.cookie,
  ), 200);
  assertStatus("competing_handover_fixture_cleanup", await request(
    "POST", `/tasks/${competingTaskId}/cancel`, {}, founderCookie,
  ), 200);

  const task = await request("POST", "/tasks", { clientWorkstreamId: workstreamId, title: "Lifecycle handover and timer test" }, founderCookie);
  assertStatus("lifecycle_task_create", task, 201);
  const taskId = field("lifecycle_task", task, "taskId");
  const assignment = await request("POST", `/tasks/${taskId}/assignments`, {
    personId: firstEmployee.personId,
    reviewerPersonId: founder.id,
    reviewRequired: true,
  }, founderCookie);
  assertStatus("lifecycle_assignment_create", assignment, 201);
  const assignmentId = field("lifecycle_assignment", assignment, "assignmentId");

  const correctionWindow = (await sql<{ started_at: string; ended_at: string }>(
    `WITH base AS (SELECT clock_timestamp() - interval '1 day 1 hour' AS at)
     SELECT to_char((base.at + interval '0.123456 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS started_at,
            to_char((base.at + interval '1 hour 0.654321 seconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS ended_at
     FROM base`,
  ))[0];
  assert(Boolean(correctionWindow?.started_at && correctionWindow.ended_at), "timeline_adjustment_microsecond_fixture_available");
  let timelineAdjustment: ApiResult;
  const actualDateNowForTimeline = Date.now;
  try {
    Date.now = () => actualDateNowForTimeline() - 2 * 24 * 60 * 60 * 1_000;
    timelineAdjustment = await request("POST", "/work/timeline-adjustments", {
      assignmentId,
      startedAt: correctionWindow.started_at,
      endedAt: correctionWindow.ended_at,
      reason: "Verify exact timestamp correction despite API clock skew.",
      personId: firstEmployee.personId,
    }, founderCookie);
  } finally {
    Date.now = actualDateNowForTimeline;
  }
  assertStatus("timeline_adjustment_uses_database_clock_and_accepts_microseconds", timelineAdjustment!, 201);
  const timelineAdjustmentId = field("timeline_adjustment", timelineAdjustment!, "adjustmentId");
  const storedAdjustment = (await sql<{ started_at: string; ended_at: string; audited_start: string; audited_end: string }>(
    `SELECT to_char(adjustments.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS started_at,
            to_char(adjustments.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS ended_at,
            events.details->>'started_at' AS audited_start,
            events.details->>'ended_at' AS audited_end
     FROM nova.work_timeline_adjustments adjustments
     JOIN nova.audit_events events ON events.target_id = adjustments.id
       AND events.action = 'work.timeline_adjusted'
     WHERE adjustments.id = $1::uuid`,
    [timelineAdjustmentId],
  ))[0];
  assert(storedAdjustment?.started_at === correctionWindow.started_at && storedAdjustment?.ended_at === correctionWindow.ended_at,
    "timeline_adjustment_persists_postgres_microseconds");
  assert(storedAdjustment?.audited_start === correctionWindow.started_at && storedAdjustment?.audited_end === correctionWindow.ended_at,
    "timeline_adjustment_audit_preserves_exact_input");

  const starts = await Promise.all(Array.from({ length: 12 }, () =>
    request("POST", "/work-sessions/start", { assignmentId }, firstEmployee.cookie)));
  assert(starts.filter((result) => result.status === 201).length === 1, "concurrent_timer_starts_create_one_live_session");
  assert(starts.filter((result) => result.status === 409 && result.body?.error === "SESSION_ALREADY_RUNNING").length === 11, "concurrent_timer_starts_reject_all_duplicates");
  const startedSession = starts.find((result) => result.status === 201)!;
  const startedSessionId = field("role_edit_timer_session", startedSession, "sessionId");
  const roleWithoutStart = {
    ...roleInput,
    permissionGrants: grants.filter((grant) => grant.permissionKey !== "tasks.start"),
  };
  assertStatus("role_edit_revoke_timer_start_permission", await updateRole(roleWithoutStart), 200);
  const stillAuthenticated = await request("GET", "/auth/get-session", undefined, firstEmployee.cookie);
  assertStatus("role_edit_keeps_authentication_session", stillAuthenticated, 200);
  assert(Boolean(stillAuthenticated.body?.session), "role_edit_does_not_revoke_authentication_session");
  assertStatus("role_edit_denies_new_timer_start_immediately", await request(
    "POST", "/work-sessions/start", { assignmentId }, firstEmployee.cookie,
  ), 403);
  assertStatus("owner_can_stop_existing_timer_after_role_revocation", await request(
    "POST", `/work-sessions/${startedSessionId}/stop`, {}, firstEmployee.cookie,
  ), 200);
  const closedAfterRevocation = (await sql<{ state: string; ended_at: string | null }>(
    "SELECT state, ended_at FROM nova.work_sessions WHERE id = $1::uuid",
    [startedSessionId],
  ))[0];
  assert(closedAfterRevocation?.state === "completed" && closedAfterRevocation.ended_at !== null,
    "role_revocation_preserves_and_closes_existing_timer_history");
  assertStatus("role_edit_regrant_timer_start_permission", await updateRole(roleInput), 200);
  const restartedSession = await request("POST", "/work-sessions/start", { assignmentId }, firstEmployee.cookie);
  assertStatus("role_edit_regrant_allows_new_timer", restartedSession, 201);
  assertStatus("role_edit_regrant_timer_cleanup", await request(
    "POST", `/work-sessions/${field("role_edit_restarted_timer", restartedSession, "sessionId")}/stop`,
    {}, firstEmployee.cookie,
  ), 200);

  const reviewerRequest = await request("POST", `/task-assignments/${assignmentId}/reviewer-requests`, {
    candidateReviewerPersonId: secondEmployee.personId,
    reason: "Request a teammate as reviewer for the handover lifecycle test.",
  }, firstEmployee.cookie);
  assertStatus("reviewer_request_create", reviewerRequest, 201);
  const reviewerRequestId = field("reviewer_request", reviewerRequest, "requestId");
  const reviewerAccepts = await Promise.all([
    request("POST", `/task-reviewer-requests/${reviewerRequestId}/accept`, {}, secondEmployee.cookie),
    request("POST", `/task-reviewer-requests/${reviewerRequestId}/accept`, {}, secondEmployee.cookie),
  ]);
  assert(reviewerAccepts.filter((result) => result.status === 200).length === 1, "reviewer_accept_exactly_once");
  assert(reviewerAccepts.filter((result) => result.status === 409).length === 1, "reviewer_accept_duplicate_rejected");
  let reviewAssignment = (await sql<{ reviewer_person_id: string | null; review_blocked_reason: string | null }>(
    "SELECT reviewer_person_id, review_blocked_reason FROM nova.task_assignments WHERE id = $1::uuid",
    [assignmentId],
  ))[0];
  assert(reviewAssignment?.reviewer_person_id === secondEmployee.personId, "reviewer_change_persisted");

  const handoverRequest = await request("POST", `/task-assignments/${assignmentId}/handover-requests`, {
    targetPersonId: secondEmployee.personId,
    reason: "Two-sided handover after reviewer acceptance.",
  }, firstEmployee.cookie);
  assertStatus("task_handover_request", handoverRequest, 201);
  const handoverId = field("handover_request", handoverRequest, "requestId");
  const noHandoverAcceptGrant = await updateRole({
    ...roleInput,
    permissionGrants: grants.filter((grant) => grant.permissionKey !== "tasks.handover_accept"),
  });
  assertStatus("revoke_handover_accept_permission_while_request_pending", noHandoverAcceptGrant, 200);
  const handoverAcceptBeforeRegrant = await request(
    "POST", `/task-handover-requests/${handoverId}/accept`, {}, secondEmployee.cookie,
  );
  assertStatus("handover_accept_revalidates_current_permission", handoverAcceptBeforeRegrant, 403);
  assert(handoverAcceptBeforeRegrant.body?.error === "PERMISSION_DENIED", "revoked_handover_permission_is_denied");
  const pendingHandoverAfterDenial = (await sql<{ status: string; person_id: string }>(
    `SELECT requests.status, assignments.person_id
     FROM nova.task_assignment_handover_requests requests
     JOIN nova.task_assignments assignments ON assignments.id = requests.assignment_id
     WHERE requests.id = $1::uuid`,
    [handoverId],
  ))[0];
  assert(pendingHandoverAfterDenial?.status === "pending"
    && pendingHandoverAfterDenial.person_id === firstEmployee.personId,
  "denied_handover_keeps_request_and_assignment_unchanged");
  assertStatus("restore_handover_accept_permission", await updateRole(roleInput), 200);
  const handoverAccepts = await Promise.all([
    request("POST", `/task-handover-requests/${handoverId}/accept`, {}, secondEmployee.cookie),
    request("POST", `/task-handover-requests/${handoverId}/accept`, {}, secondEmployee.cookie),
  ]);
  assert(handoverAccepts.filter((result) => result.status === 200).length === 1, "handover_accept_exactly_once");
  assert(handoverAccepts.filter((result) => result.status === 409).length === 1, "handover_accept_duplicate_rejected");
  const newAssignmentId = field("handover_accept", handoverAccepts.find((result) => result.status === 200)!, "assignmentId");
  const handoverState = (await sql<{
    old_status: string;
    old_timer_ended: boolean;
    new_person_id: string;
    new_reviewer_id: string | null;
  }>(
    `SELECT old_assignment.status AS old_status,
            EXISTS (SELECT 1 FROM nova.work_sessions sessions WHERE sessions.assignment_id = old_assignment.id AND sessions.ended_at IS NOT NULL) AS old_timer_ended,
            new_assignment.person_id AS new_person_id,
            new_assignment.reviewer_person_id AS new_reviewer_id
     FROM nova.task_assignments old_assignment
     JOIN nova.task_assignments new_assignment ON new_assignment.id = $2::uuid
     WHERE old_assignment.id = $1::uuid`,
    [assignmentId, newAssignmentId],
  ))[0];
  assert(handoverState?.old_status === "cancelled" && handoverState.old_timer_ended, "handover_closes_old_assignment_timer_atomically");
  assert(handoverState.new_person_id === secondEmployee.personId, "handover_moves_assignment_to_accepting_employee");
  assert(handoverState.new_reviewer_id === null, "handover_clears_reviewer_who_becomes_assignee");
  const previousAssigneeSubmit = await request("POST", `/task-assignments/${assignmentId}/submit`, {}, firstEmployee.cookie);
  assertStatus("previous_assignee_cannot_submit_cancelled_assignment", previousAssigneeSubmit, 409);
  assert(previousAssigneeSubmit.body?.error === "ASSIGNMENT_NOT_SUBMITTABLE", "previous_assignee_gets_deterministic_handover_conflict");

  const nextReviewerRequest = await request("POST", `/task-assignments/${newAssignmentId}/reviewer-requests`, {
    candidateReviewerPersonId: firstEmployee.personId,
    reason: "Exercise reviewer replacement when the selected reviewer becomes unavailable.",
  }, secondEmployee.cookie);
  assertStatus("reviewer_replacement_request", nextReviewerRequest, 201);
  const nextReviewerRequestId = field("replacement_request", nextReviewerRequest, "requestId");
  assertStatus("reviewer_replacement_accept", await request("POST", `/task-reviewer-requests/${nextReviewerRequestId}/accept`, {}, firstEmployee.cookie), 200);

  const postHandoverTimer = await request("POST", "/work-sessions/start", { assignmentId: newAssignmentId }, secondEmployee.cookie);
  assertStatus("post_handover_timer_start", postHandoverTimer, 201);
  const postHandoverSessionId = field("post_handover_timer", postHandoverTimer, "sessionId");
  assertStatus("post_handover_timer_stop", await request(
    "POST", `/work-sessions/${postHandoverSessionId}/stop`, {}, secondEmployee.cookie,
  ), 200);
  const assigneeSession = await request("GET", "/auth/get-session", undefined, secondEmployee.cookie);
  assertStatus("handover_assignee_session_still_valid", assigneeSession, 200);
  const sessionSubject = assigneeSession.body?.user?.id;
  const sessionPerson = typeof sessionSubject === "string"
    ? (await sql<{ person_id: string }>(
      "SELECT person_id FROM nova.person_identities WHERE subject = $1",
      [sessionSubject],
    ))[0]?.person_id
    : undefined;
  assert(sessionPerson === secondEmployee.personId, "handover_assignee_cookie_maps_to_expected_person");
  const resolvedAssignee = await requestActor(new Request(`${smokeOrigin}/api/task-assignments/${newAssignmentId}/submit`, {
    headers: { cookie: secondEmployee.cookie, origin: smokeOrigin },
  }));
  assert(resolvedAssignee?.context.userId === secondEmployee.personId, "submit_request_resolves_expected_actor");
  assert(resolvedAssignee.context.organisationId === organisationId, "submit_request_resolves_expected_organisation");
  const visibleToAssignee = await withDatabaseRequest(
    resolvedAssignee.context,
    async (transaction) => (await transaction.query<{
      id: string;
      person_id: string;
      task_id: string;
      status: string;
      client_id: string | null;
    }>(
      `SELECT assignments.id, assignments.person_id, assignments.task_id,
              assignments.status, clients.id AS client_id,
              tasks.client_workstream_id, tasks.work_group_id, tasks.title
       FROM nova.task_assignments assignments
       JOIN nova.tasks tasks ON tasks.id = assignments.task_id
       LEFT JOIN nova.client_workstreams workstreams ON workstreams.id = tasks.client_workstream_id
       LEFT JOIN nova.clients clients ON clients.id = workstreams.client_id
       WHERE assignments.id = $1 AND assignments.organisation_id = $2
       FOR UPDATE OF assignments, tasks`,
      [newAssignmentId, organisationId],
    )).rows[0],
  );
  assert(visibleToAssignee?.id === newAssignmentId, "submit_query_resolves_handed_over_assignment");
  assert(visibleToAssignee.person_id === resolvedAssignee.context.userId, "submit_query_assignment_belongs_to_resolved_actor");
  assert(visibleToAssignee.status === "in_progress", "submit_query_assignment_state_is_submittable");
  const submission = await request("POST", `/task-assignments/${newAssignmentId}/submit`, {}, secondEmployee.cookie);
  assertStatus("post_handover_submit_for_review", submission, 200);
  assert(submission.body?.status === "awaiting_review", "handover_assignee_submission_opens_review_cycle");
  const submittedAssignment = (await sql<{ status: string; reviewer_person_id: string | null }>(
    "SELECT status, reviewer_person_id FROM nova.task_assignments WHERE id = $1::uuid",
    [newAssignmentId],
  ))[0];
  assert(submittedAssignment?.status === "awaiting_review" && submittedAssignment.reviewer_person_id === firstEmployee.personId,
    "reviewer_is_current_and_eligible_before_freeze");

  async function createScenarioAssignment(
    label: string,
    title: string,
    assigneePersonId: string,
    reviewerPersonId: string,
  ): Promise<{ taskId: string; assignmentId: string }> {
    const scenarioTask = await request("POST", "/tasks", { clientWorkstreamId: workstreamId, title }, founderCookie);
    assertStatus(`${label}_task_create`, scenarioTask, 201);
    const scenarioTaskId = field(`${label}_task`, scenarioTask, "taskId");
    const scenarioAssignment = await request("POST", `/tasks/${scenarioTaskId}/assignments`, {
      personId: assigneePersonId,
      reviewerPersonId,
      reviewRequired: true,
    }, founderCookie);
    assertStatus(`${label}_assignment_create`, scenarioAssignment, 201);
    return { taskId: scenarioTaskId, assignmentId: field(`${label}_assignment`, scenarioAssignment, "assignmentId") };
  }

  const requestLifecycle = await createScenarioAssignment(
    "handover_resolution", "Handover withdrawal and decline", firstEmployee.personId, founder.id,
  );
  const withdrawnRequest = await request("POST", `/task-assignments/${requestLifecycle.assignmentId}/handover-requests`, {
    targetPersonId: secondEmployee.personId,
    reason: "Exercise safe withdrawal before acceptance.",
  }, firstEmployee.cookie);
  assertStatus("handover_withdraw_request_create", withdrawnRequest, 201);
  const withdrawnRequestId = field("handover_withdraw_request", withdrawnRequest, "requestId");
  const withdraw = await request("POST", `/task-handover-requests/${withdrawnRequestId}/withdraw`, {
    reason: "The original assignee will continue this task.",
  }, firstEmployee.cookie);
  assertStatus("handover_request_withdraw", withdraw, 200);
  assert(withdraw.body?.status === "withdrawn", "handover_request_withdrawn_state_persisted");
  const acceptWithdrawn = await request("POST", `/task-handover-requests/${withdrawnRequestId}/accept`, {}, secondEmployee.cookie);
  assertStatus("withdrawn_handover_cannot_be_accepted", acceptWithdrawn, 409);
  assert(acceptWithdrawn.body?.error === "REQUEST_NOT_PENDING", "withdrawn_handover_replay_conflict");
  const declinedRequest = await request("POST", `/task-assignments/${requestLifecycle.assignmentId}/handover-requests`, {
    targetPersonId: secondEmployee.personId,
    reason: "Exercise explicit recipient decline.",
  }, firstEmployee.cookie);
  assertStatus("handover_decline_request_create", declinedRequest, 201);
  const declinedRequestId = field("handover_decline_request", declinedRequest, "requestId");
  const decline = await request("POST", `/task-handover-requests/${declinedRequestId}/decline`, {
    reason: "The target cannot take this work now.",
  }, secondEmployee.cookie);
  assertStatus("handover_request_decline", decline, 200);
  assert(decline.body?.status === "declined", "handover_request_declined_state_persisted");
  const acceptDeclined = await request("POST", `/task-handover-requests/${declinedRequestId}/accept`, {}, secondEmployee.cookie);
  assertStatus("declined_handover_cannot_be_accepted", acceptDeclined, 409);
  assert(acceptDeclined.body?.error === "REQUEST_NOT_PENDING", "declined_handover_replay_conflict");

  const reviewerExpiry = await createScenarioAssignment(
    "reviewer_request_expiry", "Expired reviewer request", firstEmployee.personId, founder.id,
  );
  const expiredReviewerRequest = await request("POST", `/task-assignments/${reviewerExpiry.assignmentId}/reviewer-requests`, {
    candidateReviewerPersonId: secondEmployee.personId,
    reason: "Exercise an expired reviewer request.",
  }, firstEmployee.cookie);
  assertStatus("expired_reviewer_request_create", expiredReviewerRequest, 201);
  const expiredReviewerRequestId = field("expired_reviewer_request", expiredReviewerRequest, "requestId");
  await sql(
    `UPDATE nova.task_reviewer_requests
     SET created_at = clock_timestamp() - interval '1 day',
         expires_at = clock_timestamp() - interval '1 microsecond'
     WHERE id = $1::uuid`,
    [expiredReviewerRequestId],
  );
  const actualDateNow = Date.now;
  let expiredReviewerAccept: ApiResult;
  Date.now = () => actualDateNow() - 24 * 60 * 60 * 1_000;
  try {
    expiredReviewerAccept = await request(
      "POST", `/task-reviewer-requests/${expiredReviewerRequestId}/accept`, {}, secondEmployee.cookie,
    );
  } finally {
    Date.now = actualDateNow;
  }
  assertStatus("expired_reviewer_request_accept", expiredReviewerAccept, 409);
  assert(expiredReviewerAccept.body?.error === "REQUEST_EXPIRED", "expired_reviewer_request_cannot_change_reviewer");
  const reviewerExpiryState = (await sql<{
    request_status: string;
    resolved_by_person_id: string;
    reviewer_person_id: string | null;
    expiry_notices: string;
  }>(
    `SELECT requests.status AS request_status, requests.resolved_by_person_id,
            assignments.reviewer_person_id,
            (SELECT count(*)::text FROM nova.notifications
             WHERE event_key = 'task.reviewer_request_expired'
               AND aggregate_id = requests.id) AS expiry_notices
     FROM nova.task_reviewer_requests requests
     JOIN nova.task_assignments assignments ON assignments.id = requests.assignment_id
     WHERE requests.id = $1::uuid`,
    [expiredReviewerRequestId],
  ))[0];
  assert(reviewerExpiryState?.request_status === "expired"
    && reviewerExpiryState.resolved_by_person_id === secondEmployee.personId
    && reviewerExpiryState.reviewer_person_id === founder.id
    && reviewerExpiryState.expiry_notices === "1",
  "expired_reviewer_request_resolves_once_without_changing_reviewer");
  const expiredReviewerReplay = await request(
    "POST", `/task-reviewer-requests/${expiredReviewerRequestId}/accept`, {}, secondEmployee.cookie,
  );
  assertStatus("expired_reviewer_request_replay", expiredReviewerReplay, 409);
  assert(expiredReviewerReplay.body?.error === "REQUEST_NOT_PENDING", "expired_reviewer_request_replay_is_rejected");

  const handoverExpiry = await createScenarioAssignment(
    "handover_request_expiry", "Expired handover request", firstEmployee.personId, founder.id,
  );
  const expiredHandoverRequest = await request("POST", `/task-assignments/${handoverExpiry.assignmentId}/handover-requests`, {
    targetPersonId: secondEmployee.personId,
    reason: "Exercise an expired handover request.",
  }, firstEmployee.cookie);
  assertStatus("expired_handover_request_create", expiredHandoverRequest, 201);
  const expiredHandoverRequestId = field("expired_handover_request", expiredHandoverRequest, "requestId");
  await sql(
    `UPDATE nova.task_assignment_handover_requests
     SET created_at = clock_timestamp() - interval '1 day',
         expires_at = clock_timestamp() - interval '1 microsecond'
     WHERE id = $1::uuid`,
    [expiredHandoverRequestId],
  );
  const expiredHandoverAccept = await request(
    "POST", `/task-handover-requests/${expiredHandoverRequestId}/accept`, {}, secondEmployee.cookie,
  );
  assertStatus("expired_handover_request_accept", expiredHandoverAccept, 409);
  assert(expiredHandoverAccept.body?.error === "REQUEST_EXPIRED", "expired_handover_request_cannot_transfer_assignment");
  const handoverExpiryState = (await sql<{
    request_status: string;
    resolved_by_person_id: string;
    active_assignments: string;
    assignee_person_id: string;
    expiry_notices: string;
  }>(
    `SELECT requests.status AS request_status, requests.resolved_by_person_id,
            assignments.person_id AS assignee_person_id,
            (SELECT count(*)::text FROM nova.task_assignments active
             WHERE active.task_id = assignments.task_id AND active.status NOT IN ('approved', 'cancelled')) AS active_assignments,
            (SELECT count(*)::text FROM nova.notifications
             WHERE event_key = 'task.handover_request_expired'
               AND aggregate_id = requests.id) AS expiry_notices
     FROM nova.task_assignment_handover_requests requests
     JOIN nova.task_assignments assignments ON assignments.id = requests.assignment_id
     WHERE requests.id = $1::uuid`,
    [expiredHandoverRequestId],
  ))[0];
  assert(handoverExpiryState?.request_status === "expired"
    && handoverExpiryState.resolved_by_person_id === secondEmployee.personId
    && handoverExpiryState.assignee_person_id === firstEmployee.personId
    && handoverExpiryState.active_assignments === "1"
    && handoverExpiryState.expiry_notices === "1",
  "expired_handover_request_preserves_assignment_and_notifies_once");
  const expiredHandoverReplay = await request(
    "POST", `/task-handover-requests/${expiredHandoverRequestId}/accept`, {}, secondEmployee.cookie,
  );
  assertStatus("expired_handover_request_replay", expiredHandoverReplay, 409);
  assert(expiredHandoverReplay.body?.error === "REQUEST_NOT_PENDING", "expired_handover_request_replay_is_rejected");
  const replacementHandoverRequest = await request("POST", `/task-assignments/${handoverExpiry.assignmentId}/handover-requests`, {
    targetPersonId: secondEmployee.personId,
    reason: "Prove a fresh handover can replace an expired request.",
  }, firstEmployee.cookie);
  assertStatus("fresh_handover_request_after_expiry", replacementHandoverRequest, 201);
  const replacementHandoverId = field("replacement_handover_after_expiry", replacementHandoverRequest, "requestId");
  assertStatus("replacement_handover_after_expiry_cleanup", await request(
    "POST", `/task-handover-requests/${replacementHandoverId}/withdraw`, {
      reason: "Close the disposable expiry fixture.",
    }, firstEmployee.cookie,
  ), 200);

  const handoverSubmitRace = await createScenarioAssignment(
    "handover_submit_race", "Handover racing submission", firstEmployee.personId, founder.id,
  );
  const raceTimer = await request("POST", "/work-sessions/start", {
    assignmentId: handoverSubmitRace.assignmentId,
  }, firstEmployee.cookie);
  assertStatus("handover_submit_race_timer_start", raceTimer, 201);
  const raceTimerId = field("handover_submit_race_timer", raceTimer, "sessionId");
  assertStatus("handover_submit_race_timer_stop", await request(
    "POST", `/work-sessions/${raceTimerId}/stop`, {}, firstEmployee.cookie,
  ), 200);
  const raceHandoverRequest = await request("POST", `/task-assignments/${handoverSubmitRace.assignmentId}/handover-requests`, {
    targetPersonId: secondEmployee.personId,
    reason: "Race acceptance against old-assignee submission.",
  }, firstEmployee.cookie);
  assertStatus("handover_submit_race_request", raceHandoverRequest, 201);
  const raceHandoverId = field("handover_submit_race_request", raceHandoverRequest, "requestId");
  const handoverSubmitResults = await Promise.all([
    request("POST", `/task-handover-requests/${raceHandoverId}/accept`, {}, secondEmployee.cookie),
    request("POST", `/task-assignments/${handoverSubmitRace.assignmentId}/submit`, {}, firstEmployee.cookie),
  ]);
  const raceAcceptance = handoverSubmitResults[0]!;
  const raceSubmission = handoverSubmitResults[1]!;
  console.info("handover_submit_race", {
    accept: { status: raceAcceptance.status, error: raceAcceptance.body?.error },
    submit: { status: raceSubmission.status, error: raceSubmission.body?.error },
  });
  assert([raceAcceptance.status, raceSubmission.status].filter((status) => status === 200).length === 1,
    "handover_submit_race_has_one_winner");
  assert([raceAcceptance.status, raceSubmission.status].filter((status) => status === 409).length === 1,
    "handover_submit_race_loser_is_conflict");
  const raceAssignments = await sql<{ person_id: string; status: string }>(
    "SELECT person_id, status FROM nova.task_assignments WHERE task_id = $1::uuid ORDER BY assigned_at, id",
    [handoverSubmitRace.taskId],
  );
  if (raceAcceptance.status === 200) {
    assert(raceSubmission.body?.error === "ASSIGNMENT_NOT_SUBMITTABLE", "handover_winner_blocks_old_assignment_submission");
    assert(raceAssignments.length === 2 && raceAssignments[0]?.status === "cancelled"
      && raceAssignments[1]?.person_id === secondEmployee.personId && raceAssignments[1]?.status === "assigned",
    "handover_winner_leaves_one_new_active_assignment");
  } else {
    assert(raceAcceptance.body?.error === "ASSIGNMENT_NOT_HANDOVERABLE", "submission_winner_blocks_handover_acceptance");
    assert(raceAssignments.length === 1 && raceAssignments[0]?.person_id === firstEmployee.personId
      && raceAssignments[0]?.status === "awaiting_review",
    "submission_winner_keeps_original_reviewable_assignment");
  }
  assertStatus("handover_submit_race_fixture_cleanup", await request(
    "POST", `/tasks/${handoverSubmitRace.taskId}/cancel`, {}, founderCookie,
  ), 200);

  const resubmission = await createScenarioAssignment(
    "review_resubmission", "Changes requested then resubmitted", secondEmployee.personId, founder.id,
  );
  const firstReviewTimer = await request("POST", "/work-sessions/start", {
    assignmentId: resubmission.assignmentId,
  }, secondEmployee.cookie);
  assertStatus("resubmission_first_timer_start", firstReviewTimer, 201);
  const firstReviewTimerId = field("resubmission_first_timer", firstReviewTimer, "sessionId");
  assertStatus("resubmission_first_timer_stop", await request(
    "POST", `/work-sessions/${firstReviewTimerId}/stop`, {}, secondEmployee.cookie,
  ), 200);
  const firstSubmission = await request("POST", `/task-assignments/${resubmission.assignmentId}/submit`, {}, secondEmployee.cookie);
  assertStatus("resubmission_first_submit", firstSubmission, 200);
  assert(firstSubmission.body?.status === "awaiting_review", "first_submission_opens_review_cycle");
  const firstReviewCycleId = await pendingReviewCycleId("resubmission_first_cycle", resubmission.assignmentId, founderCookie);
  const changesRequested = await request("POST", `/task-assignments/${resubmission.assignmentId}/review`, {
    decision: "changes_requested",
    expectedReviewCycleId: firstReviewCycleId,
    feedback: "Please add the missing delivery notes.",
  }, founderCookie);
  assertStatus("resubmission_changes_requested", changesRequested, 200);
  assert(changesRequested.body?.status === "changes_requested", "review_returns_assignment_for_changes");
  const returnedState = (await sql<{
    assignment_status: string;
    task_status: string;
    cycle_number: number;
    decision: string;
    feedback: string;
    open_cycles: string;
  }>(
    `SELECT assignments.status AS assignment_status, tasks.status AS task_status,
            cycles.cycle_number, cycles.decision, cycles.feedback,
            (SELECT count(*)::text FROM nova.task_review_cycles open_cycles
             WHERE open_cycles.assignment_id = assignments.id AND open_cycles.decided_at IS NULL) AS open_cycles
     FROM nova.task_assignments assignments
     JOIN nova.tasks tasks ON tasks.id = assignments.task_id
     JOIN nova.task_review_cycles cycles ON cycles.assignment_id = assignments.id
     WHERE assignments.id = $1::uuid AND cycles.cycle_number = 1`,
    [resubmission.assignmentId],
  ))[0];
  assert(returnedState?.assignment_status === "changes_requested" && returnedState.task_status === "returned"
    && returnedState.cycle_number === 1 && returnedState.decision === "changes_requested"
    && returnedState.feedback === "Please add the missing delivery notes." && returnedState.open_cycles === "0",
  "changes_requested_persists_feedback_and_closes_first_cycle");

  const resubmissionTimer = await request("POST", "/work-sessions/start", {
    assignmentId: resubmission.assignmentId,
  }, secondEmployee.cookie);
  assertStatus("resubmission_timer_start", resubmissionTimer, 201);
  const resubmissionTimerId = field("resubmission_timer", resubmissionTimer, "sessionId");
  assertStatus("resubmission_timer_stop", await request(
    "POST", `/work-sessions/${resubmissionTimerId}/stop`, {}, secondEmployee.cookie,
  ), 200);
  const secondSubmission = await request("POST", `/task-assignments/${resubmission.assignmentId}/submit`, {}, secondEmployee.cookie);
  assertStatus("resubmission_second_submit", secondSubmission, 200);
  assert(secondSubmission.body?.status === "awaiting_review", "resubmission_opens_next_review_cycle");
  const secondReviewCycleId = await pendingReviewCycleId("resubmission_second_cycle", resubmission.assignmentId, founderCookie);
  const resubmissionApproval = await request("POST", `/task-assignments/${resubmission.assignmentId}/review`, {
    decision: "approved",
    expectedReviewCycleId: secondReviewCycleId,
  }, founderCookie);
  assertStatus("resubmission_final_approval", resubmissionApproval, 200);
  const completedCycles = await sql<{
    status: string;
    task_status: string;
    cycle_number: number;
    decision: string;
    feedback: string | null;
  }>(
    `SELECT assignments.status, tasks.status AS task_status, cycles.cycle_number,
            cycles.decision, cycles.feedback
     FROM nova.task_assignments assignments
     JOIN nova.tasks tasks ON tasks.id = assignments.task_id
     JOIN nova.task_review_cycles cycles ON cycles.assignment_id = assignments.id
     WHERE assignments.id = $1::uuid ORDER BY cycles.cycle_number`,
    [resubmission.assignmentId],
  );
  assert(completedCycles.length === 2
    && completedCycles[0]?.cycle_number === 1
    && completedCycles[0]?.decision === "changes_requested"
    && completedCycles[0]?.feedback === "Please add the missing delivery notes."
    && completedCycles[1]?.cycle_number === 2
    && completedCycles[1]?.decision === "approved"
    && completedCycles[1]?.feedback === null
    && completedCycles[1]?.status === "approved"
    && completedCycles[1]?.task_status === "approved",
  "resubmission_preserves_both_review_decisions_and_completes_task");
  const resubmissionNotifications = await sql<{ event_key: string; total: string }>(
    `SELECT event_key, count(*)::text AS total FROM nova.notifications
     WHERE aggregate_id = $1::uuid
       AND ((event_key = 'task.review_requested' AND idempotency_key LIKE 'task.submitted:%')
         OR event_key IN ('task.changes_requested', 'task.approved'))
     GROUP BY event_key`,
    [resubmission.assignmentId],
  );
  assert(resubmissionNotifications.some((row) => row.event_key === "task.review_requested" && row.total === "2")
    && resubmissionNotifications.some((row) => row.event_key === "task.changes_requested" && row.total === "1")
    && resubmissionNotifications.some((row) => row.event_key === "task.approved" && row.total === "1"),
  "review_resubmission_emits_cycle_specific_in_app_notifications");

  const billingOriginal = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Billable client deliverable",
  }, founderCookie);
  assertStatus("billing_original_create", billingOriginal, 201);
  const billingOriginalId = field("billing_original", billingOriginal, "taskId");
  const billingAssignment = await request("POST", `/tasks/${billingOriginalId}/assignments`, {
    personId: firstEmployee.personId,
    reviewerPersonId: founder.id,
    reviewRequired: true,
  }, founderCookie);
  assertStatus("billing_original_assignment_create", billingAssignment, 201);
  const billingAssignmentId = field("billing_assignment", billingAssignment, "assignmentId");
  const billingTimer = await request("POST", "/work-sessions/start", {
    assignmentId: billingAssignmentId,
  }, firstEmployee.cookie);
  assertStatus("billing_original_timer_start", billingTimer, 201);
  const billingTimerId = field("billing_timer", billingTimer, "sessionId");
  const billingSnapshot = (await sql<{ billing_class_snapshot: string }>(
    "SELECT billing_class_snapshot::text FROM nova.work_sessions WHERE id = $1::uuid",
    [billingTimerId],
  ))[0];
  assert(billingSnapshot?.billing_class_snapshot === "billable", "work_session_captures_starting_task_billing_class");
  assertStatus("billing_original_timer_stop", await request(
    "POST", `/work-sessions/${billingTimerId}/stop`, {}, firstEmployee.cookie,
  ), 200);
  assertStatus("billing_original_submit", await request(
    "POST", `/task-assignments/${billingAssignmentId}/submit`, {}, firstEmployee.cookie,
  ), 200);
  const billingReviewCycleId = await pendingReviewCycleId("billing_original_cycle", billingAssignmentId, founderCookie);
  assertStatus("billing_original_approval", await request(
    "POST", `/task-assignments/${billingAssignmentId}/review`, {
      decision: "approved",
      expectedReviewCycleId: billingReviewCycleId,
    }, founderCookie,
  ), 200);
  const completedOriginalCancellation = await request(
    "POST", `/tasks/${billingOriginalId}/cancel`, {}, founderCookie,
  );
  assertStatus("approved_original_cannot_be_cancelled", completedOriginalCancellation, 409);
  assert(completedOriginalCancellation.body?.error === "TASK_NOT_CANCELLABLE",
    "completed_task_preserves_original_history_for_correction");

  const changedWorkstreamPolicy = await request("PATCH", `/workstreams/client/${workstreamId}/billing-policy`, {
    policyClass: "non_billable",
    expectedRevision: 1,
    reason: "Future tasks in this stream are outside the billable agreement.",
  }, founderCookie);
  assertStatus("admin_changes_policy_for_future_tasks_only", changedWorkstreamPolicy, 200);
  assert(changedWorkstreamPolicy.body?.policyClass === "non_billable"
    && changedWorkstreamPolicy.body?.revision === 2,
  "workstream_policy_change_increments_revision");
  const originalAfterPolicyChange = (await sql<{ billing_class: string }>(
    "SELECT billing_class::text FROM nova.tasks WHERE id = $1::uuid", [billingOriginalId],
  ))[0]?.billing_class;
  assert(originalAfterPolicyChange === "billable"
    && (await sql<{ billing_class_snapshot: string }>(
      "SELECT billing_class_snapshot::text FROM nova.work_sessions WHERE id = $1::uuid", [billingTimerId],
    ))[0]?.billing_class_snapshot === "billable",
  "policy_change_does_not_reclassify_existing_tasks_or_sessions");
  const predefinedAfterPolicyChange = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    taskCatalogEntryId,
    taskCatalogRevision: reclassifiedTemplateRevision,
    assignToSelf: false,
  }, founderCookie);
  assertStatus("predefined_task_keeps_its_workstream_specific_rule_after_default_change", predefinedAfterPolicyChange, 201);
  const predefinedAfterPolicyClass = (await sql<{
    billing_class: string; billing_policy_revision: number; billing_policy_source: string;
  }>(
    `SELECT billing_class::text, billing_policy_revision, billing_policy_source
     FROM nova.tasks WHERE id = $1::uuid`,
    [field("predefined_after_policy_change", predefinedAfterPolicyChange, "taskId")],
  ))[0];
  assert(predefinedAfterPolicyClass?.billing_class === "non_billable"
    && predefinedAfterPolicyClass.billing_policy_revision === 1
    && predefinedAfterPolicyClass.billing_policy_source === "client_workstream_task_definition",
  "definition_override_is_independent_of_the_workstream_one_off_default_revision");
  const billableTemplateAfterDefaultChange = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    taskCatalogEntryId: billableTaskDefinitionId,
    taskCatalogRevision: billableTaskDefinitionRevision,
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("explicit_billable_definition_rule_survives_default_change", billableTemplateAfterDefaultChange, 201);
  assert(billableTemplateAfterDefaultChange.body?.billingClass === "billable"
    && billableTemplateAfterDefaultChange.body?.billingPolicySource === "client_workstream_task_definition",
  "explicit_predefined_rule_remains_billable_when_one_off_default_is_non_billable");
  const resetDefinitionBillingRule = await request(
    "PATCH", `/workstreams/client/${workstreamId}/billing-policy/definitions/${billableTaskDefinitionId}`, {
      policyClass: null, expectedRevision: 1,
      reason: "This definition now follows the workstream default instead of retaining a separate rule.",
    }, founderCookie,
  );
  assertStatus("policy_manager_resets_definition_to_workstream_default", resetDefinitionBillingRule, 200);
  assert(resetDefinitionBillingRule.body?.policyClass === null && resetDefinitionBillingRule.body?.revision === 2,
    "reset_to_inherit_is_audited_and_advances_the_rule_revision");
  const inheritedDefinitionTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    taskCatalogEntryId: billableTaskDefinitionId,
    taskCatalogRevision: billableTaskDefinitionRevision,
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("reset_definition_uses_current_workstream_default", inheritedDefinitionTask, 201);
  assert(inheritedDefinitionTask.body?.billingClass === "non_billable"
    && inheritedDefinitionTask.body?.billingPolicySource === "client_workstream"
    && inheritedDefinitionTask.body?.billingPolicyRevision === 2,
  "reset_to_inherit_uses_workstream_default_and_its_revision");
  const [definitionRuleRaceTask, definitionRuleRaceEdit] = await Promise.all([
    request("POST", "/tasks", {
      clientWorkstreamId: workstreamId,
      taskCatalogEntryId: billableTaskDefinitionId,
      taskCatalogRevision: billableTaskDefinitionRevision,
      assignToSelf: false,
    }, firstEmployee.cookie),
    request("PATCH", `/workstreams/client/${workstreamId}/billing-policy/definitions/${billableTaskDefinitionId}`, {
      policyClass: "billable", expectedRevision: 2,
      reason: "Concurrency fixture changes a predefined-task rule while the task is created.",
    }, founderCookie),
  ]);
  assertStatus("definition_rule_edit_task_create_race_task", definitionRuleRaceTask, 201);
  assertStatus("definition_rule_edit_task_create_race_edit", definitionRuleRaceEdit, 200);
  const definitionRuleRaceSnapshot = (await sql<{
    billing_class: string; billing_policy_revision: number; billing_policy_source: string;
  }>(
    `SELECT billing_class::text, billing_policy_revision, billing_policy_source
     FROM nova.tasks WHERE id = $1::uuid`, [field("definition_rule_race_task", definitionRuleRaceTask, "taskId")],
  ))[0];
  assert((definitionRuleRaceSnapshot?.billing_class === "non_billable"
      && definitionRuleRaceSnapshot.billing_policy_revision === 2
      && definitionRuleRaceSnapshot.billing_policy_source === "client_workstream")
    || (definitionRuleRaceSnapshot?.billing_class === "billable"
      && definitionRuleRaceSnapshot.billing_policy_revision === 3
      && definitionRuleRaceSnapshot.billing_policy_source === "client_workstream_task_definition"),
  "task_creation_racing_definition_rule_edit_keeps_class_source_and_revision_coherent");
  const stalePolicyUpdate = await request("PATCH", `/workstreams/client/${workstreamId}/billing-policy`, {
    policyClass: "billable",
    expectedRevision: 1,
    reason: "Stale administrator form must not overwrite a newer policy.",
  }, founderCookie);
  assertStatus("stale_policy_edit_is_conflict_not_last_write_wins", stalePolicyUpdate, 409);
  assert(stalePolicyUpdate.body?.error === "WORKSTREAM_BILLING_POLICY_VERSION_CONFLICT",
    "stale_policy_edit_has_stable_conflict");
  const [policyRaceTask, policyRaceEdit] = await Promise.all([
    request("POST", "/tasks", {
      clientWorkstreamId: workstreamId,
      title: "Task created while billing policy changes",
    }, founderCookie),
    request("PATCH", `/workstreams/client/${workstreamId}/billing-policy`, {
      policyClass: "billable", expectedRevision: 2,
      reason: "Concurrency fixture rotates the policy while a task is created.",
    }, founderCookie),
  ]);
  assertStatus("policy_edit_task_create_race_task", policyRaceTask, 201);
  assertStatus("policy_edit_task_create_race_edit", policyRaceEdit, 200);
  const policyRaceTaskId = field("policy_race_task", policyRaceTask, "taskId");
  const policyRaceSnapshot = (await sql<{
    billing_class: string; billing_policy_revision: number; billing_policy_source: string;
  }>(
    `SELECT billing_class::text, billing_policy_revision, billing_policy_source
     FROM nova.tasks WHERE id = $1::uuid`, [policyRaceTaskId],
  ))[0];
  assert((policyRaceSnapshot?.billing_class === "non_billable" && policyRaceSnapshot.billing_policy_revision === 2)
    || (policyRaceSnapshot?.billing_class === "billable" && policyRaceSnapshot.billing_policy_revision === 3),
  "racing_task_captures_one_coherent_policy_class_and_revision");
  assert(policyRaceSnapshot?.billing_policy_source === "client_workstream",
    "racing_task_preserves_workstream_policy_provenance");
  const policyAfterRace = (await sql<{ billing_policy_class: string; billing_policy_revision: number }>(
    "SELECT billing_policy_class::text, billing_policy_revision FROM nova.client_workstreams WHERE id = $1::uuid",
    [workstreamId],
  ))[0];
  assert(policyAfterRace?.billing_policy_class === "billable" && policyAfterRace.billing_policy_revision === 3,
    "policy_edit_race_keeps_one_final_serialized_revision");
  const restoreNonBillablePolicy = await request("PATCH", `/workstreams/client/${workstreamId}/billing-policy`, {
    policyClass: "non_billable", expectedRevision: 3,
    reason: "The remaining correction fixtures follow the current non-billable policy.",
  }, founderCookie);
  assertStatus("restore_non_billable_policy_for_correction_fixtures", restoreNonBillablePolicy, 200);
  assert(restoreNonBillablePolicy.body?.revision === 4,
    "restored_policy_uses_next_monotonic_revision");

  const billableCreateGrantIndex = grants.findIndex((grant) => grant.permissionKey === "tasks.create.billable");
  assert(billableCreateGrantIndex >= 0, "billable_action_permission_is_configurable_on_the_role");
  grants.splice(billableCreateGrantIndex, 1);
  assertStatus("revoke_billable_action_permission", await updateRole(roleInput), 200);
  const oneOffCorrectionWithoutBillableCapability = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Correction follows current non-billable policy",
    correctionOfTaskId: billingOriginalId,
    correctionReason: "The correction is its own task under the current stream policy.",
  }, firstEmployee.cookie);
  assertStatus("non_billable_policy_allows_correction_without_billable_action_permission", oneOffCorrectionWithoutBillableCapability, 201);
  const oneOffCorrectionId = field("one_off_correction_without_billable_capability", oneOffCorrectionWithoutBillableCapability, "taskId");
  const oneOffCorrectionClass = (await sql<{ billing_class: string }>(
    "SELECT billing_class::text FROM nova.tasks WHERE id = $1::uuid", [oneOffCorrectionId],
  ))[0]?.billing_class;
  assert(oneOffCorrectionClass === "non_billable", "correction_uses_current_policy_not_source_class");

  const restrictedBillableWorkstream = await request("POST", "/workstreams/client", {
    clientId, name: "Billable stream requiring explicit role capability",
  }, founderCookie);
  assertStatus("second_client_workstream_create", restrictedBillableWorkstream, 201);
  const restrictedBillableWorkstreamId = field("restricted_billable_workstream", restrictedBillableWorkstream, "workstreamId");
  const restrictedWorkstreamPolicy = await request("PATCH",
    `/workstreams/client/${restrictedBillableWorkstreamId}/billing-policy`, {
      policyClass: "billable", expectedRevision: 0,
      reason: "This separate stream is covered by a billable client agreement.",
    }, founderCookie);
  assertStatus("separate_billable_policy_configured", restrictedWorkstreamPolicy, 200);
  grants.push({ permissionKey: "tasks.create", scope: "client_workstream", clientWorkstreamId: restrictedBillableWorkstreamId });
  grants.push({ permissionKey: "tasks.view", scope: "client_workstream", clientWorkstreamId: restrictedBillableWorkstreamId });
  assertStatus("employee_receives_scoped_access_without_billable_action", await updateRole(roleInput), 200);
  const unauthorizedBillableTask = await request("POST", "/tasks", {
    clientWorkstreamId: restrictedBillableWorkstreamId,
    title: "Requires billable action permission",
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("billable_policy_still_requires_role_action_permission", unauthorizedBillableTask, 403);
  assert(unauthorizedBillableTask.body?.error === "PERMISSION_DENIED",
    "policy_classification_does_not_bypass_role_permissions");
  const deniedCorrectionCount = (await sql<{ count: string }>(
    "SELECT count(*)::text AS count FROM nova.tasks WHERE title = $1",
    ["Requires billable action permission"],
  ))[0]?.count;
  assert(deniedCorrectionCount === "0", "denied_billable_task_leaves_no_partial_task");
  const billableSourceTask = await request("POST", "/tasks", {
    clientWorkstreamId: restrictedBillableWorkstreamId,
    title: "Completed billable source for correction authorization test",
  }, founderCookie);
  assertStatus("billable_source_task_create_for_correction_link", billableSourceTask, 201);
  const billableSourceTaskId = field("billable_source_task_for_correction", billableSourceTask, "taskId");
  await sql("UPDATE nova.tasks SET status = 'done' WHERE id = $1::uuid", [billableSourceTaskId]);
  const unauthorizedBillableCorrection = await request("POST", "/tasks", {
    clientWorkstreamId: restrictedBillableWorkstreamId,
    title: "Correction cannot bypass billable action permission",
    correctionOfTaskId: billableSourceTaskId,
    correctionReason: "The correction follows its own workstream policy.",
  }, firstEmployee.cookie);
  assertStatus("correction_link_does_not_skip_billable_task_permission", unauthorizedBillableCorrection, 403);
  assert(unauthorizedBillableCorrection.body?.error === "PERMISSION_DENIED",
    "correction_relationship_does_not_bypass_billable_authorization");
  const deniedBillableTaskCount = (await sql<{ count: string }>(
    "SELECT count(*)::text AS count FROM nova.tasks WHERE title = $1",
    ["Correction cannot bypass billable action permission"],
  ))[0]?.count;
  assert(deniedBillableTaskCount === "0", "denied_billable_classification_leaves_no_partial_correction_task");

  const correctionTaskPayload = {
    clientWorkstreamId: workstreamId,
    title: "Correction task for approved work",
    taskCatalogEntryId,
    taskCatalogRevision: reclassifiedTemplateRevision,
    correctionOfTaskId: billingOriginalId,
    correctionReason: "Fix the approved source deliverable.",
    assignToSelf: true,
  };
  const correctionTaskKey = randomUUID();
  const correctionTask = await request("POST", "/tasks", correctionTaskPayload,
    firstEmployee.cookie, false, { "idempotency-key": correctionTaskKey });
  assertStatus("correction_task_creates_through_existing_task_authorization", correctionTask, 201);
  const correctionTaskId = field("correction_task", correctionTask, "taskId");
  const correctionTaskReplay = await request("POST", "/tasks", correctionTaskPayload,
    firstEmployee.cookie, false, { "idempotency-key": correctionTaskKey });
  assertStatus("correction_task_retry_returns_original_result", correctionTaskReplay, 201);
  assert(field("correction_task_retry", correctionTaskReplay, "taskId") === correctionTaskId
    && field("correction_task_retry", correctionTaskReplay, "assignmentId") === field("correction_task", correctionTask, "assignmentId"),
  "correction_task_retry_does_not_create_duplicate_task_or_assignment");
  const correctionRetryCount = (await sql<{ count: string }>(
    "SELECT count(*)::text AS count FROM nova.tasks WHERE title = $1",
    ["Correction task for approved work"],
  ))[0]?.count;
  assert(correctionRetryCount === "1", "correction_idempotency_persists_exactly_one_task");
  const visibleCorrectionTasks = await request("GET", "/tasks", undefined, firstEmployee.cookie);
  assertStatus("correction_task_visible_to_scoped_employee", visibleCorrectionTasks, 200);
  const correctionView = visibleCorrectionTasks.body?.tasks?.find((entry: any) => entry.id === correctionTaskId);
  assert(correctionView?.isCorrection === true
    && correctionView.billingClass === "non_billable"
    && correctionView.billingPolicySource === "client_workstream_task_definition"
    && correctionView.taskDefinition?.entryId === taskCatalogEntryId
    && correctionView.taskDefinition?.revision === reclassifiedTemplateRevision
    && correctionView.correctionOf?.taskId === billingOriginalId
    && correctionView.correctionOf?.title === "Billable client deliverable",
  "correction_task_exposes_its_read_only_definition_provenance_separately_from_its_source_link");
  const correctionAssignmentId = field("correction_task", correctionTask, "assignmentId");
  const correctionAssignments = await request("GET", "/work/assignments/mine", undefined, firstEmployee.cookie);
  assertStatus("correction_assignment_visible_to_creator", correctionAssignments, 200);
  const correctionAssignmentView = correctionAssignments.body?.assignments?.find(
    (entry: any) => entry.assignmentId === correctionAssignmentId,
  );
  assert(correctionAssignmentView?.isCorrection === true
    && correctionAssignmentView.billingClass === "non_billable"
    && correctionAssignmentView.billingPolicySource === "client_workstream_task_definition"
    && correctionAssignmentView.taskDefinition?.entryId === taskCatalogEntryId
    && correctionAssignmentView.taskDefinition?.revision === reclassifiedTemplateRevision
    && correctionAssignmentView.correctionOf?.title === "Billable client deliverable",
  "employee_work_list_shows_classification_source_and_separate_correction_link");
  const originalAfterCorrection = (await sql<{
    status: string; billing_class: string; title: string; task_catalog_entry_id: string | null;
    task_catalog_revision: number | null;
  }>(
    `SELECT status, billing_class::text, title, task_catalog_entry_id, task_catalog_revision
     FROM nova.tasks WHERE id = $1::uuid`,
    [billingOriginalId],
  ))[0];
  assert(originalAfterCorrection?.status === "approved"
    && originalAfterCorrection.billing_class === "billable"
    && originalAfterCorrection.title === "Billable client deliverable",
  "correction_creation_does_not_rewrite_original_task");
  const correctionBillingProvenance = (await sql<{
    billing_class: string; correction_of_task_id: string; task_catalog_entry_id: string | null;
    task_catalog_revision: number | null; billing_policy_source: string; billing_policy_revision: number;
  }>(
    `SELECT billing_class::text, correction_of_task_id, task_catalog_entry_id, task_catalog_revision,
            billing_policy_source, billing_policy_revision
     FROM nova.tasks WHERE id = $1::uuid`,
    [correctionTaskId],
  ))[0];
  assert(correctionBillingProvenance?.billing_class === "non_billable"
    && correctionBillingProvenance.correction_of_task_id === billingOriginalId
    && correctionBillingProvenance.task_catalog_entry_id === taskCatalogEntryId
    && correctionBillingProvenance.task_catalog_revision === reclassifiedTemplateRevision
    && correctionBillingProvenance.billing_policy_source === "client_workstream_task_definition"
    && correctionBillingProvenance.billing_policy_revision === 1,
  "correction_uses_its_own_predefined_rule_and_never_inherits_the_source_task_class");

  const nonBillableCorrection = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Correction for internal review work",
    correctionOfTaskId: resubmission.taskId,
    correctionReason: "Fix the missing internal delivery notes.",
    assignToSelf: false,
  }, firstEmployee.cookie);
  assertStatus("non_billable_correction_creation", nonBillableCorrection, 201);
  const nonBillableCorrectionId = field("non_billable_correction", nonBillableCorrection, "taskId");
  const nonBillableCorrectionState = (await sql<{
    billing_class: string; correction_of_task_id: string;
  }>(
    `SELECT billing_class::text, correction_of_task_id
     FROM nova.tasks WHERE id = $1::uuid`,
    [nonBillableCorrectionId],
  ))[0];
  assert(nonBillableCorrectionState?.billing_class === "non_billable"
    && nonBillableCorrectionState.correction_of_task_id === resubmission.taskId,
  "one_off_correction_is_non_billable_and_keeps_its_source_link");

  const employeeBusinessDate = (await sql<{ today: string }>(
    "SELECT nova.person_business_date($1::uuid)::text AS today", [firstEmployee.personId],
  ))[0]?.today;
  assert(Boolean(employeeBusinessDate), "task_due_date_uses_assignee_business_date");
  const movedDueDate = (await sql<{ tomorrow: string }>(
    "SELECT ($1::date + 1)::text AS tomorrow", [employeeBusinessDate],
  ))[0]?.tomorrow;
  assert(Boolean(movedDueDate), "next_local_calendar_date_available");
  const dueDateTask = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Due-date edit lifecycle",
    dueDate: movedDueDate,
  }, founderCookie);
  assertStatus("due_date_task_create", dueDateTask, 201);
  const dueDateTaskId = field("due_date_task", dueDateTask, "taskId");
  const dueDateAssignment = await request("POST", `/tasks/${dueDateTaskId}/assignments`, {
    personId: firstEmployee.personId,
    reviewerPersonId: founder.id,
    reviewRequired: true,
  }, founderCookie);
  assertStatus("due_date_task_assignment", dueDateAssignment, 201);
  const dueDateAssignmentId = field("due_date_assignment", dueDateAssignment, "assignmentId");
  await sql(
    `INSERT INTO nova.notification_preferences (
       organisation_id, person_id, event_key, channel, enabled
     )
     SELECT people.organisation_id, people.id, 'task.due_soon', 'email', true
     FROM nova.people people WHERE people.id = $1::uuid
     ON CONFLICT (person_id, event_key, channel) DO UPDATE SET enabled = true`,
    [firstEmployee.personId],
  );
  const taskDateLock = await fixtureDatabase.connect();
  const schedulerTransaction = await fixtureDatabase.connect();
  try {
    await taskDateLock.query("BEGIN");
    await taskDateLock.query("UPDATE nova.tasks SET due_date = $2::date WHERE id = $1::uuid", [
      dueDateTaskId, employeeBusinessDate,
    ]);
    await schedulerTransaction.query("BEGIN");
    await schedulerTransaction.query("SET LOCAL lock_timeout = '1s'");
    await schedulerTransaction.query("SELECT nova.enqueue_due_task_notifications(1, 500)");
    const noticeWhileLocked = await schedulerTransaction.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM nova.notifications
       WHERE aggregate_id = $1::uuid AND event_key IN ('task.due_soon', 'task.overdue')
         AND expires_at IS NULL`,
      [dueDateAssignmentId],
    );
    assert(noticeWhileLocked.rows[0]?.total === "0",
      "due_scheduler_skips_task_locked_by_concurrent_date_edit");
    await schedulerTransaction.query("COMMIT");
    await taskDateLock.query("COMMIT");
  } catch (error) {
    await schedulerTransaction.query("ROLLBACK").catch(() => undefined);
    await taskDateLock.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    schedulerTransaction.release();
    taskDateLock.release();
  }
  await sql("SELECT nova.enqueue_due_task_notifications(1, 500)");
  const oldDueNotice = (await sql<{ id: string }>(
    `SELECT id FROM nova.notifications
     WHERE aggregate_id = $1::uuid AND event_key = 'task.due_soon'
       AND expires_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [dueDateAssignmentId],
  ))[0];
  assert(Boolean(oldDueNotice?.id), "due_scheduler_creates_current_assignment_reminder");
  const oldDueEmail = (await sql<{ id: string; lease_token: string }>(
    `SELECT id, lease_token FROM nova.claim_notification_outbox(100, 120)
     WHERE notification_id = $1::uuid`,
    [oldDueNotice!.id],
  ))[0];
  assert(Boolean(oldDueEmail?.id && oldDueEmail.lease_token), "due_email_is_leased_before_reschedule");

  const employeeDueView = await request("GET", "/tasks", undefined, firstEmployee.cookie);
  assertStatus("employee_due_task_read", employeeDueView, 200);
  let dueView = employeeDueView.body?.tasks?.find((entry: any) => entry.id === dueDateTaskId);
  assert(dueView?.dueDate === employeeBusinessDate && dueView.dueDateRevision === 1
    && dueView.canEditDueDate === false,
  "due_date_read_model_exposes_revision_and_role_capability");
  assertStatus("employee_without_task_edit_cannot_change_due_date", await request(
    "PATCH", `/tasks/${dueDateTaskId}/due-date`, {
      dueDate: null,
      expectedDueDate: employeeBusinessDate,
      expectedDueDateRevision: 1,
    }, firstEmployee.cookie,
  ), 403);

  const dueDateChange = await request("PATCH", `/tasks/${dueDateTaskId}/due-date`, {
    dueDate: movedDueDate,
    expectedDueDate: employeeBusinessDate,
    expectedDueDateRevision: 1,
  }, founderCookie);
  assertStatus("due_date_edit", dueDateChange, 200);
  assert(dueDateChange.body?.changed === true && dueDateChange.body?.dueDateRevision === 2
    && dueDateChange.body?.notifiedAssigneeCount === 1,
  "due_date_edit_increments_revision_and_notifies_current_assignee");
  const invalidatedReminder = (await sql<{
    expires_at: Date | string | null; status: string; is_current_lease: boolean;
  }>(
    `SELECT notifications.expires_at, outbox.status,
            nova.notification_outbox_lease_is_current(outbox.id, $2::uuid) AS is_current_lease
     FROM nova.notifications notifications
     JOIN nova.notification_outbox outbox ON outbox.notification_id = notifications.id
     WHERE notifications.id = $1::uuid`,
    [oldDueNotice!.id, oldDueEmail!.lease_token],
  ))[0];
  assert(Boolean(invalidatedReminder?.expires_at) && invalidatedReminder?.status === "cancelled"
    && invalidatedReminder.is_current_lease === false,
  "reschedule_expires_inbox_notice_and_cancels_claimed_email");
  assertStatus("stale_due_date_revision_conflicts", await request(
    "PATCH", `/tasks/${dueDateTaskId}/due-date`, {
      dueDate: null,
      expectedDueDate: employeeBusinessDate,
      expectedDueDateRevision: 1,
    }, founderCookie,
  ), 409);
  assertStatus("invalid_due_date_rejected", await request(
    "PATCH", `/tasks/${dueDateTaskId}/due-date`, {
      dueDate: "2026-02-30",
      expectedDueDate: movedDueDate,
      expectedDueDateRevision: 2,
    }, founderCookie,
  ), 400);
  const dueDateNoop = await request("PATCH", `/tasks/${dueDateTaskId}/due-date`, {
    dueDate: movedDueDate,
    expectedDueDate: movedDueDate,
    expectedDueDateRevision: 2,
  }, founderCookie);
  assertStatus("same_due_date_is_a_noop", dueDateNoop, 200);
  assert(dueDateNoop.body?.changed === false && dueDateNoop.body?.dueDateRevision === 2,
    "due_date_noop_does_not_advance_revision");
  const dueChangedNotices = await sql<{ total: string; current: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE expires_at IS NULL OR expires_at > clock_timestamp())::text AS current
     FROM nova.notifications
     WHERE aggregate_id = $1::uuid AND event_key = 'task.due_date_changed'`,
    [dueDateAssignmentId],
  );
  assert(dueChangedNotices[0]?.total === "1" && dueChangedNotices[0]?.current === "1",
    "due_date_change_notice_is_single_and_current");
  await sql("SELECT nova.enqueue_due_task_notifications(1, 500)");
  const rescheduledReminder = await sql<{ count: string; max_revision: string }>(
    `SELECT count(*)::text AS count, max(split_part(idempotency_key, ':', 3)) AS max_revision
     FROM nova.notifications
     WHERE aggregate_id = $1::uuid AND event_key = 'task.due_soon'
       AND (expires_at IS NULL OR expires_at > clock_timestamp())`,
    [dueDateAssignmentId],
  );
  assert(rescheduledReminder[0]?.count === "1" && rescheduledReminder[0]?.max_revision === "2",
    "scheduler_uses_new_due_revision_without_resurrecting_old_reminder");

  const roleWithAssignedTaskEdit = {
    ...roleInput,
    permissionGrants: [...grants, { permissionKey: "tasks.edit", scope: "assigned_work" }],
  };
  assertStatus("role_grant_assigned_work_due_date_edit", await updateRole(roleWithAssignedTaskEdit), 200);
  const employeeDueViewAfterGrant = await request("GET", "/tasks", undefined, firstEmployee.cookie);
  assertStatus("employee_due_task_read_after_role_grant", employeeDueViewAfterGrant, 200);
  dueView = employeeDueViewAfterGrant.body?.tasks?.find((entry: any) => entry.id === dueDateTaskId);
  assert(dueView?.canEditDueDate === true && dueView.dueDateRevision === 2,
    "assigned_work_edit_permission_appears_without_relogin");
  assertStatus("assigned_employee_clears_due_date", await request(
    "PATCH", `/tasks/${dueDateTaskId}/due-date`, {
      dueDate: null,
      expectedDueDate: movedDueDate,
      expectedDueDateRevision: 2,
    }, firstEmployee.cookie,
  ), 200);
  assertStatus("role_edit_restore_without_due_date_edit", await updateRole(roleInput), 200);
  const finalDueState = (await sql<{ due_date: string | null; due_date_revision: number; audits: string; notices: string }>(
    `SELECT tasks.due_date::text,
            tasks.due_date_revision,
            (SELECT count(*)::text FROM nova.audit_events events
             WHERE events.target_id = tasks.id AND events.action = 'tasks.due_date_changed') AS audits,
            (SELECT count(*)::text FROM nova.notifications notifications
             WHERE notifications.aggregate_id = $2::uuid AND notifications.event_key = 'task.due_date_changed'
               AND (notifications.expires_at IS NULL OR notifications.expires_at > clock_timestamp())) AS notices
     FROM nova.tasks tasks WHERE tasks.id = $1::uuid`,
    [dueDateTaskId, dueDateAssignmentId],
  ))[0];
  assert(finalDueState?.due_date === null && finalDueState.due_date_revision === 3
    && finalDueState.audits === "2" && finalDueState.notices === "2",
  "assigned_employee_due_date_clear_is_audited_and_notified");
  const terminalDueEdit = await request("PATCH", `/tasks/${billingOriginalId}/due-date`, {
    dueDate: employeeBusinessDate,
    expectedDueDate: null,
    expectedDueDateRevision: 0,
  }, founderCookie);
  assertStatus("approved_task_due_date_is_immutable", terminalDueEdit, 409);
  assert(terminalDueEdit.body?.error === "TASK_DUE_DATE_NOT_EDITABLE",
    "terminal_task_due_date_rejection_is_explicit");

  const unfinishedSource = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Unfinished source must not accept correction",
  }, founderCookie);
  assertStatus("unfinished_correction_source_create", unfinishedSource, 201);
  const unfinishedCorrection = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Invalid premature correction",
    correctionOfTaskId: field("unfinished_source", unfinishedSource, "taskId"),
    correctionReason: "Cannot bypass the existing review/resubmit cycle.",
  }, firstEmployee.cookie);
  assertStatus("unfinished_source_uses_existing_review_cycle", unfinishedCorrection, 409);
  assert(unfinishedCorrection.body?.error === "TASK_CORRECTION_SOURCE_NOT_COMPLETE",
    "unfinished_task_cannot_become_separate_correction");

  const hiddenSource = await request("POST", "/tasks", {
    clientWorkstreamId: field("other_workstream", otherWorkstream, "workstreamId"),
    title: "Out-of-scope completed correction source",
  }, founderCookie);
  assertStatus("hidden_correction_source_fixture_create", hiddenSource, 201);
  const hiddenSourceId = field("hidden_correction_source", hiddenSource, "taskId");
  await sql("UPDATE nova.tasks SET status = 'done' WHERE id = $1::uuid", [hiddenSourceId]);
  const inaccessibleSourceCorrection = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Cannot disclose a hidden source task",
    correctionOfTaskId: hiddenSourceId,
    correctionReason: "The source is outside the current task-view scope.",
  }, firstEmployee.cookie);
  assertStatus("correction_inaccessible_source_is_hidden", inaccessibleSourceCorrection, 404);
  assert(inaccessibleSourceCorrection.body?.error === "TASK_CORRECTION_SOURCE_NOT_FOUND",
    "inaccessible_and_missing_correction_sources_are_indistinguishable");

  const wrongWorkstreamCorrection = await request("POST", "/tasks", {
    clientWorkstreamId: field("other_workstream", otherWorkstream, "workstreamId"),
    title: "Correction cannot change workstream",
    correctionOfTaskId: billingOriginalId,
    correctionReason: "Keep corrective work with its original stream.",
  }, founderCookie);
  assertStatus("correction_workstream_mismatch_rejected", wrongWorkstreamCorrection, 409);
  assert(wrongWorkstreamCorrection.body?.error === "TASK_CORRECTION_WORKSTREAM_MISMATCH",
    "correction_workstream_boundary_is_explicit");

  await sql("UPDATE nova.tasks SET status = 'done' WHERE id = $1::uuid", [correctionTaskId]);
  const nestedCorrection = await request("POST", "/tasks", {
    clientWorkstreamId: workstreamId,
    title: "Nested corrections are not a second task tree",
    correctionOfTaskId: correctionTaskId,
    correctionReason: "Must link directly to a main task.",
  }, firstEmployee.cookie);
  assertStatus("nested_correction_rejected", nestedCorrection, 409);
  assert(nestedCorrection.body?.error === "TASK_CORRECTION_NESTING_NOT_ALLOWED",
    "correction_chain_is_not_nested");

  for (const [label, field, suppliedClass] of [
    ["billable", "billingClass", "billable"],
    ["non_billable", "billingClass", "non_billable"],
    ["correction", "billingClass", "correction"],
    ["snake_case", "billing_class", "billable"],
  ] as const) {
    const directClassification = await request("POST", "/tasks", {
      clientWorkstreamId: workstreamId,
      title: `Reject user-supplied billing class ${label}`,
      [field]: suppliedClass,
    }, firstEmployee.cookie);
    assertStatus(`task_creator_cannot_submit_billing_class_${label}`, directClassification, 400);
    assert(directClassification.body?.error === "TASK_BILLING_CLASS_SERVER_ASSIGNED",
      `billing_class_${label}_is_server_assigned`);
  }

  const reviewRace = await createScenarioAssignment(
    "review_decision_race", "Concurrent review decisions", secondEmployee.personId, founder.id,
  );
  const reviewRaceTimer = await request("POST", "/work-sessions/start", {
    assignmentId: reviewRace.assignmentId,
  }, secondEmployee.cookie);
  assertStatus("review_race_timer_start", reviewRaceTimer, 201);
  const reviewRaceTimerId = field("review_race_timer", reviewRaceTimer, "sessionId");
  assertStatus("review_race_timer_stop", await request(
    "POST", `/work-sessions/${reviewRaceTimerId}/stop`, {}, secondEmployee.cookie,
  ), 200);
  assertStatus("review_race_submission", await request(
    "POST", `/task-assignments/${reviewRace.assignmentId}/submit`, {}, secondEmployee.cookie,
  ), 200);
  const reviewRaceCycleId = await pendingReviewCycleId("review_race_cycle", reviewRace.assignmentId, founderCookie);
  const reviewDecisions = await Promise.all([
    request("POST", `/task-assignments/${reviewRace.assignmentId}/review`, {
      decision: "approved",
      expectedReviewCycleId: reviewRaceCycleId,
    }, founderCookie),
    request("POST", `/task-assignments/${reviewRace.assignmentId}/review`, {
      decision: "changes_requested",
      expectedReviewCycleId: reviewRaceCycleId,
      feedback: "Concurrent decision must not overwrite the winner.",
    }, founderCookie),
  ]);
  assert(reviewDecisions.filter((result) => result.status === 200).length === 1, "review_cycle_has_one_authoritative_decision");
  assert(reviewDecisions.filter((result) => result.status === 409).length === 1, "losing_review_decision_is_conflict");
  const reviewWinner = reviewDecisions.find((result) => result.status === 200)!;
  const persistedReview = (await sql<{ status: string; decision: string | null; decided_cycles: string; open_cycles: string }>(
    `SELECT assignments.status,
            (SELECT decision FROM nova.task_review_cycles WHERE assignment_id = assignments.id ORDER BY cycle_number DESC LIMIT 1) AS decision,
            (SELECT count(*)::text FROM nova.task_review_cycles WHERE assignment_id = assignments.id AND decided_at IS NOT NULL) AS decided_cycles,
            (SELECT count(*)::text FROM nova.task_review_cycles WHERE assignment_id = assignments.id AND decided_at IS NULL) AS open_cycles
     FROM nova.task_assignments assignments WHERE assignments.id = $1::uuid`,
    [reviewRace.assignmentId],
  ))[0];
  assert(persistedReview?.status === reviewWinner.body?.status && persistedReview.decision === reviewWinner.body?.status
    && persistedReview.decided_cycles === "1" && persistedReview.open_cycles === "0",
  "review_race_persists_exactly_one_consistent_decision");
  const reviewRaceCleanup = await request(
    "POST", `/tasks/${reviewRace.taskId}/cancel`, {}, founderCookie,
  );
  const expectedReviewRaceCleanupStatus = persistedReview?.status === "approved" ? 409 : 200;
  assertStatus("review_decision_race_fixture_cleanup", reviewRaceCleanup, expectedReviewRaceCleanupStatus);
  if (persistedReview?.status === "approved") {
    assert(reviewRaceCleanup.body?.error === "TASK_NOT_CANCELLABLE",
      "approved_review_race_winner_is_not_cancelled_for_fixture_cleanup");
  } else {
    assert(reviewRaceCleanup.body?.status === "cancelled",
      "changes_requested_review_race_winner_can_be_cancelled_for_fixture_cleanup");
  }

  const cancellationReview = await createScenarioAssignment(
    "cancel_pending_review", "Cancellation blocks pending review", secondEmployee.personId, founder.id,
  );
  const cancelReviewTimer = await request("POST", "/work-sessions/start", {
    assignmentId: cancellationReview.assignmentId,
  }, secondEmployee.cookie);
  assertStatus("cancel_review_timer_start", cancelReviewTimer, 201);
  const cancelReviewTimerId = field("cancel_review_timer", cancelReviewTimer, "sessionId");
  assertStatus("cancel_review_timer_stop", await request(
    "POST", `/work-sessions/${cancelReviewTimerId}/stop`, {}, secondEmployee.cookie,
  ), 200);
  assertStatus("cancel_review_submission", await request(
    "POST", `/task-assignments/${cancellationReview.assignmentId}/submit`, {}, secondEmployee.cookie,
  ), 200);
  const cancelledReviewCycleId = await pendingReviewCycleId(
    "cancel_pending_review_cycle", cancellationReview.assignmentId, founderCookie,
  );
  assertStatus("cancel_task_awaiting_review", await request(
    "POST", `/tasks/${cancellationReview.taskId}/cancel`, {}, founderCookie,
  ), 200);
  const reviewAfterCancel = await request("POST", `/task-assignments/${cancellationReview.assignmentId}/review`, {
    decision: "approved",
    expectedReviewCycleId: cancelledReviewCycleId,
  }, founderCookie);
  assertStatus("cancelled_assignment_rejects_review", reviewAfterCancel, 409);
  assert(reviewAfterCancel.body?.error === "REVIEW_NOT_OPEN", "cancelled_review_cycle_cannot_be_decided");
  const cancelledReviewState = (await sql<{ assignment_status: string; task_status: string; decisions: string }>(
    `SELECT assignments.status AS assignment_status, tasks.status AS task_status,
            (SELECT count(*)::text FROM nova.task_review_cycles cycles WHERE cycles.assignment_id = assignments.id AND cycles.decided_at IS NOT NULL) AS decisions
     FROM nova.task_assignments assignments JOIN nova.tasks tasks ON tasks.id = assignments.task_id
     WHERE assignments.id = $1::uuid`,
    [cancellationReview.assignmentId],
  ))[0];
  assert(cancelledReviewState?.assignment_status === "cancelled" && cancelledReviewState.task_status === "cancelled"
    && cancelledReviewState.decisions === "0",
  "cancelled_pending_review_remains_undecided_history");

  const secondTask = await request("POST", "/tasks", { clientWorkstreamId: workstreamId, title: "Freeze closes active timer" }, founderCookie);
  assertStatus("freeze_task_create", secondTask, 201);
  const secondTaskId = field("freeze_task", secondTask, "taskId");
  const secondAssignment = await request("POST", `/tasks/${secondTaskId}/assignments`, {
    personId: firstEmployee.personId,
    reviewerPersonId: founder.id,
    reviewRequired: true,
  }, founderCookie);
  assertStatus("freeze_assignment_create", secondAssignment, 201);
  const secondAssignmentId = field("freeze_assignment", secondAssignment, "assignmentId");
  const freezeWfhContext = (await sql<{
    organisation_id: string; business_date: string; office_id: string; timezone: string;
  }>(
    `SELECT people.organisation_id,
            nova.person_business_date(people.id)::text AS business_date,
            offices.id AS office_id, offices.timezone
     FROM nova.people people
     JOIN LATERAL (
       SELECT assignments.office_id
       FROM nova.person_office_assignments assignments
       WHERE assignments.person_id = people.id
         AND assignments.effective_on <= nova.person_business_date(people.id)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
       ORDER BY assignments.effective_on DESC LIMIT 1
     ) current_office ON true
     JOIN nova.offices offices ON offices.id = current_office.office_id
     WHERE people.id = $1::uuid`,
    [firstEmployee.personId],
  ))[0];
  assert(Boolean(freezeWfhContext?.office_id && freezeWfhContext.timezone), "freeze_wfh_fixture_has_effective_office");
  const priorFreezeAttendance = await sql<{ id: string }>(
    `SELECT id FROM nova.attendance_days
     WHERE person_id = $1::uuid AND business_date = $2::date`,
    [firstEmployee.personId, freezeWfhContext?.business_date],
  );
  assert(priorFreezeAttendance.length === 0, "freeze_wfh_fixture_has_no_prior_official_attendance");
  await sql(
    `UPDATE nova.role_operational_policies policies
     SET attendance_required = true, wfh_allowed = true
     WHERE policies.role_id = (
       SELECT assignments.role_id FROM nova.person_role_assignments assignments
       WHERE assignments.person_id = $1::uuid
         AND assignments.effective_on <= $2::date
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= $2::date)
       ORDER BY assignments.effective_on DESC LIMIT 1
     )`,
    [firstEmployee.personId, freezeWfhContext?.business_date],
  );
  const freezeWfhRequest = (await sql<{ id: string }>(
    `INSERT INTO nova.wfh_requests (
       organisation_id, person_id, start_date, end_date, reason
     ) VALUES ($1::uuid, $2::uuid, $3::date, $3::date, 'Freeze/WFH lifecycle smoke')
     RETURNING id`,
    [freezeWfhContext?.organisation_id, firstEmployee.personId, freezeWfhContext?.business_date],
  ))[0];
  const freezeWfhEvidence = (await sql<{ id: string }>(
    `INSERT INTO nova.wfh_provisional_attendance (
       organisation_id, request_id, person_id, office_id,
       office_timezone_snapshot, business_date
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::date)
     RETURNING id`,
    [freezeWfhContext?.organisation_id, freezeWfhRequest?.id, firstEmployee.personId,
      freezeWfhContext?.office_id, freezeWfhContext?.timezone, freezeWfhContext?.business_date],
  ))[0];
  assert(Boolean(freezeWfhRequest?.id && freezeWfhEvidence?.id), "freeze_wfh_fixture_created");
  const activeTimer = await request("POST", "/work-sessions/start", { assignmentId: secondAssignmentId }, firstEmployee.cookie);
  assertStatus("freeze_timer_start", activeTimer, 201);
  const freezeTimerId = field("freeze_timer", activeTimer, "sessionId");
  const linkedFreezeTimer = (await sql<{ evidence_id: string }>(
    "SELECT provisional_wfh_attendance_id AS evidence_id FROM nova.work_sessions WHERE id = $1::uuid",
    [freezeTimerId],
  ))[0];
  assert(linkedFreezeTimer?.evidence_id === freezeWfhEvidence?.id, "freeze_timer_links_to_pending_wfh_evidence");

  const freeze = await request("POST", `/people/${firstEmployee.personId}/freeze`, {
    reason: "Disposable lifecycle integration test.",
  }, founderCookie);
  assertStatus("employee_freeze", freeze, 200);
  const frozen = (await sql<{ status: string; sessions: string; open_timers: string }>(
    `SELECT statuses.status,
            (SELECT count(*)::text FROM nova_auth.session sessions JOIN nova.person_identities identities ON identities.subject = sessions."userId" WHERE identities.person_id = people.id) AS sessions,
            (SELECT count(*)::text FROM nova.work_sessions work WHERE work.person_id = people.id AND work.ended_at IS NULL) AS open_timers
     FROM nova.people people JOIN nova.person_status_periods statuses ON statuses.person_id = people.id AND statuses.ended_at IS NULL
     WHERE people.id = $1::uuid`,
    [firstEmployee.personId],
  ))[0];
  assert(frozen?.status === "frozen" && frozen.sessions === "0" && frozen.open_timers === "0", "freeze_revokes_sessions_and_closes_live_timer");
  const frozenWfhEvidence = (await sql<{
    evidence_status: string; resolution_reason: string | null; checked_out_at: string;
    ended_at: string; closure_reason: string | null; attendance_count: string;
  }>(
    `SELECT evidence.status AS evidence_status, evidence.resolution_reason,
            to_char(evidence.checked_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_out_at,
            to_char(sessions.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS ended_at,
            sessions.closure_reason,
            (SELECT count(*)::text FROM nova.attendance_days attendance
             WHERE attendance.person_id = evidence.person_id
               AND attendance.business_date = evidence.business_date) AS attendance_count
     FROM nova.wfh_provisional_attendance evidence
     JOIN nova.work_sessions sessions ON sessions.provisional_wfh_attendance_id = evidence.id
     WHERE sessions.id = $1::uuid`,
    [freezeTimerId],
  ))[0];
  assert(frozenWfhEvidence?.evidence_status === "discarded" &&
    frozenWfhEvidence.resolution_reason === "PERSON_LIFECYCLE_CHANGE" &&
    frozenWfhEvidence.checked_out_at === frozenWfhEvidence.ended_at &&
    frozenWfhEvidence.closure_reason === "ACCOUNT_FROZEN" &&
    frozenWfhEvidence.attendance_count === "0",
  "freeze_discards_provisional_attendance_closes_linked_timer_and_preserves_no_credit");
  assertStatus("frozen_session_has_no_domain_access", await request("GET", "/people", undefined, firstEmployee.cookie), 401);

  // The internal route uses a deployment-only bearer secret, not browser credentials.
  const overlappingTicks = await Promise.all(Array.from({ length: 2 }, () => handleSmokeRequest(new Request(
    `${smokeOrigin}/api/internal/background/tick`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${backgroundSecret}`,
        "x-nova-background-scheduler": process.env.NOVA_BACKGROUND_SCHEDULER ?? "vps",
      },
    },
  ))));
  const overlappingTickBodies = await Promise.all(overlappingTicks.map((response) => response.json().catch(() => ({}))));
  assert(overlappingTicks.every((response) => response.status === 200),
    `overlapping_background_ticks_${overlappingTicks.map((response, index) => `${response.status}:${String((overlappingTickBodies[index] as any)?.error ?? "ok")}`).join(",")}`);
  reviewAssignment = (await sql<{ reviewer_person_id: string | null; review_blocked_reason: string | null }>(
    "SELECT reviewer_person_id, review_blocked_reason FROM nova.task_assignments WHERE id = $1::uuid",
    [newAssignmentId],
  ))[0];
  assert(reviewAssignment?.reviewer_person_id === null && Boolean(reviewAssignment.review_blocked_reason), "inactive_reviewer_is_cleared_and_review_blocked");
  const reviewerUnavailableNotices = await sql<{ total: string }>(
    `SELECT count(*)::text AS total FROM nova.notifications
     WHERE event_key = 'task.reviewer_unavailable' AND aggregate_id = $1::uuid`,
    [newAssignmentId],
  );
  assert(reviewerUnavailableNotices[0]?.total === "1", "overlapping_ticks_emit_one_reviewer_unavailable_notice");
  const replacement = await request("POST", `/task-assignments/${newAssignmentId}/reviewer-requests`, {
    candidateReviewerPersonId: founder.id,
    reason: "Replace the now-frozen reviewer.",
  }, secondEmployee.cookie);
  assertStatus("inactive_reviewer_replacement_request", replacement, 201);
  const replacementId = field("inactive_reviewer_replacement", replacement, "requestId");
  assertStatus("inactive_reviewer_replacement_accept", await request("POST", `/task-reviewer-requests/${replacementId}/accept`, {}, founderCookie), 200);
  const repairedReview = (await sql<{ reviewer_person_id: string | null; review_blocked_reason: string | null }>(
    "SELECT reviewer_person_id, review_blocked_reason FROM nova.task_assignments WHERE id = $1::uuid",
    [newAssignmentId],
  ))[0];
  assert(repairedReview?.reviewer_person_id === founder.id && repairedReview.review_blocked_reason === null, "replacement_reviewer_restores_review_gate");

  const blockedOffboard = await request("POST", `/people/${secondEmployee.personId}/offboard`, {
    final: true,
    reason: "Check active-work handoff guard.",
  }, founderCookie);
  assertStatus("offboarding_with_active_assignment_blocked", blockedOffboard, 409);
  assert(blockedOffboard.body?.error === "ACTIVE_ASSIGNMENTS_REMAIN", "offboarding_reports_assignment_handoff_requirement");
  assertStatus("cancel_work_before_final_offboarding", await request("POST", `/tasks/${taskId}/cancel`, {}, founderCookie), 200);
  const offboard = await request("POST", `/people/${secondEmployee.personId}/offboard`, {
    final: true,
    reason: "Disposable lifecycle integration test.",
  }, founderCookie);
  assertStatus("final_offboarding", offboard, 200);
  assert(offboard.body?.status === "exited", "offboarding_final_state_is_exited");
  const exitedAccess = await request("GET", "/people", undefined, secondEmployee.cookie);
  assertStatus("exited_session_has_no_domain_access", exitedAccess, 401);

  const roleCounts = await sql<{ grant_count: string; effective_people_view: boolean }>(
    `SELECT count(*)::text AS grant_count,
            bool_or(grants.permission_key = 'people.view' AND grants.scope = 'organisation_department' AND grants.organisation_department_id = $2::uuid) AS effective_people_view
     FROM nova.role_permission_grants grants WHERE grants.role_id = $1::uuid GROUP BY grants.role_id`,
    [roleId, departmentId],
  );
  assert(Number(roleCounts[0]?.grant_count) === grants.length && roleCounts[0]?.effective_people_view === true, "role_permission_grants_persist_after_lifecycle");
  await runEmployeeLoadSmoke({
    founderCookie,
    founderId: founder.id,
    officeId,
    departmentId,
    employmentDate: today!,
  });
  console.info(`NOVA lifecycle runtime smoke passed (${checks} assertions${loadEmployeeCount ? `; ${loadEmployeeCount}-employee load burst` : ""})`);
}

main().then(async () => {
  await fixtureDatabase.end();
  await database().end().catch(() => undefined);
  process.exit(0);
}).catch(async (error) => {
  console.error(error instanceof Error ? error.message : "NOVA_LIFECYCLE_SMOKE_FAILED");
  await fixtureDatabase.end().catch(() => undefined);
  await database().end().catch(() => undefined);
  process.exit(1);
});
