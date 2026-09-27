const projectRef = process.env.NOVA_SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) throw new Error("SUPABASE_PROJECT_AND_TOKEN_REQUIRED");

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  body: JSON.stringify({ query: `
    SELECT max(filename) AS latest,
           to_regprocedure('nova.close_attendance_at_business_boundary(integer)') IS NOT NULL AS attendance_boundary,
           to_regprocedure('nova.close_work_sessions_at_business_boundary(integer)') IS NOT NULL AS work_boundary,
           to_regclass('nova.work_sessions') IS NOT NULL AS work_sessions_ready,
           EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'nova' AND table_name = 'work_sessions' AND column_name = 'office_id'
           ) AS office_snapshot
    FROM public.nova_schema_migrations
  ` }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`SUPABASE_AUDIT_FAILED_${response.status}`);
console.info(JSON.stringify(await response.json()));

export {};
