const hostGuides = {
  "cloudflare-supabase": {
    title: "Cloudflare + Supabase Cloud",
    files: "cloudflare/worker.ts, cloudflare/wrangler.supabase-cron.toml and scripts/supabase-scheduler.ts",
    connect: "In Cloudflare → Workers & Pages, import this GitHub repository and keep the repository root as the project root. The production deploy publishes NOVA's Worker and UI; it does not create the Supabase project, runtime secrets, Hyperdrive binding or domain.",
    publish: "After configuring the database binding and Worker secrets, deploy with `npx wrangler@4.141.0 deploy --config cloudflare/wrangler.supabase-cron.toml`. This profile uses Supabase Cron, so the selected Worker config publishes no Cloudflare Cron trigger. Do not invite users until `/api/health` and `/api/ready` pass.",
    runtimeSetup: [
      "Worker secrets: BETTER_AUTH_SECRET, NOVA_BACKGROUND_JOB_SECRET, NOVA_BOOTSTRAP_TOKEN and NOVA_SECRETS_ENCRYPTION_KEY. The database connection is the HYPERDRIVE binding, not DATABASE_URL.",
      "Plain Worker variables: BETTER_AUTH_URL and, when needed, NOVA_ALLOWED_ORIGINS. NOVA_BACKGROUND_SCHEDULER=supabase comes from the selected Wrangler config.",
      "Never add SUPABASE_ACCESS_TOKEN, MIGRATOR_DATABASE_URL, NOVA_APP_PASSWORD, NOVA_SUPABASE_PROJECT_REF or owner credentials to the Worker runtime.",
    ],
    database: "Create a Supabase Cloud project and run `bun run setup:supabase` on a trusted computer. Confirm the displayed project ref and type it exactly before any write. For Hyperdrive, use that project's Direct connection and the restricted nova_app credentials; do not use the transaction-pooler URL. Set Hyperdrive's origin connection limit within the database connection budget. Setup applies migrations and prepares the app role; it does not deploy the Worker.",
    domain: "Map the custom domain to the Cloudflare Worker and confirm HTTPS. Use that exact HTTPS origin in Worker settings and NOVA first-run setup.",
    postSetup: "Better Auth is included; Supabase Auth is not required. Email is optional and configured later by an authorized Super Admin. This runtime supports Gmail API OAuth2 or Resend; credentials are encrypted in PostgreSQL and the encryption key remains a Worker secret.",
    schedulers: ["supabase"],
  },
  "netlify-supabase": {
    title: "Netlify + Supabase Cloud",
    files: "netlify.toml, the NOVA function-selection plugin and scripts/supabase-scheduler.ts",
    connect: "In Netlify, import this GitHub repository and keep the repository root as the base directory. The connected production branch deploys NOVA; database setup, runtime secrets, and domain mapping remain separate steps.",
    publish: "Set NOVA_BACKGROUND_SCHEDULER=supabase as a non-secret value available to Builds and Functions. The NOVA build plugin selects the API-only function directory and includes no Netlify schedule. After the configured deploy, verify `/api/health` and `/api/ready` before activating Supabase Cron.",
    runtimeSetup: [
      "Mark only these as Netlify Function secrets: DATABASE_URL (restricted nova_app URL), BETTER_AUTH_SECRET, NOVA_BOOTSTRAP_TOKEN, NOVA_SECRETS_ENCRYPTION_KEY and NOVA_BACKGROUND_JOB_SECRET. The build does not need these credentials.",
      "Set BETTER_AUTH_URL, NOVA_ALLOWED_ORIGINS and NOVA_BACKGROUND_SCHEDULER=supabase as regular non-secret Function values. Make the scheduler value available to Builds and Functions.",
      "Never copy the whole .env or add SUPABASE_ACCESS_TOKEN, MIGRATOR_DATABASE_URL, NOVA_APP_PASSWORD, NOVA_SUPABASE_PROJECT_REF or owner credentials to Netlify.",
    ],
    database: "Create a Supabase Cloud project and run `bun run setup:supabase` on a trusted computer. Confirm the displayed project ref and type it exactly before any write. It applies NOVA migrations, prepares the restricted nova_app role, checks readiness and writes the generated transaction-pooler DATABASE_URL to the private local .env. It does not deploy the Netlify app.",
    domain: "Add the custom domain in Netlify and confirm HTTPS. Set the same exact HTTPS origin in Netlify's runtime settings and NOVA first-run setup.",
    postSetup: "Better Auth is included; Supabase Auth is not required. Email is optional and configured later by an authorized Super Admin. This Node runtime supports SMTP/Nodemailer, Gmail API OAuth2 or Resend.",
    schedulers: ["supabase"],
  },
  "vps-postgres": {
    title: "Self-hosted Docker + PostgreSQL",
    files: "docker/bootstrap.ps1, docker/bootstrap.sh, docker/compose.yaml and docker/nginx/default.conf",
    connect: "Use an always-on computer or server you control. Windows with Docker Desktop uses `powershell -ExecutionPolicy Bypass -File .\\docker\\bootstrap.ps1`; Linux uses `bash docker/bootstrap.sh`. The bootstrap creates a private .env and starts NOVA. Keep the published Compose port bound to loopback by default.",
    publish: "After an approved update, recreate the Compose services from the updated checkout. The migration service runs before the API; keep the existing PostgreSQL volume. A GitHub push alone does not update a self-hosted installation.",
    runtimeSetup: [
      "Keep the generated .env private on the machine. Do not commit it, send it to a browser, or expose it through GitHub.",
      "The API and maintenance worker use the restricted nova_app connection. MIGRATOR_DATABASE_URL is limited to setup and migration steps.",
      "Nginx is the only published Compose entry point. For access beyond localhost, put a TLS-terminating Nginx reverse proxy in front of the loopback-bound Compose port and configure NOVA's exact HTTPS origin.",
    ],
    database: "The default profile runs PostgreSQL 17 in Compose, applies canonical NOVA migrations, creates the restricted app role, and starts the API and one maintenance worker. An existing PostgreSQL server can be prepared with `bun run setup -- --mode external`, using separate owner and nova_app URLs.",
    domain: "For a private workstation, use localhost on that machine. For employee access, point DNS to the customer-controlled host, terminate HTTPS at a trusted Nginx proxy, and use that exact HTTPS origin in NOVA first-run setup.",
    postSetup: "Better Auth is included. Email is optional and configured later by an authorized Super Admin. Keep NOVA_SECRETS_ENCRYPTION_KEY private and preserve it across updates and database restores.",
    schedulers: ["vps"],
  },
};

const schedulerGuides = {
  supabase: {
    file: "scripts/supabase-scheduler.ts plus the selected host's no-native-Cron setting",
    actions: [
      {
        phase: "prepare",
        where: "The selected Netlify or Cloudflare production configuration",
        change: "Set NOVA_BACKGROUND_SCHEDULER=supabase and deploy the profile's no-native-Cron configuration. Do not create the Supabase job before the API is live and ready.",
        result: "The API accepts the Supabase tick while the host's native trigger remains disabled.",
      },
      {
        phase: "activate",
        where: "Trusted operator computer → NOVA repository checkout",
        change: "Only after `/api/ready` passes, run `bun run supabase:scheduler` from the trusted checkout. Confirm the displayed project ref and type it exactly before any write. The command uses hidden token input if needed and does not save the token to .env.",
        result: "The command creates NOVA's named pg_cron + pg_net job and stores its URL and tick secret in Supabase Vault. The management token stays on the operator computer.",
      },
    ],
    verify: "Confirm exactly one nova-background-tick row in cron.job and a successful run in cron.job_run_details. Inspect net._http_response for HTTP 2xx, timed_out=false and no error_msg; then confirm the tick completed in NOVA logs and `/api/ready` reports supabase.",
    warning: "Keep the Supabase management token on the operator computer. The same NOVA_BACKGROUND_JOB_SECRET must be configured in the API host and Supabase Vault.",
  },
  vps: {
    file: "docker/compose.yaml (maintenance service)",
    actions: [
      {
        phase: "prepare",
        where: "Customer-controlled machine → private .env and Docker Compose",
        change: "Run the Docker bootstrap/upgrade with NOVA_BACKGROUND_SCHEDULER=vps. Do not create a cloud schedule for this database.",
        result: "Compose starts one maintenance service alongside the API; it calls NOVA's protected background endpoint on the configured interval.",
      },
    ],
    verify: "Confirm exactly one maintenance service is running, its logs show a successful tick, and `/api/ready` reports vps. Do not add a second system timer or cloud scheduler.",
  },
};

export function deploymentGuide(pathId, schedulerId = "") {
  const host = hostGuides[pathId];
  if (!host) return null;
  if (!schedulerId) return { host, scheduler: null };
  if (!host.schedulers.includes(schedulerId)) return null;

  const scheduler = schedulerGuides[schedulerId];
  if (!scheduler) return null;
  if (schedulerId !== "supabase") return { host, scheduler };

  const preparation = {
    "cloudflare-supabase": {
      phase: "prepare",
      where: "Cloudflare → Workers & Pages → NOVA Worker → Build settings",
      change: "Deploy with `cloudflare/wrangler.supabase-cron.toml`; it sets the Supabase selector and `crons = []`.",
      result: "The Worker has no Cloudflare Cron trigger; Supabase Cron is the sole hosted trigger for this profile.",
    },
    "netlify-supabase": {
      phase: "prepare",
      where: "Netlify → Site configuration → Environment variables",
      change: "Set NOVA_BACKGROUND_SCHEDULER=supabase as a regular value for Builds and Functions before the production deploy.",
      result: "The build plugin publishes the API-only function directory and registers no Netlify schedule.",
    },
  }[pathId];
  return {
    host,
    scheduler: {
      ...scheduler,
      file: pathId === "cloudflare-supabase"
        ? "cloudflare/wrangler.supabase-cron.toml and scripts/supabase-scheduler.ts"
        : "netlify/plugins/nova-functions and scripts/supabase-scheduler.ts",
      actions: [...(preparation ? [preparation] : []), ...scheduler.actions],
    },
  };
}

export function deploymentSchedulerActions(pathId, schedulerId, stage, readinessPassed) {
  const phase = stage === 0 ? "prepare" : stage === 4 ? "activate" : null;
  if (!phase || (phase === "activate" && !readinessPassed)) return [];
  return deploymentGuide(pathId, schedulerId)?.scheduler?.actions.filter((action) => action.phase === phase) ?? [];
}
