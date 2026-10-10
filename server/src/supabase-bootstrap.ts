import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { confirmSupabaseProject } from "./supabase-project-confirmation.js";
import { migrationSha256 } from "./migration-checksum.js";
import {
  applicationRoleProvisioningSql,
  applicationRoleTableGrantsSql,
} from "./application-role-provisioning.js";
import { assertSupabaseDatabaseUrlBinding, supabaseManagementFailureCode } from "./supabase-pooler.js";

const projectRef = requiredEnvironment("NOVA_SUPABASE_PROJECT_REF");
const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ?? process.env.Supabaseaccesstoken;
const applicationPassword = requiredEnvironment("NOVA_APP_PASSWORD");
const rotateExistingApplicationPassword = process.argv.includes("--rotate-app-role-password");
const migrationDirectory = fileURLToPath(
  new URL("../../database/migrations/", import.meta.url),
);
const testDirectory = fileURLToPath(
  new URL("../../database/tests/", import.meta.url),
);

if (!/^[a-z0-9]{20}$/.test(projectRef)) {
  throw new Error("NOVA_SUPABASE_PROJECT_REF_INVALID");
}
assertSupabaseDatabaseUrlBinding(requiredEnvironment("DATABASE_URL"), projectRef);

if (!accessToken) {
  throw new Error("SUPABASE_ACCESS_TOKEN_REQUIRED");
}
if (applicationPassword.length < 24) {
  throw new Error("NOVA_APP_PASSWORD_TOO_SHORT");
}
await confirmSupabaseProject(projectRef, "apply NOVA migrations and configure the restricted application role");

const supabaseAccessToken = accessToken;

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name}_REQUIRED`);
  }

  return value;
}

async function postSql(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${supabaseAccessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = (await response.text())
      .replaceAll(supabaseAccessToken, "[REDACTED]")
      .replaceAll(applicationPassword, "[REDACTED]")
      .replaceAll(/\s+/g, " ")
      .slice(0, 500);

    throw new Error(`${supabaseManagementFailureCode(path, response.status)}_${path}: ${detail}`);
  }

  return response.status === 204 ? undefined : response.json();
}

const roleProvisioningSource = applicationRoleProvisioningSql(applicationPassword, {
  rotateExistingPassword: rotateExistingApplicationPassword,
});

await postSql("/database/query", {
  query: `
    CREATE TABLE IF NOT EXISTS public.nova_schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `,
});

const migrationLedger = await postSql("/database/query", {
  query: "SELECT filename FROM public.nova_schema_migrations",
});
const appliedMigrations = new Set(
  Array.isArray(migrationLedger)
    ? migrationLedger.flatMap((row) =>
      typeof row === "object" && row !== null && typeof (row as { filename?: unknown }).filename === "string"
        ? [(row as { filename: string }).filename]
        : []
    )
    : [],
);
const checksumColumnResult = await postSql("/database/query", {
  query: `
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'nova_schema_migrations'
        AND column_name = 'sha256'
    ) AS exists
  `,
});
let checksumColumnExists = Array.isArray(checksumColumnResult) &&
  (checksumColumnResult[0] as { exists?: unknown } | undefined)?.exists === true;
const checksumMigration = "0076_operator_update_checksums.sql";
const migrationFiles = (await readdir(migrationDirectory))
  .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename))
  .sort();

for (const filename of migrationFiles) {
  if (appliedMigrations.has(filename)) {
    if (filename === checksumMigration && !checksumColumnExists) {
      throw new Error("MIGRATION_CHECKSUM_COLUMN_MISSING");
    }
    continue;
  }

  const source = await readFile(join(migrationDirectory, filename), "utf8");
  const storesChecksum = checksumColumnExists || filename === checksumMigration;
  const checksum = storesChecksum
    ? migrationSha256(source)
    : undefined;
  const ledgerInsert = storesChecksum
    ? `INSERT INTO public.nova_schema_migrations (filename, sha256) VALUES ('${filename}', '${checksum}');`
    : `INSERT INTO public.nova_schema_migrations (filename) VALUES ('${filename}');`;
  const roleProvisioning = filename === "0001_people_identity.sql"
    ? roleProvisioningSource
    : "";
  const migrationGuard = `
    DO $nova_migration_guard$
    BEGIN
      IF NOT pg_try_advisory_xact_lock(hashtextextended('nova_schema_migrations', 0)) THEN
        RAISE EXCEPTION 'NOVA_MIGRATION_LOCK_BUSY';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM public.nova_schema_migrations
        WHERE filename = '${filename}'
      ) THEN
        RAISE EXCEPTION 'NOVA_MIGRATION_ALREADY_APPLIED';
      END IF;
    END;
    $nova_migration_guard$;
  `;

  await postSql("/database/migrations", {
    name: filename.slice(0, -4),
    query: `
      ${migrationGuard}
      ${source}
      ${ledgerInsert}
      ${roleProvisioning}
    `,
  });
  if (filename === checksumMigration) checksumColumnExists = true;
}

// Ensure grants are present on every bootstrap. Existing role credentials are
// stable unless rotation was explicitly requested, so a local .env update
// cannot silently invalidate the deployed API's DATABASE_URL.
await postSql("/database/query", { query: roleProvisioningSource });

const roleBoundary = await postSql("/database/query", {
  query: `
    SELECT rolsuper, rolbypassrls, rolcanlogin, rolinherit, rolcreatedb, rolcreaterole
    FROM pg_roles
    WHERE rolname = 'nova_app'
  `,
});
const applicationRole = Array.isArray(roleBoundary)
  ? roleBoundary[0] as {
    rolsuper?: unknown;
    rolbypassrls?: unknown;
    rolcanlogin?: unknown;
    rolinherit?: unknown;
    rolcreatedb?: unknown;
    rolcreaterole?: unknown;
  } | undefined
  : undefined;
if (
  !applicationRole ||
  applicationRole.rolsuper !== false ||
  applicationRole.rolbypassrls !== false ||
  applicationRole.rolcanlogin !== true ||
  applicationRole.rolinherit !== false ||
  applicationRole.rolcreatedb !== false ||
  applicationRole.rolcreaterole !== false
) {
  throw new Error("NOVA_APPLICATION_ROLE_BOUNDARY_INVALID");
}

await postSql("/database/query", {
  query: `
    ${applicationRoleTableGrantsSql("nova_app")}
    GRANT USAGE ON SCHEMA nova_auth TO nova_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nova_auth TO nova_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA nova_auth
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.bootstrap_organisation(text, text, text, text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.bootstrap_organisation(text, text, text, text, nova.attendance_policy_mode, integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.resolve_authenticated_actor(text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.request_has_valid_actor() TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.request_actor_is_super_admin() TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.active_email_provider_connection() TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.consume_email_oauth_attempt(bytea) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.claim_invitation_identity(text, text, bytea) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.invitation_is_claimable(text, bytea) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.bootstrap_auth_signup_available() TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.can_create_auth_session(text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.complete_invitation_after_email_verification(text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.resolve_authenticated_actor_state(text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.notification_email_enabled(uuid, text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.claim_notification_outbox(integer, integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.finish_notification_outbox(uuid, uuid, text, text, text, integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.stage_notification_outbox(uuid, uuid, uuid, text, jsonb) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.purge_expired_attendance_location_evidence(integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.close_person_work_sessions(uuid, timestamptz, text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.close_assignment_work_sessions(uuid, timestamptz, text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.stage_auth_handoff(text, nova.auth_handoff_purpose, bytea, smallint, timestamptz, text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.close_person_attendance(uuid, timestamptz) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.close_attendance_at_business_boundary(integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.close_work_sessions_at_business_boundary(integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.close_wfh_provisional_attendance_at_business_boundary(integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.person_business_date(uuid) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.read_notification_delivery(integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.requeue_notification_delivery(uuid) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.enqueue_due_task_notifications(integer, integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.expire_task_due_notifications(uuid) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.notification_outbox_lease_is_current(uuid, uuid) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.expire_task_requests(integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.reconcile_unavailable_reviewers(integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.purge_expired_api_idempotency_keys(integer) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.is_valid_timezone(text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.public_origin_for_organisation(uuid) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.public_origin_for_identity(text) TO nova_app;
    GRANT EXECUTE ON FUNCTION nova.configured_public_origins() TO nova_app;
  `,
});

const testFiles = (await readdir(testDirectory))
  .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename))
  .sort();

const organisationState = await postSql("/database/query", {
  query: "SELECT EXISTS (SELECT 1 FROM nova.organisations) AS populated",
});
const populated = Array.isArray(organisationState) &&
  (organisationState[0] as { populated?: unknown } | undefined)?.populated === true;

if (populated) {
  console.info("Supabase Cloud migrations applied; rollback-only fixture tests skipped because the deployment is already populated.");
} else {
  for (const filename of testFiles) {
    await postSql("/database/query", {
      query: await readFile(join(testDirectory, filename), "utf8"),
    });
  }
  console.info("Supabase Cloud migrations and PostgreSQL tests passed");
}
