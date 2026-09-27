import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const adminUrl = process.env.MIGRATOR_DATABASE_URL;
const appPassword = process.env.NOVA_APP_PASSWORD;
if (!adminUrl || !appPassword) throw new Error("LOCAL_POSTGRES_QA_CONFIGURATION_REQUIRED");

function requiredPoolSize(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name}_MUST_BE_BETWEEN_1_AND_${maximum}`);
  }
  return value;
}

const dbPoolMax = requiredPoolSize("NOVA_DB_POOL_MAX", 10, 50);
const authPoolMax = requiredPoolSize("NOVA_AUTH_POOL_MAX", 5, 25);
console.info(`QA runtime pool sizes: database=${dbPoolMax}, auth=${authPoolMax}`);

const parsedAdminUrl = new URL(adminUrl);
if (
  !["postgres:", "postgresql:"].includes(parsedAdminUrl.protocol) ||
  parsedAdminUrl.hostname !== "postgres-qa" ||
  parsedAdminUrl.port !== "5432" ||
  parsedAdminUrl.username !== "nova_migrator" ||
  parsedAdminUrl.pathname !== "/postgres"
) {
  throw new Error("LOCAL_POSTGRES_QA_REQUIRES_LOCAL_COMPOSE_POSTGRES");
}

type QueryPool = {
  query<T extends Record<string, unknown>>(query: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};
const pgModulePath = "../server/node_modules/pg/lib/index.js";
const pg = await import(pgModulePath) as unknown as {
  Pool: new (configuration: { connectionString: string; max: number }) => QueryPool;
};
const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
const databaseName = `nova_qa_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const identifier = `"${databaseName}"`;
function databaseUrl(name: string): URL {
  const url = new URL(adminUrl!);
  url.pathname = `/${name}`;
  return url;
}
const migrationUrl = databaseUrl(databaseName);
const applicationUrl = new URL(migrationUrl);
applicationUrl.username = "nova_app";
applicationUrl.password = appPassword;
const founderEmail = `nova-qa-founder-${randomUUID()}@example.test`;
const founderPassword = `NOVA-QA-${randomBytes(24).toString("base64url")}A9`;
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  MIGRATOR_DATABASE_URL: migrationUrl.toString(),
  DATABASE_URL: applicationUrl.toString(),
  NOVA_APPLICATION_DATABASE_ROLE: "nova_app",
  NOVA_BACKGROUND_SCHEDULER: "vps",
  NOVA_LIFECYCLE_FOUNDER_EMAIL: founderEmail,
  NOVA_LIFECYCLE_FOUNDER_PASSWORD: founderPassword,
  NOVA_SMOKE_DATABASE_URL: applicationUrl.toString(),
  NOVA_SMOKE_FIXTURE_DATABASE_URL: migrationUrl.toString(),
  NOVA_SMOKE_EMAIL: founderEmail,
  NOVA_SMOKE_PASSWORD: founderPassword,
};
const root = resolve(import.meta.dir, "..");

function run(
  label: string,
  script: string,
  args: string[] = [],
  environment: NodeJS.ProcessEnv = childEnvironment,
): void {
  console.info(`QA step: ${label}`);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: environment,
    stdio: "inherit",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`LOCAL_POSTGRES_QA_STEP_FAILED_${label}_${result.status ?? "SPAWN"}`);
  }
}

async function seedLegacyBillingRules(targetDatabaseUrl: string): Promise<void> {
  const migrationTest = new pg.Pool({ connectionString: targetDatabaseUrl, max: 1 });
  try {
    await migrationTest.query(`
      BEGIN;
      INSERT INTO nova.organisations (id, name)
      VALUES ('73333333-7333-4333-8333-733333333333', 'NOVA QA 0073 legacy billing upgrade');
      INSERT INTO nova.people (id, organisation_id, email, display_name)
      VALUES (
        '74444444-7444-4444-8444-744444444444',
        '73333333-7333-4333-8333-733333333333',
        'nova-qa-0073-upgrade@example.test',
        'NOVA QA Upgrade Founder'
      );
      INSERT INTO nova.person_status_periods (person_id, status, effective_at)
      VALUES ('74444444-7444-4444-8444-744444444444', 'active', now() - interval '1 day');
      GRANT nova_app TO CURRENT_USER;
      SELECT set_config('nova.user_id', '74444444-7444-4444-8444-744444444444', true);
      SELECT set_config('nova.organisation_id', '73333333-7333-4333-8333-733333333333', true);
      SET LOCAL ROLE nova_app;
      DO $qa$
      DECLARE
        v_actor_id uuid;
        v_organisation_id uuid;
        v_client_id uuid;
        v_workstream_id uuid;
        v_override_entry_id uuid;
        v_inherited_entry_id uuid;
      BEGIN
        v_actor_id := '74444444-7444-4444-8444-744444444444';
        v_organisation_id := '73333333-7333-4333-8333-733333333333';

        INSERT INTO nova.clients (organisation_id, name, created_by_person_id)
        VALUES (v_organisation_id, 'QA 0073 migration client', v_actor_id)
        RETURNING id INTO v_client_id;
        INSERT INTO nova.client_workstreams (organisation_id, client_id, name, created_by_person_id)
        VALUES (v_organisation_id, v_client_id, 'QA 0073 migration workstream', v_actor_id)
        RETURNING id INTO v_workstream_id;
        UPDATE nova.client_workstreams SET billing_policy_class = 'billable'
        WHERE id = v_workstream_id;

        INSERT INTO nova.task_catalog_entries (organisation_id, title, created_by_person_id)
        VALUES (v_organisation_id, 'QA 0073 active legacy override', v_actor_id)
        RETURNING id INTO v_override_entry_id;
        INSERT INTO nova.task_catalog_entries (organisation_id, title, created_by_person_id)
        VALUES (v_organisation_id, 'QA 0073 reset-to-inherit history', v_actor_id)
        RETURNING id INTO v_inherited_entry_id;

        INSERT INTO nova.client_workstream_task_billing_rules (
          organisation_id, client_workstream_id, task_catalog_entry_id, billing_class
        ) VALUES (v_organisation_id, v_workstream_id, v_override_entry_id, 'non_billable');

        INSERT INTO nova.client_workstream_task_billing_rules (
          organisation_id, client_workstream_id, task_catalog_entry_id, billing_class
        ) VALUES (v_organisation_id, v_workstream_id, v_inherited_entry_id, 'non_billable');
        UPDATE nova.client_workstream_task_billing_rules
        SET billing_class = NULL
        WHERE client_workstream_id = v_workstream_id
          AND task_catalog_entry_id = v_inherited_entry_id;
      END;
      $qa$;
      COMMIT;
    `);
  } finally {
    await migrationTest.end();
  }
}

async function verifyLegacyBillingRuleAudit(targetDatabaseUrl: string): Promise<void> {
  const migrationTest = new pg.Pool({ connectionString: targetDatabaseUrl, max: 1 });
  try {
    const { rows } = await migrationTest.query<{
      title: string;
      state: string;
      previousClass: string | null;
      previousRevision: string;
      actorId: string | null;
      setAt: string | null;
      futureClass: string | null;
    }>(`
      SELECT entries.title,
             events.details->>'previousState' AS state,
             events.details->>'previousClass' AS "previousClass",
             events.details->>'previousRevision' AS "previousRevision",
             events.details->>'previouslySetByPersonId' AS "actorId",
             events.details->>'previouslySetAt' AS "setAt",
             events.details->>'futurePolicyClass' AS "futureClass"
      FROM nova.audit_events events
      JOIN nova.client_workstreams workstreams ON workstreams.id = events.target_id
      JOIN nova.task_catalog_entries entries
        ON entries.id::text = events.details->>'taskCatalogEntryId'
      WHERE events.action = 'billing_policy.definition_rule_retired'
        AND workstreams.name = 'QA 0073 migration workstream'
        AND workstreams.client_id = (
          SELECT id FROM nova.clients WHERE name = 'QA 0073 migration client'
        )
    `);
    const active = rows.find((row) => row.title === "QA 0073 active legacy override");
    const inherited = rows.find((row) => row.title === "QA 0073 reset-to-inherit history");
    if (rows.length !== 2
      || active?.state !== "definition_override"
      || active.previousClass !== "non_billable"
      || active.previousRevision !== "1"
      || !active.actorId
      || !active.setAt
      || active.futureClass !== "billable"
      || inherited?.state !== "inherit_workstream_policy"
      || inherited.previousClass !== null
      || inherited.previousRevision !== "2"
      || !inherited.actorId
      || !inherited.setAt
      || inherited.futureClass !== "billable") {
      throw new Error("LEGACY_BILLING_POLICY_AUDIT_UPGRADE_FAILED");
    }
    const restored = await migrationTest.query<{
      title: string; billing_class: string | null; revision: number;
      set_by_person_id: string | null; set_at: Date | null;
    }>(`
      SELECT entries.title, rules.billing_class::text, rules.revision,
             rules.set_by_person_id, rules.set_at
      FROM nova.client_workstream_task_billing_rules rules
      JOIN nova.task_catalog_entries entries ON entries.id = rules.task_catalog_entry_id
      JOIN nova.client_workstreams workstreams ON workstreams.id = rules.client_workstream_id
      WHERE workstreams.name = 'QA 0073 migration workstream'
        AND workstreams.client_id = (
          SELECT id FROM nova.clients WHERE name = 'QA 0073 migration client'
        )
    `);
    const restoredActive = restored.rows.find((row) => row.title === "QA 0073 active legacy override");
    const restoredInherited = restored.rows.find((row) => row.title === "QA 0073 reset-to-inherit history");
    if (restored.rows.length !== 2
      || restoredActive?.billing_class !== "non_billable"
      || restoredActive.revision !== 1
      || !restoredActive.set_by_person_id
      || !restoredActive.set_at
      || restoredInherited?.billing_class !== null
      || restoredInherited.revision !== 2
      || !restoredInherited.set_by_person_id
      || !restoredInherited.set_at) {
      throw new Error("LEGACY_BILLING_RULE_RESTORE_UPGRADE_FAILED");
    }
    console.info("Migration 0074 restored active overrides and reset-to-default revisions from 0073 audit evidence.");
  } finally {
    await migrationTest.end();
  }
}

async function runBillingPolicyUpgradeRehearsal(): Promise<void> {
  const upgradeDatabaseName = `nova_upgrade_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const upgradeDatabaseIdentifier = `"${upgradeDatabaseName}"`;
  const upgradeUrl = databaseUrl(upgradeDatabaseName);
  const upgradeAppUrl = new URL(upgradeUrl);
  upgradeAppUrl.username = "nova_app";
  upgradeAppUrl.password = appPassword!;
  const upgradeEnvironment: NodeJS.ProcessEnv = {
    ...childEnvironment,
    MIGRATOR_DATABASE_URL: upgradeUrl.toString(),
    DATABASE_URL: upgradeAppUrl.toString(),
    NOVA_SMOKE_DATABASE_URL: upgradeAppUrl.toString(),
    NOVA_SMOKE_FIXTURE_DATABASE_URL: upgradeUrl.toString(),
  };
  let completedUpgrade = false;
  await admin.query(`CREATE DATABASE ${upgradeDatabaseIdentifier} OWNER nova_migrator`);
  try {
    run("billing-upgrade-migrations-through-0072", "server/src/migrate.ts", [
      "--through", "0072_workstream_task_billing_rules.sql",
    ], upgradeEnvironment);
    await seedLegacyBillingRules(upgradeUrl.toString());
    run("billing-upgrade-apply-0073-and-0074", "server/src/migrate.ts", [], upgradeEnvironment);
    await verifyLegacyBillingRuleAudit(upgradeUrl.toString());
    const connections = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1",
      [upgradeDatabaseName],
    );
    if (connections.rows[0]?.count !== "0") {
      throw new Error(`BILLING_UPGRADE_DATABASE_HAS_ACTIVE_CONNECTIONS_${upgradeDatabaseName}`);
    }
    await admin.query(`DROP DATABASE ${upgradeDatabaseIdentifier}`);
    completedUpgrade = true;
    console.info("Disposable 0072-to-0074 billing-policy upgrade database dropped after verification.");
  } finally {
    if (!completedUpgrade) {
      console.error(`BILLING_UPGRADE_DATABASE_PRESERVED_FOR_DIAGNOSIS_${upgradeDatabaseName}`);
    }
  }
}

let completed = false;
try {
  console.info(`Creating isolated PostgreSQL database ${databaseName}`);
  await admin.query(`CREATE DATABASE ${identifier} OWNER nova_migrator`);
  run("migrations", "server/src/migrate.ts");
  run("rollback-and-rls-fixtures", "server/src/database-test.ts");
  run("authenticated-lifecycle", "scripts/runtime-lifecycle-smoke.ts");
  run("attendance-wfh-leave-geofence", "scripts/runtime-specialized-smoke.ts");
  run("application-role-preflight", "scripts/deployment-preflight.ts");
  await runBillingPolicyUpgradeRehearsal();
  completed = true;
} finally {
  if (completed) {
    const connections = await admin.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1",
      [databaseName],
    );
    if (connections.rows[0]?.count === "0") {
      await admin.query(`DROP DATABASE ${identifier}`);
      console.info("Isolated PostgreSQL QA database dropped; shared nova database and volume were not touched.");
    } else {
      console.error(`LOCAL_POSTGRES_QA_CLEANUP_DEFERRED_ACTIVE_CONNECTIONS_${databaseName}`);
      process.exitCode = 1;
    }
  } else {
    console.error(`LOCAL_POSTGRES_QA_DATABASE_PRESERVED_FOR_DIAGNOSIS_${databaseName}`);
  }
  await admin.end();
}
