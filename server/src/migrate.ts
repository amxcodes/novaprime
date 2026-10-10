import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { migrationSha256 } from "./migration-checksum.js";
import { applicationRoleTableGrantsSql } from "./application-role-provisioning.js";

const migrationDirectory = fileURLToPath(
  new URL("../../database/migrations/", import.meta.url),
);
const validRoleName = /^[a-z_][a-z0-9_]{0,62}$/;

function migrationDatabase(): Pool {
  const url = process.env.MIGRATOR_DATABASE_URL;

  if (!url) {
    throw new Error("MIGRATOR_DATABASE_URL_REQUIRED");
  }

  return new Pool({ connectionString: url });
}

function applicationRoleName(): string | undefined {
  const role = process.env.NOVA_APPLICATION_DATABASE_ROLE;

  if (role && !validRoleName.test(role)) {
    throw new Error("APPLICATION_DATABASE_ROLE_INVALID");
  }

  return role;
}

async function grantApplicationDatabaseAccess(
  database: PoolClient,
  applicationRole: string,
): Promise<void> {
  const role = `"${applicationRole}"`;
  await database.query(applicationRoleTableGrantsSql(applicationRole));

  const [authenticationSchema] = (
    await database.query<{ exists: boolean }>(
      "SELECT to_regnamespace('nova_auth') IS NOT NULL AS exists",
    )
  ).rows;

  if (authenticationSchema?.exists) {
    await database.query(`
      GRANT USAGE ON SCHEMA nova_auth TO ${role};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nova_auth TO ${role};
      ALTER DEFAULT PRIVILEGES IN SCHEMA nova_auth
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
    `);
  }

  const [bootstrapFunction] = (
    await database.query<{ exists: boolean }>(
      "SELECT to_regprocedure('nova.bootstrap_organisation(text,text,text,text)') IS NOT NULL AS exists",
    )
  ).rows;

  if (bootstrapFunction?.exists) {
    await database.query(
      `GRANT EXECUTE ON FUNCTION nova.bootstrap_organisation(text, text, text, text) TO ${role}`,
    );
  }

  const [attendancePolicyBootstrapFunction] = (
    await database.query<{ exists: boolean }>(
      "SELECT to_regprocedure('nova.bootstrap_organisation(text,text,text,text,nova.attendance_policy_mode,integer)') IS NOT NULL AS exists",
    )
  ).rows;

  if (attendancePolicyBootstrapFunction?.exists) {
    await database.query(
      `GRANT EXECUTE ON FUNCTION nova.bootstrap_organisation(text, text, text, text, nova.attendance_policy_mode, integer) TO ${role}`,
    );
  }

  const [actorResolver] = (
    await database.query<{ exists: boolean }>(
      "SELECT to_regprocedure('nova.resolve_authenticated_actor(text)') IS NOT NULL AS exists",
    )
  ).rows;

  if (actorResolver?.exists) {
    await database.query(
      `GRANT EXECUTE ON FUNCTION nova.resolve_authenticated_actor(text) TO ${role}`,
    );
  }

  const functions = [
    "nova.request_has_valid_actor()",
    "nova.request_actor_is_super_admin()",
    "nova.active_email_provider_connection()",
    "nova.consume_email_oauth_attempt(bytea)",
    "nova.claim_invitation_identity(text,text,bytea)",
    "nova.invitation_is_claimable(text,bytea)",
    "nova.bootstrap_auth_signup_available()",
    "nova.can_create_auth_session(text)",
    "nova.complete_invitation_after_email_verification(text)",
    "nova.resolve_authenticated_actor_state(text)",
    "nova.notification_email_enabled(uuid, text)",
    "nova.claim_notification_outbox(integer, integer)",
    "nova.finish_notification_outbox(uuid, uuid, text, text, text, integer)",
    "nova.stage_notification_outbox(uuid, uuid, uuid, text, jsonb)",
    "nova.purge_expired_attendance_location_evidence(integer)",
    "nova.close_person_work_sessions(uuid, timestamptz, text)",
    "nova.close_assignment_work_sessions(uuid, timestamptz, text)",
    "nova.stage_auth_handoff(text, nova.auth_handoff_purpose, bytea, smallint, timestamptz, text)",
    "nova.close_person_attendance(uuid, timestamptz)",
    "nova.close_attendance_at_business_boundary(integer)",
    "nova.close_work_sessions_at_business_boundary(integer)",
    "nova.close_wfh_provisional_attendance_at_business_boundary(integer)",
    "nova.expire_task_requests(integer)",
    "nova.reconcile_unavailable_reviewers(integer)",
    "nova.purge_expired_api_idempotency_keys(integer)",
    "nova.is_valid_timezone(text)",
    "nova.person_business_date(uuid)",
    "nova.read_notification_delivery(integer)",
    "nova.requeue_notification_delivery(uuid)",
    "nova.enqueue_due_task_notifications(integer,integer)",
    "nova.expire_task_due_notifications(uuid)",
    "nova.notification_outbox_lease_is_current(uuid,uuid)",
    "nova.public_origin_for_organisation(uuid)",
    "nova.public_origin_for_identity(text)",
    "nova.configured_public_origins()",
  ];

  for (const functionName of functions) {
    const [exists] = (
      await database.query<{ exists: boolean }>(
        "SELECT to_regprocedure($1) IS NOT NULL AS exists",
        [functionName],
      )
    ).rows;

    if (exists?.exists) {
      await database.query(`GRANT EXECUTE ON FUNCTION ${functionName} TO ${role}`);
    }
  }
}

async function applyMigration(
  database: PoolClient,
  filename: string,
  source: string,
  storeChecksum: boolean,
): Promise<void> {
  try {
    await database.query("BEGIN");
    await database.query(source);
    if (storeChecksum) {
      const checksum = migrationSha256(source);
      await database.query(
        "INSERT INTO public.nova_schema_migrations (filename, sha256) VALUES ($1, $2)",
        [filename, checksum],
      );
    } else {
      await database.query(
        "INSERT INTO public.nova_schema_migrations (filename) VALUES ($1)",
        [filename],
      );
    }
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function migrate(): Promise<void> {
  const database = migrationDatabase();
  const applicationRole = applicationRoleName();
  const throughArgument = process.argv.indexOf("--through");
  const stopAfter = throughArgument < 0 ? undefined : process.argv[throughArgument + 1];
  if (throughArgument >= 0 && (!stopAfter || !/^\d{4}_[a-z0-9_]+\.sql$/.test(stopAfter))) {
    throw new Error("MIGRATION_THROUGH_FILENAME_INVALID");
  }
  let migrationConnection: PoolClient | undefined;
  let migrationLockHeld = false;

  try {
    migrationConnection = await database.connect();
    // Serialize migration runners. The lock is connection-scoped and is
    // released automatically if a process exits during an upgrade.
    await migrationConnection.query(
      "SELECT pg_advisory_lock(hashtextextended('nova_schema_migrations', 0))",
    );
    migrationLockHeld = true;

    await migrationConnection.query(`
      CREATE TABLE IF NOT EXISTS public.nova_schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await readdir(migrationDirectory))
      .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename))
      .sort();
    if (stopAfter && !filenames.includes(stopAfter)) {
      throw new Error("MIGRATION_THROUGH_FILENAME_NOT_FOUND");
    }

    const checksumMigration = "0076_operator_update_checksums.sql";
    let checksumColumnExists = (await migrationConnection.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'nova_schema_migrations'
          AND column_name = 'sha256'
      ) AS exists
    `)).rows[0]?.exists === true;

    for (const filename of filenames) {
      const applied = await migrationConnection.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1
          FROM public.nova_schema_migrations
          WHERE filename = $1
        ) AS exists`,
        [filename],
      );

      if (applied.rows[0]?.exists) {
        if (filename === checksumMigration && !checksumColumnExists) {
          throw new Error("MIGRATION_CHECKSUM_COLUMN_MISSING");
        }
        if (filename === stopAfter) break;
        continue;
      }

      const source = await readFile(join(migrationDirectory, filename), "utf8");

      const storesChecksum = checksumColumnExists || filename === checksumMigration;
      await applyMigration(migrationConnection, filename, source, storesChecksum);
      if (filename === checksumMigration) checksumColumnExists = true;

      console.info(`Applied ${filename}`);
      if (filename === stopAfter) break;
    }

    if (applicationRole) {
      await grantApplicationDatabaseAccess(migrationConnection, applicationRole);
    }
  } finally {
    if (migrationConnection && migrationLockHeld) {
      await migrationConnection.query(
        "SELECT pg_advisory_unlock(hashtextextended('nova_schema_migrations', 0))",
      ).catch(() => undefined);
    }
    migrationConnection?.release();
    await database.end();
  }
}

await migrate();
