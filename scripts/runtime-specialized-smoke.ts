import { createHash, randomUUID } from "node:crypto";
import { resolveSupabasePoolerHost, validateSupabasePoolerHost } from "../server/src/supabase-pooler.ts";

const projectRef = process.env.NOVA_SUPABASE_PROJECT_REF;
const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;
const appPassword = process.env.NOVA_APP_PASSWORD;
const directDatabaseUrl = process.env.NOVA_SMOKE_DATABASE_URL;
const directFixtureDatabaseUrl = process.env.NOVA_SMOKE_FIXTURE_DATABASE_URL;
const smokeEmail = process.env.NOVA_SMOKE_EMAIL;
const smokePassword = process.env.NOVA_SMOKE_PASSWORD;
const supabaseConfiguration = projectRef && supabaseAccessToken && appPassword;
const smokeOrigin = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3001").origin;

if (
  (!supabaseConfiguration && !directDatabaseUrl) ||
  (directDatabaseUrl && !directFixtureDatabaseUrl) ||
  !smokeEmail ||
  !smokePassword
) {
  throw new Error("NOVA_SPECIALIZED_SMOKE_CONFIGURATION_REQUIRED");
}

async function supabasePoolerHost(): Promise<string> {
  const configured = process.env.NOVA_SUPABASE_POOLER_HOST?.trim();
  if (configured) return validateSupabasePoolerHost(configured);
  if (!projectRef || !supabaseAccessToken) {
    throw new Error("NOVA_SUPABASE_POOLER_HOST_REQUIRED");
  }
  return resolveSupabasePoolerHost(projectRef, supabaseAccessToken);
}

process.env.BETTER_AUTH_URL = smokeOrigin;
process.env.DATABASE_URL = directDatabaseUrl ??
  `postgresql://nova_app.${projectRef}:${encodeURIComponent(appPassword!)}@${await supabasePoolerHost()}:6543/postgres?uselibpqcompat=true&sslmode=require`;

const { handleRequest } = await import("../server/src/app.ts");
const { hashPassword } = await import("../server/node_modules/better-auth/dist/crypto/index.mjs");
type FixturePool = {
  query(query: string): Promise<{ rows: any[] }>;
  end(): Promise<void>;
};
const pgModulePath = "../server/node_modules/pg/lib/index.js";
const pgModule = await import(pgModulePath) as unknown as {
  Pool: new (configuration: { connectionString: string; max: number }) => FixturePool;
};
const directFixtureDatabase = directFixtureDatabaseUrl
  ? new pgModule.Pool({
    connectionString: directFixtureDatabaseUrl,
    max: 1,
  })
  : undefined;

type ApiResult = Readonly<{ status: number; body: any; cookie?: string }>;

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function postSql(query: string): Promise<any[]> {
  if (directFixtureDatabase) {
    return (await directFixtureDatabase.query(query)).rows;
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef!}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${supabaseAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text())
      .replaceAll(supabaseAccessToken!, "[REDACTED]")
      .replaceAll(appPassword!, "[REDACTED]");
    throw new Error(`NOVA_SPECIALIZED_SMOKE_SQL_${response.status}_${detail.slice(0, 400)}`);
  }
  const value = await response.json();
  return Array.isArray(value) ? value : [];
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<ApiResult> {
  const headers = new Headers({
    "content-type": "application/json",
    // Cookie-authenticated state changes must prove their same-origin source,
    // just like a browser request. Keep the fixture aligned with production
    // CSRF enforcement instead of weakening the API for tests.
    origin: smokeOrigin,
  });
  const requestIdentity = typeof body === "object" && body !== null &&
      "email" in body && typeof body.email === "string"
    ? body.email.toLowerCase()
    : `${method}:${path}`;
  const digest = createHash("sha256").update(requestIdentity).digest();
  // handleRequest bypasses the Node socket adapter, so provide the private
  // test address that index.ts normally overwrites from the real socket.
  headers.set("x-nova-remote-ip", `198.18.${digest[0]}.${digest[1]}`);
  if (cookie) headers.set("cookie", cookie);
  const response = await handleRequest(new Request(`${smokeOrigin}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  const setCookies = typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : [];
  const responseCookie = setCookies.length ? setCookies.join("; ") : response.headers.get("set-cookie") ?? undefined;
  return { status: response.status, body: parsed, ...(responseCookie ? { cookie: responseCookie } : {}) };
}

function assertStatus(label: string, result: ApiResult, expected: number): void {
  if (result.status !== expected) {
    throw new Error(`${label}_EXPECTED_${expected}_GOT_${result.status}_${JSON.stringify(result.body).slice(0, 240)}`);
  }
  console.info(`${label}: ${result.status}`);
}

function assertFixture(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`NOVA_SPECIALIZED_SMOKE_ASSERTION_FAILED_${label}`);
  console.info(`${label}: passed`);
}

function requireField(label: string, result: ApiResult, field: string): string {
  const value = result.body?.[field];
  if (typeof value !== "string" || !value) throw new Error(`${label}_FIELD_MISSING_${field}`);
  return value;
}

const identity = (await postSql(
  `SELECT people.id AS person_id, people.organisation_id
   FROM nova.people people
   WHERE people.email = ${sqlLiteral(smokeEmail)}
   LIMIT 1`,
))[0] as { person_id?: string; organisation_id?: string } | undefined;
if (!identity?.person_id || !identity.organisation_id) throw new Error("NOVA_SPECIALIZED_SMOKE_FOUNDER_NOT_FOUND");

const signIn = await api("POST", "/auth/sign-in/email", { email: smokeEmail, password: smokePassword });
assertStatus("sign_in", signIn, 200);
const cookie = signIn.cookie;
if (!cookie) throw new Error("NOVA_SPECIALIZED_SMOKE_SESSION_COOKIE_MISSING");
assertStatus("session", await api("GET", "/auth/get-session", undefined, cookie), 200);

const stamp = Date.now().toString();
const office = await api("POST", "/offices", {
  name: `NOVA Smoke Office ${stamp}`,
  location: "Disposable runtime verification fixture",
  timezone: "Asia/Kolkata",
  latitude: 12.9716,
  longitude: 77.5946,
  geofenceRadiusMeters: 100,
}, cookie);
assertStatus("office_create", office, 201);
const officeId = requireField("office_create", office, "officeId");
const existingOffice = (await postSql(
  `SELECT office_id FROM nova.person_office_assignments
   WHERE person_id = ${sqlLiteral(identity.person_id)}::uuid
     AND effective_until IS NULL
   ORDER BY effective_on DESC LIMIT 1`,
))[0] as { office_id?: string } | undefined;
const fixtureOfficeId = existingOffice?.office_id ?? officeId;

const department = await api("POST", "/organisation-departments", {
  name: `NOVA Smoke Department ${stamp}`,
}, cookie);
assertStatus("department_create", department, 201);
const departmentId = requireField("department_create", department, "organisationDepartmentId");

const permissions = await postSql("SELECT key FROM nova.permissions ORDER BY key");
const role = await api("POST", "/roles", {
  key: `nova_smoke_${stamp}`.slice(0, 63),
  name: `NOVA Smoke Runtime Role ${stamp}`,
  permissionGrants: permissions.map((row) => ({ permissionKey: row.key, scope: "organisation" })),
  operationalPolicy: {
    workEnabled: true,
    canReceiveAssignments: false,
    attendanceRequired: true,
    wfhAllowed: true,
    canWorkWithoutAttendance: false,
    payrollApplicable: false,
    payrollAttendanceContributes: false,
    payrollOvertimeApplicable: false,
  },
}, cookie);
assertStatus("role_create", role, 201);
const roleId = requireField("role_create", role, "roleId");

let todayRow = (await postSql(
  `WITH person_day AS (
     SELECT nova.person_business_date(${sqlLiteral(identity.person_id)}::uuid) AS today
   )
   SELECT today::text AS today, (today + 1)::text AS tomorrow FROM person_day`,
))[0] as { today?: string; tomorrow?: string } | undefined;
if (!todayRow?.today || !todayRow.tomorrow) throw new Error("NOVA_SPECIALIZED_SMOKE_DATE_MISSING");

const reviewerEmail = `nova-reviewer-${stamp}@example.invalid`;
const reviewerPassword = `N0vaReviewer-${stamp}-Aa1!`;
const reviewerSubject = randomUUID();
const reviewerPasswordHash = await hashPassword(reviewerPassword);
await postSql(`
  INSERT INTO nova_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  VALUES (${sqlLiteral(reviewerSubject)}, ${sqlLiteral(`NOVA Smoke Reviewer ${stamp}`)}, ${sqlLiteral(reviewerEmail)}, true, now(), now());
  INSERT INTO nova_auth.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(reviewerSubject)}, 'credential', ${sqlLiteral(reviewerSubject)},
          ${sqlLiteral(reviewerPasswordHash)}, now(), now());
`);

await postSql(`
  UPDATE nova.role_operational_policies policies
  SET wfh_allowed = true
  WHERE policies.role_id IN (
    SELECT roles.id FROM nova.roles roles
    WHERE roles.organisation_id = ${sqlLiteral(identity.organisation_id)}::uuid
      AND roles.key = 'super_admin'
  );
  ${existingOffice?.office_id ? "" : `INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES (${sqlLiteral(identity.person_id)}::uuid,
          ${sqlLiteral(officeId)}::uuid, ${sqlLiteral(todayRow.today)}::date);`}
`);
const reviewerPerson = (await postSql(`
  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (${sqlLiteral(identity.organisation_id)}::uuid, ${sqlLiteral(reviewerEmail)}, ${sqlLiteral(`NOVA Smoke Reviewer ${stamp}`)})
  RETURNING id
`))[0] as { id?: string } | undefined;
if (!reviewerPerson?.id) throw new Error("NOVA_SPECIALIZED_SMOKE_REVIEWER_PERSON_MISSING");
await postSql(`
  INSERT INTO nova.person_identities (person_id, provider, subject)
  VALUES (${sqlLiteral(reviewerPerson.id)}::uuid, 'better_auth', ${sqlLiteral(reviewerSubject)});
  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (${sqlLiteral(reviewerPerson.id)}::uuid, 'active', now());
  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES (${sqlLiteral(reviewerPerson.id)}::uuid, ${sqlLiteral(fixtureOfficeId)}::uuid, ${sqlLiteral(todayRow.today)}::date);
  INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
  VALUES (${sqlLiteral(reviewerPerson.id)}::uuid, ${sqlLiteral(roleId)}::uuid, ${sqlLiteral(todayRow.today)}::date);
`);

const client = await api("POST", "/clients", { name: `NOVA Smoke Client ${stamp}` }, cookie);
assertStatus("client_create", client, 201);
const clientId = requireField("client_create", client, "clientId");
const workstream = await api("POST", "/workstreams/client", {
  clientId,
  name: `NOVA Smoke Workstream ${stamp}`,
}, cookie);
assertStatus("client_workstream_create", workstream, 201);
const clientWorkstreamId = requireField("client_workstream_create", workstream, "workstreamId");
const workstreamBillingPolicy = await api(
  "PATCH", `/workstreams/client/${clientWorkstreamId}/billing-policy`, {
    policyClass: "non_billable",
    expectedRevision: 0,
    reason: "The specialized smoke fixture does not represent client-billable work.",
  }, cookie,
);
assertStatus("client_workstream_billing_policy", workstreamBillingPolicy, 200);

// Exercise the product's group-scoped create-only path through the authenticated
// API against the disposable PostgreSQL fixture. The actor has only the exact
// group create grant and no tasks.view grant. The mismatched-parent request keeps
// that authorized group id so it reaches the server's parent/group integrity check.
const group = await api("POST", "/work-groups", {
  clientWorkstreamId,
  name: `NOVA Smoke Task Group ${stamp}`,
}, cookie);
assertStatus("group_task_target_create", group, 201);
const groupId = requireField("group_task_target_create", group, "groupId");
const siblingGroup = await api("POST", "/work-groups", {
  clientWorkstreamId,
  name: `NOVA Smoke Sibling Task Group ${stamp}`,
}, cookie);
assertStatus("group_task_sibling_target_create", siblingGroup, 201);
const siblingGroupId = requireField("group_task_sibling_target_create", siblingGroup, "groupId");
const mismatchWorkstream = await api("POST", "/workstreams/client", {
  clientId,
  name: `NOVA Smoke Mismatch Parent ${stamp}`,
}, cookie);
assertStatus("group_task_mismatch_parent_create", mismatchWorkstream, 201);
const mismatchWorkstreamId = requireField("group_task_mismatch_parent_create", mismatchWorkstream, "workstreamId");

const groupCreatorRole = await api("POST", "/roles", {
  key: `nova_group_creator_${stamp}`.slice(0, 63),
  name: `NOVA Group-Scoped Task Creator ${stamp}`,
  permissionGrants: [{ permissionKey: "tasks.create", scope: "group", groupId }],
  operationalPolicy: {
    workEnabled: true,
    canReceiveAssignments: false,
    attendanceRequired: false,
    wfhAllowed: false,
    canWorkWithoutAttendance: false,
    payrollApplicable: false,
    payrollAttendanceContributes: false,
    payrollOvertimeApplicable: false,
  },
}, cookie);
assertStatus("group_task_creator_role", groupCreatorRole, 201);
const groupCreatorRoleId = requireField("group_task_creator_role", groupCreatorRole, "roleId");

const groupCreatorEmail = `nova-group-creator-${stamp}@example.invalid`;
const groupCreatorPassword = `N0vaGroupCreator-${stamp}-Aa1!`;
const groupCreatorSubject = randomUUID();
const groupCreatorPasswordHash = await hashPassword(groupCreatorPassword);
await postSql(`
  INSERT INTO nova_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  VALUES (${sqlLiteral(groupCreatorSubject)}, ${sqlLiteral(`NOVA Group Creator ${stamp}`)}, ${sqlLiteral(groupCreatorEmail)}, true, now(), now());
  INSERT INTO nova_auth.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(groupCreatorSubject)}, 'credential', ${sqlLiteral(groupCreatorSubject)},
          ${sqlLiteral(groupCreatorPasswordHash)}, now(), now());
`);
const groupCreatorPerson = (await postSql(`
  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (${sqlLiteral(identity.organisation_id)}::uuid, ${sqlLiteral(groupCreatorEmail)}, ${sqlLiteral(`NOVA Group Creator ${stamp}`)})
  RETURNING id
`))[0] as { id?: string } | undefined;
if (!groupCreatorPerson?.id) throw new Error("NOVA_GROUP_CREATOR_PERSON_MISSING");
await postSql(`
  INSERT INTO nova.person_identities (person_id, provider, subject)
  VALUES (${sqlLiteral(groupCreatorPerson.id)}::uuid, 'better_auth', ${sqlLiteral(groupCreatorSubject)});
  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (${sqlLiteral(groupCreatorPerson.id)}::uuid, 'active', now());
  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES (${sqlLiteral(groupCreatorPerson.id)}::uuid, ${sqlLiteral(fixtureOfficeId)}::uuid, ${sqlLiteral(todayRow.today)}::date);
  INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
  VALUES (${sqlLiteral(groupCreatorPerson.id)}::uuid, ${sqlLiteral(groupCreatorRoleId)}::uuid, ${sqlLiteral(todayRow.today)}::date);
`);

const groupCreatorGrantAudit = (await postSql(`
  SELECT count(*) FILTER (WHERE grants.permission_key = 'tasks.create' AND grants.scope = 'group'
                            AND grants.group_id = ${sqlLiteral(groupId)}::uuid)::text AS group_create_grants,
         count(*) FILTER (WHERE grants.permission_key = 'tasks.view')::text AS task_view_grants,
         count(*) FILTER (WHERE grants.permission_key = 'tasks.create')::text AS task_create_grants
  FROM nova.person_role_assignments assignments
  JOIN nova.role_permission_grants grants ON grants.role_id = assignments.role_id
  WHERE assignments.person_id = ${sqlLiteral(groupCreatorPerson.id)}::uuid
    AND assignments.role_id = ${sqlLiteral(groupCreatorRoleId)}::uuid
`))[0] as { group_create_grants?: string; task_view_grants?: string; task_create_grants?: string } | undefined;
assertFixture(groupCreatorGrantAudit?.group_create_grants === "1"
  && groupCreatorGrantAudit.task_view_grants === "0"
  && groupCreatorGrantAudit.task_create_grants === "1", "group_creator_has_only_group_create_without_task_view");

const groupCreatorSignIn = await api("POST", "/auth/sign-in/email", {
  email: groupCreatorEmail,
  password: groupCreatorPassword,
});
assertStatus("group_creator_sign_in", groupCreatorSignIn, 200);
const groupCreatorCookie = groupCreatorSignIn.cookie;
if (!groupCreatorCookie) throw new Error("NOVA_GROUP_CREATOR_SESSION_COOKIE_MISSING");
assertStatus("group_creator_session", await api("GET", "/auth/get-session", undefined, groupCreatorCookie), 200);

const groupTaskTitle = `NOVA Smoke Group-Scoped Task ${stamp}`;
const groupTask = await api("POST", "/tasks", {
  clientWorkstreamId,
  workGroupId: groupId,
  title: groupTaskTitle,
}, groupCreatorCookie);
assertStatus("group_scoped_task_create_without_task_view", groupTask, 201);
const groupTaskId = requireField("group_scoped_task_create_without_task_view", groupTask, "taskId");
const createdGroupTask = (await postSql(`
  SELECT organisation_id, client_workstream_id, work_group_id, created_by_person_id
  FROM nova.tasks
  WHERE id = ${sqlLiteral(groupTaskId)}::uuid
`))[0] as {
  organisation_id?: string;
  client_workstream_id?: string;
  work_group_id?: string;
  created_by_person_id?: string;
} | undefined;
assertFixture(createdGroupTask?.organisation_id === identity.organisation_id
  && createdGroupTask.client_workstream_id === clientWorkstreamId
  && createdGroupTask.work_group_id === groupId
  && createdGroupTask.created_by_person_id === groupCreatorPerson.id,
"group_task_persists_exact_parent_and_creator");
assertStatus("group_creator_cannot_read_task_without_task_view", await api("GET", `/tasks/${groupTaskId}`, undefined, groupCreatorCookie), 404);

const noGroupTaskTitle = `NOVA Smoke Group Required Task ${stamp}`;
const noGroupTask = await api("POST", "/tasks", {
  clientWorkstreamId,
  title: noGroupTaskTitle,
}, groupCreatorCookie);
assertStatus("group_creator_without_group_denied", noGroupTask, 403);
if (noGroupTask.body?.error !== "PERMISSION_DENIED") {
  throw new Error(`GROUP_CREATOR_WITHOUT_GROUP_WRONG_ERROR_${noGroupTask.body?.error}`);
}
const noGroupTaskCount = (await postSql(`
  SELECT count(*)::text AS count FROM nova.tasks
  WHERE organisation_id = ${sqlLiteral(identity.organisation_id)}::uuid
    AND title = ${sqlLiteral(noGroupTaskTitle)}
`))[0] as { count?: string } | undefined;
if (noGroupTaskCount?.count !== "0") throw new Error("GROUP_CREATOR_WITHOUT_GROUP_WROTE_TASK");

const siblingGroupTaskTitle = `NOVA Smoke Sibling Group Task ${stamp}`;
const siblingGroupTask = await api("POST", "/tasks", {
  clientWorkstreamId,
  workGroupId: siblingGroupId,
  title: siblingGroupTaskTitle,
}, groupCreatorCookie);
assertStatus("group_creator_sibling_group_denied", siblingGroupTask, 403);
if (siblingGroupTask.body?.error !== "PERMISSION_DENIED") {
  throw new Error(`GROUP_CREATOR_SIBLING_GROUP_WRONG_ERROR_${siblingGroupTask.body?.error}`);
}
const siblingTaskCount = (await postSql(`
  SELECT count(*)::text AS count FROM nova.tasks
  WHERE organisation_id = ${sqlLiteral(identity.organisation_id)}::uuid
    AND title = ${sqlLiteral(siblingGroupTaskTitle)}
`))[0] as { count?: string } | undefined;
if (siblingTaskCount?.count !== "0") throw new Error("GROUP_CREATOR_SIBLING_GROUP_WROTE_TASK");

const mismatchedTaskTitle = `NOVA Smoke Mismatched Group Task ${stamp}`;
const mismatchedGroupTask = await api("POST", "/tasks", {
  clientWorkstreamId: mismatchWorkstreamId,
  workGroupId: groupId,
  title: mismatchedTaskTitle,
}, groupCreatorCookie);
assertStatus("mismatched_group_parent_rejected", mismatchedGroupTask, 409);
assertFixture(mismatchedGroupTask.body?.error === "TASK_CONTEXT_INVALID", "mismatched_group_parent_returns_context_error");
const mismatchTaskCount = (await postSql(`
  SELECT count(*)::text AS count FROM nova.tasks
  WHERE organisation_id = ${sqlLiteral(identity.organisation_id)}::uuid
    AND title = ${sqlLiteral(mismatchedTaskTitle)}
`))[0] as { count?: string } | undefined;
assertFixture(mismatchTaskCount?.count === "0", "mismatched_group_parent_writes_no_task");
console.info("group_scoped_task_create_gate: passed");

const task = await api("POST", "/tasks", {
  clientWorkstreamId,
  title: `NOVA Smoke Assignment Gate ${stamp}`,
}, cookie);
assertStatus("task_create", task, 201);
const taskId = requireField("task_create", task, "taskId");
const blockedAssignment = await api("POST", `/tasks/${taskId}/assignments`, {
  personId: reviewerPerson.id,
  reviewerPersonId: identity.person_id,
  reviewRequired: true,
}, cookie);
assertStatus("assignment_policy_reject", blockedAssignment, 409);
if (blockedAssignment.body?.error !== "PERSON_NOT_ASSIGNABLE") {
  throw new Error(`ASSIGNMENT_POLICY_REJECT_WRONG_ERROR_${blockedAssignment.body?.error}`);
}
await postSql(`
  UPDATE nova.role_operational_policies
  SET can_receive_assignments = true
  WHERE role_id = ${sqlLiteral(roleId)}::uuid;
`);
const assignment = await api("POST", `/tasks/${taskId}/assignments`, {
  personId: reviewerPerson.id,
  reviewerPersonId: identity.person_id,
  reviewRequired: true,
}, cookie);
assertStatus("assignment_policy_accept", assignment, 201);
console.info("assignment_policy_gate: passed");

const wfhRaceEmail = `nova-wfh-race-${stamp}@example.invalid`;
const wfhRacePassword = `N0vaWfhRace-${stamp}-Aa1!`;
const wfhRaceSubject = randomUUID();
const wfhRacePasswordHash = await hashPassword(wfhRacePassword);
await postSql(`
  INSERT INTO nova_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  VALUES (${sqlLiteral(wfhRaceSubject)}, 'NOVA WFH Race Worker', ${sqlLiteral(wfhRaceEmail)}, true, now(), now());
  INSERT INTO nova_auth.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(wfhRaceSubject)}, 'credential', ${sqlLiteral(wfhRaceSubject)},
          ${sqlLiteral(wfhRacePasswordHash)}, now(), now());
`);
const wfhRacePerson = (await postSql(`
  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (${sqlLiteral(identity.organisation_id)}::uuid, ${sqlLiteral(wfhRaceEmail)}, 'NOVA WFH Race Worker')
  RETURNING id
`))[0] as { id?: string } | undefined;
if (!wfhRacePerson?.id) throw new Error("NOVA_SPECIALIZED_SMOKE_WFH_RACE_PERSON_MISSING");
await postSql(`
  INSERT INTO nova.person_identities (person_id, provider, subject)
  VALUES (${sqlLiteral(wfhRacePerson.id)}::uuid, 'better_auth', ${sqlLiteral(wfhRaceSubject)});
  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (${sqlLiteral(wfhRacePerson.id)}::uuid, 'active', now());
  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES (${sqlLiteral(wfhRacePerson.id)}::uuid, ${sqlLiteral(fixtureOfficeId)}::uuid, ${sqlLiteral(todayRow.today)}::date);
  INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
  VALUES (${sqlLiteral(wfhRacePerson.id)}::uuid, ${sqlLiteral(roleId)}::uuid, ${sqlLiteral(todayRow.today)}::date);
`);
const wfhRaceAssignment = await api("POST", `/tasks/${taskId}/assignments`, {
  personId: wfhRacePerson.id,
  reviewerPersonId: identity.person_id,
  reviewRequired: true,
}, cookie);
assertStatus("wfh_race_worker_assignment", wfhRaceAssignment, 201);
const wfhRaceAssignmentId = requireField("wfh_race_worker_assignment", wfhRaceAssignment, "assignmentId");
const wfhRaceSignIn = await api("POST", "/auth/sign-in/email", {
  email: wfhRaceEmail,
  password: wfhRacePassword,
});
assertStatus("wfh_race_worker_sign_in", wfhRaceSignIn, 200);
const wfhRaceCookie = wfhRaceSignIn.cookie;
if (!wfhRaceCookie) throw new Error("NOVA_SPECIALIZED_SMOKE_WFH_RACE_SESSION_COOKIE_MISSING");

const timezoneFixture = (await postSql(`
  SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS reviewer_date,
         (SELECT zone
          FROM unnest(ARRAY['Pacific/Kiritimati', 'Pacific/Pago_Pago']::text[]) AS zones(zone)
          WHERE (statement_timestamp() AT TIME ZONE 'UTC')::date
            <> (statement_timestamp() AT TIME ZONE zone)::date
          LIMIT 1) AS target_timezone
`))[0] as { reviewer_date?: string; target_timezone?: string } | undefined;
if (!timezoneFixture?.reviewer_date || !timezoneFixture.target_timezone) {
  throw new Error("CROSS_TIMEZONE_SCOPE_FIXTURE_NOT_AVAILABLE");
}
const targetTimezoneOffice = await api("POST", "/offices", {
  name: `NOVA Smoke Scope Target ${stamp}`,
  location: "Disposable cross-timezone permission fixture",
  timezone: timezoneFixture.target_timezone,
  latitude: 0,
  longitude: 0,
  geofenceRadiusMeters: 100,
}, cookie);
assertStatus("cross_timezone_target_office", targetTimezoneOffice, 201);
const targetTimezoneOfficeId = requireField("cross_timezone_target_office", targetTimezoneOffice, "officeId");
const reviewerUtcOffice = await api("POST", "/offices", {
  name: `NOVA Smoke Scope Reviewer UTC ${stamp}`,
  location: "Disposable UTC reviewer fixture",
  timezone: "UTC",
  latitude: 0,
  longitude: 0,
  geofenceRadiusMeters: 100,
}, cookie);
assertStatus("cross_timezone_reviewer_office", reviewerUtcOffice, 201);
const reviewerUtcOfficeId = requireField("cross_timezone_reviewer_office", reviewerUtcOffice, "officeId");
const targetDay = (await postSql(`
  SELECT (statement_timestamp() AT TIME ZONE ${sqlLiteral(timezoneFixture.target_timezone)})::date::text AS target_date
`))[0] as { target_date?: string } | undefined;
if (!targetDay?.target_date || targetDay.target_date === timezoneFixture.reviewer_date) {
  throw new Error("CROSS_TIMEZONE_SCOPE_FIXTURE_DATES_NOT_DISTINCT");
}
const scopedReviewerRole = await api("POST", "/roles", {
  key: `nova_scope_reviewer_${stamp}`.slice(0, 63),
  name: `NOVA Scoped Leave/WFH Reviewer ${stamp}`,
  permissionGrants: [
    { permissionKey: "availability.wfh.review", scope: "office", officeId: targetTimezoneOfficeId },
    { permissionKey: "leave.review", scope: "organisation_department", organisationDepartmentId: departmentId },
  ],
  operationalPolicy: {
    workEnabled: false,
    canReceiveAssignments: false,
    attendanceRequired: false,
    wfhAllowed: false,
    canWorkWithoutAttendance: false,
    payrollApplicable: false,
    payrollAttendanceContributes: false,
    payrollOvertimeApplicable: false,
  },
}, cookie);
assertStatus("cross_timezone_scoped_reviewer_role", scopedReviewerRole, 201);
const scopedReviewerRoleId = requireField("cross_timezone_scoped_reviewer_role", scopedReviewerRole, "roleId");

const scopedReviewerEmail = `nova-scope-reviewer-${stamp}@example.invalid`;
const scopedReviewerPassword = `N0vaScopeReviewer-${stamp}-Aa1!`;
const scopedReviewerSubject = randomUUID();
const scopedReviewerPasswordHash = await hashPassword(scopedReviewerPassword);
await postSql(`
  INSERT INTO nova_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  VALUES (${sqlLiteral(scopedReviewerSubject)}, 'NOVA Scoped Reviewer', ${sqlLiteral(scopedReviewerEmail)}, true, now(), now());
  INSERT INTO nova_auth.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(scopedReviewerSubject)}, 'credential', ${sqlLiteral(scopedReviewerSubject)},
          ${sqlLiteral(scopedReviewerPasswordHash)}, now(), now());
`);
const scopedReviewerPerson = (await postSql(`
  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (${sqlLiteral(identity.organisation_id)}::uuid, ${sqlLiteral(scopedReviewerEmail)}, 'NOVA Scoped Reviewer')
  RETURNING id
`))[0] as { id?: string } | undefined;
if (!scopedReviewerPerson?.id) throw new Error("CROSS_TIMEZONE_SCOPED_REVIEWER_MISSING");
await postSql(`
  INSERT INTO nova.person_identities (person_id, provider, subject)
  VALUES (${sqlLiteral(scopedReviewerPerson.id)}::uuid, 'better_auth', ${sqlLiteral(scopedReviewerSubject)});
  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (${sqlLiteral(scopedReviewerPerson.id)}::uuid, 'active', now());
  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on)
  VALUES (${sqlLiteral(scopedReviewerPerson.id)}::uuid, ${sqlLiteral(reviewerUtcOfficeId)}::uuid,
          ${sqlLiteral(timezoneFixture.reviewer_date)}::date);
  INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
  VALUES (${sqlLiteral(scopedReviewerPerson.id)}::uuid, ${sqlLiteral(scopedReviewerRoleId)}::uuid,
          ${sqlLiteral(timezoneFixture.reviewer_date)}::date);
`);

const scopedTargetEmail = `nova-scope-target-${stamp}@example.invalid`;
const scopedTargetPassword = `N0vaScopeTarget-${stamp}-Aa1!`;
const scopedTargetSubject = randomUUID();
const scopedTargetPasswordHash = await hashPassword(scopedTargetPassword);
await postSql(`
  INSERT INTO nova_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  VALUES (${sqlLiteral(scopedTargetSubject)}, 'NOVA Cross-Timezone Target', ${sqlLiteral(scopedTargetEmail)}, true, now(), now());
  INSERT INTO nova_auth.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(scopedTargetSubject)}, 'credential', ${sqlLiteral(scopedTargetSubject)},
          ${sqlLiteral(scopedTargetPasswordHash)}, now(), now());
`);
const scopedTargetPerson = (await postSql(`
  INSERT INTO nova.people (organisation_id, email, display_name)
  VALUES (${sqlLiteral(identity.organisation_id)}::uuid, ${sqlLiteral(scopedTargetEmail)}, 'NOVA Cross-Timezone Target')
  RETURNING id
`))[0] as { id?: string } | undefined;
if (!scopedTargetPerson?.id) throw new Error("CROSS_TIMEZONE_TARGET_PERSON_MISSING");
await postSql(`
  INSERT INTO nova.person_identities (person_id, provider, subject)
  VALUES (${sqlLiteral(scopedTargetPerson.id)}::uuid, 'better_auth', ${sqlLiteral(scopedTargetSubject)});
  INSERT INTO nova.person_status_periods (person_id, status, effective_at)
  VALUES (${sqlLiteral(scopedTargetPerson.id)}::uuid, 'active', now());
  INSERT INTO nova.person_office_assignments (person_id, office_id, effective_on, effective_until)
  VALUES (${sqlLiteral(scopedTargetPerson.id)}::uuid, ${sqlLiteral(targetTimezoneOfficeId)}::uuid,
          ${sqlLiteral(targetDay.target_date)}::date, ${sqlLiteral(targetDay.target_date)}::date);
  INSERT INTO nova.person_department_assignments (person_id, organisation_department_id, effective_on, effective_until)
  VALUES (${sqlLiteral(scopedTargetPerson.id)}::uuid, ${sqlLiteral(departmentId)}::uuid,
          ${sqlLiteral(targetDay.target_date)}::date, ${sqlLiteral(targetDay.target_date)}::date);
  INSERT INTO nova.person_role_assignments (person_id, role_id, effective_on)
  VALUES (${sqlLiteral(scopedTargetPerson.id)}::uuid, ${sqlLiteral(roleId)}::uuid,
          ${sqlLiteral(targetDay.target_date)}::date);
`);
const scopedReviewerSignIn = await api("POST", "/auth/sign-in/email", {
  email: scopedReviewerEmail,
  password: scopedReviewerPassword,
});
assertStatus("cross_timezone_scoped_reviewer_sign_in", scopedReviewerSignIn, 200);
const scopedReviewerCookie = scopedReviewerSignIn.cookie;
if (!scopedReviewerCookie) throw new Error("CROSS_TIMEZONE_SCOPED_REVIEWER_COOKIE_MISSING");
const scopedTargetSignIn = await api("POST", "/auth/sign-in/email", {
  email: scopedTargetEmail,
  password: scopedTargetPassword,
});
assertStatus("cross_timezone_target_sign_in", scopedTargetSignIn, 200);
const scopedTargetCookie = scopedTargetSignIn.cookie;
if (!scopedTargetCookie) throw new Error("CROSS_TIMEZONE_TARGET_COOKIE_MISSING");

const scopedWfhRequest = await api("POST", "/availability/wfh", {
  startDate: targetDay.target_date,
  endDate: targetDay.target_date,
  reason: "NOVA cross-timezone office-scope authorization fixture",
}, scopedTargetCookie);
assertStatus("cross_timezone_wfh_request", scopedWfhRequest, 201);
const scopedWfhRequestId = requireField("cross_timezone_wfh_request", scopedWfhRequest, "wfhRequestId");
const scopedPendingWfh = await api("GET", "/availability/wfh/pending", undefined, scopedReviewerCookie);
assertStatus("cross_timezone_scoped_wfh_pending_read", scopedPendingWfh, 200);
if (!scopedPendingWfh.body?.requests?.some((request: any) => request.id === scopedWfhRequestId)) {
  throw new Error("TARGET_OFFICE_LOCAL_DATE_WFH_GRANT_WAS_NOT_VISIBLE");
}
assertStatus("cross_timezone_scoped_wfh_review", await api(
  "POST", `/availability/wfh/${scopedWfhRequestId}/review`, {
    decision: "rejected",
    reason: "NOVA cross-timezone permission fixture cleanup",
  }, scopedReviewerCookie,
), 200);

const scopedLeaveRequest = await api("POST", "/leave", {
  leaveType: "annual",
  startDate: targetDay.target_date,
  endDate: targetDay.target_date,
  reason: "NOVA cross-timezone department-scope authorization fixture",
  days: [{ date: targetDay.target_date, portion: 1 }],
}, scopedTargetCookie);
assertStatus("cross_timezone_leave_request", scopedLeaveRequest, 201);
const scopedLeaveRequestId = requireField("cross_timezone_leave_request", scopedLeaveRequest, "leaveRequestId");
const scopedPendingLeave = await api("GET", "/leave/pending", undefined, scopedReviewerCookie);
assertStatus("cross_timezone_scoped_leave_pending_read", scopedPendingLeave, 200);
if (!scopedPendingLeave.body?.requests?.some((request: any) => request.id === scopedLeaveRequestId)) {
  throw new Error("TARGET_OFFICE_LOCAL_DATE_LEAVE_GRANT_WAS_NOT_VISIBLE");
}
assertStatus("cross_timezone_scoped_leave_review", await api(
  "POST", `/leave/${scopedLeaveRequestId}/review`, {
    decision: "rejected",
    reason: "NOVA cross-timezone permission fixture cleanup",
  }, scopedReviewerCookie,
), 200);
console.info(`cross_timezone_scope_dates: passed (${timezoneFixture.reviewer_date} UTC; ${targetDay.target_date} ${timezoneFixture.target_timezone})`);

const shift = await api("POST", "/availability/shifts", {
  name: `NOVA Smoke Shift ${stamp}`,
  startLocalTime: "00:00",
  endLocalTime: "23:59",
  graceMinutes: 0,
  overtimeEnabled: false,
}, cookie);
assertStatus("shift_create", shift, 201);
const shiftId = requireField("shift_create", shift, "shiftId");
const existingCalendar = (await postSql(
  `SELECT calendar_id FROM nova.office_calendar_assignments
   WHERE office_id = ${sqlLiteral(fixtureOfficeId)}::uuid
     AND effective_until IS NULL
   ORDER BY effective_on DESC LIMIT 1`,
))[0] as { calendar_id?: string } | undefined;
if (existingCalendar?.calendar_id) {
  console.info("calendar_create: reused-existing");
} else {
  const calendar = await api("POST", "/availability/calendars", {
    name: `NOVA Smoke Calendar ${stamp}`,
    officeId: fixtureOfficeId,
    effectiveOn: todayRow.today,
    rules: Array.from({ length: 7 }, (_, weekday) => ({ weekday, ordinal: 0, isWorking: true, shiftId })),
  }, cookie);
  assertStatus("calendar_create", calendar, 201);
}
assertStatus("availability_read", await api("GET", "/availability/config", undefined, cookie), 200);
assertStatus("attendance_read_initial", await api("GET", "/attendance/today", undefined, cookie), 200);

// Setup above may cross the office-local midnight; use the current business
// date for a new request rather than failing as an accidental past-date test.
todayRow = (await postSql(
  `WITH person_day AS (
     SELECT nova.person_business_date(${sqlLiteral(identity.person_id)}::uuid) AS today
   )
   SELECT today::text AS today, (today + 1)::text AS tomorrow FROM person_day`,
))[0] as { today?: string; tomorrow?: string } | undefined;
if (!todayRow?.today || !todayRow.tomorrow) throw new Error("NOVA_SPECIALIZED_SMOKE_CURRENT_DATE_MISSING");

const pendingWfh = (await postSql(
  `SELECT id FROM nova.wfh_requests
   WHERE person_id = ${sqlLiteral(identity.person_id)}::uuid
     AND status = 'pending'
     AND start_date = ${sqlLiteral(todayRow.today)}::date
   ORDER BY created_at DESC LIMIT 1`,
))[0] as { id?: string } | undefined;
const wfh = pendingWfh?.id
  ? { status: 201, body: { wfhRequestId: pendingWfh.id } } as ApiResult
  : await api("POST", "/availability/wfh", {
  startDate: todayRow.today,
  endDate: todayRow.today,
  reason: "NOVA disposable WFH approval smoke",
  }, cookie);
assertStatus("wfh_request", wfh, 201);
const wfhId = requireField("wfh_request", wfh, "wfhRequestId");
const reviewerSignIn = await api("POST", "/auth/sign-in/email", { email: reviewerEmail, password: reviewerPassword });
assertStatus("reviewer_sign_in", reviewerSignIn, 200);
const reviewerCookie = reviewerSignIn.cookie;
if (!reviewerCookie) throw new Error("NOVA_SPECIALIZED_SMOKE_REVIEWER_SESSION_COOKIE_MISSING");
assertStatus("wfh_review", await api("POST", `/availability/wfh/${wfhId}/review`, {
  decision: "approved",
  reason: "NOVA disposable WFH approval smoke",
}, reviewerCookie), 200);

const wfhCheckIn = await api("POST", "/attendance/check-in", { mode: "wfh" }, cookie);
assertStatus("attendance_wfh_check_in", wfhCheckIn, 201);
const officeLocationRejections = [
  {
    label: "attendance_missing_location_rejected",
    body: { mode: "office" },
    status: 409,
    error: "ATTENDANCE_LOCATION_REQUIRED",
  },
  {
    label: "attendance_low_accuracy_rejected",
    body: { mode: "office", latitude: 12.9716, longitude: 77.5946, accuracyMeters: 101 },
    status: 409,
    error: "ATTENDANCE_LOCATION_ACCURACY_TOO_LOW",
  },
  {
    label: "attendance_invalid_location_rejected",
    body: { mode: "office", latitude: 12.9716, longitude: 77.5946, accuracyMeters: -1 },
    status: 400,
    error: "ATTENDANCE_INPUT_INVALID",
  },
] as const;
for (const rejection of officeLocationRejections) {
  const result = await api("POST", "/attendance/change-mode", rejection.body, cookie);
  assertStatus(rejection.label, result, rejection.status);
  if (result.body?.error !== rejection.error) {
    throw new Error(`${rejection.label.toUpperCase()}_WRONG_ERROR_${result.body?.error}`);
  }
}
const attendanceAfterLocationRejections = (await postSql(
  `SELECT mode FROM nova.attendance_days
   WHERE person_id = ${sqlLiteral(identity.person_id)}::uuid
     AND business_date = ${sqlLiteral(todayRow.today)}::date
   ORDER BY created_at DESC LIMIT 1`,
))[0] as { mode?: string } | undefined;
if (attendanceAfterLocationRejections?.mode !== "wfh") {
  throw new Error("ATTENDANCE_REJECTED_LOCATION_CHANGED_PERSISTED_MODE");
}
console.info("attendance_location_rejections_preserve_state: passed");
const badLocation = await api("POST", "/attendance/change-mode", {
  mode: "office",
  latitude: 0,
  longitude: 0,
  accuracyMeters: 5,
}, cookie);
assertStatus("attendance_geofence_reject", badLocation, 409);
if (badLocation.body?.error !== "ATTENDANCE_OUTSIDE_GEOFENCE") {
  throw new Error(`ATTENDANCE_GEOFENCE_REJECT_WRONG_ERROR_${badLocation.body?.error}`);
}
console.info("attendance_geofence_reject_error: ATTENDANCE_OUTSIDE_GEOFENCE");
assertStatus("attendance_office_mode", await api("POST", "/attendance/change-mode", {
  mode: "office",
  latitude: 12.9716,
  longitude: 77.5946,
  accuracyMeters: 5,
}, cookie), 200);
assertStatus("attendance_check_out", await api("POST", "/attendance/check-out", undefined, cookie), 200);
const recoverableAttendance = (await postSql(
  `SELECT attendance.business_date::text AS business_date,
          to_char(attendance.checked_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_in_at,
          to_char(attendance.checked_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_out_at
   FROM nova.attendance_days attendance
   WHERE attendance.person_id = ${sqlLiteral(identity.person_id)}::uuid
     AND attendance.business_date = ${sqlLiteral(todayRow.today)}::date
     AND attendance.checked_out_at IS NOT NULL
   ORDER BY attendance.created_at DESC LIMIT 1`,
))[0] as { business_date?: string; checked_in_at?: string; checked_out_at?: string } | undefined;
if (!recoverableAttendance?.business_date || !recoverableAttendance.checked_in_at || !recoverableAttendance.checked_out_at) {
  throw new Error("NOVA_SPECIALIZED_SMOKE_RECOVERY_FIXTURE_MISSING");
}
let attendanceRecovery: ApiResult;
const actualDateNowForRecovery = Date.now;
try {
  Date.now = () => actualDateNowForRecovery() - 24 * 60 * 60 * 1_000;
  attendanceRecovery = await api("POST", "/attendance/recover", {
    personId: identity.person_id,
    businessDate: recoverableAttendance.business_date,
    mode: "office",
    checkedInAt: recoverableAttendance.checked_in_at,
    checkedOutAt: recoverableAttendance.checked_out_at,
    reason: "Verify database-clock recovery and PostgreSQL microsecond preservation.",
  }, cookie);
} finally {
  Date.now = actualDateNowForRecovery;
}
assertStatus("attendance_recovery_uses_database_clock_and_accepts_microseconds", attendanceRecovery!, 201);
if (attendanceRecovery!.body?.checkedInAt !== recoverableAttendance.checked_in_at ||
  attendanceRecovery!.body?.checkedOutAt !== recoverableAttendance.checked_out_at) {
  throw new Error("ATTENDANCE_RECOVERY_RESPONSE_LOST_TIMESTAMP_PRECISION");
}
const recoveredAttendance = (await postSql(
  `SELECT to_char(attendance.checked_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_in_at,
          to_char(attendance.checked_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_out_at,
          correction.after_state->>'checkedInAt' AS audited_check_in,
          correction.after_state->>'checkedOutAt' AS audited_check_out
   FROM nova.attendance_days attendance
   JOIN nova.attendance_corrections correction ON correction.attendance_day_id = attendance.id
   WHERE correction.id = ${sqlLiteral(String(attendanceRecovery!.body.correctionId))}::uuid`,
))[0] as { checked_in_at?: string; checked_out_at?: string; audited_check_in?: string; audited_check_out?: string } | undefined;
if (recoveredAttendance?.checked_in_at !== recoverableAttendance.checked_in_at ||
  recoveredAttendance?.checked_out_at !== recoverableAttendance.checked_out_at ||
  recoveredAttendance?.audited_check_in !== recoverableAttendance.checked_in_at ||
  recoveredAttendance?.audited_check_out !== recoverableAttendance.checked_out_at) {
  throw new Error("ATTENDANCE_RECOVERY_DATABASE_OR_AUDIT_LOST_TIMESTAMP_PRECISION");
}
console.info("attendance_recovery_microseconds_and_db_clock: passed");

const pendingWfhReject = await api("POST", "/availability/wfh", {
  startDate: todayRow.today,
  endDate: todayRow.today,
  reason: "NOVA provisional WFH rejection smoke",
}, reviewerCookie);
assertStatus("wfh_pending_request", pendingWfhReject, 201);
const pendingWfhRejectId = requireField("wfh_pending_request", pendingWfhReject, "wfhRequestId");
assertStatus("wfh_timer_requires_provisional_attendance", await api(
  "POST", "/work-sessions/start", { assignmentId: requireField("assignment", assignment, "assignmentId") }, reviewerCookie,
), 409);
assertStatus("wfh_provisional_check_in", await api(
  "POST", "/attendance/check-in", { mode: "wfh" }, reviewerCookie,
), 201);
const provisionalAfterCheckIn = await api("GET", "/attendance/today", undefined, reviewerCookie);
assertStatus("wfh_provisional_read", provisionalAfterCheckIn, 200);
if (provisionalAfterCheckIn.body?.attendance !== null ||
  provisionalAfterCheckIn.body?.provisionalAttendance?.status !== "pending" ||
  provisionalAfterCheckIn.body?.provisionalAttendance?.creditable !== false) {
  throw new Error("WFH_PENDING_CHECKIN_WAS_COUNTED_AS_AUTHORITATIVE_ATTENDANCE");
}
const noPrematureAttendance = await postSql(
  `SELECT id FROM nova.attendance_days
   WHERE person_id = ${sqlLiteral(reviewerPerson.id)}::uuid
     AND business_date = ${sqlLiteral(todayRow.today)}::date`,
);
if (noPrematureAttendance.length) throw new Error("WFH_PENDING_CREATED_AUTHORITATIVE_ATTENDANCE");
const rejectedTimer = await api("POST", "/work-sessions/start", {
  assignmentId: requireField("assignment", assignment, "assignmentId"),
}, reviewerCookie);
assertStatus("wfh_provisional_timer_start", rejectedTimer, 201);
const rejectedSessionId = requireField("wfh_provisional_timer", rejectedTimer, "sessionId");
assertStatus("wfh_pending_rejected", await api("POST", `/availability/wfh/${pendingWfhRejectId}/review`, {
  decision: "rejected", reason: "NOVA provisional rejection smoke",
}, cookie), 200);
const rejectedState = (await postSql(
  `SELECT evidence.status AS evidence_status, evidence.resolution_reason,
          to_char(evidence.checked_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_out_at,
          to_char(sessions.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS ended_at,
          sessions.closure_reason, assignments.status AS assignment_status
   FROM nova.wfh_provisional_attendance evidence
   JOIN nova.work_sessions sessions
     ON sessions.provisional_wfh_attendance_id = evidence.id
   JOIN nova.task_assignments assignments ON assignments.id = sessions.assignment_id
   WHERE sessions.id = ${sqlLiteral(rejectedSessionId)}::uuid`,
))[0] as {
  evidence_status?: string; resolution_reason?: string; checked_out_at?: string;
  ended_at?: string; closure_reason?: string; assignment_status?: string;
} | undefined;
if (rejectedState?.evidence_status !== "discarded" ||
  rejectedState.resolution_reason !== "WFH_REQUEST_REJECTED" ||
  !rejectedState.ended_at || rejectedState.ended_at !== rejectedState.checked_out_at ||
  rejectedState.closure_reason !== "WFH_REQUEST_REJECTED" ||
  rejectedState.assignment_status !== "in_progress") {
  throw new Error(`WFH_REJECTION_DID_NOT_DISCARD_ONLY_ATTENDANCE_AND_CLOSE_LINKED_TIMER_${JSON.stringify(rejectedState)}`);
}
if ((await postSql(
  `SELECT id FROM nova.attendance_days
   WHERE person_id = ${sqlLiteral(reviewerPerson.id)}::uuid
     AND business_date = ${sqlLiteral(todayRow.today)}::date`,
)).length) throw new Error("WFH_REJECTION_CREATED_AUTHORITATIVE_ATTENDANCE");
console.info("wfh_rejection_discards_credit_preserves_task_and_stops_linked_timer_at_same_instant: passed");

const pendingWfhCancel = await api("POST", "/availability/wfh", {
  startDate: todayRow.today,
  endDate: todayRow.today,
  reason: "NOVA provisional WFH cancellation smoke",
}, reviewerCookie);
assertStatus("wfh_cancellation_request", pendingWfhCancel, 201);
const pendingWfhCancelId = requireField("wfh_cancellation_request", pendingWfhCancel, "wfhRequestId");
const officeCheckInWhileWfhPending = await api(
  "POST", "/attendance/check-in", { mode: "office" }, reviewerCookie,
);
assertStatus("office_check_in_requires_pending_wfh_cancel", officeCheckInWhileWfhPending, 409);
if (officeCheckInWhileWfhPending.body?.error !== "WFH_REQUEST_CANCEL_BEFORE_OFFICE_CHECK_IN") {
  throw new Error(`OFFICE_CHECKIN_DID_NOT_REQUIRE_PENDING_WFH_CANCEL_${officeCheckInWhileWfhPending.body?.error}`);
}
assertStatus("wfh_cancellation_provisional_check_in", await api(
  "POST", "/attendance/check-in", { mode: "wfh" }, reviewerCookie,
), 201);
const cancellationTimer = await api("POST", "/work-sessions/start", {
  assignmentId: requireField("assignment", assignment, "assignmentId"),
}, reviewerCookie);
assertStatus("wfh_cancellation_linked_timer_start", cancellationTimer, 201);
const cancellationSessionId = requireField("wfh_cancellation_timer", cancellationTimer, "sessionId");
assertStatus("wfh_request_cancelled_with_open_provisional_timer", await api(
  "POST", `/availability/wfh/${pendingWfhCancelId}/cancel`, {}, reviewerCookie,
), 200);
const reviewAfterWfhCancel = await api("POST", `/availability/wfh/${pendingWfhCancelId}/review`, {
  decision: "approved", reason: "Must not override employee cancellation.",
}, cookie);
assertStatus("wfh_cancel_wins_over_later_review", reviewAfterWfhCancel, 409);
if (reviewAfterWfhCancel.body?.error !== "WFH_REQUEST_NOT_PENDING") {
  throw new Error(`WFH_CANCEL_DID_NOT_BLOCK_LATER_REVIEW_${reviewAfterWfhCancel.body?.error}`);
}
const cancelledWfhState = (await postSql(
  `SELECT evidence.status AS evidence_status, evidence.resolution_reason,
          to_char(evidence.checked_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_out_at,
          to_char(sessions.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS ended_at,
          sessions.state AS session_state, sessions.closure_reason,
          assignments.status AS assignment_status
   FROM nova.wfh_provisional_attendance evidence
   JOIN nova.work_sessions sessions ON sessions.provisional_wfh_attendance_id = evidence.id
   JOIN nova.task_assignments assignments ON assignments.id = sessions.assignment_id
   WHERE sessions.id = ${sqlLiteral(cancellationSessionId)}::uuid`,
))[0] as {
  evidence_status?: string; resolution_reason?: string; checked_out_at?: string;
  ended_at?: string; session_state?: string; closure_reason?: string; assignment_status?: string;
} | undefined;
if (cancelledWfhState?.evidence_status !== "discarded" ||
  cancelledWfhState.resolution_reason !== "WFH_REQUEST_CANCELLED" ||
  !cancelledWfhState.ended_at || cancelledWfhState.ended_at !== cancelledWfhState.checked_out_at ||
  cancelledWfhState.session_state !== "auto_closed" ||
  cancelledWfhState.closure_reason !== "WFH_REQUEST_CANCELLED" ||
  cancelledWfhState.assignment_status !== "in_progress") {
  throw new Error(`WFH_CANCELLATION_DID_NOT_CLOSE_ONLY_PROVISIONAL_TIME_${JSON.stringify(cancelledWfhState)}`);
}
if ((await postSql(
  `SELECT id FROM nova.attendance_days
   WHERE person_id = ${sqlLiteral(reviewerPerson.id)}::uuid
     AND business_date = ${sqlLiteral(todayRow.today)}::date`,
)).length) throw new Error("WFH_CANCELLATION_CREATED_AUTHORITATIVE_ATTENDANCE");
console.info("wfh_cancellation_discards_only_attendance_and_preserves_task_work: passed");

const pendingWfhApprove = await api("POST", "/availability/wfh", {
  startDate: todayRow.today,
  endDate: todayRow.today,
  reason: "NOVA provisional WFH approval smoke",
}, reviewerCookie);
assertStatus("wfh_second_pending_request", pendingWfhApprove, 201);
const pendingWfhApproveId = requireField("wfh_second_pending_request", pendingWfhApprove, "wfhRequestId");
assertStatus("wfh_second_provisional_check_in", await api(
  "POST", "/attendance/check-in", { mode: "wfh" }, reviewerCookie,
), 201);
const promotedTimer = await api("POST", "/work-sessions/start", {
  assignmentId: requireField("assignment", assignment, "assignmentId"),
}, reviewerCookie);
assertStatus("wfh_second_provisional_timer_start", promotedTimer, 201);
const promotedSessionId = requireField("wfh_second_provisional_timer", promotedTimer, "sessionId");
assertStatus("wfh_pending_approved_and_promoted", await api(
  "POST", `/availability/wfh/${pendingWfhApproveId}/review`, {
    decision: "approved", reason: "NOVA provisional promotion smoke",
  }, cookie,
), 200);
const cancelAfterWfhApproval = await api(
  "POST", `/availability/wfh/${pendingWfhApproveId}/cancel`, {}, reviewerCookie,
);
assertStatus("wfh_approval_wins_over_later_cancel", cancelAfterWfhApproval, 409);
if (cancelAfterWfhApproval.body?.error !== "WFH_REQUEST_NOT_CANCELLABLE") {
  throw new Error(`WFH_APPROVAL_DID_NOT_BLOCK_CANCELLATION_${cancelAfterWfhApproval.body?.error}`);
}
const promotedState = (await postSql(
  `SELECT evidence.status AS evidence_status, attendance.mode,
          to_char(attendance.checked_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_in_at,
          to_char(evidence.checked_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS evidence_checked_in_at,
          to_char(sessions.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS ended_at
   FROM nova.wfh_provisional_attendance evidence
   JOIN nova.attendance_days attendance ON attendance.id = evidence.attendance_day_id
   JOIN nova.work_sessions sessions ON sessions.provisional_wfh_attendance_id = evidence.id
   WHERE sessions.id = ${sqlLiteral(promotedSessionId)}::uuid`,
))[0] as {
  evidence_status?: string; mode?: string; checked_in_at?: string;
  evidence_checked_in_at?: string; ended_at?: string | null;
} | undefined;
if (promotedState?.evidence_status !== "promoted" || promotedState.mode !== "wfh" ||
  promotedState.checked_in_at !== promotedState.evidence_checked_in_at || promotedState.ended_at !== null) {
  throw new Error("WFH_APPROVAL_DID_NOT_PROMOTE_EVIDENCE_OR_STOPPED_TASK_TIMER");
}
assertStatus("wfh_approved_check_out", await api("POST", "/attendance/check-out", undefined, reviewerCookie), 200);
console.info("wfh_approval_promotes_original_interval_and_keeps_task_timer_running: passed");

const liveWfhRaceRequest = await api("POST", "/availability/wfh", {
  startDate: todayRow.today,
  endDate: todayRow.today,
  reason: "NOVA approval versus cancellation with live work smoke",
}, wfhRaceCookie);
assertStatus("wfh_approval_cancel_live_request", liveWfhRaceRequest, 201);
const liveWfhRaceRequestId = requireField("wfh_approval_cancel_live_request", liveWfhRaceRequest, "wfhRequestId");
assertStatus("wfh_approval_cancel_live_provisional_check_in", await api(
  "POST", "/attendance/check-in", { mode: "wfh" }, wfhRaceCookie,
), 201);
const liveWfhRaceTimer = await api("POST", "/work-sessions/start", {
  assignmentId: wfhRaceAssignmentId,
}, wfhRaceCookie);
assertStatus("wfh_approval_cancel_live_timer", liveWfhRaceTimer, 201);
const liveWfhRaceSessionId = requireField("wfh_approval_cancel_live_timer", liveWfhRaceTimer, "sessionId");
const [liveWfhRaceReview, liveWfhRaceCancel] = await Promise.all([
  api("POST", `/availability/wfh/${liveWfhRaceRequestId}/review`, {
    decision: "approved", reason: "Concurrent approval/cancellation race.",
  }, cookie),
  api("POST", `/availability/wfh/${liveWfhRaceRequestId}/cancel`, {}, wfhRaceCookie),
]);
const approvalWon = liveWfhRaceReview.status === 200 && liveWfhRaceCancel.status === 409 &&
  liveWfhRaceCancel.body?.error === "WFH_REQUEST_NOT_CANCELLABLE";
const liveCancelWon = liveWfhRaceCancel.status === 200 && liveWfhRaceReview.status === 409 &&
  liveWfhRaceReview.body?.error === "WFH_REQUEST_NOT_PENDING";
if (!approvalWon && !liveCancelWon) {
  throw new Error(`WFH_APPROVAL_CANCEL_LIVE_RACE_UNEXPECTED_OUTCOME_${JSON.stringify({
    review: { status: liveWfhRaceReview.status, body: liveWfhRaceReview.body },
    cancel: { status: liveWfhRaceCancel.status, body: liveWfhRaceCancel.body },
  })}`);
}
const liveWfhRaceState = (await postSql(
  `SELECT requests.status AS request_status, evidence.status AS evidence_status,
          evidence.resolution_reason, evidence.attendance_day_id,
          attendance.mode AS attendance_mode, sessions.state AS session_state,
          sessions.closure_reason,
          to_char(evidence.checked_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS evidence_checked_out_at,
          to_char(sessions.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS session_ended_at,
          assignments.status AS assignment_status,
          (SELECT count(*) FROM nova.audit_events events
           WHERE events.target_type = 'wfh_request' AND events.target_id = requests.id
             AND events.action IN ('availability.wfh_approved', 'availability.wfh_cancelled')) AS decision_events
   FROM nova.wfh_requests requests
   JOIN nova.wfh_provisional_attendance evidence ON evidence.request_id = requests.id
   JOIN nova.work_sessions sessions ON sessions.provisional_wfh_attendance_id = evidence.id
   JOIN nova.task_assignments assignments ON assignments.id = sessions.assignment_id
   LEFT JOIN nova.attendance_days attendance ON attendance.id = evidence.attendance_day_id
   WHERE requests.id = ${sqlLiteral(liveWfhRaceRequestId)}::uuid
     AND sessions.id = ${sqlLiteral(liveWfhRaceSessionId)}::uuid
   LIMIT 1`,
))[0] as {
  request_status?: string; evidence_status?: string; resolution_reason?: string;
  attendance_day_id?: string | null; attendance_mode?: string | null; session_state?: string;
  closure_reason?: string | null; evidence_checked_out_at?: string | null;
  session_ended_at?: string | null; assignment_status?: string; decision_events?: number | string;
} | undefined;
if (!liveWfhRaceState || Number(liveWfhRaceState.decision_events) !== 1 ||
  liveWfhRaceState.assignment_status !== "in_progress") {
  throw new Error(`WFH_APPROVAL_CANCEL_LIVE_RACE_AUDIT_OR_TASK_STATE_INVALID_${JSON.stringify(liveWfhRaceState)}`);
}
if (approvalWon) {
  if (liveWfhRaceState.request_status !== "approved" || liveWfhRaceState.evidence_status !== "promoted" ||
    !liveWfhRaceState.attendance_day_id || liveWfhRaceState.attendance_mode !== "wfh" ||
    liveWfhRaceState.session_state !== "running" || liveWfhRaceState.session_ended_at !== null ||
    liveWfhRaceState.resolution_reason !== null) {
    throw new Error(`WFH_APPROVAL_CANCEL_RACE_APPROVAL_STATE_INVALID_${JSON.stringify(liveWfhRaceState)}`);
  }
  assertStatus("wfh_approval_cancel_race_cleanup_timer", await api(
    "POST", `/work-sessions/${liveWfhRaceSessionId}/stop`, {}, wfhRaceCookie,
  ), 200);
  assertStatus("wfh_approval_cancel_race_cleanup_attendance", await api(
    "POST", "/attendance/check-out", undefined, wfhRaceCookie,
  ), 200);
} else if (liveWfhRaceState.request_status !== "cancelled" ||
  liveWfhRaceState.evidence_status !== "discarded" ||
  liveWfhRaceState.resolution_reason !== "WFH_REQUEST_CANCELLED" ||
  liveWfhRaceState.attendance_day_id !== null || liveWfhRaceState.attendance_mode !== null ||
  liveWfhRaceState.session_state !== "auto_closed" ||
  liveWfhRaceState.closure_reason !== "WFH_REQUEST_CANCELLED" ||
  !liveWfhRaceState.evidence_checked_out_at ||
  liveWfhRaceState.evidence_checked_out_at !== liveWfhRaceState.session_ended_at) {
  throw new Error(`WFH_APPROVAL_CANCEL_RACE_CANCELLATION_STATE_INVALID_${JSON.stringify(liveWfhRaceState)}`);
}
console.info(`wfh_approval_cancel_with_live_provisional_work: passed (${approvalWon ? "approval" : "cancellation"} won atomically)`);

const concurrentWfh = await api("POST", "/availability/wfh", {
  startDate: todayRow.tomorrow,
  endDate: todayRow.tomorrow,
  reason: "NOVA concurrent review/cancel race smoke",
}, reviewerCookie);
assertStatus("wfh_concurrent_race_request", concurrentWfh, 201);
const concurrentWfhId = requireField("wfh_concurrent_race_request", concurrentWfh, "wfhRequestId");
const [concurrentWfhReview, concurrentWfhCancel] = await Promise.all([
  api("POST", `/availability/wfh/${concurrentWfhId}/review`, {
    decision: "rejected", reason: "Concurrent race smoke decision.",
  }, cookie),
  api("POST", `/availability/wfh/${concurrentWfhId}/cancel`, {}, reviewerCookie),
]);
const cancelWon = concurrentWfhCancel.status === 200 && concurrentWfhReview.status === 409 &&
  concurrentWfhReview.body?.error === "WFH_REQUEST_NOT_PENDING";
const reviewWon = concurrentWfhReview.status === 200 && concurrentWfhCancel.status === 409 &&
  concurrentWfhCancel.body?.error === "WFH_REQUEST_NOT_CANCELLABLE";
if (!cancelWon && !reviewWon) {
  throw new Error(`WFH_REVIEW_CANCEL_RACE_UNEXPECTED_OUTCOME_${JSON.stringify({
    review: { status: concurrentWfhReview.status, body: concurrentWfhReview.body },
    cancel: { status: concurrentWfhCancel.status, body: concurrentWfhCancel.body },
  })}`);
}
const concurrentWfhState = (await postSql(
  `SELECT requests.status,
          count(events.id) FILTER (WHERE events.action IN (
            'availability.wfh_rejected', 'availability.wfh_cancelled'
          )) AS final_decision_events
   FROM nova.wfh_requests requests
   LEFT JOIN nova.audit_events events
     ON events.target_type = 'wfh_request' AND events.target_id = requests.id
   WHERE requests.id = ${sqlLiteral(concurrentWfhId)}::uuid
   GROUP BY requests.id`,
))[0] as { status?: string; final_decision_events?: number | string } | undefined;
const expectedRaceStatus = cancelWon ? "cancelled" : "rejected";
if (concurrentWfhState?.status !== expectedRaceStatus ||
  Number(concurrentWfhState.final_decision_events) !== 1) {
  throw new Error(`WFH_REVIEW_CANCEL_RACE_PERSISTED_INCONSISTENT_STATE_${JSON.stringify(concurrentWfhState)}`);
}
console.info(`wfh_review_cancel_concurrency: passed (${expectedRaceStatus} won; one final decision)`);

const leave = await api("POST", "/leave", {
  leaveType: "annual",
  startDate: todayRow.tomorrow,
  endDate: todayRow.tomorrow,
  reason: "NOVA disposable leave approval smoke",
  days: [{ date: todayRow.tomorrow, portion: 1 }],
}, cookie);
assertStatus("leave_request", leave, 201);
const leaveId = requireField("leave_request", leave, "leaveRequestId");
assertStatus("leave_review", await api("POST", `/leave/${leaveId}/review`, {
  decision: "approved",
  reason: "NOVA disposable leave approval smoke",
}, reviewerCookie), 200);
const wfhConflict = await api("POST", "/availability/wfh", {
  startDate: todayRow.tomorrow,
  endDate: todayRow.tomorrow,
  reason: "NOVA disposable conflict invariant smoke",
}, cookie);
assertStatus("leave_wfh_conflict", wfhConflict, 409);
if (wfhConflict.body?.error !== "LEAVE_WFH_CONFLICT") {
  throw new Error(`LEAVE_WFH_CONFLICT_WRONG_ERROR_${wfhConflict.body?.error}`);
}
console.info("leave_wfh_conflict_error: LEAVE_WFH_CONFLICT");
assertStatus("attendance_read_final", await api("GET", "/attendance/today", undefined, cookie), 200);
assertStatus("wfh_read_final", await api("GET", "/availability/wfh/mine", undefined, cookie), 200);
assertStatus("leave_read_final", await api("GET", "/leave/mine", undefined, cookie), 200);

await directFixtureDatabase?.end();
console.info("NOVA specialized PostgreSQL runtime smoke passed");
