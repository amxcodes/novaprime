const projectRef = process.env.NOVA_SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) throw new Error("SUPABASE_CONFIGURATION_REQUIRED");

const query = `
SELECT
  (SELECT count(*) FROM public.nova_schema_migrations) AS migration_count,
  (SELECT max(filename) FROM public.nova_schema_migrations) AS latest,
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'nova' AND rowsecurity) AS rls_tables,
  (SELECT count(*) FROM pg_tables tables WHERE tables.schemaname = 'nova' AND tables.rowsecurity
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies policies
      WHERE policies.schemaname = tables.schemaname AND policies.tablename = tables.tablename
    )) AS rls_without_policy,
  (SELECT count(*) FROM pg_proc functions
    JOIN pg_namespace namespaces ON namespaces.oid = functions.pronamespace
    WHERE namespaces.nspname = 'nova' AND functions.prosecdef
      AND has_function_privilege('public', functions.oid, 'EXECUTE')) AS public_security_definers,
  (SELECT count(*) FROM pg_proc functions
    JOIN pg_namespace namespaces ON namespaces.oid = functions.pronamespace
    WHERE namespaces.nspname = 'nova'
      AND functions.proname IN ('public_origin_for_organisation', 'public_origin_for_identity', 'configured_public_origins')) AS origin_functions,
  (SELECT count(*) FROM nova.permissions WHERE key = 'organisation.public_origin.manage') AS origin_permission,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'nova' AND tablename = 'organisation_runtime_settings') AS origin_policies,
  (SELECT jsonb_build_object('superuser', rolsuper, 'bypassrls', rolbypassrls, 'createdb', rolcreatedb, 'createrole', rolcreaterole)
   FROM pg_roles WHERE rolname = 'nova_app') AS nova_app_role,
  (SELECT count(*) FROM pg_proc functions
   JOIN pg_namespace namespaces ON namespaces.oid = functions.pronamespace
   WHERE namespaces.nspname = 'nova'
     AND functions.proname IN ('public_origin_for_organisation', 'public_origin_for_identity', 'configured_public_origins')
     AND has_function_privilege('nova_app', functions.oid, 'EXECUTE')) AS origin_functions_granted_to_app,
  (SELECT count(*) FROM pg_constraint constraints
   JOIN pg_class relations ON relations.oid = constraints.conrelid
   JOIN pg_namespace namespaces ON namespaces.oid = relations.relnamespace
   WHERE namespaces.nspname = 'nova' AND relations.relname = 'organisation_runtime_settings'
     AND constraints.conname = 'organisation_runtime_settings_public_origin_check') AS origin_constraint,
  (SELECT count(*) FROM pg_trigger triggers
   JOIN pg_class relations ON relations.oid = triggers.tgrelid
   JOIN pg_namespace namespaces ON namespaces.oid = relations.relnamespace
   WHERE namespaces.nspname = 'nova' AND relations.relname = 'organisation_runtime_settings'
     AND triggers.tgname = 'organisation_runtime_settings_validate_actor') AS origin_actor_trigger;
`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    body: JSON.stringify({ query }),
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    method: "POST",
  },
);
if (!response.ok) throw new Error(`SUPABASE_QUERY_FAILED_${response.status}`);
console.log(JSON.stringify(await response.json()));
