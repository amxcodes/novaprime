import { deploymentGuide, deploymentSchedulerActions } from "../../../../deployment-guide.js";
import {
  DEPLOYMENT_SCHEDULER_LABELS,
  DEPLOYMENT_SCHEDULERS,
  deploymentPathById,
} from "./catalog";
import type {
  DeploymentGuide,
  DeploymentGuideAction,
  DeploymentPath,
  DeploymentPathId,
  DeploymentProbe,
  DeploymentScheduler,
} from "./contracts";
import { deploymentProbePassed } from "./flow";

export interface DeploymentStageCopy {
  title: string;
  where: string;
  body: string;
  items: string[];
}

export interface DeploymentSchedulerOutcome {
  lives: string;
  where: string;
  action: string;
  automatic: string;
  activates: string;
  check: string;
  prepare?: string;
  prepareAutomatic?: string;
}

export interface DeploymentPlace {
  label: string;
  title: string;
  action: string;
  automatic: string;
  check: string;
}

export interface DeploymentActionRow {
  part: string;
  action: string;
  result: string;
}

export interface DeploymentWiringPresentation {
  summary: string;
  source: string;
  runtime: string;
  database: string;
  scheduler: string;
  places: DeploymentPlace[];
  rows: DeploymentActionRow[];
}

export interface DeploymentSchedulerPresentation {
  title: string;
  description: string;
  schedulerLabel: string;
  outcome: DeploymentSchedulerOutcome | null;
  file: string;
  actions: DeploymentGuideAction[];
  actionLead: string;
  emptyMessage: string;
  verify: string;
  warning?: string;
  expanded: boolean;
}

export interface DeploymentPresentation {
  selectedPath: DeploymentPath | null;
  current: DeploymentStageCopy;
  completed: boolean;
  needsProbe: boolean;
  probePassed: boolean;
  probeWarning: boolean;
  wiring: DeploymentWiringPresentation | null;
  schedulerPanel: DeploymentSchedulerPresentation | null;
  nextDisabled: boolean;
  completionDisabled: boolean;
}

const schedulerOutcomes: Readonly<Record<DeploymentScheduler, DeploymentSchedulerOutcome>> = {
  supabase: {
    lives: "Your Supabase project (not the hosting provider)",
    where: "The API host’s runtime settings, then your Supabase project (the guarded NOVA command creates the Cron job).",
    prepare: "In the API host’s private settings, select NOVA_BACKGROUND_SCHEDULER=supabase and deploy the configuration that disables its native schedule. Do not create the Supabase job yet.",
    prepareAutomatic: "The host deploy prepares the API to receive Supabase Cron and ensures its own schedule is off. NOVA shows the guarded Supabase command only after the live readiness check passes.",
    action: "Set NOVA_BACKGROUND_SCHEDULER=supabase on the API host and deploy its no-native-Cron config. Once NOVA /api/ready passes, run bun run supabase:scheduler from the trusted repository checkout and confirm the displayed Supabase project ref.",
    automatic: "That guarded command creates NOVA’s named pg_cron + pg_net job and stores its request URL/secret in Supabase Vault. No host-native schedule should remain enabled.",
    activates: "After NOVA passes readiness, the trusted-operator command creates the job in Supabase.",
    check: "Check cron.job_run_details, then net._http_response: require HTTP 2xx, timed_out=false, and no error_msg; inspect the tick body/API logs for notification errors. Cron success alone only means pg_net queued the call. NOVA /api/ready must report supabase.",
  },
  vps: {
    lives: "The always-on computer or server running NOVA",
    where: "The machine’s private .env and Docker Compose maintenance service.",
    action: "Run NOVA’s Docker bootstrap/upgrade with NOVA_BACKGROUND_SCHEDULER=vps in the private .env. Do not add a cloud schedule.",
    automatic: "Compose starts one maintenance worker beside the API; it calls NOVA locally on its normal interval.",
    activates: "The Docker Compose bootstrap starts one maintenance worker; no separate scheduler account or cloud job is used.",
    check: "One maintenance service is running and its logs show a successful tick; NOVA /api/ready reports vps.",
  },
};

function stageCopy(path: DeploymentPath | null, scheduler: DeploymentScheduler | "", stage: number, probe: DeploymentProbe | null): DeploymentStageCopy {
  const id = path?.id ?? "";
  const guide = (deploymentGuide(id, scheduler) as DeploymentGuide | null) ?? null;
  const instructions: DeploymentStageCopy[] = [
    {
      title: id === "vps-postgres" ? "Prepare your self-hosted machine and public address" : "Connect GitHub and choose the public address",
      where: id === "vps-postgres" ? "Your always-on desktop/server, Nginx reverse proxy, and public DNS." : "Your GitHub repository and selected hosting account; public DNS/domain settings are applied in the hosting provider or domain registrar.",
      body: id === "vps-postgres"
        ? "Run the Docker bootstrap on a machine that stays on. NOVA starts PostgreSQL, the API, Nginx and one maintenance worker. Use a TLS-terminating Nginx reverse proxy for access beyond this machine."
        : "Connect GitHub to the selected host and choose the public HTTPS address. The production deploy publishes NOVA with the host's native schedule disabled; after readiness, a separate operator command creates Supabase Cron.",
      items: [
        guide?.host.connect ?? "Choose a deployment path first.",
        `Repository configuration: ${guide?.host.files ?? "select a path first"}.`,
        scheduler
          ? `Profile scheduler: ${DEPLOYMENT_SCHEDULER_LABELS[scheduler]}. It runs in ${schedulerOutcomes[scheduler].lives ?? "the selected provider"}. The steps below show where and how to activate it after readiness.`
          : "This profile uses one fixed scheduler; activate it only after the runtime passes readiness.",
        id === "vps-postgres"
          ? "A GitHub push does not update a self-hosted machine; the operator stages a release and restarts the Compose services."
          : "A GitHub push deploys code only after you connect the repository. It does not create the database, set runtime secrets, or configure DNS.",
      ].filter(Boolean),
    },
    {
      title: "Apply the canonical database",
      where: id.endsWith("-supabase")
        ? "The selected Supabase project plus a trusted operator computer running the setup command."
        : "The self-hosted PostgreSQL machine and its Docker bootstrap or external-database setup.",
      body: guide?.host.database ?? "Run the documented database setup from a trusted operator computer. A GitHub deploy does not apply PostgreSQL migrations.",
      items: id.endsWith("-supabase")
        ? [
            "Create/select the Supabase Cloud project, then run `bun run setup:supabase` on a trusted computer. It applies migrations, prepares `nova_app`, checks preflight and writes generated values to the private local `.env`.",
            "A scoped Supabase token needs `database_pooling_config_read`, `database_read`, `database_write`, and `database_migrations_write` access to this project. If setup reports a 403, check both token scopes and your Supabase project role; a denied pooler lookup stops before database setup.",
            id === "cloudflare-supabase"
              ? "Create Cloudflare Hyperdrive from Supabase's Direct connection endpoint using the generated restricted `nova_app` credentials. Do not paste the transaction-pooler `DATABASE_URL` into Hyperdrive; Hyperdrive supplies pooling."
              : "Use the generated transaction-pooler `DATABASE_URL` for this Node API host. Keep the owner URL and Supabase management token on the trusted setup computer.",
            "This command prepares the database only. It does not deploy/start the API or create host secrets; use the next stage for runtime settings.",
            "Keep SUPABASE_ACCESS_TOKEN and migration-owner credentials on the trusted operator computer. Never put them in GitHub, a public build variable, or the runtime host.",
          ]
        : [
            "Use Docker Compose with the self-hosted bootstrap, or point external setup at PostgreSQL you administer. NOVA applies migrations using a separate owner connection.",
            "Keep the migration-owner URL private; the API and worker use only the restricted `nova_app` connection.",
          ],
    },
    {
      title: id === "vps-postgres" ? "Configure private self-hosted runtime" : "Put runtime settings in the hosting provider",
      where: id === "vps-postgres"
        ? "The private `.env` on the machine running NOVA."
        : `${path?.title ?? "Selected host"} server-side Variables & Secrets settings; Cloudflare also needs its Hyperdrive database binding.`,
      body: id === "vps-postgres"
        ? "Keep runtime values in the private `.env` on the host. Restrict access to the file and let Docker Compose pass values only to the services that need them."
        : "The database setup wrote generated values to the operator's private `.env`. Copy only the listed runtime values into the API host's server-side environment settings, marking only credentials as secrets. This browser never collects or transfers them.",
      items: [
        ...(guide?.host.runtimeSetup ?? ["Choose a deployment path first."]),
        id === "vps-postgres"
          ? "A GitHub push does not update the machine. The operator stages the release, applies migrations, then recreates the API and worker without removing the database volume."
          : "The connected hosting provider deploys code from GitHub; its private Variables/Secrets settings supply runtime credentials. Neither GitHub nor a browser checklist transfers them.",
        "After saving new host settings, redeploy or restart the runtime. Never add SUPABASE_ACCESS_TOKEN or migration-owner credentials there.",
        "Before inviting anyone, replace any `http://localhost:3001` default with your exact public HTTPS URL in `BETTER_AUTH_URL` and `NOVA_ALLOWED_ORIGINS`.",
        guide?.host.domain ?? "Map HTTPS and allowlist the exact public origin before configuring email.",
        id === "vps-postgres" ? "Keep the Compose web port bound to loopback and terminate public HTTPS at a trusted Nginx reverse proxy." : "",
      ].filter(Boolean),
    },
    {
      title: "Deploy and prove the runtime",
      where: "The deployed NOVA public HTTPS origin and its `/api/health` and `/api/ready` checks; domain mapping remains in the host provider.",
      body: "Publish/restart the configured runtime. Do not invite people until the configured release passes both health and readiness checks. The live check is read-only.",
      items: [
        guide?.host.publish ?? "Choose a deployment path first.",
        "GET /api/health returns an ordinary liveness response.",
        "GET /api/ready confirms the nova schema is present and reachable through the application role.",
        "If using a custom domain, finish DNS/HTTPS and set the exact same HTTPS origin in BETTER_AUTH_URL, NOVA_ALLOWED_ORIGINS, and NOVA first-run before enabling invitations. The host setting is changed in the provider; the canonical application origin is confirmed inside NOVA.",
      ],
    },
    {
      title: "Verify the profile scheduler",
      where: "The selected profile's provider configuration or Docker services.",
      body: scheduler === "supabase"
        ? probe?.checking !== true && probe?.health === true && probe?.ready === true && probe?.scheduler === "supabase"
          ? "The API is live with the Supabase selector and native hosting schedules disabled. The command below now creates the Supabase Cron job; after its first run, verify the pg_net HTTP response as well as Cron history."
          : "First run the live API/database check. The Supabase Cron creation command appears only after health, readiness, and this profile's scheduler setting all match."
        : "The self-hosted Compose worker runs the selected schedule. Verify one worker is active and that its tick reached NOVA successfully.",
      items: [
        scheduler ? `Selected profile scheduler: ${scheduler}. The setup steps below are what activate it.` : "Select a profile before deploying.",
        "All built-in triggers call the same NOVA background endpoint and runner; exactly one trigger should be active for this database.",
        scheduler === "supabase"
          ? "For an existing deployment, disable the old host schedule and deploy the no-native-Cron config before creating the Supabase job."
          : "Do not enable Supabase Cron or another external timer for this database while the Compose maintenance worker is active.",
        "Confirm the selected runtime value in /api/ready, then inspect the provider's own schedule and successful invocation. The checkbox is an operator attestation, not remote proof.",
        "Keep previews/staging on another database or with scheduling disabled.",
      ],
    },
    {
      title: "Use the existing first-run workflow",
      where: "NOVA's browser setup after runtime verification; Better Auth is built in, and email providers are configured later inside NOVA by an authorized Super Admin.",
      body: guide?.host.postSetup ?? "After infrastructure is ready, NOVA guides the owner through first-run setup.",
      items: [
        "Choose hour-based or scheduled attendance once; the choice is effective-dated and does not create a second timeline.",
        "Configure offices, timezone, working calendar and geofence before employee attendance begins.",
        "Create roles by permission, scope and operational policy before inviting the team.",
      ],
    },
    {
      title: "Finish with a safe handoff",
      where: "The one-time setup screen, NOVA's Super Admin settings, and the hosting provider's private secret store.",
      body: "The deployment operator should leave the owner with only the public setup URL and normal application access. Bootstrap and migration material must not remain in a hosted runtime.",
      items: [
        "Rotate or remove the one-time NOVA_BOOTSTRAP_TOKEN after founder setup.",
        "Remove SUPABASE_ACCESS_TOKEN and migration-owner credentials from the host after migrations and verification.",
        "Record the profile scheduler, public origin, backup owner and secret-rotation owner.",
      ],
    },
  ];
  return instructions[stage] ?? instructions[0];
}

function wiringPresentation(path: DeploymentPath, stage: number, scheduler: DeploymentScheduler | "", probe: DeploymentProbe | null): DeploymentWiringPresentation {
  const id = path.id;
  const hosted = id.endsWith("-supabase");
  const hostName = hosted ? path.title.split(" + ")[0] : "your self-hosted machine";
  const codeAction = hosted
    ? "Connect this repository to " + hostName + " and keep the repository root as the project root."
    : "Run the Docker bootstrap on an always-on computer or server you control.";
  const codeResult = hosted
    ? "After connection, a production-branch push builds and publishes NOVA’s UI and API. It does not migrate PostgreSQL or add secrets."
    : "Compose starts PostgreSQL, the API, Nginx and one maintenance worker. A GitHub push alone does not update this machine.";
  const databaseAction = hosted
    ? "On your trusted computer, run `bun run setup:supabase` for the intended project; NOVA displays its project ref and asks you to type it before applying migrations."
    : "Run the Compose bootstrap; for an existing PostgreSQL server, use the external-database setup with separate owner and `nova_app` URLs.";
  const databaseResult = hosted
    ? "NOVA applies migrations and creates the restricted app role, then writes generated values to your private local `.env`. This does not deploy the API."
    : "The same NOVA schema and PostgreSQL rules are installed; Compose also starts the API and one worker.";
  const runtimeAction = id === "cloudflare-supabase"
    ? "In Cloudflare Worker → Variables & Secrets, add runtime settings; create Hyperdrive from Supabase Connect → Direct using `nova_app` and bind its ID."
    : hosted
      ? "In " + hostName + " private Environment Variables, copy only runtime values (including the generated pooler `DATABASE_URL`) from your local `.env`, then redeploy."
      : "Keep the bootstrap-generated `.env` private on the machine running NOVA; Compose supplies it to the API and worker.";
  const runtimeResult = id === "cloudflare-supabase"
    ? "The Worker connects through Hyperdrive. Do not set raw `DATABASE_URL` or place the Supabase token/migration-owner credentials on Cloudflare."
    : hosted
      ? "The hosted API uses the restricted app connection. The Supabase token and migration-owner URL stay on your setup computer."
      : "The runtime and worker use the restricted app role; keep the migration-owner URL separate.";
  const originAction = "Map DNS/HTTPS at your host or domain provider; set the same exact public origin in runtime settings and NOVA first-run.";
  const originResult = "NOVA uses the canonical origin for sign-in, invitation, verification, reset, and notification links.";
  const emailAction = "You do not choose or configure a separate identity provider. After first-run, a permitted Super Admin may configure and activate an email adapter inside NOVA.";
  const emailResult = id === "cloudflare-supabase"
    ? "Better Auth is included. Email starts off; Cloudflare supports Gmail API or Resend, not SMTP/Nodemailer. Credentials are encrypted in PostgreSQL; the encryption key stays in Worker secrets."
    : "Better Auth is included. Email starts off; this Node runtime supports SMTP/Nodemailer, Gmail API, or Resend. Credentials are encrypted in PostgreSQL; the encryption key stays in runtime secrets.";
  const outcome = scheduler ? schedulerOutcomes[scheduler] : null;
  const supabaseActivationReady = stage === 4 && probe?.checking !== true && probe?.health === true && probe?.ready === true && probe?.scheduler === "supabase";
  const schedulerAction = !outcome
    ? "Use this profile's fixed scheduler and verify it reaches NOVA's protected background endpoint."
    : scheduler === "supabase" && !supabaseActivationReady ? outcome.prepare! : outcome.action;
  const schedulerResult = !outcome
    ? "Exactly one provider trigger must call NOVA's same protected background endpoint."
    : scheduler === "supabase" && !supabaseActivationReady ? outcome.prepareAutomatic! : outcome.automatic;
  const schedulerVerification = !outcome
    ? "Use the profile-specific instructions and confirm the job reaches NOVA."
    : scheduler === "supabase" && !supabaseActivationReady
      ? "First pass the live API/database readiness check; the separate Supabase job command is not available yet."
      : outcome.check;
  const runtimePlace = id === "cloudflare-supabase"
    ? "Cloudflare Worker → Variables & Secrets + Hyperdrive binding"
    : hosted ? hostName + " → private server-side Environment Variables" : "Private .env on the self-hosted machine; Docker Compose reads it";
  const places: DeploymentPlace[] = [
    { label: "1 · Code + API", title: hosted ? "GitHub → " + hostName : "Self-hosted Docker services", action: codeAction, automatic: codeResult, check: hosted ? "The host's production deployment history shows this commit published." : "Nginx reaches the API and /api/health passes." },
    { label: "2 · Database", title: hosted ? "Supabase Cloud" : "PostgreSQL 17", action: databaseAction, automatic: databaseResult, check: hosted ? "The setup command reports migrations and application-role preflight ready." : "The bootstrap reports healthy database/API readiness." },
    { label: "3 · Runtime + secrets", title: runtimePlace, action: runtimeAction, automatic: runtimeResult, check: hosted ? "The host has the variables/binding, then NOVA /api/health and /api/ready return 200." : "The private .env is present; NOVA /api/health and /api/ready return 200." },
    { label: "4 · Domain + links", title: "Host/domain settings, then NOVA", action: originAction, automatic: originResult, check: "The exact HTTPS origin opens NOVA and is the same value used in first-run setup." },
    { label: "5 · Authentication + email", title: id === "cloudflare-supabase" ? "NOVA Better Auth + optional Gmail API/Resend" : "NOVA Better Auth + optional SMTP/Gmail API/Resend", action: emailAction, automatic: emailResult, check: "Sign in with the founding account; if email is enabled, send and receive a test message before invitations." },
    { label: "6 · Background scheduler", title: scheduler ? DEPLOYMENT_SCHEDULER_LABELS[scheduler] : "Profile scheduler", action: schedulerAction, automatic: schedulerResult, check: schedulerVerification },
  ];
  const rows: DeploymentActionRow[] = [
    { part: "Code + API", action: codeAction, result: codeResult },
    { part: "PostgreSQL", action: databaseAction, result: databaseResult },
    { part: "Runtime access", action: runtimeAction, result: runtimeResult },
    { part: "Domain + links", action: originAction, result: originResult },
    { part: "Login + email", action: emailAction, result: emailResult },
    { part: "Background work", action: schedulerAction, result: schedulerResult + " Check: " + schedulerVerification },
  ];
  return {
    summary: "GitHub delivers hosted releases; " + (hosted ? hostName + " runs NOVA" : "your machine runs NOVA through Docker and Nginx") + "; PostgreSQL stores the data. NOVA includes login, roles and permissions. Email is optional. One scheduler runs NOVA’s background work.",
    source: hosted ? "GitHub repository" : "Customer-controlled machine",
    runtime: hosted ? hostName + " runs NOVA UI + API" : "Docker runs NOVA + PostgreSQL + worker behind Nginx",
    database: hosted ? "Supabase PostgreSQL" : "Customer PostgreSQL",
    scheduler: scheduler ? DEPLOYMENT_SCHEDULER_LABELS[scheduler] + " calls NOVA’s same protected background endpoint." : "This profile has one fixed scheduler for NOVA’s protected background endpoint.",
    places,
    rows,
  };
}

function schedulerPresentation(path: DeploymentPath, stage: number, scheduler: DeploymentScheduler | "", probePassed: boolean): DeploymentSchedulerPresentation | null {
  if (stage !== 0 && stage !== 4) return null;
  const guide = (deploymentGuide(path.id, scheduler) as DeploymentGuide | null) ?? null;
  const plan = guide?.scheduler ?? null;
  const actions = (deploymentSchedulerActions(path.id, scheduler, stage, probePassed) as DeploymentGuideAction[]) ?? [];
  const emptyMessage = stage === 0
    ? "This profile has one recommended trigger. The checklist does not change a provider account."
    : scheduler === "supabase"
      ? probePassed
        ? "The API is ready with the Supabase scheduler selector."
        : "First run the live API/database check above. Supabase Cron activation stays hidden until health and readiness pass."
      : probePassed
        ? "The Compose bootstrap starts one maintenance worker. Verify its tick succeeded; do not add another scheduler."
        : "First pass the API/database readiness check above; then verify one Compose maintenance worker and a successful tick.";
  const description = stage === 0
    ? "Each supported profile has one fixed scheduler. Hosted profiles create Supabase Cron after readiness; the self-hosted profile runs one Docker maintenance worker."
    : !probePassed
      ? "Run the live API/database check above first. The guide will show the apply or verify action only after health, readiness, and the runtime selector match."
      : scheduler === "supabase"
    ? "The Supabase setup command below creates the job in the exact project you confirm. First deploy NOVA with the Supabase selector and the host's native schedule disabled."
        : "The Docker bootstrap starts one maintenance worker. Verify its process and successful tick; do not add a cloud schedule.";
  const outcome = scheduler ? schedulerOutcomes[scheduler] : null;
  return {
    title: stage === 0 ? "Profile scheduler" : "Activate or verify the trigger",
    description,
    schedulerLabel: scheduler ? DEPLOYMENT_SCHEDULER_LABELS[scheduler] : "",
    outcome,
    file: plan?.file ?? "Provider configuration",
    actions,
    actionLead: stage === 0 ? "Prepare before the final production deploy:" : "Do this now, after readiness passes:",
    emptyMessage,
    verify: plan?.verify ?? "",
    warning: plan?.warning,
    expanded: stage === 4 && actions.length > 0,
  };
}

export function projectDeploymentPresentation(input: {
  pathId: DeploymentPathId | "";
  stage: number;
  scheduler: DeploymentScheduler | "";
  completed: Readonly<Record<number, boolean>>;
  probe: DeploymentProbe | null;
}): DeploymentPresentation {
  const selectedPath = deploymentPathById(input.pathId);
  const expectedScheduler = selectedPath ? DEPLOYMENT_SCHEDULERS[selectedPath.id] : "";
  const schedulerMismatch = (input.stage === 0 || input.stage === 4) && input.scheduler !== expectedScheduler;
  const needsProbe = input.stage === 3 || input.stage === 4;
  const probePassed = deploymentProbePassed(input.stage, input.scheduler, input.probe);
  const completed = input.completed[input.stage] === true;
  const current = stageCopy(selectedPath, input.scheduler, input.stage, input.probe);
  return {
    selectedPath,
    current,
    completed,
    needsProbe,
    probePassed,
    probeWarning: Boolean(input.probe && !input.probe.checking && !(input.probe.health && input.probe.ready && (input.stage !== 4 || input.probe.scheduler === input.scheduler))),
    wiring: selectedPath ? wiringPresentation(selectedPath, input.stage, input.scheduler, input.probe) : null,
    schedulerPanel: selectedPath ? schedulerPresentation(selectedPath, input.stage, input.scheduler, probePassed) : null,
    nextDisabled: !selectedPath || !completed || (needsProbe && !probePassed) || schedulerMismatch,
    completionDisabled: (needsProbe && !probePassed) || schedulerMismatch,
  };
}
