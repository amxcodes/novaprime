const hostGuides = {
  "cloudflare-supabase": {
    title: "Cloudflare + Supabase Cloud",
    files: "cloudflare/worker.ts, cloudflare/wrangler.toml and cloudflare/wrangler.supabase-cron.toml",
    connect: "In Cloudflare → Workers & Pages → Create application → Import a repository, connect GitHub and this repository. Set the Worker root directory to the repository root. In Settings → Build, the deploy command must use the Wrangler file for the selected scheduler. A GitHub push then deploys NOVA code; it does not create the Supabase project, database role, secrets or domain.",
    publish: "After the database, Hyperdrive binding and Worker runtime settings are ready, publish the production branch from Workers Builds. Confirm its deploy command uses the Wrangler file selected above; that build publishes the API/UI and applies the selected Cron configuration. A first import may publish an incomplete bootstrap version—do not invite users until this deployment passes readiness.",
    runtimeSetup: [
      "Worker secrets: BETTER_AUTH_SECRET, NOVA_BACKGROUND_JOB_SECRET, NOVA_BOOTSTRAP_TOKEN and NOVA_SECRETS_ENCRYPTION_KEY. The database connection is a HYPERDRIVE binding, not DATABASE_URL.",
      "Plain Worker variables: BETTER_AUTH_URL and, when needed, NOVA_ALLOWED_ORIGINS/NOVA_PUBLIC_ORIGIN. NOVA_BACKGROUND_SCHEDULER is a non-secret value supplied by the selected Wrangler config; the Hyperdrive binding ID is also not a secret.",
      "Never add SUPABASE_ACCESS_TOKEN, MIGRATOR_DATABASE_URL, NOVA_APP_PASSWORD, NOVA_SUPABASE_POOLER_HOST, NOVA_SUPABASE_PROJECT_REF or NOVA_APPLICATION_DATABASE_ROLE to the Worker runtime. Keep migration credentials in the operator/migration path only.",
    ],
    database: "Create a Supabase Cloud project, then run bun run setup:supabase on a trusted computer. Before any write, it shows the exact project ref and requires you to type it to confirm; then it applies NOVA migrations, prepares the restricted nova_app role, runs preflight and writes generated values to a private local .env. For Cloudflare, in Supabase Connect → Direct connection, use that endpoint and the nova_app credentials from the file to create Hyperdrive; do not use the transaction-pooler DATABASE_URL because Hyperdrive provides pooling. Set Hyperdrive's origin connection limit within the Supabase project's connection budget and leave headroom for migrations and administration. Netlify/Vercel use that generated transaction-pooler DATABASE_URL. This command does not deploy or start the hosted API.",
    domain: "In Cloudflare, map the custom domain to the Worker and confirm HTTPS. Select that exact public URL in NOVA's first-run screen.",
    postSetup: "Better Auth is included in NOVA's API; Supabase Auth is not required. Configure email later in NOVA's Super Admin screen. Cloudflare supports HTTPS email providers (Gmail API OAuth2 or Resend), not SMTP/Nodemailer. Email credentials are encrypted in PostgreSQL; NOVA_SECRETS_ENCRYPTION_KEY remains a Worker secret.",
    schedulers: ["cloudflare", "supabase"],
  },
  "netlify-supabase": {
    title: "Netlify + Supabase Cloud",
    files: "netlify.toml, the NOVA local build plugin and scheduler-specific function entrypoints",
    connect: "In Netlify, choose Add new site → Import an existing project and connect this GitHub repository. Keep the repository root as the base directory so netlify.toml can find the API function and web folder. Published Git pushes deploy code; database setup and runtime secrets remain separate steps.",
    publish: "After the database and Netlify runtime settings are ready, publish the production branch (or use Deploys → Trigger deploy). The NOVA build plugin reads NOVA_BACKGROUND_SCHEDULER and selects the matching committed function directory: Netlify includes its scheduled function; Supabase includes only the API. Preview and branch builds never include a production schedule. A first import may publish an incomplete bootstrap version—do not invite users until this deployment passes readiness.",
    runtimeSetup: [
      "Mark only these as Netlify secrets, scoped to Functions: DATABASE_URL (the restricted nova_app URL), BETTER_AUTH_SECRET, NOVA_BOOTSTRAP_TOKEN, NOVA_SECRETS_ENCRYPTION_KEY and NOVA_BACKGROUND_JOB_SECRET. The build does not need these secrets.",
      "Add BETTER_AUTH_URL and NOVA_ALLOWED_ORIGINS as regular, non-secret Functions variables. NOVA_PUBLIC_ORIGIN is also regular and only needed for Netlify's native scheduler.",
      "Set NOVA_BACKGROUND_SCHEDULER to the selected value (netlify or supabase) as a regular, non-secret variable available to both Builds and Functions. Netlify scans secret-marked values against repository files; if this selector was marked secret, delete it and recreate it as a regular variable. Keep secret scanning enabled.",
      "Do not copy the whole .env to Netlify. Never add SUPABASE_ACCESS_TOKEN, MIGRATOR_DATABASE_URL, NOVA_APP_PASSWORD, NOVA_SUPABASE_POOLER_HOST, NOVA_SUPABASE_PROJECT_REF or NOVA_APPLICATION_DATABASE_ROLE; these are operator/bootstrap values, not hosted API settings.",
    ],
    database: "Create a Supabase Cloud project, then run bun run setup:supabase on a trusted computer. Before any write, it shows the exact project ref and requires you to type it to confirm; then it applies NOVA migrations, prepares the restricted nova_app role, runs preflight and writes the Node runtime transaction-pooler DATABASE_URL to a private local .env. This command does not deploy or start the hosted API.",
    domain: "In Netlify domain management, add the custom domain and confirm HTTPS. Select that exact public URL in NOVA's first-run screen.",
    postSetup: "Better Auth is included in NOVA's API; Supabase Auth is not required. Configure email later in NOVA's Super Admin screen. This Node runtime supports SMTP/Nodemailer, Gmail API OAuth2 or Resend. Email credentials are encrypted in PostgreSQL; NOVA_SECRETS_ENCRYPTION_KEY remains a Netlify runtime secret.",
    schedulers: ["netlify", "supabase"],
  },
  "vercel-supabase": {
    title: "Vercel + Supabase Cloud",
    files: "vercel.ts, web/vercel-config.ts and api/[...path].ts",
    connect: "In Vercel, choose Add New → Project and import this GitHub repository. Keep the repository root as the Root Directory so vercel.ts and api/[...path].ts are used. Set NOVA_BACKGROUND_SCHEDULER in Production before deploying; the config registers Vercel Cron only when its value is `vercel`. Previews must not share a production scheduler/database.",
    publish: "After the database and Vercel Production environment variables are ready, deploy the production branch (or redeploy its latest production deployment). This publishes the API/UI and evaluates vercel.ts: it creates the five-minute Cron only for `NOVA_BACKGROUND_SCHEDULER=vercel`, and creates none for `supabase`. A first import may publish an incomplete bootstrap version—do not invite users until this deployment passes readiness.",
    runtimeSetup: [
      "Keep these credentials private in Vercel Production: DATABASE_URL (restricted nova_app URL), BETTER_AUTH_SECRET, NOVA_BOOTSTRAP_TOKEN, NOVA_SECRETS_ENCRYPTION_KEY and NOVA_BACKGROUND_JOB_SECRET. Runtime code needs them; build steps do not.",
      "Set BETTER_AUTH_URL and NOVA_ALLOWED_ORIGINS as ordinary configuration values. NOVA_BACKGROUND_SCHEDULER is also non-secret; set it to the selected value (vercel or supabase) for Production. Add NOVA_PUBLIC_ORIGIN only when required by the selected trigger.",
      "Only when Vercel Cron is selected, add a separate private CRON_SECRET. Do not add it when Supabase Cron is selected.",
      "Do not copy the whole .env to Vercel. Never add SUPABASE_ACCESS_TOKEN, MIGRATOR_DATABASE_URL, NOVA_APP_PASSWORD, NOVA_SUPABASE_POOLER_HOST, NOVA_SUPABASE_PROJECT_REF or NOVA_APPLICATION_DATABASE_ROLE; these are operator/bootstrap values, not hosted API settings.",
    ],
    database: "Create a Supabase Cloud project, then run bun run setup:supabase on a trusted computer. Before any write, it shows the exact project ref and requires you to type it to confirm; then it applies NOVA migrations, prepares the restricted nova_app role, runs preflight and writes the Node runtime transaction-pooler DATABASE_URL to a private local .env. This command does not deploy or start the hosted API.",
    domain: "In Vercel project Domains, add the custom domain and confirm HTTPS. Select that exact public URL in NOVA's first-run screen.",
    postSetup: "Better Auth is included in NOVA's API; Supabase Auth is not required. Configure email later in NOVA's Super Admin screen. This Node runtime supports SMTP/Nodemailer, Gmail API OAuth2 or Resend. Email credentials are encrypted in PostgreSQL; NOVA_SECRETS_ENCRYPTION_KEY remains a Vercel runtime secret.",
    schedulers: ["vercel", "supabase"],
  },
  "vps-postgres": {
    title: "Docker / VPS / PostgreSQL",
    files: "docker/bootstrap.sh, docker/compose.yaml and .env.example",
    connect: "On the VPS, clone the GitHub repository over SSH and run bash docker/bootstrap.sh. A GitHub push alone does not update a VPS; an operator pulls the release and reruns the documented upgrade/deploy steps.",
    publish: "From the VPS repository checkout, follow the upgrade steps in docs/deployment-operations.md: apply pending migrations with the migration service, then recreate the API and maintenance services using the private .env. Do not replace or remove the PostgreSQL volume.",
    runtimeSetup: [
      "Keep the generated .env private on the VPS. It contains credentials; never commit it, send it to a browser, or copy it into a hosted provider.",
      "The API and maintenance worker use the restricted nova_app DATABASE_URL. Keep MIGRATOR_DATABASE_URL limited to the migration step/service; it must not become an API or worker connection.",
      "For Supabase-backed VPS installs, keep SUPABASE_ACCESS_TOKEN on the operator computer only. For direct PostgreSQL, use the external-database setup and separate owner/application URLs.",
    ],
    database: "The default Compose install runs PostgreSQL, applies migrations, starts the API and starts one maintenance worker. For an existing PostgreSQL server, use the external setup path with a separate migration-owner URL and restricted nova_app URL.",
    domain: "Point DNS to the VPS, terminate HTTPS at a reverse proxy, and expose only the proxy publicly. Select that exact public URL in NOVA's first-run screen.",
    postSetup: "Better Auth is included in NOVA's API. Configure email later in NOVA's Super Admin screen. This Node runtime supports SMTP/Nodemailer, Gmail API OAuth2 or Resend. Email credentials are encrypted in PostgreSQL; keep NOVA_SECRETS_ENCRYPTION_KEY in the VPS .env.",
    schedulers: ["vps"],
  },
  "local-docker": {
    title: "Local Docker",
    files: "docker/bootstrap.ps1, docker/bootstrap.sh and docker/compose.yaml",
    connect: "No GitHub or hosting account is needed. On Windows with Docker Desktop run powershell -ExecutionPolicy Bypass -File .\\docker\\bootstrap.ps1. With Docker only inside WSL, run bash docker/bootstrap.sh in an interactive WSL shell and keep that shell open.",
    publish: "The first bootstrap already starts the API and maintenance worker. After code changes, follow docs/deployment-operations.md to apply migrations and recreate the API/maintenance services; keep the existing PostgreSQL volume.",
    runtimeSetup: [
      "The bootstrap generates a private local .env containing database credentials and application secrets. Keep it on this computer and out of Git.",
      "Compose separates migration-owner access from the restricted nova_app API connection; do not expose the migration URL to the API or maintenance worker.",
      "Localhost links work only on this computer. Do not use them for people connecting from other devices.",
    ],
    database: "The local bootstrap starts PostgreSQL, applies migrations, creates the restricted app role, starts the API and starts one maintenance worker. The disposable QA runner is separate and must not replace or erase a normal local database.",
    domain: "Use http://localhost:3001 only on this computer. Do not configure invitations or password links for localhost if other people need to open them.",
    postSetup: "Better Auth and Console email are available locally. To test external email delivery, configure a supported provider in NOVA after first-run setup; credentials remain encrypted in the local database.",
    schedulers: ["vps"],
  },
};

const schedulerGuides = {
  cloudflare: {
    file: "cloudflare/wrangler.toml",
    actions: [
      {
        phase: "prepare",
        where: "Cloudflare → Workers & Pages → your NOVA Worker → Settings → Build",
        change: "Before the first production deploy (after database and runtime settings are ready), set the Deploy command to `npx wrangler@4.141.0 deploy --config cloudflare/wrangler.toml` and save it.",
        result: "That production build applies `cloudflare/wrangler.toml`, sets `NOVA_BACKGROUND_SCHEDULER=cloudflare`, and creates/updates the five-minute Cloudflare Cron Trigger.",
      },
      {
        phase: "prepare",
        where: "Cloudflare → your NOVA Worker → Settings → Variables & Secrets",
        change: "Set the Worker runtime secrets, including `NOVA_BACKGROUND_JOB_SECRET`.",
        result: "The protected tick can authenticate. Do not also create the Supabase Cron job for this database.",
      },
    ],
    verify: "In the Cloudflare dashboard, check the Worker’s Cron Trigger and invocation logs. Allow up to 15 minutes after a config change for propagation; then confirm /api/ready reports cloudflare and observe a successful tick before handoff.",
    warning: "The database-backed API and scheduled handler now pass locally in Workerd against disposable PostgreSQL. Wrangler's local direct connection bypasses Hyperdrive pooling, so local concurrency does not validate the production connection pool. Size and verify the real Hyperdrive origin pool against the selected database limit; no remote Hyperdrive binding, Cloudflare account deployment, or production Cron run has been verified.",
  },
  netlify: {
    file: "netlify/plugins/nova-functions and netlify/entrypoints/with-netlify-cron/nova-background-tick.mts",
    actions: [
      {
        phase: "prepare",
        where: "Netlify → Site configuration → Environment variables",
        change: "Set `NOVA_BACKGROUND_SCHEDULER=netlify` and make it available to Builds and Functions. After the database and runtime settings are ready, publish the production commit through the connected Netlify site.",
        result: "The committed build plugin selects the Netlify function directory, so that production deploy bundles NOVA's five-minute scheduled function. No source edit is needed.",
      },
      {
        phase: "prepare",
        where: "Netlify → Site configuration → Environment variables",
        change: "Set `NOVA_PUBLIC_ORIGIN` and `NOVA_BACKGROUND_JOB_SECRET` for Functions, then redeploy.",
        result: "The selected scheduled function targets this NOVA deployment and authenticates the protected tick.",
      },
    ],
    verify: "Netlify → Functions should show nova-background-tick as Scheduled. Use Run now, then inspect its response/logs and NOVA /api/ready. Preview deploys do not run the schedule automatically.",
    warning: "Netlify limits a scheduled function to 30 seconds; the adapter only forwards the protected tick and returns its result.",
  },
  vercel: {
    file: "vercel.ts, web/vercel-config.ts and api/[...path].ts",
    actions: [
      {
        phase: "prepare",
        where: "Vercel → Project → Settings → Environment Variables (Production)",
        change: "Set `NOVA_BACKGROUND_SCHEDULER=vercel` before the Production deploy.",
        result: "The repository's `vercel.ts` registers NOVA's five-minute Cron path during deployment.",
      },
      {
        phase: "prepare",
        where: "Vercel → Project → Settings → Environment Variables (Production)",
        change: "Also set `NOVA_BACKGROUND_JOB_SECRET` and a separate random `CRON_SECRET`, then deploy Production.",
        result: "Vercel authenticates its Cron request and NOVA's adapter forwards it to the protected tick.",
      },
    ],
    verify: "Vercel → Project → Settings → Cron Jobs should list the path; inspect its invocation logs and NOVA /api/ready. The adapter converts the authenticated provider GET into NOVA’s protected POST.",
    warning: "Vercel Hobby only supports once-daily Cron, so it cannot run NOVA’s five-minute maintenance schedule. Use Supabase Cron on Hobby, or use Vercel Cron on a plan that supports five-minute schedules. Vercel delivery is best-effort and does not retry failures; NOVA’s tick is idempotent, but monitor logs.",
  },
  supabase: {
    file: "scripts/supabase-scheduler.ts plus the selected host’s no-native-Cron setting",
    actions: [
      {
        phase: "prepare",
        where: "Hosting provider + GitHub repository",
        change: "After the native schedule is removed, set `NOVA_BACKGROUND_SCHEDULER=supabase` in the API host's private runtime settings and redeploy.",
        result: "The API accepts Supabase Cron requests. This step does not create the database job; the next operator command does that.",
      },
      {
        phase: "activate",
        where: "Trusted operator computer → NOVA repository checkout",
        change: "Only after the deployed API passes `/api/ready`, run `bun run supabase:scheduler` from the trusted checkout. It reads the project ref and tick secret from the private local `.env`, displays the project ref and requires you to type it exactly before any write. If the public URL is missing or still localhost, it asks for NOVA's deployed HTTPS origin. If the management token is not in the operator shell, it asks with hidden input.",
        result: "The command creates NOVA's named `pg_cron` + `pg_net` HTTP job and stores its URL/secret in Supabase Vault. It does not deploy the app or put the management token on the app host, and does not save the token to `.env`.",
      },
    ],
    verify: "Confirm one nova-background-tick job and that cron.job_run_details shows it ran. Then inspect net._http_response: require a 2xx status_code, timed_out=false, and blank error_msg; check the response body/API logs for tick completion and notification errors. Cron success alone only means pg_net queued the request. Confirm the app host’s /api/ready reports supabase.",
    warning: "Keep the management token on the operator computer; never put it in GitHub or a runtime host. The same NOVA_BACKGROUND_JOB_SECRET must be in the API host and Supabase Vault.",
  },
  vps: {
    file: "docker/compose.yaml (maintenance service)",
    actions: [
      {
        phase: "prepare",
        where: "VPS/local machine → private `.env` and Docker Compose",
        change: "Run the documented Compose bootstrap/upgrade and set `NOVA_BACKGROUND_SCHEDULER=vps` in the private `.env`.",
        result: "Compose starts the single `maintenance` service alongside NOVA. Do not also enable a cloud scheduler for this database.",
      },
    ],
    verify: "Check that exactly one maintenance service is running, review its logs, and confirm /api/ready reports vps. A second VPS/system timer would create a duplicate trigger.",
  },
};

export function deploymentGuide(pathId, schedulerId = "") {
  const host = hostGuides[pathId];
  if (!host) return null;
  if (!schedulerId) return { host, scheduler: null };
  if (!host.schedulers.includes(schedulerId)) return null;
  const scheduler = schedulerGuides[schedulerId];
  if (!scheduler) return null;
  if (schedulerId === "supabase") {
    const noNativeCron = {
      "cloudflare-supabase": {
        phase: "prepare",
        where: "Cloudflare → Workers & Pages → your NOVA Worker → Settings → Build",
        change: "Before the first production deploy (after database and runtime settings are ready), set Deploy command to `npx wrangler@4.141.0 deploy --config cloudflare/wrangler.supabase-cron.toml`.",
        result: "That Wrangler config sets `NOVA_BACKGROUND_SCHEDULER=supabase` and `crons = []`, so the deployment removes Cloudflare's trigger.",
      },
      "netlify-supabase": {
        phase: "prepare",
        where: "Netlify → Site configuration → Environment variables",
        change: "Set `NOVA_BACKGROUND_SCHEDULER=supabase` and make it available to Builds and Functions before the production deploy.",
        result: "The committed build plugin selects the API-only function directory. Netlify does not bundle or register its native scheduled function; no repository edit is needed.",
      },
      "vercel-supabase": {
        phase: "prepare",
        where: "Vercel → Project → Settings → Environment Variables (Production)",
        change: "Set `NOVA_BACKGROUND_SCHEDULER=supabase` before the Production deploy.",
        result: "`vercel.ts` sees the selected value at deploy time and publishes no Vercel Cron job.",
      },
    }[pathId];
    const selectedFiles = {
      "cloudflare-supabase": "cloudflare/wrangler.supabase-cron.toml and scripts/supabase-scheduler.ts",
      "netlify-supabase": "netlify/plugins/nova-functions and scripts/supabase-scheduler.ts",
      "vercel-supabase": "vercel.ts and scripts/supabase-scheduler.ts",
    }[pathId];
    const selectorAction = pathId === "cloudflare-supabase"
      ? {
          phase: "prepare",
          where: "Cloudflare Worker → Wrangler deployment configuration",
          change: "The selected `wrangler.supabase-cron.toml` sets `NOVA_BACKGROUND_SCHEDULER=supabase`. Do not set a conflicting dashboard variable; if one exists from an earlier setup, remove it before deploy. Keep the tick secret in Worker secrets.",
          result: "The deployed API accepts Supabase Cron requests, and the Wrangler config keeps Cloudflare's native Cron disabled.",
        }
      : pathId === "vercel-supabase"
        ? {
          phase: "prepare",
          where: "Vercel → Project → Settings → Environment Variables (Production)",
          change: "Also set `NOVA_BACKGROUND_JOB_SECRET` before the Production deploy.",
          result: "The Supabase request will authenticate to the deployed NOVA endpoint; the Vercel Cron stays absent.",
        }
        : {
          phase: "prepare",
          where: pathId === "netlify-supabase"
            ? "Netlify → Site configuration → Environment variables"
            : "Vercel → Project → Settings → Environment Variables (Production)",
          change: pathId === "netlify-supabase"
            ? "Set `NOVA_BACKGROUND_SCHEDULER=supabase` for Builds and Functions, and set `NOVA_BACKGROUND_JOB_SECRET` for Functions before the first production deploy."
            : "Set `NOVA_BACKGROUND_SCHEDULER=supabase` and `NOVA_BACKGROUND_JOB_SECRET` before the first production deploy.",
          result: pathId === "netlify-supabase"
            ? "The API accepts Supabase Cron requests; the build plugin selects an API-only function directory, so Netlify registers no native schedule."
            : "The deployed API accepts Supabase Cron requests; the selected provider configuration prevents its native schedule from being registered.",
        };
    return {
      host,
      scheduler: {
        ...scheduler,
        file: selectedFiles,
        actions: [...(noNativeCron ? [noNativeCron] : []), selectorAction, scheduler.actions[1]],
        warning: scheduler.warning,
      },
    };
  }
  return { host, scheduler };
}

export function deploymentSchedulerActions(pathId, schedulerId, stage, readinessPassed) {
  const phase = stage === 0 ? "prepare" : stage === 4 ? "activate" : null;
  if (!phase || (phase === "activate" && !readinessPassed)) return [];
  return deploymentGuide(pathId, schedulerId)?.scheduler?.actions.filter((action) => action.phase === phase) ?? [];
}
