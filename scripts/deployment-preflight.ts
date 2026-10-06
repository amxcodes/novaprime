export {};

type DatabasePool = {
  query<T extends Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { isSecretsEncryptionKeyValid } from "../server/src/secrets.ts";
import { assertSupabaseDatabaseUrlBinding } from "../server/src/supabase-pooler.ts";
const pgModulePath = "../server/node_modules/pg/lib/index.js";
const pg = await import(pgModulePath) as unknown as {
  Pool: new (configuration: { connectionString: string; max: number }) => DatabasePool;
};

const databaseUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATOR_DATABASE_URL;
const preflightArguments = process.argv.slice(2);
if (preflightArguments.some((argument) => argument !== "--migration-update") || preflightArguments.length > 1) {
  throw new Error("PREFLIGHT_ARGUMENT_UNSUPPORTED");
}
const migrationUpdateMode = preflightArguments.length === 1;
const expectedApplicationRole = process.env.NOVA_APPLICATION_DATABASE_ROLE ?? "nova_app";
const migrationDirectory = resolve(import.meta.dir, "../database/migrations");
const expectedMigration = (await readdir(migrationDirectory))
  .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename))
  .sort()
  .at(-1);
if (!expectedMigration) throw new Error("DATABASE_MIGRATIONS_NOT_FOUND");
const supabaseProjectRef = process.env.NOVA_SUPABASE_PROJECT_REF;
const supabaseAccessToken = process.env.SUPABASE_ACCESS_TOKEN;

async function readSupabaseMigrationLedger(): Promise<{
  currentUser: string;
  count: number;
  latest: string | null;
}> {
  if (!supabaseProjectRef || !/^[a-z0-9]{20}$/.test(supabaseProjectRef) || !supabaseAccessToken) {
    throw new Error("SUPABASE_MIGRATION_VERIFICATION_CONFIGURATION_REQUIRED");
  }
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${supabaseProjectRef}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${supabaseAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: `SELECT current_user::text AS "currentUser",
                       count(*)::int AS count, max(filename) AS latest
                FROM public.nova_schema_migrations`,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`SUPABASE_MIGRATION_LEDGER_READ_FAILED_${response.status}`);
  }
  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length !== 1 ||
    typeof rows[0]?.currentUser !== "string" ||
    typeof rows[0]?.count !== "number" ||
    (rows[0]?.latest !== null && typeof rows[0]?.latest !== "string")) {
    throw new Error("SUPABASE_MIGRATION_LEDGER_RESPONSE_INVALID");
  }
  return rows[0] as { currentUser: string; count: number; latest: string | null };
}

if (!databaseUrl) {
  throw new Error("DATABASE_URL_REQUIRED");
}
if (supabaseProjectRef) {
  assertSupabaseDatabaseUrlBinding(databaseUrl, supabaseProjectRef, expectedApplicationRole);
}
if (!migrationUpdateMode && !isSecretsEncryptionKeyValid()) {
  throw new Error("NOVA_SECRETS_ENCRYPTION_KEY_INVALID");
}
if (!migrationUpdateMode && !process.env.NOVA_BACKGROUND_JOB_SECRET) {
  throw new Error("NOVA_BACKGROUND_JOB_SECRET_REQUIRED");
}
if (!migrationUpdateMode && !["cloudflare", "netlify", "vercel", "supabase", "vps"]
  .some((scheduler) => scheduler === process.env.NOVA_BACKGROUND_SCHEDULER)) {
  throw new Error("NOVA_BACKGROUND_SCHEDULER_INVALID");
}

const applicationDatabase = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const role = await applicationDatabase.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
  }>(
    `SELECT current_user,
            roles.rolsuper,
            roles.rolbypassrls,
            roles.rolcreaterole,
            roles.rolcreatedb
     FROM pg_roles roles
     WHERE roles.rolname = current_user`,
  );
  const roleState = role.rows[0];
  if (!roleState) throw new Error("APPLICATION_ROLE_NOT_FOUND");
  if (roleState.rolsuper || roleState.rolbypassrls || roleState.rolcreaterole || roleState.rolcreatedb) {
    throw new Error("APPLICATION_ROLE_PRIVILEGE_TOO_BROAD");
  }
  if (roleState.current_user !== expectedApplicationRole) {
    throw new Error("APPLICATION_DATABASE_ROLE_MISMATCH");
  }

  const ownership = await applicationDatabase.query<{
    owns_nova_objects: boolean;
    can_assume_nova_object_owner: boolean;
    has_privileged_membership: boolean;
  }>(
    `WITH object_owners(owner_oid) AS (
       SELECT nspowner FROM pg_namespace WHERE nspname IN ('nova', 'nova_auth')
       UNION
       SELECT catalog_relation.relowner
       FROM pg_class catalog_relation
       JOIN pg_namespace catalog_namespace ON catalog_namespace.oid = catalog_relation.relnamespace
       WHERE catalog_namespace.nspname IN ('nova', 'nova_auth')
          OR (catalog_namespace.nspname = 'public'
            AND catalog_relation.relname = 'nova_schema_migrations')
       UNION
       SELECT catalog_routine.proowner
       FROM pg_proc catalog_routine
       JOIN pg_namespace catalog_namespace ON catalog_namespace.oid = catalog_routine.pronamespace
       WHERE catalog_namespace.nspname IN ('nova', 'nova_auth')
       UNION
       SELECT catalog_type.typowner
       FROM pg_type catalog_type
       JOIN pg_namespace catalog_namespace ON catalog_namespace.oid = catalog_type.typnamespace
       WHERE catalog_namespace.nspname IN ('nova', 'nova_auth')
     )
     SELECT EXISTS (
              SELECT 1 FROM object_owners
              WHERE owner_oid = current_user::regrole::oid
            ) AS owns_nova_objects,
            EXISTS (
              SELECT 1 FROM object_owners
              WHERE pg_has_role(current_user, owner_oid, 'MEMBER')
            ) AS can_assume_nova_object_owner,
            EXISTS (
              SELECT 1 FROM pg_roles privileged
              WHERE privileged.rolname <> current_user
                AND (privileged.rolsuper OR privileged.rolbypassrls
                  OR privileged.rolcreaterole OR privileged.rolcreatedb)
                AND pg_has_role(current_user, privileged.rolname, 'MEMBER')
            ) AS has_privileged_membership`,
  );
  const ownershipState = ownership.rows[0];
  if (!ownershipState) throw new Error("APPLICATION_ROLE_OWNERSHIP_CHECK_FAILED");
  if (ownershipState.owns_nova_objects || ownershipState.can_assume_nova_object_owner) {
    throw new Error("APPLICATION_ROLE_OWNS_OR_CAN_ASSUME_NOVA_OBJECT_OWNER");
  }
  if (ownershipState.has_privileged_membership) {
    throw new Error("APPLICATION_ROLE_HAS_PRIVILEGED_MEMBERSHIP");
  }

  const schema = await applicationDatabase.query<{ ready: boolean }>(
    `SELECT to_regclass('nova.people') IS NOT NULL
       AND to_regclass('nova_auth."rateLimit"') IS NOT NULL
       AND to_regclass('public.nova_schema_migrations') IS NOT NULL AS ready`,
  );
  if (schema.rows[0]?.ready !== true) throw new Error("NOVA_SCHEMA_NOT_READY");

  let migrationCount: number | null = null;
  let latestMigration: string | null = null;
  let migrationRoleChecked = false;
  if (migrationUrl) {
    const migrationDatabase = new pg.Pool({ connectionString: migrationUrl, max: 1 });
    try {
      const migrationRole = await migrationDatabase.query<{ current_user: string }>(
        "SELECT current_user",
      );
      if (migrationRole.rows[0]?.current_user === roleState.current_user) {
        throw new Error("MIGRATION_AND_APPLICATION_ROLES_MUST_DIFFER");
      }
      const ledger = await migrationDatabase.query<{ count: number; latest: string | null }>(
        `SELECT count(*)::int AS count, max(filename) AS latest
         FROM public.nova_schema_migrations`,
      );
      const state = ledger.rows[0];
      if (!state || state.latest !== expectedMigration) {
        throw new Error(`NOVA_MIGRATION_LEDGER_NOT_CURRENT_${state?.latest ?? "EMPTY"}`);
      }
      migrationCount = state.count;
      latestMigration = state.latest;
      migrationRoleChecked = true;
    } finally {
      await migrationDatabase.end();
    }
  } else if (supabaseProjectRef || supabaseAccessToken) {
    const ledger = await readSupabaseMigrationLedger();
    if (ledger.currentUser === roleState.current_user) {
      throw new Error("MIGRATION_AND_APPLICATION_ROLES_MUST_DIFFER");
    }
    if (ledger.latest !== expectedMigration) {
      throw new Error(`NOVA_MIGRATION_LEDGER_NOT_CURRENT_${ledger.latest ?? "EMPTY"}`);
    }
    migrationCount = ledger.count;
    latestMigration = ledger.latest;
    migrationRoleChecked = true;
  }

  console.info(JSON.stringify({
    applicationRole: roleState.current_user,
    applicationRoleOwnsNovaObjects: ownershipState.owns_nova_objects,
    applicationRoleCanAssumeNovaObjectOwner: ownershipState.can_assume_nova_object_owner,
    applicationRoleHasPrivilegedMembership: ownershipState.has_privileged_membership,
    migrationCount,
    latestMigration,
    migrationRoleChecked,
    status: migrationRoleChecked ? "ready" : "migration_verification_required",
  }));
  if (!migrationRoleChecked) process.exitCode = 2;
} finally {
  await applicationDatabase.end();
}
