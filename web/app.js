import {
  collectRolePermissionGrants,
  groupRolePermissionGrants,
  leastPrivilegedRoleScope,
  rolePresetDraft,
  rolePresets,
  uniqueRoleKey,
} from "./role-grants.js";
import {
  adminReadIssue,
  canShowAdminNavigation,
  canShowInviteNavigation,
  canViewAuthHandoffs,
  adminPermissionNoticeMessage,
  hasPermissionGrant,
  readOrError,
} from "./admin-read-state.js";
import { deploymentGuide, deploymentSchedulerActions } from "./deployment-guide.js";

const app = document.querySelector("#app");
let deploymentProbe = null;

const state = {
  adminData: null,
  adminRoleId: null,
  actorGrants: null,
  message: "",
  messageKind: "success",
  session: null,
  bootstrapToken: "",
  publicOriginConfigured: false,
  publicOrigin: "",
  taskCreateFingerprint: "",
  taskCreateRequestKey: "",
  deployment: {
    path: "",
    stage: 0,
    scheduler: "",
    completed: {},
  },
  view: null,
};

const deploymentPaths = [
  {
    id: "cloudflare-supabase",
    title: "Cloudflare + Supabase Cloud",
    badge: "Recommended",
    text: "Cloudflare hosts the NOVA Worker and client; Supabase Cloud provides managed PostgreSQL.",
  },
  {
    id: "netlify-supabase",
    title: "Netlify + Supabase Cloud",
    badge: "Hosted",
    text: "Netlify hosts the NOVA API and client; Supabase Cloud provides managed PostgreSQL.",
  },
  {
    id: "vercel-supabase",
    title: "Vercel + Supabase Cloud",
    badge: "Hosted",
    text: "Vercel hosts the NOVA API and client; Supabase Cloud provides managed PostgreSQL.",
  },
  {
    id: "vps-postgres",
    title: "Docker / VPS / PostgreSQL",
    badge: "Self-hosted",
    text: "Run the same API, migrations and maintenance loop on a server you control.",
  },
  {
    id: "local-docker",
    title: "Local Docker",
    badge: "Test",
    text: "A private laptop setup for evaluation and development with no hosted account required.",
  },
];

const deploymentStages = [
  { title: "Prerequisites", summary: "Choose the host, public URL and scheduler recipe." },
  { title: "Database readiness", summary: "Create PostgreSQL and apply NOVA migrations." },
  { title: "Secret handoff", summary: "Copy runtime values into the API host." },
  { title: "Deploy & runtime readiness", summary: "Publish the configured runtime and check health." },
  { title: "Scheduler verification", summary: "Create Supabase Cron after readiness, or verify the deploy-created trigger." },
  { title: "First-run setup", summary: "Create the founding workspace and attendance policy." },
  { title: "Handoff", summary: "Remove bootstrap material and give the owner the setup URL." },
];

const deploymentSchedulers = {
  "cloudflare-supabase": ["cloudflare", "supabase"],
  "netlify-supabase": ["netlify", "supabase"],
  "vercel-supabase": ["vercel", "supabase"],
  "vps-postgres": ["vps"],
  "local-docker": ["vps"],
};
const deploymentSchedulerLabels = {
  cloudflare: "Cloudflare runs the schedule (inside your Worker)",
  netlify: "Netlify runs the schedule (with your published app)",
  vercel: "Vercel runs the schedule (from a production deploy)",
  supabase: "Supabase runs the schedule (inside your database)",
  vps: "This server runs the schedule (Docker worker)",
};
// Stage 1 and 2 were reordered so runtime values are handed off only after
// database setup. Never reuse old completion attestations for new stage meanings.
const deploymentProgressStorageKey = "nova-deployment-progress-v2";

function supportedDeploymentSchedulers(pathId) {
  return deploymentSchedulers[pathId] || [];
}

function formatDeploymentText(value) {
  const escaped = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  return escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
}

function persistDeployment() {
  try {
    sessionStorage.setItem(deploymentProgressStorageKey, JSON.stringify(state.deployment));
  } catch {
    // Private browsing may deny storage; the in-memory checklist still works.
  }
}

function restoreDeployment() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(deploymentProgressStorageKey) || "null");
    if (!saved || typeof saved !== "object") return;
    const path = deploymentPaths.some((candidate) => candidate.id === saved.path) ? saved.path : "";
    const completed = {};
    if (saved.completed && typeof saved.completed === "object" && !Array.isArray(saved.completed)) {
      deploymentStages.forEach((_, index) => {
        if (saved.completed[index] === true) completed[index] = true;
      });
    }
    const scheduler = supportedDeploymentSchedulers(path).includes(saved.scheduler) ? saved.scheduler : "";
    if (saved.scheduler && !scheduler) delete completed[4];
    state.deployment = {
      path,
      stage: Number.isInteger(saved.stage) ? Math.max(0, Math.min(deploymentStages.length - 1, saved.stage)) : 0,
      scheduler,
      completed,
    };
  } catch {
    // Ignore malformed or unavailable browser storage.
  }
}

restoreDeployment();

const errorMessages = {
  ACCOUNT_NOT_OPERATIONAL: "This account is not currently allowed to perform that action.",
  ATTENDANCE_ALREADY_CLOSED: "Today's attendance is already closed.",
  ATTENDANCE_ALREADY_EXISTS: "Today's attendance has already been started.",
  ATTENDANCE_CALENDAR_REQUIRED: "An active working calendar is not configured for this office.",
  ATTENDANCE_HOLIDAY: "Today is an office holiday; attendance cannot be started.",
  ATTENDANCE_MODE_INVALID: "Choose a valid attendance mode.",
  ATTENDANCE_NON_WORKING_DAY: "Today is not a working day on the office calendar.",
  ATTENDANCE_SCHEDULE_REQUIRED: "This scheduled-attendance day has no shift configured yet.",
  ATTENDANCE_NOT_FOUND: "No open attendance exists for today.",
  ATTENDANCE_APPROVED_LEAVE: "Approved leave covers today; attendance cannot be started.",
  WORK_ON_APPROVED_LEAVE: "Approved leave covers today; productive work cannot be started.",
  ATTENDANCE_OFFICE_ASSIGNMENT_REQUIRED: "An active office assignment is required before attendance can start.",
  ATTENDANCE_CHECKOUT_RESULT_MISSING: "Attendance could not be closed safely. Try again.",
  ATTENDANCE_INPUT_INVALID: "Choose a valid attendance mode and location.",
  ATTENDANCE_GEOFENCE_NOT_CONFIGURED: "This office does not have an attendance geofence configured yet.",
  ATTENDANCE_LOCATION_REQUIRED: "Allow location access to check in at the office.",
  ATTENDANCE_LOCATION_ACCURACY_TOO_LOW: "Your location accuracy is too low for this office geofence.",
  ATTENDANCE_OUTSIDE_GEOFENCE: "You are outside the configured office attendance radius.",
  OFFICE_ASSIGNMENT_REQUIRED: "An active office assignment is required before attendance can start.",
  AUTHENTICATION_CONFIGURATION_REQUIRED: "NOVA authentication is not configured in this deployment yet.",
  AUTHENTICATION_REQUIRED: "Please sign in to continue.",
  AUTH_HANDOFF_NOT_AVAILABLE: "This secure handoff is expired, revoked, or already revealed. Generate a new one.",
  AUTH_HANDOFF_NOT_FOUND: "That secure handoff no longer exists.",
  EMAIL_CONNECTION_NOT_ACTIVE: "Set up and activate an email connection first, or use the secure system handoff in Admin.",
  EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME: "This deployment cannot use that provider from its runtime. Choose an HTTPS email provider such as Resend.",
  INVALID_PASSWORD: "The current password is not correct.",
  CALENDAR_ALREADY_EXISTS: "A working calendar with that name already exists.",
  CALENDAR_INPUT_INVALID: "Check the calendar name, office, effective date, and weekly rules.",
  CALENDAR_EFFECTIVE_DATE_INVALID: "A new calendar must begin after the office's latest calendar assignment.",
  EMAIL_CONNECTION_NOT_TESTED: "Test this connection successfully before activating it.",
  EMAIL_PROVIDER_DELIVERY_FAILED: "The provider could not send that email. Check its settings and try again.",
  EMAIL_CONNECTION_INPUT_INVALID: "Check the email connection details and try again.",
  PUBLIC_ORIGIN_INPUT_INVALID: "Enter an origin such as https://work.example.com without a path.",
  PUBLIC_ORIGIN_NOT_ALLOWED: "That origin is not approved by the deployment operator yet.",
  PUBLIC_ORIGIN_NOT_CONFIGURED: "Choose and save the public NOVA URL first. New email links and callbacks are blocked until it is set.",
  PUBLIC_ORIGIN_REQUIRED_WHILE_EMAIL_ACTIVE: "Deactivate the active email connection before clearing the public URL, so queued links cannot be generated for an unknown host.",
  PUBLIC_ORIGIN_CHANGE_BLOCKED_DURING_GMAIL_AUTH: "Finish or cancel the current Google connection before changing the public URL.",
  EMAIL_TEST_INPUT_INVALID: "Enter a valid recipient email address for the test.",
  FOUNDER_REGISTRATION_INPUT_INVALID: "Check the founder details and try again.",
  HOLIDAY_ALREADY_EXISTS: "That office already has a holiday on this date.",
  HOLIDAY_INPUT_INVALID: "Check the holiday name, office, and date.",
  GMAIL_OAUTH_CALLBACK_FAILED: "Google connection could not be completed. Try connecting it again.",
  GMAIL_OAUTH_CALLBACK_INVALID: "Google did not return a valid authorization result.",
  INVITATION_INVALID_OR_EXPIRED: "This invitation is no longer valid. Ask your administrator for a new one.",
  PERSON_INVITATION_INPUT_INVALID: "Enter a name and valid work email address.",
  PERSON_FREEZE_INPUT_INVALID: "That person could not be frozen with the supplied details.",
  ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED: "This NOVA deployment has already been set up.",
  ORGANISATION_BOOTSTRAP_TOKEN_INVALID: "The setup token was not accepted.",
  PASSWORDS_DO_NOT_MATCH: "The two new passwords do not match.",
  INVALID_ORIGIN: "This browser address is not trusted by NOVA. Check BETTER_AUTH_URL and NOVA_ALLOWED_ORIGINS in the hosting provider, then reload.",
  EMAIL_MISMATCH: "The requested email does not match the signed-in account. Refresh the page and try again.",
  EMAIL_ALREADY_VERIFIED: "This account is already verified. Sign out and sign in again.",
  VERIFICATION_EMAIL_NOT_ENABLED: "This deployment cannot send verification email. Ask an administrator to use the secure system handoff.",
  TOO_MANY_REQUESTS: "Too many attempts were made. Wait before trying again.",
  UNAUTHORIZED: "Your session expired or is not allowed to do that. Sign in again.",
  PERMISSION_DENIED: "Your account does not have permission for that action.",
  ROLE_ALREADY_EXISTS: "A role with that key or name already exists.",
  ROLE_NOT_FOUND: "That role no longer exists or cannot be changed.",
  ROLE_VERSION_CONFLICT: "Another administrator changed this role. Your changes were not saved; reopen the latest role and reapply them.",
  ROLE_INPUT_INVALID: "Check the role name, permissions, scopes, and policy choices.",
  ROLE_GRANT_REQUIRED: "Keep at least one scope for every selected permission, or turn that permission off.",
  ROLE_GRANT_TARGET_REQUIRED: "Choose a target for each office, department, client, workstream, or group scope.",
  ROLE_GRANT_DUPLICATE: "Remove duplicate permission scopes before saving this role.",
  PERSON_ONBOARDING_INPUT_INVALID: "Check the onboarding details and try again.",
  PERSON_NOT_FOUND: "That person could not be found.",
  PERSON_NOT_ONBOARDING: "This person is not currently waiting for onboarding.",
  PERSON_ALREADY_FROZEN: "This person is already frozen.",
  PERSON_NOT_FREEZABLE: "This person cannot be frozen in its current lifecycle state.",
  ACTIVE_ASSIGNMENTS_REMAIN: "Reassign or close this person's active assignments before offboarding.",
  PERSON_ALREADY_OFFBOARDING: "This person's offboarding has already started.",
  PERSON_ALREADY_EXITED: "This person has already exited.",
  OWNER_TRANSFER_INPUT_INVALID: "Choose a new owner and type TRANSFER SUPER ADMIN exactly.",
  OWNER_TRANSFER_TARGET_INVALID: "Choose a different person as the new owner.",
  TARGET_NOT_FOUND: "That ownership target is no longer available.",
  TARGET_NOT_OPERATIONAL: "The ownership target must be active or serving notice.",
  TARGET_ALREADY_OWNER: "That person is already a Super Admin.",
  SHIFT_ALREADY_EXISTS: "A shift with that name already exists.",
  SHIFT_INPUT_INVALID: "Check the shift times, break, grace period, and overtime setting.",
  OFFICE_NOT_FOUND: "The selected office is no longer available.",
  SHIFT_NOT_FOUND: "One of the selected shifts is no longer available.",
  WFH_NOT_ALLOWED: "Your current role does not allow working from home.",
  WFH_APPROVAL_REQUIRED: "Submit a WFH request and wait for approval before checking in from home.",
  WFH_REQUEST_CANCEL_BEFORE_OFFICE_CHECK_IN: "Cancel the pending WFH request first, then check in at the office.",
  WFH_ATTENDANCE_CONFLICT: "This request overlaps recorded attendance. Resolve that date before submitting or approving WFH.",
  WFH_REQUEST_INPUT_INVALID: "Check the WFH dates and reason.",
  WFH_REQUEST_OVERLAP: "Those dates overlap another WFH request.",
  WFH_REQUEST_NOT_PENDING: "This WFH request has already been decided.",
  WFH_REQUEST_NOT_CANCELLABLE: "This WFH request cannot be cancelled in its current state.",
  WFH_REVIEW_INPUT_INVALID: "Choose approve or reject and check the review reason.",
  OFFICE_GEOFENCE_INPUT_INVALID: "Enter valid coordinates and a radius between 10 and 100,000 metres.",
  WFH_POLICY_INPUT_INVALID: "Check the WFH target, effective dates, and policy choice.",
  WFH_POLICY_ALREADY_EXISTS: "An overlapping WFH policy already covers that target and period.",
  WFH_POLICY_TARGET_NOT_FOUND: "The selected WFH policy target is no longer available.",
  HISTORICAL_EXCEPTION_RESOLUTION_INVALID: "Enter a resolution note and choose resolved or dismissed.",
  HISTORICAL_EXCEPTION_NOT_OPEN: "That historical exception is already closed.",
  HISTORICAL_EXCEPTION_NOT_FOUND: "That historical exception no longer exists.",
  LEAVE_REQUEST_INPUT_INVALID: "Check the leave type, dates, portions, and reason.",
  LEAVE_REVIEW_INPUT_INVALID: "Choose approve or reject and check the review reason.",
  LEAVE_REQUEST_OVERLAP: "Those dates already have an open or approved leave request.",
  LEAVE_REQUEST_NOT_PENDING: "This leave request has already been decided.",
  LEAVE_REQUEST_NOT_CANCELLABLE: "This leave request cannot be cancelled in its current state.",
  LEAVE_ATTENDANCE_CONFLICT: "Attendance already exists on one of these dates; recover it before approving leave.",
  LEAVE_WORK_CONFLICT: "A running work timer covers one of these dates; stop it before approving leave.",
  LEAVE_CONFLICT_DECISION_INVALID: "Choose an outcome and provide a recovery note.",
  LEAVE_CONFLICT_NOT_FOUND: "No open attendance conflict remains for this request.",
  LEAVE_CONFLICT_REQUIRES_DECISION: "This conflict must be resolved from the leave request.",
  NOTIFICATION_EVENT_INVALID: "That notification event is not available.",
  NOTIFICATION_PREFERENCE_INPUT_INVALID: "Choose a valid notification preference.",
  NOTIFICATION_REQUIRED: "Required in-app notifications cannot be disabled.",
  CSRF_ORIGIN_INVALID: "This request was blocked because it did not come from the NOVA site. Refresh the page and try again.",
  TASK_NOT_CANCELLABLE: "That task cannot be cancelled in its current state.",
  TASK_CORRECTION_SOURCE_NOT_FOUND: "That source task is unavailable. Choose completed work you are authorized to view.",
  TASK_BILLING_CLASS_SERVER_ASSIGNED: "NOVA assigns billing automatically from the workstream policy. Task creators and reusable task definitions cannot choose a class.",
  TASK_BILLING_POLICY_NOT_CONFIGURED: "This client workstream needs an authorized billing policy before tasks can be created.",
  ASSIGNMENT_NOT_REASSIGNABLE: "That assignment cannot be reassigned in its current state.",
  PERSON_ALREADY_ASSIGNED: "This person already has an active assignment for the task. Choose another colleague or resolve that assignment first.",
  PERSON_NOT_ASSIGNABLE: "That person is inactive or is not eligible to receive work under their current role or status.",
  REVIEWER_REQUIRED: "Choose a reviewer before reassigning this review-required assignment.",
  ASSIGNMENT_REVIEWER_NOT_CHANGEABLE: "A completed or cancelled assignment cannot change its reviewer.",
  REVIEWER_EXCEPTION_INPUT_INVALID: "Choose an active reviewer and explain why an exception is needed.",
  ASSIGNMENT_NOT_EXCEPTION_ELIGIBLE: "This assignment cannot receive a reviewer exception in its current state.",
  SELF_REVIEW_NOT_ALLOWED: "The assignee cannot review their own work.",
  REVIEWER_NOT_ASSIGNABLE: "That reviewer is not active and cannot receive this review.",
  REVIEW_POLICY_REQUIRES_REVIEW: "Client work must have an eligible reviewer.",
  REVIEWER_REQUEST_INPUT_INVALID: "Choose an eligible reviewer and explain the request.",
  REVIEWER_REQUEST_ALREADY_PENDING: "A reviewer request is already waiting for a decision.",
  REQUEST_NOT_PENDING: "That request has already been decided.",
  REQUEST_RECIPIENT_ONLY: "Only the requested person can decide this request.",
  REQUEST_REQUESTER_ONLY: "Only the person who created this request can withdraw it.",
  REQUEST_EXPIRED: "That request has expired.",
  REQUEST_NOT_AUTHORIZED: "Only a participant in that request can resolve it.",
  ASSIGNMENT_NOT_REQUESTABLE: "This assignment cannot accept a reviewer request now.",
  HANDOVER_REQUEST_INPUT_INVALID: "Choose an active replacement and explain the handover.",
  HANDOVER_REQUEST_ALREADY_PENDING: "A handover request is already waiting for a decision.",
  ASSIGNMENT_NOT_HANDOVERABLE: "This assignment cannot be handed over in its current state.",
  SELF_HANDOVER_NOT_ALLOWED: "Choose another person for the handover.",
  REVIEWER_UNAVAILABLE: "The selected reviewer is no longer eligible; request a replacement.",
  NOTIFICATION_DELIVERY_NOT_FOUND: "That delivery row is no longer available.",
  ATTENDANCE_REQUIRED: "This correction must be covered by a closed attendance period.",
  TIMELINE_ADJUSTMENT_OVERLAP: "That time overlaps recorded work or another correction.",
  TIMELINE_ADJUSTMENT_INPUT_INVALID: "Enter a past time range, assignment, and reason.",
  TARGET_NOT_OPERATIONAL: "That person is not currently operational.",
  SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED: "Email delivery needs NOVA_SECRETS_ENCRYPTION_KEY in the server environment.",
  ATTENDANCE_POLICY_INPUT_INVALID: "Choose an attendance mode and a required duration between 1 minute and 24 hours.",
  ATTENDANCE_POLICY_DATE_INVALID: "Attendance policy changes must begin on or after the next available business date.",
};

function requestOptions(method, body, headers) {
  const options = {
    credentials: "include",
    headers: { accept: "application/json", ...(headers || {}) },
    method,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers["content-type"] = "application/json";
  }
  return options;
}

async function api(path, options) {
  const response = await fetch(path, options || requestOptions("GET"));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Better Auth reports stable `code`/`message` fields, while NOVA domain
    // routes report `error`. Preserve only the stable code for safe UI copy;
    // never display provider, SQL, or raw authentication exception details.
    const errorCode = payload.error || payload.code || "REQUEST_FAILED";
    const error = new Error(errorCode);
    error.code = errorCode;
    error.httpStatus = response.status;
    throw error;
  }
  return payload;
}

function setMessage(message, kind) {
  state.message = message;
  state.messageKind = kind || "success";
}

function errorText(error) {
  return errorMessages[error && error.code] ||
    "Something went wrong. Nothing was saved unless NOVA confirms it below.";
}

function routeView() {
  if (window.location.pathname === "/accept-invite" || window.location.pathname.endsWith("/accept-invite/")) {
    return "accept";
  }
  if (window.location.pathname === "/reset-password" || window.location.pathname.endsWith("/reset-password/")) {
    return "reset";
  }
  const view = new URLSearchParams(window.location.search).get("view");
  return ["setup", "login", "forgot", "deploy", "settings", "invite", "admin", "operations", "today", "work", "notifications"].includes(view) ? view : null;
}

function go(view) {
  const url = new URL("/", window.location.origin);
  if (view) url.searchParams.set("view", view);
  window.history.pushState({}, "", url);
  state.view = view;
  render();
}

function feedback() {
  return '<p id="feedback" class="notice" role="status" hidden></p>';
}

function showFeedback() {
  const element = app.querySelector("#feedback");
  if (!element || !state.message) return;
  element.hidden = false;
  element.className = "notice" + (state.messageKind === "error" ? " error" : state.messageKind === "warning" ? " warning" : "");
  element.textContent = state.message;
  state.message = "";
}

function attachNavigation() {
  app.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.nav === "home" ? null : button.dataset.nav));
  });
  const logout = app.querySelector("[data-action=logout]");
  if (logout) logout.addEventListener("click", signOut);
}

function renderLanding() {
  app.innerHTML =
    '<section class="hero">' +
      '<p class="eyebrow">People operations, built to move</p>' +
      '<h1>Start with a secure team foundation.</h1>' +
      '<p class="lede">NOVA keeps organisation rules in PostgreSQL and presents the same workflow on hosted or direct deployments.</p>' +
      '<div class="actions"><button class="button" type="button" data-nav="setup">Set up NOVA</button>' +
      '<button class="button secondary" type="button" data-nav="login">Sign in</button></div>' +
    '</section>' +
    '<section class="card-grid" aria-label="Available workflows">' +
      '<article class="card"><h2>First deployment</h2><p>Create the founding account and organisation using the one-time deployment setup token.</p><button class="button secondary" type="button" data-nav="setup">Begin setup</button></article>' +
      '<article class="card"><h2>Team member</h2><p>Use your invitation link to create your own password. NOVA never gives HR a password to share.</p><a class="button secondary" href="/accept-invite">Accept invitation</a></article>' +
      '<article class="card"><h2>Already set up</h2><p>Sign in to configure email delivery or invite people when your role permits it.</p><button class="button secondary" type="button" data-nav="login">Sign in</button></article>' +
      '<article class="card"><h2>Deployment assistant</h2><p>Walk through Cloudflare, Supabase, Netlify, Vercel, VPS, or local Docker without entering secrets in the browser.</p><button class="button secondary" type="button" data-nav="deploy">Open deployment guide</button></article>' +
    '</section>';
  attachNavigation();
}

function deploymentPath() {
  return deploymentPaths.find((candidate) => candidate.id === state.deployment.path) || null;
}

function deploymentWiringPanel() {
  const path = deploymentPath();
  if (!path) return "";
  const id = path.id;
  const hosted = id.endsWith("-supabase");
  const hostName = hosted ? path.title.split(" + ")[0] : id === "local-docker" ? "this computer" : "your VPS";
  const row = (part, action, result) => '<tr><th scope="row">' + formatDeploymentText(part) + '</th><td data-label="Your action">' + formatDeploymentText(action) + '</td><td data-label="What happens">' + formatDeploymentText(result) + '</td></tr>';

  const codeAction = hosted
    ? 'Connect this repository to ' + hostName + ' and keep the repository root as the project root.'
    : id === "local-docker"
      ? 'Run the Windows or WSL Docker bootstrap from this repository.'
      : 'Clone the repository on the VPS and run its Docker bootstrap.';
  const codeResult = hosted
    ? 'After connection, a production-branch push builds and publishes NOVA’s UI and API. It does not migrate PostgreSQL or add secrets.'
    : id === "local-docker"
      ? 'Compose starts PostgreSQL, the NOVA API, and one maintenance worker locally.'
      : 'A GitHub push alone does not update the VPS; pull/release the code and run the documented upgrade.';
  const databaseAction = hosted
    ? 'On your trusted computer, run `bun run setup:supabase` for the intended project; NOVA displays its project ref and asks you to type it before applying migrations.'
    : 'Run the Compose bootstrap; for an existing PostgreSQL server, use the external-database setup with separate owner and `nova_app` URLs.';
  const databaseResult = hosted
    ? 'NOVA applies migrations and creates the restricted app role, then writes generated values to your private local `.env`. This does not deploy the API.'
    : 'The same NOVA schema and PostgreSQL rules are installed; Compose also starts the API and one worker.';
  const runtimeAction = id === "cloudflare-supabase"
    ? 'In Cloudflare Worker → Variables & Secrets, add runtime settings; create Hyperdrive from Supabase Connect → Direct using `nova_app` and bind its ID.'
    : hosted
      ? 'In ' + hostName + ' private Environment Variables, copy only runtime values (including the generated pooler `DATABASE_URL`) from your local `.env`, then redeploy.'
      : 'Keep the bootstrap-generated `.env` private on the machine running NOVA; Compose supplies it to the API and worker.';
  const runtimeResult = id === "cloudflare-supabase"
    ? 'The Worker connects through Hyperdrive. Do not set raw `DATABASE_URL` or place the Supabase token/migration-owner credentials on Cloudflare.'
    : hosted
      ? 'The hosted API uses the restricted app connection. The Supabase token and migration-owner URL stay on your setup computer.'
      : 'The runtime and worker use the restricted app role; keep the migration-owner URL separate.';
  const originAction = id === "local-docker"
    ? 'Use `http://localhost:3001` on this computer only.'
    : 'Map DNS/HTTPS at your host or domain provider; set the same exact public origin in runtime settings and NOVA first-run.';
  const originResult = id === "local-docker"
    ? 'Local links work only on this device; use a public HTTPS origin before inviting remote employees.'
    : 'NOVA uses the canonical origin for sign-in, invitation, verification, reset, and notification links.';
  const emailAction = 'You do not choose or configure a separate identity provider. After first-run, a permitted Super Admin may configure and activate an email adapter inside NOVA.';
  const emailResult = id === "cloudflare-supabase"
    ? 'Better Auth is included. Email starts off; Cloudflare supports Gmail API or Resend, not SMTP/Nodemailer. Credentials are encrypted in PostgreSQL; the encryption key stays in Worker secrets.'
    : 'Better Auth is included. Email starts off; this Node runtime supports SMTP/Nodemailer, Gmail API, or Resend. Credentials are encrypted in PostgreSQL; the encryption key stays in runtime secrets.';
  const schedulerOutcome = deploymentSchedulerOutcome(state.deployment.scheduler);
  const supabaseActivationReady = state.deployment.stage === 4 &&
    deploymentProbe?.health === true && deploymentProbe?.ready === true && deploymentProbe?.scheduler === "supabase";
  const schedulerAction = !schedulerOutcome
    ? "Choose one trigger below. The scheduler card gives the exact place and action; selecting it here changes only this guide."
    : state.deployment.scheduler === "supabase" && !supabaseActivationReady
      ? schedulerOutcome.prepare
      : schedulerOutcome.action;
  const schedulerResult = !schedulerOutcome
    ? "Exactly one provider trigger must call NOVA's same protected background endpoint."
    : state.deployment.scheduler === "supabase" && !supabaseActivationReady
      ? schedulerOutcome.prepareAutomatic
      : schedulerOutcome.automatic;
  const schedulerVerification = !schedulerOutcome
    ? 'After choosing, use the provider-specific instructions and confirm the job reaches NOVA.'
    : state.deployment.scheduler === "supabase" && !supabaseActivationReady
      ? "First pass the live API/database readiness check; the separate Supabase job command is not available yet."
      : schedulerOutcome.check;
  const rows = [
    row("Code + API", codeAction, codeResult),
    row("PostgreSQL", databaseAction, databaseResult),
    row("Runtime access", runtimeAction, runtimeResult),
    row("Domain + links", originAction, originResult),
    row("Login + email", emailAction, emailResult),
    row("Background work", schedulerAction, schedulerResult + " Check: " + schedulerVerification),
  ].join("");
  const runtimePlace = id === "cloudflare-supabase"
    ? "Cloudflare Worker → Variables & Secrets + Hyperdrive binding"
    : hosted
      ? hostName + " → private server-side Environment Variables"
      : "Private .env on the computer/server; Docker Compose reads it";
  const place = (label, title, action, automatic, check) => '<article class="deployment-place"><span>' + formatDeploymentText(label) + '</span><strong>' + formatDeploymentText(title) + '</strong><p><b>You do:</b> ' + formatDeploymentText(action) + '</p><p><b>Then:</b> ' + formatDeploymentText(automatic) + '</p><p><b>Confirm:</b> ' + formatDeploymentText(check) + '</p></article>';
  return '<section class="deployment-places" aria-label="How deployment services connect"><h3>How your services connect</h3><p class="small">GitHub delivers code; ' + formatDeploymentText(hosted ? hostName + " runs NOVA" : id === "local-docker" ? "this computer runs NOVA" : "your server runs NOVA") + '; PostgreSQL stores the data. NOVA includes login, roles and permissions. Email is optional. One scheduler runs NOVA’s background work.</p><div class="deployment-architecture" aria-label="NOVA deployment connection"><span>' + formatDeploymentText(id === "local-docker" ? "This computer" : id === "vps-postgres" ? "VPS checkout" : "GitHub repository") + '</span><span aria-hidden="true">→</span><span>' + formatDeploymentText(id === "local-docker" ? "NOVA + PostgreSQL + worker" : id === "vps-postgres" ? "VPS runs NOVA + PostgreSQL" : hostName + " runs NOVA UI + API") + '</span><span aria-hidden="true">↔</span><span>' + formatDeploymentText(hosted ? "Supabase PostgreSQL" : id === "local-docker" ? "Local PostgreSQL" : "Your PostgreSQL") + '</span><span class="deployment-architecture-scheduler">' + formatDeploymentText(state.deployment.scheduler ? deploymentSchedulerLabels[state.deployment.scheduler] + " calls NOVA’s same protected background endpoint." : "Choose one scheduler; it calls NOVA’s same protected background endpoint.") + '</span></div><p class="deployment-provider-boundary"><strong>Important:</strong> This checklist does not log in to or change provider accounts. Follow the current step to apply the change there, then use its confirmation instructions.</p><details class="deployment-map-details"><summary>See where each part is configured</summary><div class="deployment-places-grid">' +
    place("1 · Code + API", hosted ? "GitHub → " + hostName : id === "local-docker" ? "This computer" : "VPS checkout", codeAction, codeResult, hosted ? "The host's production deployment history shows this commit published." : "Open NOVA locally or check the VPS deployment logs.") +
    place("2 · Database", hosted ? "Supabase Cloud" : id === "local-docker" ? "Local PostgreSQL" : "Your PostgreSQL", databaseAction, databaseResult, hosted ? "The setup command reports migrations and application-role preflight ready." : "The bootstrap reports healthy database/API readiness.") +
    place("3 · Runtime + secrets", runtimePlace, runtimeAction, runtimeResult, hosted ? "The host has the variables/binding, then NOVA /api/health and /api/ready return 200." : "The private .env is present; NOVA /api/health and /api/ready return 200.") +
    place("4 · Domain + links", "Host/domain settings, then NOVA", originAction, originResult, id === "local-docker" ? "Open localhost on this computer only." : "The exact HTTPS origin opens NOVA and is the same value used in first-run setup.") +
    place("5 · Authentication + email", id === "cloudflare-supabase" ? "NOVA Better Auth + optional Gmail API/Resend" : "NOVA Better Auth + optional SMTP/Gmail API/Resend", emailAction, emailResult, "Sign in with the founding account; if email is enabled, send and receive a test message before invitations.") +
    place("6 · Background scheduler", state.deployment.scheduler ? deploymentSchedulerLabels[state.deployment.scheduler] : "Choose one trigger below", schedulerAction, schedulerResult, schedulerVerification) +
    '</div><details class="deployment-wiring"><summary>Full action map: what you do and what it changes</summary><h3>Your action → what happens next</h3>' +
    '<div class="deployment-action-scroll" role="region" aria-label="Deployment action map" tabindex="0"><table class="deployment-action-map"><thead><tr><th scope="col">Part</th><th scope="col">Your action / where</th><th scope="col">What happens</th></tr></thead><tbody>' + rows +
    '</tbody></table></div></details></details></section>';
}

function deploymentSchedulerOutcome(scheduler) {
  const outcomes = {
    cloudflare: {
      lives: "Your Cloudflare Worker",
      where: "Cloudflare Worker → Settings → Build for the deploy command; Triggers shows the resulting Cron Trigger.",
      action: "In Cloudflare → Workers & Pages → your NOVA Worker → Settings → Build, set the production Deploy command to the Cloudflare Cron Wrangler config shown below, then deploy.",
      automatic: "That committed config sets the NOVA scheduler selector and five-minute Cron Trigger. Cloudflare registers it when the production deploy runs; do not also create Supabase Cron.",
      activates: "A production Worker deploy using the Cloudflare Cron Wrangler config registers the five-minute trigger.",
      check: "Cloudflare Cron Triggers and invocation logs, plus NOVA /api/ready. Allow up to 15 minutes after a config change for the trigger to propagate.",
    },
    netlify: {
      lives: "Your Netlify site",
      where: "Netlify → Site configuration → Environment variables; the published site’s Functions list shows the result.",
      action: "In Netlify → Site configuration → Environment variables, set NOVA_BACKGROUND_SCHEDULER=netlify for Builds and Functions, then publish the production branch.",
      automatic: "The NOVA build plugin selects and publishes the scheduled-function entrypoint. Netlify runs it on its schedule; previews do not get a production schedule.",
      activates: "The production build reads NOVA_BACKGROUND_SCHEDULER: `netlify` bundles the scheduled function; `supabase` bundles only the API. Preview and branch builds never include a production schedule.",
      check: "Netlify Functions and run history, plus NOVA /api/ready.",
    },
    vercel: {
      lives: "Your Vercel production project",
      where: "Vercel → Project Settings → Environment Variables → Production; Cron Jobs shows the result.",
      action: "In Vercel → Project Settings → Environment Variables → Production, set NOVA_BACKGROUND_SCHEDULER=vercel and CRON_SECRET, then redeploy Production.",
      automatic: "The deployed vercel.ts registers the five-minute Cron path. Vercel Hobby cannot run this cadence; choose Supabase Cron on Hobby.",
      activates: "The Production deploy reads NOVA_BACKGROUND_SCHEDULER in vercel.ts: it registers Vercel Cron only when the value is vercel, and registers none when Supabase Cron is selected. Vercel Hobby cannot run the required five-minute cadence.",
      check: "Vercel Cron Jobs and invocation logs, plus NOVA /api/ready.",
    },
    supabase: {
      lives: "Your Supabase project (not the hosting provider)",
      where: "The API host’s runtime settings, then your Supabase project (the guarded NOVA command creates the Cron job).",
      prepare: "In the API host’s private settings, select NOVA_BACKGROUND_SCHEDULER=supabase and deploy the configuration that disables its native schedule. Do not create the Supabase job yet.",
      prepareAutomatic: "The host deploy prepares the API to receive Supabase Cron and ensures its own schedule is off. NOVA shows the guarded Supabase command only after the live readiness check passes.",
      action: "Set NOVA_BACKGROUND_SCHEDULER=supabase on the API host and deploy its no-native-Cron config. Once NOVA /api/ready passes, run bun run supabase:scheduler from the trusted repository checkout and confirm the displayed Supabase project ref.",
      automatic: "That guarded command creates NOVA’s named pg_cron + pg_net job and stores its request URL/secret in Supabase Vault. No host-native schedule should remain enabled.",
      activates: "After NOVA passes readiness, the trusted-operator command creates the job in Supabase; selecting the radio does not create it.",
      check: "Check cron.job_run_details, then net._http_response: require HTTP 2xx, timed_out=false, and no error_msg; inspect the tick body/API logs for notification errors. Cron success alone only means pg_net queued the call. NOVA /api/ready must report supabase.",
    },
    vps: {
      lives: "The VPS/local server running NOVA",
      where: "The server’s private .env and Docker Compose maintenance service.",
      action: "Run NOVA’s Docker bootstrap/upgrade with NOVA_BACKGROUND_SCHEDULER=vps in the private .env. Do not add a cloud schedule.",
      automatic: "Compose starts one maintenance worker beside the API; it calls NOVA locally on its normal interval.",
      activates: "The Docker Compose bootstrap starts one maintenance worker; no separate scheduler account or cloud job is used.",
      check: "One maintenance service is running and its logs show a successful tick; NOVA /api/ready reports vps.",
    },
  };
  return outcomes[scheduler] || null;
}

function deploymentInstructions(stage) {
  const path = deploymentPath();
  const id = path ? path.id : "";
  const localOnly = id === "local-docker";
  const selectedScheduler = state.deployment.scheduler;
  const guide = deploymentGuide(id, selectedScheduler);
  const instructions = [
    {
      title: localOnly ? "Start NOVA on this computer" : id === "vps-postgres" ? "Prepare the VPS checkout and public address" : "Connect GitHub and choose the public address",
      where: localOnly ? "This computer / interactive WSL shell and the local Docker setup." : id === "vps-postgres" ? "Your VPS checkout, DNS/domain provider, and one scheduler choice." : "Your GitHub repository and selected hosting account; public DNS/domain settings are applied in the hosting provider or domain registrar.",
      body: localOnly
        ? "Choose the local Docker setup. Bootstrap creates PostgreSQL, the NOVA API and one maintenance worker on this computer; no GitHub or public domain is needed."
        : id === "vps-postgres"
          ? "Clone the repository on your server and choose the public HTTPS address. A GitHub push does not update the VPS; the operator pulls/releases code and Compose starts one maintenance worker."
          : selectedScheduler === "supabase"
            ? "Connect GitHub to the selected host and choose the public HTTPS address. Its production deploy publishes the NOVA API/UI with that host's native schedule disabled; after readiness, a separate operator command creates Supabase Cron."
            : "Choose the public HTTPS address and scheduler. Connect GitHub to the selected host; its configured production deploy publishes the NOVA API/UI and registers the selected native schedule.",
      items: [
        guide?.host.connect ?? "Choose a deployment path first.",
        `Repository configuration: ${guide?.host.files ?? "select a path first"}.`,
        selectedScheduler
          ? `Selected scheduler: ${deploymentSchedulerLabels[selectedScheduler]}. It runs in ${deploymentSchedulerOutcome(selectedScheduler)?.lives ?? "the selected provider"}. The scheduler steps below show where and how to activate it; selecting this option only changes this browser checklist.`
          : "Choose one scheduler below before deploying; the first production deploy must use the matching provider configuration.",
        id === "local-docker"
          ? "No GitHub or hosting account is needed; the local bootstrap starts services on this computer."
          : id === "vps-postgres"
            ? "A GitHub push does not update a VPS; the operator pulls/releases code on that server."
            : "A GitHub push deploys code only after you connect the repository. It does not create the database, set runtime secrets, or configure DNS.",
      ].filter(Boolean),
    },
    {
      title: "Apply the canonical database",
      where: id === "cloudflare-supabase" || id === "netlify-supabase" || id === "vercel-supabase"
        ? "The selected Supabase project plus a trusted operator computer running the setup command."
        : "The local/VPS PostgreSQL host and its Docker bootstrap or external-database setup.",
      body: guide?.host.database ?? "Run the documented database setup from a trusted operator computer. A GitHub deploy does not apply PostgreSQL migrations.",
      items: id.endsWith("-supabase")
        ? [
            "Create/select the Supabase Cloud project, then run `bun run setup:supabase` on a trusted computer. It applies migrations, prepares `nova_app`, checks preflight and writes generated values to the private local `.env`.",
            id === "cloudflare-supabase"
              ? "Create Cloudflare Hyperdrive from Supabase's Direct connection endpoint using the generated restricted `nova_app` credentials. Do not paste the transaction-pooler `DATABASE_URL` into Hyperdrive; Hyperdrive supplies pooling."
              : "Use the generated transaction-pooler `DATABASE_URL` for this Node API host. Keep the owner URL and Supabase management token on the trusted setup computer.",
            "This command prepares the database only. It does not deploy/start the API or create host secrets; use the next stage for runtime settings.",
            "Keep SUPABASE_ACCESS_TOKEN and migration-owner credentials on the trusted operator computer. Never put them in GitHub, a public build variable, or the runtime host.",
          ]
        : id === "local-docker"
          ? [
              "Run the local Docker bootstrap. It creates the private `.env`, starts PostgreSQL, applies migrations and starts NOVA with the restricted application role.",
              "No Supabase project, access token, GitHub account, or hosted secret store is needed for this local-only path.",
            ]
          : [
              "Use Docker Compose with the VPS bootstrap, or point the external setup at the PostgreSQL server you administer. The setup applies migrations using a separate owner connection.",
              "Keep the migration-owner URL private; the deployed API and worker use only the restricted `nova_app` connection.",
            ],
    },
    {
      title: id === "local-docker"
        ? "Keep local runtime settings private"
        : id === "vps-postgres"
          ? "Configure private VPS runtime"
          : "Put runtime settings in the hosting provider",
      where: id === "local-docker" || id === "vps-postgres"
        ? "The private `.env` on the computer/server running NOVA."
        : `${path?.title ?? "Selected host"} server-side Variables & Secrets settings; Cloudflare also needs its Hyperdrive database binding.`,
      body: id === "local-docker"
        ? "The local bootstrap creates a private `.env` and Docker Compose passes it to NOVA. Keep it on this computer; no hosted secret store is involved."
        : id === "vps-postgres"
          ? "Keep runtime values in the private `.env` on the VPS. Restrict access to the file and let Docker Compose pass the values to NOVA; no third-party secret store is involved."
          : "The database setup wrote generated values to the operator's private `.env`. Copy only runtime values into the selected API host's server-side secret store; this browser never collects them.",
      items: [
        guide?.host.secrets ?? "Choose a deployment path first.",
        id === "local-docker"
          ? "Docker Compose reads the private `.env` on this computer; no GitHub deployment is involved."
          : id === "vps-postgres"
            ? "A GitHub push does not update a VPS. The operator pulls/releases code on the server and restarts the deployment."
            : "The connected hosting provider deploys code from GitHub; its private Variables/Secrets settings supply runtime credentials. Neither GitHub nor a browser checklist transfers them.",
        "After saving new host settings, redeploy or restart the runtime. Never add SUPABASE_ACCESS_TOKEN or migration-owner credentials there.",
        id === "local-docker"
          ? ""
          : "Before inviting anyone, replace any `http://localhost:3001` default with your exact public HTTPS URL in `BETTER_AUTH_URL` and `NOVA_ALLOWED_ORIGINS`.",
        guide?.host.domain ?? "Map HTTPS and allowlist the exact public origin before configuring email.",
        id === "vps-postgres" ? "Set NOVA_TRUST_PROXY_HEADERS=true only behind a reverse proxy that strips and rewrites forwarded headers." : "",
      ].filter(Boolean),
    },
    {
      title: "Deploy and prove the runtime",
      where: "The deployed NOVA public HTTPS origin and its `/api/health` and `/api/ready` checks; domain mapping remains in the host provider.",
      body: "Now publish/restart the configured production runtime. Host-native schedules take effect as part of this deployment. An early import build is only a bootstrap; do not invite people until this final configured build passes both checks. The live check is read-only.",
      items: [
        guide?.host.publish ?? "Choose a deployment path first.",
        "GET /api/health returns an ordinary liveness response.",
        "GET /api/ready confirms the nova schema is present and reachable through the application role.",
        "If using a custom domain, finish DNS/HTTPS and set the exact same HTTPS origin in BETTER_AUTH_URL, NOVA_ALLOWED_ORIGINS, and NOVA first-run before enabling invitations. The host setting is changed in the provider; the canonical application origin is confirmed inside NOVA.",
      ],
    },
    {
      title: "Verify exactly one scheduler",
      where: "The selected provider/repository actions shown below. Choosing the radio option only changes this checklist; it does not change a provider account.",
      body: selectedScheduler === "supabase"
        ? deploymentProbe?.health === true && deploymentProbe?.ready === true && deploymentProbe?.scheduler === "supabase"
          ? "The API is live with the Supabase selector and native hosting schedules disabled. The command below now creates the Supabase Cron job; after its first run, verify the pg_net HTTP response as well as Cron history."
          : "First run the live API/database check. The Supabase Cron creation command appears only after health, readiness, and the selected scheduler all match."
        : "The host-native trigger is activated by the configured production deploy in the previous step. This stage verifies the provider has exactly one active trigger and that its invocation reached NOVA successfully.",
      items: [
        selectedScheduler ? `Selected: ${selectedScheduler}. The radio selected the instructions only; the provider configuration/command below is what applies it.` : "Select a scheduler in Prerequisites before deploying.",
        "All built-in triggers call the same NOVA background endpoint and runner; exactly one trigger should be active for this database.",
        selectedScheduler === "supabase"
          ? "For an existing deployment, disable the old host schedule and deploy the no-native-Cron config before creating the Supabase job."
          : "When switching from Supabase Cron, run `bun run supabase:scheduler:disable` from a trusted operator checkout before enabling the new trigger. A radio change alone never switches a live schedule.",
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
        "Record the selected scheduler, public origin, backup owner and secret-rotation owner.",
      ],
    },
  ];
  return instructions[stage] || instructions[0];
}

async function checkDeploymentEndpoint(path, expectedStatus) {
  try {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json().catch(() => null);
    return response.ok && result?.service === "nova-api" && result.status === expectedStatus
      ? result
      : false;
  } catch {
    return false;
  }
}

function renderDeployment() {
  const current = deploymentInstructions(state.deployment.stage);
  const selected = deploymentPath();
  const completed = state.deployment.completed[state.deployment.stage] === true;
  const needsProbe = state.deployment.stage === 3 || state.deployment.stage === 4;
  const probePassed = state.deployment.stage === 3
    ? deploymentProbe?.health === true && deploymentProbe?.ready === true
    : state.deployment.stage === 4
      ? deploymentProbe?.health === true && deploymentProbe?.ready === true && deploymentProbe?.scheduler === state.deployment.scheduler
      : true;
  const stageList = deploymentStages.map((stage, index) =>
    '<button class="deployment-stage' + (index === state.deployment.stage ? ' active' : '') + (state.deployment.completed[index] ? ' complete' : '') + '" type="button" data-deployment-stage="' + index + '">' +
      '<span class="deployment-stage-number">' + (state.deployment.completed[index] ? '✓' : String(index + 1)) + '</span>' +
      '<span><strong>' + stage.title + '</strong><small>' + stage.summary + '</small></span>' +
    '</button>'
  ).join('');
  const pathCards = deploymentPaths.map((path) =>
    '<button class="deployment-path' + (path.id === state.deployment.path ? ' selected' : '') + '" type="button" data-deployment-path="' + path.id + '">' +
      '<span class="status">' + path.badge + '</span><strong>' + path.title + '</strong><span>' + path.text + '</span>' +
    '</button>'
  ).join('');
  const availableSchedulers = new Set(supportedDeploymentSchedulers(state.deployment.path));
  const schedulerChoices = Object.entries(deploymentSchedulerLabels)
    .filter(([value]) => availableSchedulers.has(value))
    .map(([value, label]) => '<label class="check deployment-scheduler"><input type="radio" name="deploymentScheduler" value="' + value + '"' + (state.deployment.scheduler === value ? ' checked' : '') + '> ' + label + '</label>')
    .join('');
  const schedulerPlan = deploymentGuide(state.deployment.path, state.deployment.scheduler)?.scheduler;
  const schedulerOutcome = deploymentSchedulerOutcome(state.deployment.scheduler);
  const schedulerActions = deploymentSchedulerActions(
    state.deployment.path,
    state.deployment.scheduler,
    state.deployment.stage,
    probePassed,
  );
  const schedulerEmptyPhase = state.deployment.stage === 0
    ? "Select a trigger to see its configuration. Nothing is changed in a provider by selecting it."
    : state.deployment.path === "vercel-supabase" && state.deployment.scheduler === "supabase"
      ? probePassed
        ? "Vercel's Production config is confirmed for the Supabase selector. Run the separate Supabase setup command below, then check Supabase Cron history."
        : "Set NOVA_BACKGROUND_SCHEDULER=supabase in Vercel Production before deploying; vercel.ts then publishes no Vercel Cron. Run the readiness check before creating Supabase Cron."
      : state.deployment.scheduler === "supabase"
      ? probePassed
        ? "The API is ready with the Supabase scheduler selector."
        : "First run the live API/database check above. The Supabase Cron creation command stays hidden until health, readiness, and the selected runtime value all pass."
      : state.deployment.scheduler === "vps"
        ? probePassed
          ? "The Compose bootstrap starts one maintenance worker. Verify that exactly one worker is running and that its tick succeeded; do not add a second scheduler."
          : "First pass the API/database readiness check above; then verify exactly one Compose maintenance worker and a successful tick."
        : probePassed
          ? "The selected trigger is registered by the production deployment. Do not create a second schedule; verify the provider shows one active trigger and a successful tick."
          : "First pass the API/database readiness check above; then verify the deployment-registered trigger and a successful tick.";
  const schedulerPanel = state.deployment.stage === 0 || state.deployment.stage === 4
      ? '<section class="deployment-scheduler-grid" aria-label="Choose and apply the selected scheduler"><h3>' + (state.deployment.stage === 0 ? 'Choose one trigger' : 'Activate or verify the trigger') + '</h3><p class="small">' + (state.deployment.stage === 0 ? 'This is a guide choice only; it does not change a provider account. The selected provider action below applies it. Hosted native schedules are registered by the configured production deploy; the VPS worker starts with Compose; Supabase Cron is created later by its protected setup command after readiness.' : !probePassed ? 'Run the live API/database check above first. The guide will show the apply or verify action only after health, readiness, and the runtime selector match.' : state.deployment.scheduler === "supabase" ? 'The Supabase setup command below creates the actual job in the exact Supabase project you confirm. First deploy NOVA with the Supabase selector and the hosting provider’s native schedule disabled.' : state.deployment.scheduler === "vps" ? 'The Docker bootstrap starts the local worker. Verify its process and successful tick; do not add a cloud schedule.' : 'The final configured production deploy applies the host schedule. Verify it in the provider dashboard; this checklist itself does not change the account.') + '</p><div class="deployment-scheduler-choices">' + schedulerChoices + '</div>' +
      (schedulerPlan
        ? (schedulerOutcome ? '<div class="deployment-scheduler-outcome" role="note"><h4>How this selection becomes real</h4><dl><div><dt>Where you change it</dt><dd>' + formatDeploymentText(schedulerOutcome.where) + '</dd></div><div><dt>What switches it on</dt><dd>' + formatDeploymentText(schedulerOutcome.activates) + '</dd></div><div><dt>Where you confirm</dt><dd>' + formatDeploymentText(schedulerOutcome.check) + '</dd></div></dl></div>' : '') +
          '<details class="deployment-scheduler-plan"' + (state.deployment.stage === 4 && schedulerActions.length ? ' open' : '') + '><summary>Show the exact provider settings and steps</summary><div class="deployment-scheduler-plan-body"><p><strong>Repository files:</strong> ' + formatDeploymentText(schedulerPlan.file ?? "Provider configuration") + '</p>' + (schedulerActions.length ? '<p><strong>' + (state.deployment.stage === 0 ? 'Prepare before the final production deploy:' : 'Do this now, after readiness passes:') + '</strong></p><ol>' + schedulerActions.map((action) => '<li><p><strong>Where:</strong> ' + formatDeploymentText(action.where) + '</p><p>' + formatDeploymentText(action.change) + '</p><p><strong>What that does:</strong> ' + formatDeploymentText(action.result) + '</p></li>').join('') + '</ol>' : '<p class="notice" role="note">' + formatDeploymentText(schedulerEmptyPhase) + '</p>') + '<p><strong>How to verify:</strong> ' + formatDeploymentText(schedulerPlan.verify) + '</p>' + (schedulerPlan.warning ? '<p class="notice warning" role="note">' + formatDeploymentText(schedulerPlan.warning) + '</p>' : '') + '</div></details>'
        : '<p class="small">Select a trigger to see exactly which file/setting activates it and where to verify it.</p>') +
      '</section>'
    : '';
  const probePanel = needsProbe
    ? '<section class="deployment-scheduler-grid" aria-label="Live deployment checks"><p class="small">Read-only check against this NOVA deployment. It sends no credentials. Rerun after changing runtime or database configuration.</p>' +
      (deploymentProbe?.checking
        ? '<p class="notice" role="status" aria-live="polite">Checking API and database readiness…</p>'
        : deploymentProbe
          ? '<div class="notice ' + (deploymentProbe.health && deploymentProbe.ready && (state.deployment.stage !== 4 || deploymentProbe.scheduler === state.deployment.scheduler) ? '' : 'warning') + '" role="status" aria-live="polite"><p>API health: ' + (deploymentProbe.health ? 'ready' : 'unavailable') + '</p><p>Database/runtime readiness: ' + (deploymentProbe.ready ? 'ready' : 'not ready') + '</p>' + (state.deployment.stage === 4 ? '<p>Selected scheduler: ' + (state.deployment.scheduler || 'not selected') + '</p><p>Runtime selector: ' + (deploymentProbe.scheduler || 'not configured') + '</p>' : '') + '<p class="small">Checked at ' + deploymentProbe.checkedAt + ' UTC. Readiness checks core tables and a supported scheduler selection; it does not verify the full migration ledger, database-role privileges, or the live provider trigger.</p></div>'
          : '<p class="small" role="status" aria-live="polite">Not checked in this browser session.</p>') +
      '<button class="button secondary" type="button" data-deployment-probe' + (deploymentProbe?.checking ? ' disabled' : '') + '>Check API and database</button></section>'
    : '';
  const nextDisabled = !selected || !completed || (needsProbe && !probePassed) || ((state.deployment.stage === 0 || state.deployment.stage === 4) && !availableSchedulers.has(state.deployment.scheduler));
  const completionDisabled = (needsProbe && !probePassed) || (state.deployment.stage === 0 && !availableSchedulers.has(state.deployment.scheduler));
  app.innerHTML =
    '<section class="panel deployment-assistant">' +
      '<div class="panel-header"><div><p class="eyebrow">Guided deployment</p><h1>Follow the exact setup for your host.</h1><p class="lede">This guide will not change your GitHub, hosting, or database accounts. For every part, it shows where you make the change, what happens automatically afterward, and where to confirm it.</p></div><button class="button secondary compact" type="button" data-deployment-reset>Reset checklist</button></div>' +
      feedback() +
      (!selected ? '<h2>1. Choose the runtime shape</h2><p class="small">This selects a deployment recipe. It does not change NOVA’s PostgreSQL schema, permissions, authentication, RLS, or domain behaviour.</p><div class="deployment-path-grid">' + pathCards + '</div>' :
        '<div class="deployment-layout"><aside class="deployment-steps" aria-label="Deployment progress">' + stageList + '</aside><div class="deployment-content"><div class="deployment-selected"><span class="eyebrow">Selected path</span><strong>' + formatDeploymentText(selected.title) + '</strong><span>' + formatDeploymentText(selected.text) + '</span></div>' + deploymentWiringPanel() + '<h2>' + formatDeploymentText(current.title) + '</h2><p class="deployment-location"><strong>Where this happens:</strong> ' + formatDeploymentText(current.where) + '</p><p class="lede">' + formatDeploymentText(current.body) + '</p><ul class="deployment-checklist">' + current.items.map((item) => '<li>' + formatDeploymentText(item) + '</li>').join('') + '</ul>' + probePanel + schedulerPanel + '<label class="check deployment-confirm"><input type="checkbox" data-deployment-complete' + (completed ? ' checked' : '') + (completionDisabled ? ' disabled' : '') + '> I applied these steps and verified them at the provider.</label><div class="form-actions"><button class="button secondary" type="button" data-deployment-back' + (state.deployment.stage === 0 ? ' disabled' : '') + '>Back</button><button class="button" type="button" data-deployment-next' + (nextDisabled ? ' disabled' : '') + '>' + (state.deployment.stage === deploymentStages.length - 1 ? 'Open NOVA setup' : 'Continue') + '</button></div><p class="small"><button class="link-button" type="button" data-nav="home">Return to NOVA home</button></p></div></div>') +
    '</section>';
  const probeButton = app.querySelector('[data-deployment-probe]');
  if (probeButton) probeButton.addEventListener('click', async () => {
    deploymentProbe = { checking: true };
    render();
    const [health, ready] = await Promise.all([
      checkDeploymentEndpoint('/api/health', 'ok'),
      checkDeploymentEndpoint('/api/ready', 'ready'),
    ]);
      deploymentProbe = { health: Boolean(health), ready: Boolean(ready), scheduler: ready?.scheduler ?? null, checkedAt: new Date().toISOString() };
    render();
  });
  app.querySelectorAll('[data-deployment-path]').forEach((button) => button.addEventListener('click', () => {
    state.deployment.path = button.dataset.deploymentPath;
    state.deployment.stage = 0;
    state.deployment.scheduler = '';
    state.deployment.completed = {};
    deploymentProbe = null;
    persistDeployment();
    render();
  }));
  app.querySelectorAll('[data-deployment-stage]').forEach((button) => button.addEventListener('click', () => {
    state.deployment.stage = Number(button.dataset.deploymentStage);
    deploymentProbe = null;
    persistDeployment();
    render();
  }));
  app.querySelectorAll('[name=deploymentScheduler]').forEach((input) => input.addEventListener('change', () => {
    if (state.deployment.scheduler !== input.value) state.deployment.completed = {};
    state.deployment.scheduler = input.value;
    deploymentProbe = null;
    persistDeployment();
    render();
  }));
  const completeBox = app.querySelector('[data-deployment-complete]');
  if (completeBox) completeBox.addEventListener('change', () => {
    state.deployment.completed[state.deployment.stage] = completeBox.checked;
    persistDeployment();
    render();
  });
  const next = app.querySelector('[data-deployment-next]');
  if (next) next.addEventListener('click', () => {
    if ((state.deployment.stage === 2 || state.deployment.stage === 3) && !probePassed) {
      deploymentProbe = null;
      render();
      return;
    }
    if (state.deployment.stage === deploymentStages.length - 1) {
      go('setup');
      return;
    }
    state.deployment.completed[state.deployment.stage] = true;
    state.deployment.stage += 1;
    deploymentProbe = null;
    persistDeployment();
    render();
  });
  const back = app.querySelector('[data-deployment-back]');
  if (back) back.addEventListener('click', () => {
    state.deployment.stage = Math.max(0, state.deployment.stage - 1);
    deploymentProbe = null;
    persistDeployment();
    render();
  });
  const reset = app.querySelector('[data-deployment-reset]');
  if (reset) reset.addEventListener('click', () => {
    state.deployment = { path: '', stage: 0, scheduler: '', completed: {} };
    deploymentProbe = null;
    persistDeployment();
    render();
  });
  attachNavigation();
  showFeedback();
}

function renderLogin() {
  app.innerHTML =
    '<section class="panel">' +
      '<p class="eyebrow">Secure sign in</p><h1>Welcome back.</h1>' +
      '<p class="lede">Use the email and password you set yourself.</p>' + feedback() +
      '<form id="login-form" class="form-grid one">' +
        '<label>Email address<input name="email" type="email" autocomplete="email" required></label>' +
        '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>' +
        '<div class="form-actions"><button class="button" type="submit">Sign in</button><button class="button secondary" type="button" data-nav="forgot">Forgot password?</button><button class="button secondary" type="button" data-nav="home">Back</button></div>' +
      '</form>' +
    '</section>';
  app.querySelector("#login-form").addEventListener("submit", submitLogin);
  attachNavigation();
  showFeedback();
}

function renderSetup() {
  app.innerHTML =
    '<section class="panel">' +
      '<p class="eyebrow">One-time deployment setup</p><h1>Create the founding workspace.</h1>' +
      '<p class="lede">This creates the founding account and organisation. First choose the public NOVA URL; it is used for invitations, password links, Google callbacks, and notifications. Then choose attendance. The deployment setup token is used only for these requests and is never saved in this browser.</p>' + feedback() +
      '<form id="setup-form" class="form-grid">' +
        '<label>Your name<input name="name" autocomplete="name" required maxlength="180"></label>' +
        '<label>Organisation name<input name="organisationName" autocomplete="organization" required maxlength="180"></label>' +
      '<label>Email address<input name="email" type="email" autocomplete="email" required></label>' +
      '<label>Password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label>' +
      '<label class="full">Public NOVA URL<input name="publicOrigin" type="url" autocomplete="url" required placeholder="https://work.example.com"></label>' +
      '<p class="small full">Use the exact address people will open. Hosted deployments need HTTPS; private local testing can use localhost over HTTP. The origin must be mapped to this deployment and approved in NOVA_ALLOWED_ORIGINS.</p>' +
      '<label>Attendance mode<select name="attendanceMode"><option value="hour_based">Hour-based — measure required duration</option><option value="scheduled">Scheduled — compare against shift times</option></select></label>' +
        '<label id="required-attendance-minutes-field">Required attendance minutes<input name="requiredAttendanceMinutes" type="number" min="1" max="1440" step="1" value="480" required></label>' +
        '<p class="small full">Hour-based mode uses this duration and does not invent late/early states. Scheduled mode ignores it and uses each office calendar shift; configure office shifts before attendance begins.</p>' +
        '<label class="full">Deployment setup token<input name="bootstrapToken" type="password" autocomplete="off" required></label>' +
        '<div class="form-actions full"><button class="button" type="submit">Create NOVA workspace</button><button class="button secondary" type="button" data-nav="home">Cancel</button></div>' +
      '</form>' +
    '</section>';
  app.querySelector("#setup-form").addEventListener("submit", submitSetup);
  const attendanceMode = app.querySelector("[name=attendanceMode]");
  const requiredAttendanceMinutes = app.querySelector("[name=requiredAttendanceMinutes]");
  const requiredAttendanceMinutesField = app.querySelector("#required-attendance-minutes-field");
  const updateAttendanceModeFields = () => {
    const hourBased = attendanceMode.value === "hour_based";
    requiredAttendanceMinutesField.hidden = !hourBased;
    requiredAttendanceMinutes.required = hourBased;
  };
  attendanceMode.addEventListener("change", updateAttendanceModeFields);
  updateAttendanceModeFields();
  app.querySelector("[name=publicOrigin]").value = window.location.origin;
  attachNavigation();
  showFeedback();
}

function renderShell(body, active) {
  const adminNavigation = canShowAdminNavigation(state.actorGrants)
    ? '<button type="button" data-nav="admin"' + (active === "admin" ? ' aria-current="page"' : "") + '>Admin console</button>'
    : "";
  const inviteNavigation = canShowInviteNavigation(state.actorGrants)
    ? '<button type="button" data-nav="invite"' + (active === "invite" ? ' aria-current="page"' : "") + '>Invite a person</button>'
    : "";
  const permissionMessage = adminPermissionNoticeMessage(state.actorGrants, state.session);
  const permissionNotice = permissionMessage
    ? '<p class="small" role="status">' + permissionMessage + '</p>'
    : "";
  app.innerHTML =
    '<div class="shell">' +
      '<aside class="side-nav" aria-label="NOVA workspace">' +
        '<button type="button" data-nav="today"' + (active === "today" ? ' aria-current="page"' : "") + '>Today</button>' +
        '<button type="button" data-nav="work"' + (active === "work" ? ' aria-current="page"' : "") + '>Work</button>' +
        '<button type="button" data-nav="operations"' + (active === "operations" ? ' aria-current="page"' : "") + '>Operations</button>' +
        '<button type="button" data-nav="notifications"' + (active === "notifications" ? ' aria-current="page"' : "") + '>Notifications</button>' +
        adminNavigation +
        '<button type="button" data-nav="settings"' + (active === "settings" ? ' aria-current="page"' : "") + '>Settings</button>' +
        inviteNavigation +
        permissionNotice +
        '<button type="button" data-nav="home"' + (active === "home" ? ' aria-current="page"' : "") + '>Overview</button>' +
        '<button type="button" class="logout" data-action="logout">Sign out</button>' +
      '</aside><section>' + body + '</section></div>';
  attachNavigation();
}

function appendAccount() {
  const target = app.querySelector("#account");
  const user = state.session || {};
  const initial = String(user.name || user.email || "?").trim().slice(0, 1).toUpperCase();
  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = initial;
  const text = document.createElement("div");
  const name = document.createElement("p");
  name.textContent = user.name || "NOVA account";
  const email = document.createElement("p");
  email.className = "small";
  email.textContent = user.email || "";
  text.append(name, email);
  const status = document.createElement("span");
  status.className = "status" + (user.emailVerified ? "" : " pending");
  status.textContent = user.emailVerified ? "Verified" : "Verification pending";
  target.append(avatar, text, status);
}

async function renderSettings() {
  const canManageEmail = state.actorGrants?.isSuperAdmin === true;
  renderShell(
    '<section class="panel">' +
      '<div class="panel-header"><div><p class="eyebrow">Account security</p><h1>Change your password</h1><p>Changing your password does not require email. You must know your current password.</p></div></div>' + feedback() +
      '<form id="change-password-form" class="form-grid one"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></label><div class="form-actions"><button class="button" type="submit">Change password</button></div></form>' +
    '</section>' +
    '<section class="panel">' +
      '<div class="panel-header"><div><p class="eyebrow">Public links and custom domain</p><h1>Canonical NOVA origin</h1><p>Choose which operator-approved domain NOVA uses in invitations, password links, Gmail callbacks, and notification emails. DNS, HTTPS, and hosting mapping must be completed first.</p></div></div>' +
      '<div id="public-origin"><p class="small">Loading public origins...</p></div>' +
    '</section>' +
    '<section class="panel">' +
      '<div class="panel-header"><div><p class="eyebrow">Deployment settings</p><h1>Email delivery</h1><p>Choose, test, and explicitly activate the connection NOVA uses for invitations and authentication mail.</p></div></div>' +
      '<div id="account" class="account"></div>' + feedback() +
      '<div id="connections"><p class="small">Loading email connections...</p></div>' +
      '<div class="form-actions"><button class="button secondary" type="button" data-action="send-verification">Request verification link</button></div>' +
    '</section>' +
    '<section class="panel"><div class="panel-header"><div><h2>Secure system handoffs</h2><p class="small">When email is unavailable, authorised administrators can reveal each one-time invitation, verification or password-reset link once for secure in-person handoff.</p></div></div><div id="auth-handoffs"><p class="small">Loading secure handoffs...</p></div></section>' +
    '<section class="panel">' +
      '<div class="panel-header"><div><h2>Add an email connection</h2><p>Credentials are sent only to NOVA API, encrypted before storage, and never returned to this screen.</p></div></div>' +
      '<div id="email-runtime-notice"></div>' +
      '<form id="connection-form" class="form-grid">' +
        '<label>Connection name<input name="name" required maxlength="180" placeholder="Company SMTP"></label>' +
        '<label>Provider<select name="provider"><option value="console">Console (local development)</option><option value="smtp">SMTP</option><option value="gmail_oauth2">Gmail OAuth2</option><option value="resend">Resend</option></select></label>' +
        '<label>Sender email<input name="senderEmail" type="email" required placeholder="people@example.com"></label>' +
        '<label>Reply-to email <span class="small">(optional)</span><input name="replyToEmail" type="email" placeholder="support@example.com"></label>' +
        '<div id="provider-fields" class="provider-fields full"></div>' +
        '<div class="form-actions full"><button class="button" type="submit">Save connection</button></div>' +
      '</form>' +
    '</section>',
    "settings",
  );
  appendAccount();
  showFeedback();
  app.querySelector("#change-password-form").addEventListener("submit", submitChangePassword);
  app.querySelector("#connection-form").addEventListener("submit", submitConnection);
  app.querySelector("[name=provider]").addEventListener("change", renderProviderFields);
  app.querySelector("[data-action=send-verification]").addEventListener("click", sendVerification);
  renderProviderFields();
  await renderPublicOrigin();
  renderProviderFields();
  const connectionForm = app.querySelector("#connection-form");
  const connectionFields = connectionForm ? connectionForm.querySelectorAll("input, select, button") : [];
  if (!canManageEmail) {
    connectionForm.hidden = true;
    connectionForm.closest(".panel").hidden = true;
    app.querySelector("#connections").replaceChildren(noticeElement(
      "System email delivery can be managed only by a Super Admin.",
      "warning",
    ));
  } else if (!state.publicOriginConfigured) {
    connectionFields.forEach((field) => { field.disabled = true; });
    app.querySelector("#connections").replaceChildren(noticeElement(
      "Save the public NOVA URL above before configuring email. This prevents invitations and password links from pointing at the wrong deployment.",
      "warning",
    ));
  } else {
    connectionFields.forEach((field) => { field.disabled = false; });
    try {
      const result = await api("/api/email-connections");
      const providerSelect = app.querySelector("#connection-form [name=provider]");
      const supportedProviders = Array.isArray(result.supportedProviders)
        ? result.supportedProviders
        : Array.from(providerSelect.options, (option) => option.value);
      configureEmailProviderOptions(supportedProviders);
      renderConnections(result.connections || [], supportedProviders);
    } catch (error) {
      const target = app.querySelector("#connections");
      target.replaceChildren(noticeElement(errorText(error), "error"));
      connectionFields.forEach((field) => { field.disabled = true; });
      app.querySelector("#email-runtime-notice").replaceChildren(noticeElement(
        "NOVA could not load the email methods available in this deployment. Reload Settings after the connection is restored.",
        "warning",
      ));
    }
  }
  await renderAuthHandoffs();
}

async function renderPublicOrigin() {
  const target = app.querySelector("#public-origin");
  if (!target) return;
  try {
    const result = await api("/api/organisation/public-origin", state.bootstrapToken
      ? requestOptions("GET", undefined, { "x-nova-bootstrap-token": state.bootstrapToken })
      : undefined);
    state.publicOriginConfigured = Boolean(result.configuredOrigin);
    state.publicOrigin = result.configuredOrigin || result.effectiveOrigin || "";
    target.replaceChildren();
    const form = document.createElement("form");
    form.className = "form-grid";
    const label = document.createElement("label");
    label.className = "full";
    label.textContent = "Approved origin";
    const select = document.createElement("select");
    select.name = "origin";
    (result.allowedOrigins || []).forEach((origin) => {
      const option = document.createElement("option");
      option.value = origin;
      option.textContent = origin;
      option.selected = origin === (result.configuredOrigin || result.effectiveOrigin);
      select.append(option);
    });
    const fallback = document.createElement("option");
    fallback.value = "";
    fallback.textContent = "Use deployment fallback";
    fallback.selected = !result.configuredOrigin;
    select.append(fallback);
    label.append(select);
    const action = document.createElement("div");
    action.className = "form-actions full";
    const button = document.createElement("button");
    button.className = "button";
    button.type = "submit";
    button.textContent = "Save public origin";
    action.append(button);
    form.append(label, action);
    const status = document.createElement("p");
    status.className = "small";
    status.textContent = "Current link origin: " + result.effectiveOrigin;
    form.append(status);
    form.addEventListener("submit", (event) => withSubmit(event, async () => {
      const saved = await api("/api/organisation/public-origin", requestOptions(
        "PATCH",
        { origin: select.value || null },
        state.bootstrapToken ? { "x-nova-bootstrap-token": state.bootstrapToken } : undefined,
      ));
      state.publicOriginConfigured = Boolean(saved.configuredOrigin);
      state.publicOrigin = saved.configuredOrigin || saved.effectiveOrigin || "";
      status.textContent = "Current link origin: " + saved.effectiveOrigin;
      setMessage("Public origin saved. New links use it immediately.");
      render();
    }));
    target.append(form);
  } catch (error) {
    state.publicOriginConfigured = false;
    state.publicOrigin = "";
    if (error && error.code === "PERMISSION_DENIED") {
      target.replaceChildren(noticeElement("Public origin settings are available only to an authorized role.", "warning"));
      return;
    }
    target.replaceChildren(noticeElement(errorText(error), "error"));
  }
}

async function renderAuthHandoffs() {
  const target = app.querySelector("#auth-handoffs");
  if (!target) return;
  if (!state.bootstrapToken && !canViewAuthHandoffs(state.actorGrants)) {
    target.replaceChildren(noticeElement("Secure system handoffs are available only to authorized roles.", "warning"));
    return;
  }
  try {
    const result = await api("/api/auth-handoffs", state.bootstrapToken
      ? requestOptions("GET", undefined, { "x-nova-bootstrap-token": state.bootstrapToken })
      : undefined);
    target.replaceChildren();
    if (!result.handoffs.length) {
      target.append(noticeElement("No pending system handoffs. Email delivery remains optional for normal NOVA activity.", "warning"));
      return;
    }
    result.handoffs.forEach((handoff) => {
      const card = document.createElement("article");
      card.className = "connection";
      const heading = document.createElement("h3");
      heading.textContent = handoff.purpose + " · " + handoff.targetDisplayName;
      const detail = document.createElement("p");
      detail.className = "small";
      detail.textContent = handoff.targetEmail + " · expires " + new Date(handoff.expiresAt).toLocaleString();
      const actions = document.createElement("div");
      actions.className = "connection-actions";
      actions.append(actionButton("Reveal once", async () => {
        try {
          const revealed = await api("/api/auth-handoffs/" + handoff.id + "/reveal", requestOptions(
            "POST",
            undefined,
            state.bootstrapToken ? { "x-nova-bootstrap-token": state.bootstrapToken } : undefined,
          ));
          const output = document.createElement("textarea");
          output.className = "full";
          output.readOnly = true;
          output.rows = 3;
          output.value = revealed.handoff.url;
          card.append(output);
          state.bootstrapToken = "";
          setMessage("Copy this secure link now. It will not be shown again.");
          actions.replaceChildren(noticeElement("Revealed once", "warning"));
        } catch (error) {
          setMessage(errorText(error), "error");
        }
      }));
      card.append(heading, detail, actions);
      target.append(card);
    });
  } catch (error) {
    target.replaceChildren(noticeElement(errorText(error), "error"));
  }
}

function adminOption(value, label, selected) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected === value;
  return option;
}

function adminField(labelText, name, type, value, required) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.name = name;
  input.type = type || "text";
  input.value = value || "";
  if (required) input.required = true;
  label.append(input);
  return label;
}

function adminReadFailure(result, resource) {
  const issue = adminReadIssue(result, resource);
  return issue ? noticeElement(issue.message, "warning") : null;
}

function hasAdminPermission(data, permissionKey, target = {}) {
  return hasPermissionGrant(data?.actorGrants, permissionKey, target);
}

function replaceSectionWithReadFailures(section, sources) {
  const failures = sources.map(([result, resource]) => adminReadFailure(result, resource)).filter(Boolean);
  if (!failures.length) return false;
  section.replaceChildren(...failures);
  return true;
}

function taskDueDateEditor(task, refresh) {
  const taskStatus = task.taskStatus || task.status;
  const taskId = task.id || task.taskId;
  if (!task.canEditDueDate || ["approved", "done", "cancelled"].includes(taskStatus)) return null;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Change due date";
  const form = document.createElement("form");
  form.className = "form-actions";
  const date = adminField("Due date (blank removes it)", "dueDate", "date", task.dueDate || "", false);
  form.append(date, adminSubmit("Save due date", true));
  const hint = document.createElement("p");
  hint.className = "small";
  hint.textContent = "Changes are audited, old due reminders are withdrawn, and active assignees are notified when present.";
  details.append(summary, form, hint);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      const result = await api("/api/tasks/" + taskId + "/due-date", requestOptions("PATCH", {
        dueDate: date.querySelector("input").value || null,
        expectedDueDate: task.dueDate || null,
        expectedDueDateRevision: task.dueDateRevision,
      }));
      const notifiedCount = Number(result.notifiedAssigneeCount || 0);
      const notificationMessage = notifiedCount === 0
        ? "No active assignees to notify."
        : `${notifiedCount} active assignee${notifiedCount === 1 ? "" : "s"} notified.`;
      setMessage(result.changed ? `Due date updated; ${notificationMessage}` : "Due date is unchanged.");
    } catch (error) {
      setMessage(errorText(error), "error");
    }
    refresh();
  });
  return details;
}

function appendTaskCorrectionFields(form, tasks, workstreamSelect) {
  const correction = document.createElement("select");
  correction.name = "correctionOfTaskId";
  correction.append(adminOption("", "This is not a correction task"));
  correction.value = "";
  (tasks || []).filter((task) =>
    ["approved", "done"].includes(task.status) && !task.isCorrection && task.workstream?.id,
  ).forEach((task) => {
    const option = adminOption(task.id, task.title + " · " + task.status);
    option.dataset.workstream = task.workstream.kind + ":" + task.workstream.id;
    correction.append(option);
  });
  const correctionLabel = document.createElement("label");
  correctionLabel.textContent = "Create a separate correction task linked to completed work (optional)";
  correctionLabel.append(correction);
  form.append(correctionLabel);

  const reasonLabel = document.createElement("label");
  reasonLabel.className = "full";
  reasonLabel.textContent = "What needs correcting?";
  const reason = document.createElement("textarea");
  reason.name = "correctionReason";
  reason.maxLength = 2000;
  reasonLabel.append(reason);
  form.append(reasonLabel);
  const hint = document.createElement("p");
  hint.className = "small full";
  hint.textContent = "A correction is a separate new work item to repair an approved or completed task; it never reopens or changes the original. NOVA classifies the new task under the current workstream policy, like any other task. The correction link is not a billing category and never chooses the class. Unfinished work should continue through its existing review cycle.";
  form.append(hint);

  const refresh = () => {
    const context = workstreamSelect.value;
    correction.querySelectorAll("option[data-workstream]").forEach((option) => {
      option.hidden = Boolean(context) && option.dataset.workstream !== context;
    });
    if (correction.selectedOptions[0]?.hidden) correction.value = "";
    const isCorrection = Boolean(correction.value);
    reasonLabel.hidden = !isCorrection;
    reason.required = isCorrection;
    if (!isCorrection) reason.value = "";
  };
  workstreamSelect.addEventListener("change", refresh);
  correction.addEventListener("change", refresh);
  refresh();
}

function appendTaskCatalogSelector(form, catalog) {
  const readFailure = adminReadFailure(catalog, "task definitions");
  if (readFailure) {
    form.append(readFailure);
    return null;
  }
  const entries = catalog && catalog.entries || [];
  if (!entries.length) {
    const hint = document.createElement("p");
    hint.className = "small full";
    hint.textContent = "No approved task definitions are available to this role. You can still create a one-off task. NOVA classifies it from the selected workstream policy.";
    form.append(hint);
    return null;
  }
  const select = document.createElement("select");
  select.name = "taskCatalogEntryId";
  select.append(adminOption("", "One-off task"));
  entries.forEach((entry) => {
    const option = adminOption(entry.id, entry.title);
    option.dataset.revision = String(entry.revision);
    option.dataset.title = entry.title;
    option.dataset.description = entry.description || "";
    option.dataset.priority = entry.priority;
    select.append(option);
  });
  const label = document.createElement("label");
  label.textContent = "Task definition (optional defaults)";
  label.append(select);
  form.append(label);
  const billingHint = document.createElement("p");
  billingHint.className = "small full";
  billingHint.textContent = "You cannot set billing class here. NOVA applies the selected workstream's single automatic policy to free-form, predefined, and correction tasks alike. A correction link is separate from billing classification.";
  form.append(billingHint);
  select.addEventListener("change", () => {
    const old = select.dataset.appliedEntryId
      ? entries.find((entry) => entry.id === select.dataset.appliedEntryId)
      : null;
    const title = form.elements.namedItem("title");
    const description = form.elements.namedItem("description");
    const priority = form.elements.namedItem("priority");
    if (old && title && title.value === old.title) title.value = "";
    if (old && description && description.value === (old.description || "")) description.value = "";
    if (old && priority && priority.value === old.priority) priority.value = "normal";
    const entry = entries.find((candidate) => candidate.id === select.value);
    if (!entry) {
      delete select.dataset.appliedEntryId;
      updateBillingHint();
      return;
    }
    if (title) title.value = entry.title;
    if (description) description.value = entry.description || "";
    if (priority) priority.value = entry.priority;
    select.dataset.appliedEntryId = entry.id;
    updateBillingHint();
  });
  form.addEventListener("change", (event) => {
  });
  return select;
}

function taskCatalogProvenance(select) {
  const option = select && select.selectedOptions[0];
  return option && option.value
    ? { taskCatalogEntryId: option.value, taskCatalogRevision: Number(option.dataset.revision) }
    : {};
}

function taskCreateIdempotencyHeaders(payload) {
  const fingerprint = JSON.stringify(payload);
  if (state.taskCreateFingerprint !== fingerprint || !state.taskCreateRequestKey) {
    state.taskCreateFingerprint = fingerprint;
    state.taskCreateRequestKey = crypto.randomUUID();
  }
  return { "idempotency-key": state.taskCreateRequestKey };
}

function clearTaskCreateIdempotency(payload) {
  if (state.taskCreateFingerprint !== JSON.stringify(payload)) return;
  state.taskCreateFingerprint = "";
  state.taskCreateRequestKey = "";
}

function taskBillingConfirmation(task) {
  const billingClass = task && task.billingClass;
  const classification = billingClass === "billable"
    ? "Billable"
    : billingClass === "non_billable" ? "Non-billable" : "classified automatically";
  const source = task && task.billingPolicySource === "client_workstream_task_definition"
    ? "predefined-task rule" : task && task.billingPolicySource === "client_workstream"
      ? "client workstream default" : task && task.billingPolicySource === "organisation_default"
        ? "organisation default" : task && task.billingPolicySource === "legacy_snapshot"
          ? "legacy classification snapshot" : "workstream policy";
  const revision = task && Number.isSafeInteger(task.billingPolicyRevision) && task.billingPolicyRevision > 0
    ? " · policy r" + task.billingPolicyRevision : "";
  return "NOVA automatically classified this task as " + classification + " · " + source + revision;
}

function taskCorrectionConfirmation(isCorrection) {
  return isCorrection ? " This is a separate correction work item; the original task remains unchanged." : "";
}

function taskDefinitionProvenance(task) {
  return task && task.taskDefinition
    ? "selected definition · revision " + task.taskDefinition.revision
    : "one-off task path";
}

function taskDefinitionReference(task) {
  return task && task.taskDefinition
    ? task.taskDefinition.entryId + "@" + task.taskDefinition.revision
    : "one-off task path";
}

function renderTaskCatalogTools(catalog) {
  const readFailure = adminReadFailure(catalog, "task definitions");
  if (readFailure) return readFailure;
  const permissions = catalog && catalog.permissions || {};
  if (!permissions.manage && !permissions.propose && !permissions.review && !permissions.view) return null;
  const section = adminSection(
    "Reusable task defaults",
    "Definitions provide reusable task content only. NOVA applies the same automatic policy to every task in a client workstream, whether entered freely, selected from this list, or created as a correction. This list never classifies work; a correction link is separate from billing.",
  );
  if (permissions.manage || permissions.propose) {
    const form = document.createElement("form");
    form.className = "form-grid";
    form.append(adminField("Task name", "title", "text", "", true));
    const descriptionLabel = document.createElement("label");
    descriptionLabel.textContent = "Description (optional)";
    const description = document.createElement("textarea");
    description.name = "description";
    description.maxLength = 10000;
    descriptionLabel.append(description);
    const priority = document.createElement("select");
    priority.name = "priority";
    [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]]
      .forEach(([value, label]) => priority.append(adminOption(value, label, "normal")));
    const priorityLabel = document.createElement("label");
    priorityLabel.textContent = "Default priority";
    priorityLabel.append(priority);
    form.append(descriptionLabel, priorityLabel, adminField("Reason", "reason", "text", "", true));
    const reason = form.elements.namedItem("reason");
    reason.maxLength = 2000;
    form.append(adminSubmit(permissions.manage ? "Add approved default" : "Suggest a reusable task", true));
    form.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
      const result = await api("/api/task-catalog", requestOptions("POST", formValues(form)));
      setMessage(result.status === "pending" ? "Suggestion sent for review." : "Reusable task default added.");
    }));
    section.append(form);
  }

  const entries = catalog && catalog.entries || [];
  if (permissions.view || permissions.manage) {
    const list = document.createElement("div");
    list.className = "stack";
    if (!entries.length) list.append(noticeElement("No approved task defaults yet. You can still create one-off tasks; NOVA applies the selected workstream policy.", "warning"));
    entries.forEach((entry) => {
      const item = document.createElement("article");
      item.className = "list-item";
      const heading = document.createElement("strong");
      heading.textContent = entry.title;
      const meta = document.createElement("span");
      meta.className = "small";
      meta.textContent = entry.priority + " priority · revision " + entry.revision +
        (entry.createdByName ? " · added by " + entry.createdByName : "");
      item.append(heading, meta);
      if (entry.description) {
        const details = document.createElement("p");
        details.className = "small";
        details.textContent = entry.description;
        item.append(details);
      }
      if (permissions.manage || permissions.propose) {
        const edit = document.createElement("form");
        edit.className = "form-grid";
        edit.append(adminField("Task name", "title", "text", entry.title, true));
        const editDescriptionLabel = document.createElement("label");
        editDescriptionLabel.textContent = "Description (optional)";
        const editDescription = document.createElement("textarea");
        editDescription.name = "description";
        editDescription.maxLength = 10000;
        editDescription.value = entry.description || "";
        editDescriptionLabel.append(editDescription);
        const editPriority = document.createElement("select");
        editPriority.name = "priority";
        [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]]
          .forEach(([value, label]) => editPriority.append(adminOption(value, label, entry.priority)));
        const editPriorityLabel = document.createElement("label");
        editPriorityLabel.textContent = "Default priority";
        editPriorityLabel.append(editPriority);
        edit.append(editDescriptionLabel, editPriorityLabel, adminField("Reason", "reason", "text", "", true));
        edit.elements.namedItem("reason").maxLength = 2000;
        edit.append(adminSubmit(permissions.manage ? "Save changes" : "Suggest changes", true));
        edit.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
          const values = formValues(edit);
          const result = await api("/api/task-catalog/" + entry.id, requestOptions("PATCH", {
            ...values, expectedRevision: entry.revision,
          }));
          setMessage(result.status === "pending" ? "Change suggestion sent for review." : "Reusable task default updated.");
        }));
        const archive = document.createElement("form");
        archive.className = "form-actions";
        const archiveReason = adminField("Archive reason", "reason", "text", "", true);
        archiveReason.querySelector("input").maxLength = 2000;
        archive.append(archiveReason, adminSubmit(permissions.manage ? "Archive default" : "Suggest archive", true));
        archive.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
          const values = formValues(archive);
          const result = await api("/api/task-catalog/" + entry.id + "/archive", requestOptions("POST", {
            ...values, expectedRevision: entry.revision,
          }));
          setMessage(result.status === "pending" ? "Archive suggestion sent for review." : "Reusable task default archived.");
        }));
        item.append(edit, archive);
      }
      list.append(item);
    });
    section.append(list);
  }

  const proposals = catalog && catalog.proposals || [];
  if (permissions.propose || permissions.review) {
    const list = document.createElement("div");
    list.className = "stack";
    if (!proposals.length) list.append(noticeElement("No task catalogue proposals to show.", "warning"));
    proposals.forEach((proposal) => {
      const item = document.createElement("article");
      item.className = "list-item";
      const heading = document.createElement("strong");
      heading.textContent = proposal.action + " · " + proposal.title;
      const meta = document.createElement("span");
      meta.className = "small";
      meta.textContent = proposal.status + " · proposed by " + (proposal.proposerName || "colleague") + " · " + proposal.reason;
      item.append(heading, meta);
      if (permissions.review && proposal.status === "pending") {
        const reviewForm = document.createElement("form");
        reviewForm.className = "form-actions";
        const note = adminField("Review note (required to reject)", "reviewNote", "text", "", false);
        note.querySelector("input").maxLength = 2000;
        reviewForm.append(note);
        const approve = adminSubmit("Approve", true);
        approve.dataset.decision = "approved";
        const reject = adminSubmit("Reject", true);
        reject.dataset.decision = "rejected";
        reviewForm.append(approve, reject);
        reviewForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
          const values = formValues(reviewForm);
          const decision = event.submitter && event.submitter.dataset.decision;
          const result = await api("/api/task-catalog/proposals/" + proposal.id + "/review", requestOptions("POST", {
            decision, reviewNote: values.reviewNote || null,
          }));
          setMessage(result.status === "stale" ? "Proposal was stale and needs a fresh request." : "Proposal " + result.status + ".");
        }));
        item.append(reviewForm);
      }
      list.append(item);
    });
    section.append(list);
  }
  return section;
}

function renderBillingPolicyTools(clientWorkstreams, taskCatalogData) {
  const manageable = (clientWorkstreams || []).filter((workstream) => workstream.canManageBillingPolicy);
  if (!manageable.length) return null;
  const section = adminSection(
    "Client workstream billing policies",
    "An authorized policy manager sets the default for one-off tasks and may set a separate rule for each reusable task in each client workstream. Workers never choose a billing class. Changes affect future tasks only; corrections remain linked work items, not billing adjustments.",
  );
  manageable.forEach((workstream) => {
    const form = document.createElement("form");
    form.className = "form-grid";
    const heading = document.createElement("strong");
    heading.className = "full";
    heading.textContent = (workstream.client_name || "Client") + " · " + workstream.name;
    const current = document.createElement("p");
    current.className = "small full";
    const updateCurrentPolicy = () => {
      current.textContent = workstream.billingPolicyClass
        ? "Default for one-off tasks: " + (workstream.billingPolicyClass === "billable" ? "Billable" : "Non-billable") +
          " · revision " + workstream.billingPolicyRevision + " · applies to future tasks only."
      : "No policy yet. Task creation in this workstream is blocked until one is set.";
    };
    updateCurrentPolicy();
    const select = document.createElement("select");
    select.name = "policyClass";
    select.required = true;
    select.append(adminOption("", "Choose automatic policy"));
    select.append(adminOption("billable", "Billable"));
    select.append(adminOption("non_billable", "Non-billable"));
    select.value = workstream.billingPolicyClass || "";
    const label = document.createElement("label");
    label.textContent = "Automatic policy for this workstream";
    label.append(select);
    const reason = document.createElement("textarea");
    reason.name = "reason";
    reason.maxLength = 2000;
    reason.required = true;
    const reasonLabel = document.createElement("label");
    reasonLabel.className = "full";
    reasonLabel.textContent = "Why is this policy being set or changed?";
    reasonLabel.append(reason);
    form.append(heading, current, label, reasonLabel, adminSubmit("Save policy", true));
    form.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
      const values = formValues(form);
      const saved = await api("/api/workstreams/client/" + workstream.id + "/billing-policy", requestOptions("PATCH", {
        policyClass: values.policyClass,
        expectedRevision: workstream.billingPolicyRevision,
        reason: values.reason,
      }));
      workstream.billingPolicyClass = saved.policyClass;
      workstream.billingPolicyRevision = saved.revision;
      select.value = saved.policyClass;
      updateCurrentPolicy();
      setMessage("Default saved for future one-off tasks. Existing tasks and timers were not changed.");
    }));
    section.append(form);
  });

  const catalogPermissions = taskCatalogData && taskCatalogData.permissions || {};
  const catalogReadFailure = adminReadFailure(taskCatalogData, "task definitions");
  if (catalogReadFailure) {
    section.append(catalogReadFailure);
    return section;
  }
  const catalogVisible = catalogPermissions.view === true || catalogPermissions.manage === true;
  const entries = catalogVisible && Array.isArray(taskCatalogData.entries) ? taskCatalogData.entries : [];
  if (!catalogVisible) {
    const note = document.createElement("p");
    note.className = "notice warning";
    note.textContent = "To configure per-task defaults, this role also needs task-catalog view or manage permission. Catalog editing alone never grants billing-policy authority.";
    section.append(note);
    return section;
  }
  if (!entries.length) {
    const note = document.createElement("p");
    note.className = "small";
    note.textContent = "Create or approve reusable task definitions first. One-off tasks will use the workstream default.";
    section.append(note);
    return section;
  }

  const definitionHeading = document.createElement("h3");
  definitionHeading.textContent = "Predefined-task rules";
  const definitionHelp = document.createElement("p");
  definitionHelp.className = "small";
  definitionHelp.textContent = "Choose a predefined task and set its class for this workstream, or use the one-off default. The selected task name determines the rule; users never submit a class. You need task-catalog visibility plus workstream billing-policy permission.";
  const definitionForm = document.createElement("form");
  definitionForm.className = "form-grid";
  const workstreamSelect = document.createElement("select");
  workstreamSelect.name = "workstreamId";
  workstreamSelect.required = true;
  manageable.forEach((workstream) => workstreamSelect.append(adminOption(
    workstream.id, (workstream.client_name || "Client") + " · " + workstream.name,
  )));
  const workstreamLabel = document.createElement("label");
  workstreamLabel.textContent = "Client workstream";
  workstreamLabel.append(workstreamSelect);
  const entrySelect = document.createElement("select");
  entrySelect.name = "entryId";
  entrySelect.required = true;
  entries.forEach((entry) => entrySelect.append(adminOption(entry.id, entry.title)));
  const entryLabel = document.createElement("label");
  entryLabel.textContent = "Predefined task";
  entryLabel.append(entrySelect);
  const classSelect = document.createElement("select");
  classSelect.name = "policyClass";
  classSelect.required = true;
  classSelect.append(adminOption("inherit", "Use workstream default"));
  classSelect.append(adminOption("billable", "Billable"));
  classSelect.append(adminOption("non_billable", "Non-billable"));
  const classLabel = document.createElement("label");
  classLabel.textContent = "Automatic class for this predefined task";
  classLabel.append(classSelect);
  const definitionReason = document.createElement("textarea");
  definitionReason.name = "reason";
  definitionReason.maxLength = 2000;
  definitionReason.required = true;
  const definitionReasonLabel = document.createElement("label");
  definitionReasonLabel.className = "full";
  definitionReasonLabel.textContent = "Why is this task rule being set or changed?";
  definitionReasonLabel.append(definitionReason);
  const currentDefinitionRule = document.createElement("p");
  currentDefinitionRule.className = "small full";
  const saveDefinitionRule = adminSubmit("Save task rule", true);
  let currentRules = new Map();
  let ruleLoadGeneration = 0;
  let definitionRulesLoaded = false;
  const selectedWorkstream = () => manageable.find((item) => item.id === workstreamSelect.value);
  const updateDefinitionRule = () => {
    const rule = currentRules.get(entrySelect.value);
    classSelect.value = rule && rule.billingClass
      ? rule.billingClass : "inherit";
    definitionReason.value = "";
    const workstream = selectedWorkstream();
    const fallback = workstream && workstream.billingPolicyClass;
    currentDefinitionRule.textContent = rule && rule.billingClass
      ? "Current classification: " + (rule.billingClass === "billable" ? "Billable" : "Non-billable") +
        " · task-rule revision " + rule.ruleRevision + " · existing tasks are unchanged."
      : "No separate rule. Future tasks use the workstream default" + (fallback
        ? " (" + (fallback === "billable" ? "billable" : "non-billable") + ")."
        : "; task creation is blocked until the default is configured.");
    classSelect.disabled = !fallback || !definitionRulesLoaded;
    saveDefinitionRule.disabled = !fallback || !definitionRulesLoaded;
  };
  const loadDefinitionRules = async () => {
    const generation = ++ruleLoadGeneration;
    definitionRulesLoaded = false;
    currentRules = new Map();
    updateDefinitionRule();
    if (!workstreamSelect.value) return;
    try {
      const result = await api("/api/workstreams/client/" + workstreamSelect.value + "/billing-policy/definitions");
      if (generation !== ruleLoadGeneration) return;
      currentRules = new Map((result.entries || []).map((rule) => [rule.entryId, rule]));
      definitionRulesLoaded = true;
      const workstream = selectedWorkstream();
      if (workstream && result.defaultClass) {
        workstream.billingPolicyClass = result.defaultClass;
        workstream.billingPolicyRevision = result.defaultRevision;
      }
      updateDefinitionRule();
    } catch (error) {
      if (generation === ruleLoadGeneration) {
        definitionRulesLoaded = false;
        updateDefinitionRule();
        currentDefinitionRule.textContent = error && error.code === "PERMISSION_DENIED"
          ? "Catalog access is required to inspect or edit these rules."
          : "Could not load the current task rules. Nothing has been changed.";
      }
    }
  };
  workstreamSelect.addEventListener("change", loadDefinitionRules);
  entrySelect.addEventListener("change", updateDefinitionRule);
  definitionForm.append(workstreamLabel, entryLabel, classLabel, definitionReasonLabel, currentDefinitionRule, saveDefinitionRule);
  definitionForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const workstream = selectedWorkstream();
    const rule = currentRules.get(entrySelect.value);
    if (!workstream || !entrySelect.value) throw Object.assign(new Error("TASK_BILLING_RULE_INPUT_INVALID"), { code: "TASK_BILLING_RULE_INPUT_INVALID" });
    const saved = await api(
      "/api/workstreams/client/" + workstream.id + "/billing-policy/definitions/" + entrySelect.value,
      requestOptions("PATCH", {
        policyClass: classSelect.value === "inherit" ? null : classSelect.value,
        expectedRevision: rule ? rule.ruleRevision : 0,
        reason: formValues(definitionForm).reason,
      }),
    );
    currentRules.set(entrySelect.value, {
      ...(rule || {}), entryId: entrySelect.value,
      billingClass: saved.policyClass, ruleRevision: saved.revision,
    });
    updateDefinitionRule();
    setMessage("Predefined-task rule saved for future tasks in this workstream. Existing tasks and timers were not changed.");
  }));
  section.append(definitionHeading, definitionHelp, definitionForm);
  if (workstreamSelect.value) void loadDefinitionRules();
  return section;
}

function adminSection(title, description) {
  const section = document.createElement("section");
  section.className = "panel";
  const header = document.createElement("div");
  header.className = "panel-header";
  const heading = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.className = "small";
  p.textContent = description;
  heading.append(h2, p);
  header.append(heading);
  section.append(header);
  return section;
}

function adminButton(text, handler, secondary) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button compact" + (secondary ? " secondary" : "");
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function adminFormSubmit(event, work) {
  return withSubmit(event, async () => {
    await work();
    render();
  });
}

function renderAdmin() {
  renderShell(
    '<div id="admin-console"><section class="panel"><p class="eyebrow">Organisation administration</p><h1>Admin console</h1><p class="lede">Manage the real NOVA organisation, role, people, onboarding, and audit records.</p>' + feedback() + '<div id="admin-content"><p class="small">Loading organisation data...</p></div></section></div>',
    "admin",
  );
  showFeedback();
  loadAdmin();
}

async function loadAdmin() {
  try {
    const [organisation, offices, departments, permissions, roles, people, audit, availability, wfhPolicies, leavePending, wfhPending, exceptions, workContext, tasks, taskCatalog, actorGrants] = await Promise.all([
      readOrError(api("/api/organisation"), { organisation: null }),
      readOrError(api("/api/offices"), { offices: [] }),
      readOrError(api("/api/organisation-departments"), { departments: [] }),
      readOrError(api("/api/permissions"), { permissions: [] }),
      readOrError(api("/api/roles"), { roles: [] }),
      readOrError(api("/api/people"), { people: [] }),
      readOrError(api("/api/audit-events?limit=50"), { events: [] }),
      readOrError(api("/api/availability/config"), { shifts: [], calendars: [], holidays: [] }),
      readOrError(api("/api/availability/wfh-policies"), { policies: [] }),
      readOrError(api("/api/leave/pending"), { requests: [] }),
      readOrError(api("/api/availability/wfh/pending"), { requests: [] }),
      readOrError(api("/api/historical-exceptions"), { exceptions: [] }),
      readOrError(api("/api/work-context"), { clients: [], clientWorkstreams: [], organisationWorkstreams: [], groups: [] }),
      readOrError(api("/api/tasks"), { tasks: [] }),
      readOrError(api("/api/task-catalog"), { entries: [], proposals: [], permissions: {} }),
      readOrError(api("/api/me/permission-grants"), { grants: [], isSuperAdmin: false, actorPersonId: null }),
    ]);
    state.adminData = { organisation, offices, departments, permissions, roles, people, audit, availability, wfhPolicies, leavePending, wfhPending, exceptions, workContext, tasks, taskCatalog, actorGrants };
    renderAdminContent(state.adminData);
  } catch (error) {
    const target = app.querySelector("#admin-content");
    if (target) target.replaceChildren(noticeElement(errorText(error), "error"));
  }
}

function renderAdminContent(data) {
  const target = app.querySelector("#admin-content");
  if (!target) return;
  target.replaceChildren();
  const organisation = data.organisation.organisation;
  const summary = document.createElement("p");
  summary.className = "small";
  summary.textContent = organisation
    ? organisation.name + " · " + (data.people.readError ? "people list unavailable" : data.people.people.length + " people")
    : "Organisation unavailable";
  target.append(summary);
  const actorPermissionFailure = adminReadFailure(data.actorGrants, "your current action permissions");
  if (actorPermissionFailure) {
    actorPermissionFailure.textContent += " Write controls are hidden until this can be refreshed.";
    target.append(actorPermissionFailure);
  }

  const structure = adminSection("Organisation structure", "Create the offices and departments used by onboarding and future availability rules.");
  const structureGrid = document.createElement("div");
  structureGrid.className = "split";
  const officeForm = document.createElement("form");
  officeForm.className = "form-grid";
  officeForm.append(adminField("Office name", "name", "text", "", true));
  officeForm.append(adminField("Location anchor", "location", "text", "", true));
  officeForm.append(adminField("IANA timezone", "timezone", "text", "UTC", true));
  officeForm.append(adminField("Latitude", "latitude", "number", "", true));
  officeForm.append(adminField("Longitude", "longitude", "number", "", true));
  officeForm.append(adminField("Attendance radius (metres)", "geofenceRadiusMeters", "number", "150", true));
  const officeActions = document.createElement("div");
  officeActions.className = "form-actions full";
  const officeSubmit = document.createElement("button");
  officeSubmit.className = "button";
  officeSubmit.type = "submit";
  officeSubmit.textContent = "Create office";
  officeActions.append(officeSubmit);
  officeForm.append(officeActions);
  officeForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    values.latitude = Number(values.latitude);
    values.longitude = Number(values.longitude);
    values.geofenceRadiusMeters = Number(values.geofenceRadiusMeters);
    await api("/api/offices", requestOptions("POST", values));
    setMessage("Office created.");
  }));
  const departmentForm = document.createElement("form");
  departmentForm.className = "form-grid";
  departmentForm.append(adminField("Department name", "name", "text", "", true));
  const departmentActions = document.createElement("div");
  departmentActions.className = "form-actions full";
  const departmentSubmit = document.createElement("button");
  departmentSubmit.className = "button";
  departmentSubmit.type = "submit";
  departmentSubmit.textContent = "Create department";
  departmentActions.append(departmentSubmit);
  departmentForm.append(departmentActions);
  departmentForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    await api("/api/organisation-departments", requestOptions("POST", values));
    setMessage("Department created.");
  }));
  const structureForms = document.createElement("div");
  if (hasAdminPermission(data, "organisation.settings.manage")) {
    structureForms.append(officeForm, departmentForm);
  }
  const structureList = document.createElement("div");
  structureList.className = "stack";
  const officeHeading = document.createElement("h3");
  officeHeading.textContent = "Offices";
  structureList.append(officeHeading);
  data.offices.offices.forEach((office) => {
    const item = document.createElement("article");
    item.className = "list-item";
    const summary = document.createElement("strong");
    summary.textContent = office.name + " · " + office.location + " · " + office.timezone +
      " · geofence " + (office.latitude === null ? "not configured" : office.geofenceRadiusMeters + "m");
    const geofenceForm = document.createElement("form");
    geofenceForm.className = "form-grid";
    geofenceForm.innerHTML = '<label>Latitude<input name="latitude" type="number" step="0.00001" required></label>' +
      '<label>Longitude<input name="longitude" type="number" step="0.00001" required></label>' +
      '<label>Radius (m)<input name="geofenceRadiusMeters" type="number" min="10" max="100000" required></label>' +
      '<div class="form-actions"><button class="button secondary" type="submit">Save geofence</button></div>';
    geofenceForm.elements.latitude.value = office.latitude === null ? "" : office.latitude;
    geofenceForm.elements.longitude.value = office.longitude === null ? "" : office.longitude;
    geofenceForm.elements.geofenceRadiusMeters.value = office.geofenceRadiusMeters || 150;
    geofenceForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
      const values = formValues(event.currentTarget);
      await api("/api/offices/" + office.id + "/geofence", requestOptions("PATCH", {
        latitude: Number(values.latitude), longitude: Number(values.longitude),
        geofenceRadiusMeters: Number(values.geofenceRadiusMeters),
      }));
      setMessage("Office geofence updated.");
    }));
    item.append(summary);
    if (hasAdminPermission(data, "attendance.geofence.manage", { officeId: office.id })) {
      item.append(geofenceForm);
    }
    structureList.append(item);
  });
  const departmentHeading = document.createElement("h3");
  departmentHeading.textContent = "Departments";
  structureList.append(departmentHeading);
  data.departments.departments.forEach((department) => {
    const item = document.createElement("p");
    item.className = "list-item";
    item.textContent = department.name;
    structureList.append(item);
  });
  if (structureForms.childElementCount) structureGrid.append(structureForms);
  structureGrid.append(structureList);
  structure.append(structureGrid);
  replaceSectionWithReadFailures(structure, [
    [data.organisation, "organisation settings"],
    [data.offices, "offices"],
    [data.departments, "departments"],
  ]);
  target.append(structure);

  const attendancePolicy = adminSection("Attendance interpretation", "Choose whether the organisation measures required duration or schedule-relative attendance. Changes are effective-dated so historical timelines keep their meaning.");
  const attendancePolicyForm = document.createElement("form");
  attendancePolicyForm.className = "form-grid";
  attendancePolicyForm.innerHTML = '<label>Mode<select name="mode"><option value="hour_based">Hour-based</option><option value="scheduled">Scheduled</option></select></label>' +
    '<label>Effective from<input name="effectiveOn" type="date" required></label>' +
    '<label>Required attendance minutes<input name="requiredAttendanceMinutes" type="number" min="1" max="1440" step="1" required></label>' +
    '<p class="small full">Hour-based mode does not derive late/early states. Scheduled mode uses the shift attached to each working calendar day.</p>' +
    '<div class="form-actions full"><button class="button" type="submit">Schedule attendance policy</button></div>';
  const currentPolicy = organisation?.attendancePolicy;
  attendancePolicyForm.elements.mode.value = currentPolicy?.mode || "hour_based";
  const policyAnchor = currentPolicy?.effectiveOn
    ? new Date(currentPolicy.effectiveOn + "T00:00:00Z")
    : new Date();
  policyAnchor.setUTCDate(policyAnchor.getUTCDate() + 1);
  attendancePolicyForm.elements.effectiveOn.value = policyAnchor.toISOString().slice(0, 10);
  attendancePolicyForm.elements.requiredAttendanceMinutes.value = currentPolicy?.requiredAttendanceMinutes || 480;
  attendancePolicyForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    await api("/api/organisation/attendance-policy", requestOptions("PATCH", {
      mode: values.mode,
      effectiveOn: values.effectiveOn,
      requiredAttendanceMinutes: Number(values.requiredAttendanceMinutes),
    }));
    setMessage("Attendance policy scheduled.");
  }));
  if (hasAdminPermission(data, "organisation.settings.manage")) {
    attendancePolicy.append(attendancePolicyForm);
  } else if (organisation?.attendancePolicy) {
    const currentPolicySummary = document.createElement("p");
    currentPolicySummary.className = "small";
    currentPolicySummary.textContent = "Current policy: " + organisation.attendancePolicy.mode.replaceAll("_", " ") +
      " · " + organisation.attendancePolicy.requiredAttendanceMinutes + " required minutes · effective " +
      organisation.attendancePolicy.effectiveOn;
    attendancePolicy.append(currentPolicySummary);
  }
  replaceSectionWithReadFailures(attendancePolicy, [[data.organisation, "attendance policy"]]);
  target.append(attendancePolicy);

  target.append(renderAvailabilitySection(data));

  const rolesSection = adminSection("Roles and permissions", "Build configurable roles from the canonical permission catalogue. Protected Super Admin cannot be edited.");
  const roleForm = document.createElement("form");
  roleForm.id = "admin-role-form";
  roleForm.className = "form-grid";
  const roleTitle = document.createElement("h3");
  roleTitle.id = "admin-role-form-title";
  roleTitle.textContent = "Create custom role";
  roleForm.append(roleTitle);
  const rolePresetBox = document.createElement("div");
  rolePresetBox.className = "role-preset-box full";
  const rolePresetLabel = document.createElement("label");
  rolePresetLabel.textContent = "Starter profile (optional)";
  const rolePresetSelect = document.createElement("select");
  rolePresetSelect.name = "rolePreset";
  rolePresetSelect.append(adminOption("", "Choose a profile"));
  rolePresets.forEach((preset) => rolePresetSelect.append(adminOption(preset.id, preset.name)));
  rolePresetLabel.append(rolePresetSelect);
  const rolePresetHelp = document.createElement("p");
  rolePresetHelp.className = "small";
  rolePresetHelp.textContent = "Profiles are editable starting points, not built-in roles. Applying one replaces the draft below and suggests an unused role key. Review every grant and operational setting; scoped grants need an explicit target. Saving still uses normal role permissions.";
  const rolePresetStatus = document.createElement("p");
  rolePresetStatus.className = "small";
  rolePresetStatus.setAttribute("aria-live", "polite");
  rolePresetSelect.addEventListener("change", () => {
    const draft = rolePresetDraft(rolePresetSelect.value, data.permissions.permissions);
    if (!draft) {
      rolePresetStatus.textContent = "Choose a profile to preview it. Your current draft is unchanged.";
      return;
    }
    rolePresetStatus.textContent = "Preview: " + draft.description + " It contains " + draft.grants.length +
      " available grants and " + draft.targetGrantCount + " target-specific grants. Applying replaces the role draft." +
      (draft.omitted.length ? " Some profile permissions/scopes are unavailable in this installed catalogue." : "");
  });
  const applyRolePresetButton = adminButton("Apply profile to draft", () => {
    const draft = rolePresetDraft(rolePresetSelect.value, data.permissions.permissions);
    if (!draft) {
      setMessage("Choose a starter profile first.", "error");
      return;
    }
    roleForm.querySelector("[name=key]").value = uniqueRoleKey(draft.key, data.roles.roles);
    roleForm.querySelector("[name=name]").value = draft.name;
    policyNames.forEach(([name]) => {
      roleForm.querySelector("[name=" + name + "]").checked = draft.operationalPolicy[name] === true;
    });
    const grantsByPermission = groupRolePermissionGrants(draft.grants);
    roleForm.querySelectorAll(".permission-row").forEach((row) => {
      const grants = grantsByPermission.get(row.dataset.permission) || [];
      const check = row.querySelector(".permission-check");
      const addGrant = row.querySelector(".role-add-grant");
      const grantList = row.querySelector(".role-grant-list");
      check.checked = grants.length > 0;
      grantList.replaceChildren();
      addGrant.hidden = grants.length === 0;
      grants.forEach((grant) => row.createGrantEditor(grant));
    });
    const targetText = draft.targetGrantCount
      ? " " + draft.targetGrantCount + " scoped grants still need exact targets."
      : "";
    const omittedText = draft.omitted.length
      ? " " + draft.omitted.length + " unavailable permission/scope entries were omitted; review the installed catalogue."
      : "";
    rolePresetStatus.textContent = draft.description + " Applied " + draft.grants.length + " grants." + targetText + omittedText;
    setMessage("Starter profile applied as an editable draft. Review before saving.");
  }, true);
  rolePresetBox.append(rolePresetLabel, rolePresetHelp, applyRolePresetButton, rolePresetStatus);
  roleForm.append(rolePresetBox);
  const roleRevision = document.createElement("input");
  roleRevision.type = "hidden";
  roleRevision.name = "expectedRevision";
  roleForm.append(roleRevision);
  roleForm.append(adminField("Role key", "key", "text", "", true));
  roleForm.append(adminField("Display name", "name", "text", "", true));
  const policyHeading = document.createElement("h3");
  policyHeading.textContent = "Operational policy";
  roleForm.append(policyHeading);
  const policyNames = [
    ["workEnabled", "Work enabled"],
    ["canReceiveAssignments", "Can receive assignments"],
    ["attendanceRequired", "Attendance required"],
    ["wfhAllowed", "WFH allowed"],
    ["canWorkWithoutAttendance", "Can work without attendance"],
    ["payrollApplicable", "Payroll applicable"],
    ["payrollAttendanceContributes", "Attendance contributes to payroll"],
    ["payrollOvertimeApplicable", "Overtime applicable"],
  ];
  const policyGrid = document.createElement("div");
  policyGrid.className = "check-grid";
  policyNames.forEach(([name, labelText]) => {
    const label = document.createElement("label");
    label.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    label.append(input, document.createTextNode(labelText));
    policyGrid.append(label);
  });
  roleForm.append(policyGrid);
  const permissionHeading = document.createElement("h3");
  permissionHeading.textContent = "Permission grants";
  roleForm.append(permissionHeading);
  const permissionHelp = document.createElement("p");
  permissionHelp.className = "small full";
  permissionHelp.textContent = "A permission may have multiple independent scopes or targets. New grants start at the narrowest supported scope; select every target explicitly. Role edits preserve all grants.";
  roleForm.append(permissionHelp);
  const permissionGrid = document.createElement("div");
  permissionGrid.className = "permission-grid";
  data.permissions.permissions.forEach((permission) => {
    const row = document.createElement("div");
    row.className = "permission-row";
    row.dataset.permission = permission.key;
    const label = document.createElement("label");
    label.className = "check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "permission-check";
    label.append(checkbox, document.createTextNode(permission.key));
    const description = document.createElement("span");
    description.className = "small";
    description.textContent = permission.description;
    const heading = document.createElement("div");
    heading.className = "permission-heading";
    heading.append(label, description);
    const grantList = document.createElement("div");
    grantList.className = "role-grant-list";
    const scopeLabels = [
      ["organisation", "Organisation"],
      ["own_record", "Own record"],
      ["office", "Office"],
      ["organisation_department", "Department"],
      ["client", "Client"],
      ["client_workstream", "Client workstream"],
      ["group", "Group"],
      ["assigned_work", "Assigned work"],
    ];
    const allowedScopes = Array.isArray(permission.allowedScopes) && permission.allowedScopes.length
      ? permission.allowedScopes : ["organisation"];
    const targetOptions = [
      ...data.offices.offices.map((item) => ({ id: item.id, name: item.name, scope: "office" })),
      ...data.departments.departments.map((item) => ({ id: item.id, name: item.name, scope: "organisation_department" })),
      ...data.workContext.clients.map((item) => ({ id: item.id, name: item.name, scope: "client" })),
      ...data.workContext.clientWorkstreams.map((item) => ({ id: item.id, name: item.name, scope: "client_workstream" })),
      ...data.workContext.groups.map((item) => ({ id: item.id, name: item.name, scope: "group" })),
    ];
    const addGrantEditor = (initialGrant = {}) => {
      const entry = document.createElement("div");
      entry.className = "role-grant-entry";
      const scope = document.createElement("select");
      scope.className = "role-scope";
      scope.setAttribute("aria-label", permission.key + " scope");
      scopeLabels.filter(([value]) => allowedScopes.includes(value)).forEach(([value, labelText]) => {
        scope.append(adminOption(value, labelText));
      });
      if (initialGrant.scope && !allowedScopes.includes(initialGrant.scope)) {
        scope.append(adminOption(initialGrant.scope, "Saved scope — review"));
      }
      scope.value = initialGrant.scope || leastPrivilegedRoleScope(allowedScopes);
      const targetSelect = document.createElement("select");
      targetSelect.className = "role-target";
      targetSelect.setAttribute("aria-label", permission.key + " scope target");
      targetSelect.append(adminOption("", "Choose scope target"));
      targetOptions.forEach((target) => {
        const option = adminOption(target.id, target.name);
        option.dataset.targetScope = target.scope;
        targetSelect.append(option);
      });
      const initialTargetId = initialGrant.officeId || initialGrant.organisationDepartmentId || initialGrant.clientId ||
        initialGrant.clientWorkstreamId || initialGrant.groupId || "";
      if (initialTargetId && !targetOptions.some((target) => target.id === initialTargetId)) {
        const option = adminOption(initialTargetId, "Saved target — review");
        option.dataset.targetScope = initialGrant.scope;
        targetSelect.append(option);
      }
      const updateTarget = () => {
        targetSelect.hidden = !["office", "organisation_department", "client", "client_workstream", "group"].includes(scope.value);
        targetSelect.required = !targetSelect.hidden;
        targetSelect.querySelectorAll("option[data-target-scope]").forEach((option) => {
          option.hidden = option.dataset.targetScope !== scope.value;
        });
        if (targetSelect.hidden) targetSelect.value = "";
      };
      scope.addEventListener("change", () => {
        targetSelect.value = "";
        updateTarget();
      });
      const removeGrant = adminButton("Remove scope", () => {
        entry.remove();
        if (!grantList.children.length) {
          checkbox.checked = false;
          addGrantButton.hidden = true;
        }
      }, true);
      updateTarget();
      targetSelect.value = initialTargetId;
      entry.append(scope, targetSelect, removeGrant);
      grantList.append(entry);
    };
    const addGrantButton = adminButton("Add scope or target", () => {
      const previousScope = grantList.lastElementChild?.querySelector(".role-scope")?.value;
      addGrantEditor({ scope: previousScope || leastPrivilegedRoleScope(allowedScopes) });
    }, true);
    addGrantButton.classList.add("role-add-grant");
    addGrantButton.hidden = true;
    row.createGrantEditor = addGrantEditor;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (!grantList.children.length) addGrantEditor();
        addGrantButton.hidden = false;
      } else {
        grantList.replaceChildren();
        addGrantButton.hidden = true;
      }
    });
    const grantControls = document.createElement("div");
    grantControls.className = "role-grant-controls";
    grantControls.append(grantList, addGrantButton);
    row.append(heading, grantControls);
    permissionGrid.append(row);
  });
  roleForm.append(permissionGrid);
  const roleActions = document.createElement("div");
  roleActions.className = "form-actions full";
  const roleSubmit = document.createElement("button");
  roleSubmit.className = "button";
  roleSubmit.type = "submit";
  roleSubmit.textContent = "Create role";
  const roleCancel = adminButton("Clear", () => clearAdminRoleForm(), true);
  roleActions.append(roleSubmit, roleCancel);
  roleForm.append(roleActions);
  roleForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const form = event.currentTarget;
    const roleGrantResult = collectRolePermissionGrants([...form.querySelectorAll(".permission-row")].map((row) => ({
      permissionKey: row.dataset.permission,
      enabled: row.querySelector(".permission-check").checked,
      grants: [...row.querySelectorAll(".role-grant-entry")].map((entry) => ({
        scope: entry.querySelector(".role-scope").value,
        targetId: entry.querySelector(".role-target").value,
      })),
    })));
    if (roleGrantResult.error) {
      setMessage(errorMessages[roleGrantResult.error] || errorMessages.ROLE_INPUT_INVALID, "error");
      return;
    }
    const grants = roleGrantResult.grants;
    const values = formValues(form);
    const policy = Object.fromEntries(policyNames.map(([name]) => [name, values[name] === "on"]));
    const body = {
      key: values.key,
      name: values.name,
      permissionGrants: grants,
      operationalPolicy: policy,
      ...(state.adminRoleId ? { expectedRevision: Number(values.expectedRevision) } : {}),
    };
    if (state.adminRoleId) {
      try {
        await api("/api/roles/" + state.adminRoleId, requestOptions("PATCH", body));
      } catch (error) {
        if (error?.code === "ROLE_VERSION_CONFLICT") state.adminRoleId = null;
        throw error;
      }
      clearAdminRoleForm();
      setMessage("Role updated.");
    } else {
      await api("/api/roles", requestOptions("POST", body));
      setMessage("Role created.");
    }
  }));
  roleForm.hidden = !hasAdminPermission(data, "roles.create");
  rolesSection.append(roleForm);
  const rolesList = document.createElement("div");
  rolesList.className = "stack";
  data.roles.roles.forEach((role) => {
    const item = document.createElement("article");
    item.className = "list-item";
    const title = document.createElement("strong");
    title.textContent = role.name + " (" + role.key + ")";
    const meta = document.createElement("span");
    meta.className = "small";
    meta.textContent = role.isProtected ? "Protected role" : (role.archivedAt ? "Archived" : "Custom role");
    item.append(title, meta);
    if (!role.isProtected && !role.archivedAt && hasAdminPermission(data, "roles.edit")) {
      item.append(adminButton("Edit", () => editAdminRole(role), true));
    }
    rolesList.append(item);
  });
  rolesSection.append(rolesList);
  const roleReadFailed = replaceSectionWithReadFailures(rolesSection, [
    [data.roles, "roles"],
    [data.permissions, "the role permission catalogue"],
  ]);
  if (!roleReadFailed) {
    const scopeTargetFailures = [
      [data.offices, "office scope targets"],
      [data.departments, "department scope targets"],
      [data.workContext, "client and workstream scope targets"],
    ].map(([result, resource]) => adminReadFailure(result, resource)).filter(Boolean);
    if (scopeTargetFailures.length) roleForm.replaceChildren(...scopeTargetFailures);
  }
  target.append(rolesSection);

  target.append(renderWorkAdminSection(data));
  const taskCatalogTools = renderTaskCatalogTools(data.taskCatalog);
  if (taskCatalogTools) target.append(taskCatalogTools);

  const peopleSection = adminSection("People and onboarding", "Invite people, complete their operational setup, and freeze access without rewriting history.");
  const inviteForm = document.createElement("form");
  inviteForm.className = "form-grid";
  inviteForm.append(adminField("Full name", "displayName", "text", "", true));
  inviteForm.append(adminField("Work email", "email", "email", "", true));
  const inviteActions = document.createElement("div");
  inviteActions.className = "form-actions full";
  const inviteSubmit = document.createElement("button");
  inviteSubmit.className = "button";
  inviteSubmit.type = "submit";
  inviteSubmit.textContent = "Send invitation";
  inviteActions.append(inviteSubmit);
  inviteForm.append(inviteActions);
  inviteForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const result = await api("/api/people/invitations", requestOptions("POST", formValues(event.currentTarget)));
    reflectInvitationDelivery(result);
  }));
  if (hasAdminPermission(data, "people.invite")) peopleSection.append(inviteForm);
  else peopleSection.append(noticeElement("You do not have permission to invite people.", "warning"));
  const peopleList = document.createElement("div");
  peopleList.className = "stack";
  data.people.people.forEach((person) => peopleList.append(renderAdminPerson(person, data)));
  peopleSection.append(peopleList);
  const peopleReadFailure = adminReadFailure(data.people, "people");
  if (peopleReadFailure) peopleList.append(peopleReadFailure);
  else if (!peopleList.children.length) peopleList.append(noticeElement("No people are available.", "warning"));
  target.append(peopleSection);

  const ownerSection = adminSection("Ownership transfer", "Transfer the protected Super Admin role to an active or notice person. The current owner's sessions are revoked and the action is audited.");
  const ownerForm = document.createElement("form");
  ownerForm.className = "form-grid";
  const ownerTarget = document.createElement("select");
  ownerTarget.name = "targetPersonId";
  ownerTarget.required = true;
  ownerTarget.append(adminOption("", "Choose new owner"));
  data.people.people.filter((person) => ["active", "notice"].includes(person.status)).forEach((person) => ownerTarget.append(adminOption(person.id, person.displayName || person.email)));
  const ownerLabel = document.createElement("label");
  ownerLabel.textContent = "New owner";
  ownerLabel.append(ownerTarget);
  ownerForm.append(ownerLabel, adminField("Type confirmation", "confirmation", "text", "", true), adminSubmit("Transfer ownership", true));
  ownerForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    await api("/api/organisation/owner-transfer", requestOptions("POST", formValues(event.currentTarget)));
    setMessage("Ownership transferred. Your current sessions may now be revoked.");
  }));
  if (peopleReadFailure) ownerSection.append(adminReadFailure(data.people, "people needed for ownership transfer"));
  else ownerSection.append(ownerForm);
  if (data.actorGrants.isSuperAdmin === true) target.append(ownerSection);

  const leaveSection = adminSection("Leave review", "Approve or reject pending requests. Attendance conflicts are returned for explicit recovery instead of being changed silently.");
  const leaveList = document.createElement("div");
  leaveList.className = "stack";
  const pending = data.leavePending && data.leavePending.requests || [];
  const leaveReadFailure = adminReadFailure(data.leavePending, "pending leave requests");
  if (leaveReadFailure) leaveList.append(leaveReadFailure);
  else if (!pending.length) leaveList.append(noticeElement("No pending leave requests.", "warning"));
  pending.forEach((leave) => {
    const item = document.createElement("article");
    item.className = "list-item";
    const title = document.createElement("strong");
    title.textContent = leave.leaveType + " · " + leave.startDate + "–" + leave.endDate;
    const meta = document.createElement("span");
    meta.className = "small";
    meta.textContent = (leave.reason || "No reason supplied") + " · " + leave.status;
    const actions = document.createElement("div");
    actions.className = "form-actions";
    actions.append(
      adminButton("Approve", async () => {
        try { await api("/api/leave/" + leave.id + "/review", requestOptions("POST", { decision: "approved" })); setMessage("Leave approved."); }
        catch (error) { setMessage(errorText(error), "error"); }
        render();
      }),
      adminButton("Reject", async () => {
        try { await api("/api/leave/" + leave.id + "/review", requestOptions("POST", { decision: "rejected" })); setMessage("Leave rejected."); }
        catch (error) { setMessage(errorText(error), "error"); }
        render();
      }, true),
    );
    if (leave.hasConflict) {
      actions.append(
        adminButton("Approve, preserve attendance", () => resolveLeaveConflict(leave.id, "approved")),
        adminButton("Reject after conflict", () => resolveLeaveConflict(leave.id, "rejected"), true),
      );
    }
    item.append(title, meta, actions);
    leaveList.append(item);
  });
  leaveSection.append(leaveList);
  target.append(leaveSection);

  const wfhReviewSection = adminSection("WFH review", "Review requests using the configurable availability.wfh.review permission. Approval is rechecked against current policy and assignment rules.");
  const wfhReviewList = document.createElement("div");
  wfhReviewList.className = "stack";
  const pendingWfh = data.wfhPending && data.wfhPending.requests || [];
  const wfhReadFailure = adminReadFailure(data.wfhPending, "pending WFH requests");
  if (wfhReadFailure) wfhReviewList.append(wfhReadFailure);
  else if (!pendingWfh.length) wfhReviewList.append(noticeElement("No pending WFH requests.", "warning"));
  pendingWfh.forEach((item) => {
    const row = document.createElement("article");
    row.className = "list-item";
    const title = document.createElement("strong");
    title.textContent = item.startDate + "–" + item.endDate;
    const meta = document.createElement("span");
    meta.className = "small";
    meta.textContent = (item.reason || "No reason supplied") + " · " + item.status;
    const actions = document.createElement("div");
    actions.className = "form-actions";
    actions.append(
      adminButton("Approve", async () => {
        try { await api("/api/availability/wfh/" + item.id + "/review", requestOptions("POST", { decision: "approved" })); setMessage("WFH approved."); }
        catch (error) { setMessage(errorText(error), "error"); }
        render();
      }),
      adminButton("Reject", async () => {
        try { await api("/api/availability/wfh/" + item.id + "/review", requestOptions("POST", { decision: "rejected" })); setMessage("WFH rejected."); }
        catch (error) { setMessage(errorText(error), "error"); }
        render();
      }, true),
    );
    row.append(title, meta, actions);
    wfhReviewList.append(row);
  });
  wfhReviewSection.append(wfhReviewList);
  target.append(wfhReviewSection);

  const exceptionSection = adminSection("Historical exceptions", "Availability changes never delete attendance. Review and close the preserved exception explicitly.");
  const exceptionList = document.createElement("div");
  exceptionList.className = "stack";
  const exceptions = data.exceptions && data.exceptions.exceptions || [];
  const exceptionReadFailure = adminReadFailure(data.exceptions, "historical exceptions");
  if (exceptionReadFailure) exceptionList.append(exceptionReadFailure);
  else if (!exceptions.length) exceptionList.append(noticeElement("No historical exceptions.", "warning"));
  exceptions.forEach((exception) => {
    const item = document.createElement("article");
    item.className = "list-item";
    const title = document.createElement("strong");
    title.textContent = exception.code + " · " + (exception.businessDate || "undated") + " · " + exception.status;
    const meta = document.createElement("span");
    meta.className = "small";
    meta.textContent = exception.sourceType + " · " + exception.sourceId;
    item.append(title, meta);
    if (exception.status === "open" && exception.code === "availability.leave_attendance_conflict") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent = "Resolve this from the linked pending leave request; generic exception dismissal is blocked.";
      item.append(note);
    } else if (exception.status === "open" && hasAdminPermission(data, "availability.exception.resolve")) {
      const form = document.createElement("form");
      form.className = "form-grid";
      form.innerHTML = '<label>Resolution note<input name="note" required maxlength="2000"></label>' +
        '<label>Outcome<select name="status"><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label>' +
        '<div class="form-actions"><button class="button" type="submit">Close exception</button></div>';
      form.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
        const values = formValues(event.currentTarget);
        await api("/api/historical-exceptions/" + exception.id + "/resolve", requestOptions("POST", values));
        setMessage("Historical exception closed.");
      }));
      item.append(form);
    }
    exceptionList.append(item);
  });
  exceptionSection.append(exceptionList);
  target.append(exceptionSection);

  const auditSection = adminSection("Audit history", "Immutable organisation actions are shown newest first.");
  const auditList = document.createElement("div");
  auditList.className = "stack";
  data.audit.events.forEach((event) => {
    const item = document.createElement("p");
    item.className = "list-item";
    item.textContent = new Date(event.occurredAt).toLocaleString() + " · " + event.action + " · " + (event.actorName || "System");
    auditList.append(item);
  });
  const auditReadFailure = adminReadFailure(data.audit, "audit history");
  if (auditReadFailure) auditList.append(auditReadFailure);
  else if (!data.audit.events.length) {
    auditList.append(noticeElement("No audit events yet.", "warning"));
  }
  auditSection.append(auditList);
  target.append(auditSection);
}

function renderWorkAdminSection(data) {
  const context = data.workContext || { clients: [], clientWorkstreams: [], organisationWorkstreams: [], groups: [] };
  const people = (data.people && data.people.people || []).filter((person) => ["active", "notice"].includes(person.status));
  const assignablePeople = people.filter((person) => person.canReceiveAssignments === true);
  const section = adminSection("Client work and task operations", "Create portable work context, assign work, and preserve task history. Every command is checked again by the API.");
  const contextReadFailure = adminReadFailure(data.workContext, "work context");
  if (contextReadFailure) {
    section.append(contextReadFailure);
    return section;
  }
  const peopleReadFailure = adminReadFailure(data.people, "people choices for task assignment");
  const forms = document.createElement("div");
  forms.className = "split";

  const clientForm = document.createElement("form");
  clientForm.className = "form-grid";
  clientForm.append(adminField("Client name", "name", "text", "", true));
  clientForm.append(adminSubmit("Create client"));
  clientForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    await api("/api/clients", requestOptions("POST", formValues(event.currentTarget)));
    setMessage("Client created.");
  }));

  const clientWorkstreamForm = document.createElement("form");
  clientWorkstreamForm.className = "form-grid";
  clientWorkstreamForm.append(adminField("Client workstream", "name", "text", "", true));
  const clientSelect = document.createElement("select");
  clientSelect.name = "clientId";
  clientSelect.required = true;
  clientSelect.append(adminOption("", "Choose client"));
  const creatableClients = context.clients.filter((client) =>
    hasAdminPermission(data, "workstreams.create", { clientId: client.id }));
  creatableClients.forEach((client) => clientSelect.append(adminOption(client.id, client.name)));
  const clientLabel = document.createElement("label");
  clientLabel.textContent = "Client";
  clientLabel.append(clientSelect);
  clientWorkstreamForm.append(clientLabel, adminSubmit("Create client workstream"));
  clientWorkstreamForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    await api("/api/workstreams/client", requestOptions("POST", formValues(event.currentTarget)));
    setMessage("Client workstream created.");
  }));

  const organisationWorkstreamForm = document.createElement("form");
  organisationWorkstreamForm.className = "form-grid";
  organisationWorkstreamForm.append(adminField("Organisation workstream", "name", "text", "", true));
  organisationWorkstreamForm.append(adminSubmit("Create organisation workstream"));
  organisationWorkstreamForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    await api("/api/workstreams/organisation", requestOptions("POST", formValues(event.currentTarget)));
    setMessage("Organisation workstream created.");
  }));

  const groupForm = document.createElement("form");
  groupForm.className = "form-grid";
  groupForm.append(adminField("Group name", "name", "text", "", true));
  const groupContext = document.createElement("select");
  groupContext.name = "contextId";
  groupContext.required = true;
  groupContext.append(adminOption("", "Choose workstream"));
  context.clientWorkstreams.forEach((workstream) => {
    if (!hasAdminPermission(data, "groups.create", { clientWorkstreamId: workstream.id })) return;
    const option = adminOption("client:" + workstream.id, "Client · " + workstream.name);
    option.dataset.contextType = "client";
    groupContext.append(option);
  });
  context.organisationWorkstreams.forEach((workstream) => {
    if (!hasAdminPermission(data, "groups.create")) return;
    const option = adminOption("organisation:" + workstream.id, "Organisation · " + workstream.name);
    option.dataset.contextType = "organisation";
    groupContext.append(option);
  });
  const groupContextLabel = document.createElement("label");
  groupContextLabel.textContent = "Workstream";
  groupContextLabel.append(groupContext);
  groupForm.append(groupContextLabel, adminSubmit("Create group"));
  groupForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    const [kind, id] = values.contextId.split(":");
    await api("/api/work-groups", requestOptions("POST", {
      name: values.name,
      ...(kind === "client" ? { clientWorkstreamId: id } : { organisationWorkstreamId: id }),
    }));
    setMessage("Work group created.");
  }));

  const workstreamHeading = document.createElement("h3");
  workstreamHeading.className = "full";
  workstreamHeading.textContent = "Context setup";
  if (hasAdminPermission(data, "clients.create")) forms.append(clientForm);
  if (creatableClients.length) forms.append(clientWorkstreamForm);
  if (hasAdminPermission(data, "workstreams.create")) forms.append(organisationWorkstreamForm);
  if (groupContext.options.length > 1) forms.append(groupForm);
  if (forms.childElementCount) forms.prepend(workstreamHeading);
  else forms.append(noticeElement("You do not have permission to create clients, workstreams, or groups in the visible scope.", "warning"));
  section.append(forms);
  const billingPolicyTools = renderBillingPolicyTools(context.clientWorkstreams, data.taskCatalog);
  if (billingPolicyTools) section.append(billingPolicyTools);
  const taskCatalogReadFailure = adminReadFailure(data.taskCatalog, "reusable task defaults");
  if (taskCatalogReadFailure) section.append(taskCatalogReadFailure);

  const taskForm = document.createElement("form");
  taskForm.className = "form-grid";
  taskForm.append(adminField("Task title", "title", "text", "", true));
  const taskContext = document.createElement("select");
  taskContext.name = "contextId";
  taskContext.required = true;
  taskContext.append(adminOption("", "Choose workstream"));
  const taskCreationTargets = context.taskCreationTargets || [];
  taskCreationTargets.forEach((workstream) => taskContext.append(adminOption(
    workstream.kind + ":" + workstream.id,
    (workstream.kind === "client" ? "Client · " + workstream.clientName + " / " : "Organisation · ") +
      workstream.name + (workstream.billingPolicyClass
        ? " · " + (workstream.billingPolicyClass === "billable" ? "billable policy" : "non-billable policy")
        : " · policy setup required"),
  )));
  const taskContextLabel = document.createElement("label");
  taskContextLabel.textContent = "Workstream";
  taskContextLabel.append(taskContext);
  taskForm.append(taskContextLabel);
  const taskCatalogSelect = appendTaskCatalogSelector(taskForm, data.taskCatalog);
  const correctionReadFailure = adminReadFailure(data.tasks, "existing tasks for correction links");
  if (correctionReadFailure) taskForm.append(correctionReadFailure);
  else appendTaskCorrectionFields(taskForm, data.tasks && data.tasks.tasks || [], taskContext);
  const taskGroup = document.createElement("select");
  taskGroup.name = "workGroupId";
  taskGroup.append(adminOption("", "No group"));
  context.groups.forEach((group) => {
    const option = adminOption(group.id, group.name);
    option.dataset.clientWorkstreamId = group.clientWorkstreamId || "";
    option.dataset.organisationWorkstreamId = group.organisationWorkstreamId || "";
    taskGroup.append(option);
  });
  const taskGroupLabel = document.createElement("label");
  taskGroupLabel.textContent = "Group (optional)";
  taskGroupLabel.append(taskGroup);
  taskForm.append(taskGroupLabel);
  const department = document.createElement("select");
  department.name = "organisationDepartmentId";
  department.append(adminOption("", "No department"));
  (data.departments && data.departments.departments || []).forEach((entry) => department.append(adminOption(entry.id, entry.name)));
  const departmentLabel = document.createElement("label");
  departmentLabel.textContent = "Department (optional)";
  departmentLabel.append(department);
  const departmentReadFailure = adminReadFailure(data.departments, "department choices");
  if (departmentReadFailure) taskForm.append(departmentReadFailure);
  else taskForm.append(departmentLabel);
  const priority = document.createElement("select");
  priority.name = "priority";
  [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]].forEach(([value, label]) => priority.append(adminOption(value, label, "normal")));
  const priorityLabel = document.createElement("label");
  priorityLabel.textContent = "Priority";
  priorityLabel.append(priority);
  taskForm.append(priorityLabel);
  taskForm.append(adminField("Due date", "dueDate", "date", "", false));
  const description = document.createElement("label");
  description.className = "full";
  description.textContent = "Description";
  const descriptionInput = document.createElement("textarea");
  descriptionInput.name = "description";
  descriptionInput.maxLength = 10000;
  description.append(descriptionInput);
  const selfAssignLabel = document.createElement("label");
  selfAssignLabel.className = "check full";
  const selfAssign = document.createElement("input");
  selfAssign.type = "checkbox";
  selfAssign.name = "assignToSelf";
  selfAssign.disabled = context.canReceiveAssignments !== true;
  selfAssignLabel.append(selfAssign, document.createTextNode("Assign this task to me now (client work will still require review)"));
  taskForm.append(description, selfAssignLabel);
  if (context.canReceiveAssignments !== true) {
    const assignmentPolicyHint = document.createElement("p");
    assignmentPolicyHint.className = "small full";
    assignmentPolicyHint.textContent = "Your current role or status cannot receive assignments. You can still create the task without assigning it to yourself.";
    taskForm.append(assignmentPolicyHint);
  }
  taskForm.append(adminSubmit("Create task", true));
  const refreshTaskGroups = () => {
    const [kind, id] = taskContext.value.split(":");
    taskGroup.querySelectorAll("option[data-client-workstream-id]").forEach((option) => {
      const matches = kind === "client" ? option.dataset.clientWorkstreamId === id : option.dataset.organisationWorkstreamId === id;
      option.hidden = !matches;
    });
    if (taskGroup.selectedOptions[0]?.hidden) taskGroup.value = "";
  };
  taskContext.addEventListener("change", refreshTaskGroups);
  taskForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    const [kind, id] = values.contextId.split(":");
    const payload = {
      title: values.title,
      ...(kind === "client" ? { clientWorkstreamId: id } : { organisationWorkstreamId: id }),
      ...taskCatalogProvenance(taskCatalogSelect),
      ...(values.workGroupId ? { workGroupId: values.workGroupId } : {}),
      ...(values.organisationDepartmentId ? { organisationDepartmentId: values.organisationDepartmentId } : {}),
      description: values.description || null,
      priority: values.priority,
      dueDate: values.dueDate || null,
      correctionOfTaskId: values.correctionOfTaskId || null,
      correctionReason: values.correctionReason || null,
      assignToSelf: values.assignToSelf === "on",
    };
    const createdTask = await api("/api/tasks", requestOptions(
      "POST", payload, taskCreateIdempotencyHeaders(payload),
    ));
    clearTaskCreateIdempotency(payload);
    setMessage("Task created · " + taskBillingConfirmation(createdTask) + taskCorrectionConfirmation(Boolean(values.correctionOfTaskId)));
  }));
  const taskSection = adminSection("Create task", "Tasks belong to exactly one organisation or client workstream. Assignment and review are separate records.");
  if (taskCreationTargets.length) taskSection.append(taskForm);
  else taskSection.append(noticeElement("You do not have permission to create tasks in a visible workstream.", "warning"));
  section.append(taskSection);

  const taskListSection = adminSection("Tasks and assignments", "Visible tasks are listed with their assignment history. Cancel closes future work and preserves recorded history.");
  const taskList = document.createElement("div");
  taskList.className = "stack";
  if (peopleReadFailure) taskListSection.append(peopleReadFailure);
  const tasks = data.tasks && data.tasks.tasks || [];
  const taskReadFailure = adminReadFailure(data.tasks, "tasks");
  if (taskReadFailure) taskList.append(taskReadFailure);
  else if (!tasks.length) taskList.append(noticeElement("No visible tasks yet.", "warning"));
  tasks.forEach((task) => {
    const item = document.createElement("article");
    item.className = "list-item";
    const title = document.createElement("strong");
    title.textContent = task.title;
    const contextText = task.client ? task.client.name + " / " : "Organisation / ";
    const meta = document.createElement("p");
    meta.className = "small";
    meta.textContent = contextText + (task.workstream && task.workstream.name || "workstream") + " · " + task.status + " · " + task.priority +
      " · " + taskBillingConfirmation(task) + " · " + taskDefinitionProvenance(task) +
      (task.dueDate ? " · due " + task.dueDate : "");
    item.append(title, meta);
    const dueDateEditor = taskDueDateEditor(task, () => render());
    if (dueDateEditor) item.append(dueDateEditor);
    if (task.isCorrection) {
      const correction = document.createElement("p");
      correction.className = "small";
      correction.textContent = "Correction task" + (task.correctionOf ? " for “" + task.correctionOf.title + "”" : "") +
        (task.correctionReason ? " · " + task.correctionReason : "");
      item.append(correction);
    }
    if (task.description) {
      const detail = document.createElement("p");
      detail.className = "small";
      detail.textContent = task.description;
      item.append(detail);
    }
    const assignmentList = document.createElement("div");
    assignmentList.className = "stack";
    (task.assignments || []).forEach((assignment) => {
      const assignmentRow = document.createElement("div");
      assignmentRow.className = "list-item";
      const assignmentText = document.createElement("span");
      assignmentText.textContent = assignment.personName + " · " + assignment.status +
        (assignment.reviewerName ? " · reviewer " + assignment.reviewerName : "") +
        (assignment.reviewRequired ? " · review required" : "") +
        (assignment.resolutionSource === "policy" ? " · completed without review" : "") +
        (assignment.reviewBlockedReason ? " · review blocked: no eligible reviewer" : "");
      assignmentRow.append(assignmentText);
      if (!peopleReadFailure && !["cancelled", "approved"].includes(assignment.status)) {
        const reassignForm = document.createElement("form");
        reassignForm.className = "form-actions";
        const reassignPerson = document.createElement("select");
        reassignPerson.name = "personId";
        reassignPerson.required = true;
        reassignPerson.append(adminOption("", "Choose replacement"));
        assignablePeople.filter((person) => person.id !== assignment.personId).forEach((person) => reassignPerson.append(adminOption(person.id, person.displayName)));
        reassignForm.append(reassignPerson, adminSubmit("Reassign", true));
        reassignForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
          const values = formValues(event.currentTarget);
          await api("/api/task-assignments/" + assignment.id + "/reassign", requestOptions("POST", { personId: values.personId }));
          setMessage("Assignment reassigned; recorded history was preserved.");
        }));
        assignmentRow.append(reassignForm);
      }
      assignmentList.append(assignmentRow);
    });
    item.append(assignmentList);
    if (!["cancelled", "done"].includes(task.status)) {
      const actions = document.createElement("div");
      actions.className = "form-actions";
      actions.append(adminButton("Cancel task", async () => {
        if (!window.confirm("Cancel this task? Recorded work remains preserved.")) return;
        try { await api("/api/tasks/" + task.id + "/cancel", requestOptions("POST")); setMessage("Task cancelled; recorded history was preserved."); }
        catch (error) { setMessage(errorText(error), "error"); }
        render();
      }, true));
      if (!peopleReadFailure) item.append(actions);
      const assignmentForm = document.createElement("form");
      assignmentForm.className = "form-grid";
      const assignee = document.createElement("select");
      assignee.name = "personId";
      assignee.required = true;
      assignee.append(adminOption("", "Choose assignee"));
      assignablePeople.forEach((person) => assignee.append(adminOption(person.id, person.displayName)));
      const assigneeLabel = document.createElement("label");
      assigneeLabel.textContent = "Assignee";
      assigneeLabel.append(assignee);
      assignmentForm.append(assigneeLabel);
      const reviewer = document.createElement("select");
      reviewer.name = "reviewerPersonId";
      reviewer.append(adminOption("", "No reviewer"));
      people.forEach((person) => reviewer.append(adminOption(person.id, person.displayName)));
      const reviewerLabel = document.createElement("label");
      reviewerLabel.textContent = "Reviewer";
      reviewerLabel.append(reviewer);
      assignmentForm.append(reviewerLabel);
      const reviewRequiredLabel = document.createElement("label");
      reviewRequiredLabel.className = "check";
      const reviewRequired = document.createElement("input");
      reviewRequired.type = "checkbox";
      reviewRequired.name = "reviewRequired";
      reviewRequired.checked = true;
      reviewRequiredLabel.append(reviewRequired, document.createTextNode("Review required"));
      assignmentForm.append(reviewRequiredLabel, adminSubmit("Assign task", true));
      assignmentForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
        const values = formValues(event.currentTarget);
        await api("/api/tasks/" + task.id + "/assignments", requestOptions("POST", {
          personId: values.personId,
          reviewerPersonId: values.reviewerPersonId || null,
          reviewRequired: values.reviewRequired === "on",
        }));
        setMessage("Task assigned.");
      }));
      if (!peopleReadFailure) item.append(assignmentForm);
    }
    taskList.append(item);
  });
  taskListSection.append(taskList);
  section.append(taskListSection);
  return section;
}

function adminSubmit(text, secondary) {
  const actions = document.createElement("div");
  actions.className = "form-actions full";
  const button = document.createElement("button");
  button.className = "button" + (secondary ? " secondary" : "");
  button.type = "submit";
  button.textContent = text;
  actions.append(button);
  return actions;
}

async function resolveLeaveConflict(leaveId, decision) {
  const note = window.prompt("Explain the attendance recovery decision:");
  if (!note || !note.trim()) return;
  try {
    await api("/api/leave/" + leaveId + "/resolve-conflict", requestOptions("POST", { decision, note }));
    setMessage(decision === "approved" ? "Leave approved; attendance was preserved." : "Leave rejected; attendance was preserved.");
  } catch (error) {
    setMessage(errorText(error), "error");
  }
  render();
}

function renderAvailabilitySection(data) {
  const availability = data.availability || { shifts: [], calendars: [], holidays: [] };
  const section = adminSection("Availability configuration", "Define fixed shifts, office working calendars, holidays, and effective WFH eligibility rules.");
  const availabilityReadFailure = adminReadFailure(data.availability, "availability configuration");
  if (availabilityReadFailure) {
    section.append(availabilityReadFailure);
    return section;
  }
  const forms = document.createElement("div");
  forms.className = "split";

  const shiftForm = document.createElement("form");
  shiftForm.className = "form-grid";
  shiftForm.append(adminField("Shift name", "name", "text", "", true));
  shiftForm.append(adminField("Start (local time)", "startLocalTime", "time", "09:30", true));
  shiftForm.append(adminField("End (local time)", "endLocalTime", "time", "18:30", true));
  shiftForm.append(adminField("Break start", "breakStartLocalTime", "time", "13:00", false));
  shiftForm.append(adminField("Break end", "breakEndLocalTime", "time", "14:00", false));
  shiftForm.append(adminField("Grace minutes", "graceMinutes", "number", "0", true));
  const overtimeLabel = document.createElement("label");
  overtimeLabel.className = "check full";
  const overtime = document.createElement("input");
  overtime.type = "checkbox";
  overtime.name = "overtimeEnabled";
  overtimeLabel.append(overtime, document.createTextNode("Overtime may be recorded"));
  shiftForm.append(overtimeLabel);
  const shiftActions = document.createElement("div");
  shiftActions.className = "form-actions full";
  const shiftSubmit = document.createElement("button");
  shiftSubmit.className = "button";
  shiftSubmit.type = "submit";
  shiftSubmit.textContent = "Create shift";
  shiftActions.append(shiftSubmit);
  shiftForm.append(shiftActions);
  shiftForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    await api("/api/availability/shifts", requestOptions("POST", {
      ...values,
      graceMinutes: Number(values.graceMinutes),
      overtimeEnabled: values.overtimeEnabled === "on",
      breakStartLocalTime: values.breakStartLocalTime || undefined,
      breakEndLocalTime: values.breakEndLocalTime || undefined,
    }));
    setMessage("Shift created.");
  }));

  const calendarForm = document.createElement("form");
  calendarForm.className = "form-grid";
  calendarForm.append(adminField("Calendar name", "name", "text", "", true));
  const calendarOffice = document.createElement("select");
  calendarOffice.name = "officeId";
  calendarOffice.required = true;
  calendarOffice.append(adminOption("", "Choose office"));
  data.offices.offices.forEach((office) => calendarOffice.append(adminOption(office.id, office.name)));
  const calendarOfficeLabel = document.createElement("label");
  calendarOfficeLabel.textContent = "Office";
  calendarOfficeLabel.append(calendarOffice);
  calendarForm.append(calendarOfficeLabel);
  calendarForm.append(adminField("Effective from", "effectiveOn", "date", new Date().toISOString().slice(0, 10), true));
  const weekHeading = document.createElement("h3");
  weekHeading.className = "full";
  weekHeading.textContent = "Weekly rules";
  calendarForm.append(weekHeading);
  const weekGrid = document.createElement("div");
  weekGrid.className = "availability-week-grid full";
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  weekdayNames.forEach((weekdayName, weekday) => {
    const row = document.createElement("div");
    row.className = "availability-rule-row";
    row.dataset.weekday = String(weekday);
    const title = document.createElement("strong");
    title.textContent = weekdayName;
    const workingLabel = document.createElement("label");
    workingLabel.className = "check";
    const working = document.createElement("input");
    working.type = "checkbox";
    working.className = "availability-working";
    working.checked = weekday > 0 && weekday < 6;
    workingLabel.append(working, document.createTextNode("Working"));
    const shift = document.createElement("select");
    shift.className = "availability-shift";
    shift.append(adminOption("", "Choose shift"));
    availability.shifts.forEach((entry) => shift.append(adminOption(entry.id, entry.name)));
    shift.disabled = !working.checked;
    working.addEventListener("change", () => {
      shift.disabled = !working.checked;
      if (!working.checked) shift.value = "";
    });
    row.append(title, workingLabel, shift);
    weekGrid.append(row);
  });
  calendarForm.append(weekGrid);
  const calendarActions = document.createElement("div");
  calendarActions.className = "form-actions full";
  const calendarSubmit = document.createElement("button");
  calendarSubmit.className = "button";
  calendarSubmit.type = "submit";
  calendarSubmit.textContent = "Create calendar";
  calendarActions.append(calendarSubmit);
  calendarForm.append(calendarActions);
  calendarForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    const rules = [...event.currentTarget.querySelectorAll(".availability-rule-row")].map((row) => {
      const working = row.querySelector(".availability-working");
      const shift = row.querySelector(".availability-shift");
      const isWorking = working.checked;
      return {
        weekday: Number(row.dataset.weekday),
        ordinal: 0,
        isWorking,
        ...(isWorking ? { shiftId: shift.value } : {}),
      };
    });
    await api("/api/availability/calendars", requestOptions("POST", {
      name: values.name,
      officeId: values.officeId,
      effectiveOn: values.effectiveOn,
      rules,
    }));
    setMessage("Working calendar created and assigned to the office.");
  }));

  const holidayForm = document.createElement("form");
  holidayForm.className = "form-grid";
  holidayForm.append(adminField("Holiday name", "name", "text", "", true));
  holidayForm.append(adminField("Date", "date", "date", "", true));
  const holidayOffice = document.createElement("select");
  holidayOffice.name = "officeId";
  holidayOffice.required = true;
  holidayOffice.append(adminOption("", "Choose office"));
  data.offices.offices.forEach((office) => holidayOffice.append(adminOption(office.id, office.name)));
  const holidayOfficeLabel = document.createElement("label");
  holidayOfficeLabel.textContent = "Office";
  holidayOfficeLabel.append(holidayOffice);
  holidayForm.append(holidayOfficeLabel);
  const holidayActions = document.createElement("div");
  holidayActions.className = "form-actions full";
  const holidaySubmit = document.createElement("button");
  holidaySubmit.className = "button";
  holidaySubmit.type = "submit";
  holidaySubmit.textContent = "Add holiday";
  holidayActions.append(holidaySubmit);
  holidayForm.append(holidayActions);
  holidayForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    await api("/api/availability/holidays", requestOptions("POST", formValues(event.currentTarget)));
    setMessage("Holiday added.");
  }));

  const formPanels = document.createElement("div");
  formPanels.className = "stack";
  const shiftHeading = document.createElement("h3");
  shiftHeading.textContent = "Shifts";
  if (hasAdminPermission(data, "availability.shift.manage")) {
    formPanels.append(shiftHeading, shiftForm);
  }
  const calendarHeading = document.createElement("h3");
  calendarHeading.textContent = "Working calendar";
  const officeReadFailure = adminReadFailure(data.offices, "offices for calendar and holiday setup");
  if (hasAdminPermission(data, "availability.calendar.manage")) {
    if (officeReadFailure) formPanels.append(officeReadFailure);
    else formPanels.append(calendarHeading, calendarForm);
  }
  const holidayHeading = document.createElement("h3");
  holidayHeading.textContent = "Office holiday";
  if (hasAdminPermission(data, "availability.holiday.manage")) {
    if (officeReadFailure) formPanels.append(officeReadFailure);
    else formPanels.append(holidayHeading, holidayForm);
  }

  const lists = document.createElement("div");
  lists.className = "stack";
  const shiftsHeading = document.createElement("h3");
  shiftsHeading.textContent = "Configured shifts";
  lists.append(shiftsHeading);
  availability.shifts.forEach((shift) => {
    const item = document.createElement("p");
    item.className = "list-item";
    item.textContent = shift.name + " · " + shift.startLocalTime + "–" + shift.endLocalTime + " · grace " + shift.graceMinutes + "m";
    lists.append(item);
  });
  const calendarsHeading = document.createElement("h3");
  calendarsHeading.textContent = "Assigned calendars";
  lists.append(calendarsHeading);
  availability.calendars.forEach((calendar) => {
    const item = document.createElement("p");
    item.className = "list-item";
    item.textContent = calendar.name + " · " + calendar.office.name + " · from " + calendar.effectiveOn;
    lists.append(item);
  });
  const holidaysHeading = document.createElement("h3");
  holidaysHeading.textContent = "Upcoming holidays";
  lists.append(holidaysHeading);
  availability.holidays.forEach((holiday) => {
    const item = document.createElement("p");
    item.className = "list-item";
    item.textContent = holiday.date + " · " + holiday.name + " · " + holiday.office.name;
    lists.append(item);
  });
  forms.append(formPanels, lists);
  section.append(forms);

  const wfh = data.wfhPolicies || { policies: [] };
  const wfhSection = adminSection("WFH eligibility overrides", "Most-specific effective rule wins: person, then department, then office, then role policy.");
  const wfhReadFailure = adminReadFailure(data.wfhPolicies, "WFH eligibility overrides");
  if (wfhReadFailure) {
    wfhSection.append(wfhReadFailure);
    section.append(wfhSection);
    return section;
  }
  const wfhForm = document.createElement("form");
  wfhForm.className = "form-grid";
  const targetType = document.createElement("select");
  targetType.name = "targetType";
  if (!data.offices.readError) targetType.append(adminOption("office", "Office"));
  if (!data.departments.readError) targetType.append(adminOption("organisation_department", "Department"));
  if (!data.people.readError) targetType.append(adminOption("person", "Person"));
  const targetId = document.createElement("select");
  targetId.name = "targetId";
  targetId.required = true;
  const targetLabel = document.createElement("label");
  targetLabel.textContent = "Target";
  targetLabel.append(targetId);
  const targetTypeLabel = document.createElement("label");
  targetTypeLabel.textContent = "Target type";
  targetTypeLabel.append(targetType);
  const refreshWfhTargets = () => {
    targetId.replaceChildren(adminOption("", "Choose target"));
    const source = targetType.value === "office" ? data.offices.offices
      : targetType.value === "organisation_department" ? data.departments.departments
        : targetType.value === "person" ? data.people.people : [];
    source.forEach((entry) => targetId.append(adminOption(entry.id, entry.name || entry.displayName || entry.email)));
  };
  targetType.addEventListener("change", refreshWfhTargets);
  refreshWfhTargets();
  wfhForm.append(targetTypeLabel, targetLabel);
  wfhForm.append(adminField("Effective from", "effectiveOn", "date", new Date().toISOString().slice(0, 10), true));
  wfhForm.append(adminField("Effective until (optional)", "effectiveUntil", "date", "", false));
  const allowedLabel = document.createElement("label");
  allowedLabel.className = "check";
  const allowed = document.createElement("input");
  allowed.type = "checkbox";
  allowed.name = "allowed";
  allowed.checked = true;
  allowedLabel.append(allowed, document.createTextNode("WFH allowed"));
  wfhForm.append(allowedLabel);
  wfhForm.append(adminField("Reason (optional)", "reason", "text", "", false));
  const wfhActions = document.createElement("div");
  wfhActions.className = "form-actions full";
  const wfhSubmit = document.createElement("button");
  wfhSubmit.className = "button";
  wfhSubmit.type = "submit";
  wfhSubmit.textContent = "Add WFH override";
  wfhActions.append(wfhSubmit);
  wfhForm.append(wfhActions);
  wfhForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    await api("/api/availability/wfh-policies", requestOptions("POST", {
      targetType: values.targetType,
      targetId: values.targetId,
      allowed: values.allowed === "on",
      effectiveOn: values.effectiveOn,
      effectiveUntil: values.effectiveUntil || undefined,
      reason: values.reason || undefined,
    }));
    setMessage("WFH eligibility override added.");
  }));
  const wfhList = document.createElement("div");
  wfhList.className = "stack";
  if (!wfh.policies.length) wfhList.append(noticeElement("No WFH overrides configured; role policy applies.", "warning"));
  wfh.policies.forEach((policy) => {
    const item = document.createElement("p");
    item.className = "list-item";
    item.textContent = (policy.targetName || policy.targetType) + " · " + (policy.allowed ? "allowed" : "not allowed") +
      " · from " + policy.effectiveOn + (policy.effectiveUntil ? " to " + policy.effectiveUntil : "") +
      (policy.reason ? " · " + policy.reason : "");
    wfhList.append(item);
  });
  const targetReadFailures = [
    [data.offices, "office override targets"],
    [data.departments, "department override targets"],
    [data.people, "person override targets"],
  ].map(([result, resource]) => adminReadFailure(result, resource)).filter(Boolean);
  if (hasAdminPermission(data, "availability.wfh_policy.manage") && targetType.options.length) {
    wfhSection.append(wfhForm);
  } else if (hasAdminPermission(data, "availability.wfh_policy.manage")) {
    wfhSection.append(...targetReadFailures);
  }
  wfhSection.append(wfhList);
  if (targetType.options.length && targetReadFailures.length) wfhSection.append(...targetReadFailures);
  section.append(wfhSection);
  return section;
}

function clearAdminRoleForm() {
  state.adminRoleId = null;
  const form = app.querySelector("#admin-role-form");
  if (!form) return;
  form.hidden = !hasPermissionGrant(state.adminData?.actorGrants, "roles.create");
  form.reset();
  form.querySelector("#admin-role-form-title").textContent = "Create custom role";
  form.querySelector(".role-preset-box").hidden = false;
  form.querySelector("[name=rolePreset]").value = "";
  form.querySelector(".role-preset-box [aria-live]").textContent = "";
  form.querySelector("[type=submit]").textContent = "Create role";
  form.querySelectorAll(".role-target").forEach((target) => {
    target.hidden = true;
    target.value = "";
  });
  form.querySelectorAll(".permission-row").forEach((row) => {
    row.querySelector(".permission-check").checked = false;
    row.querySelector(".role-grant-list").replaceChildren();
    row.querySelector(".role-add-grant").hidden = true;
  });
}

function editAdminRole(role) {
  if (!hasPermissionGrant(state.adminData?.actorGrants, "roles.edit")) return;
  const form = app.querySelector("#admin-role-form");
  if (!form) return;
  clearAdminRoleForm();
  form.hidden = false;
  form.querySelector(".role-preset-box").hidden = true;
  state.adminRoleId = role.id;
  form.querySelector("[name=expectedRevision]").value = String(role.revision);
  form.querySelector("[name=key]").value = role.key;
  form.querySelector("[name=name]").value = role.name;
  Object.entries(role.operationalPolicy).forEach(([name, value]) => {
    form.querySelector("[name=" + name + "]").checked = value === true;
  });
  const grantsByPermission = groupRolePermissionGrants(role.permissionGrants);
  form.querySelectorAll(".permission-row").forEach((row) => {
    const grants = grantsByPermission.get(row.dataset.permission) || [];
    const check = row.querySelector(".permission-check");
    check.checked = grants.length > 0;
    row.querySelector(".role-add-grant").hidden = grants.length === 0;
    grants.forEach((grant) => row.createGrantEditor(grant));
  });
  form.querySelector("#admin-role-form-title").textContent = "Edit custom role";
  form.querySelector("[type=submit]").textContent = "Save role";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAdminPerson(person, data) {
  const item = document.createElement("article");
  item.className = "list-item";
  const heading = document.createElement("strong");
  heading.textContent = person.displayName + " · " + person.email;
  const status = document.createElement("span");
  status.className = "small";
  status.textContent = (person.status || "unknown") + " · " +
    [person.office && person.office.name, person.department && person.department.name, person.role && person.role.name]
      .filter(Boolean).join(" · ");
  item.append(heading, status);
  const actions = document.createElement("div");
  actions.className = "form-actions";
  if (person.status === "invited" && hasAdminPermission(data, "people.invite")) {
    actions.append(adminButton("Resend invitation", async () => {
      try {
        await api("/api/people/" + person.id + "/invitations/resend", requestOptions("POST"));
        setMessage("Invitation resent.");
      } catch (error) {
        setMessage(errorText(error), "error");
      }
      render();
    }, true));
  }
  if (hasAdminPermission(data, "people.freeze") &&
    (person.status === "active" || person.status === "notice" || person.status === "onboarding")) {
    actions.append(adminButton("Freeze", async () => {
      try {
        await api("/api/people/" + person.id + "/freeze", requestOptions("POST", { reason: "Frozen by administrator" }));
        setMessage("Person frozen and existing sessions revoked.");
      } catch (error) {
        setMessage(errorText(error), "error");
      }
      render();
    }, true));
  }
  const personPermissionTarget = {
    personId: person.id,
    officeId: person.office?.id,
    organisationDepartmentId: person.department?.id,
  };
  if (hasAdminPermission(data, "people.offboard", personPermissionTarget) &&
    (person.status === "active" || person.status === "notice")) {
    actions.append(adminButton("Start offboarding", async () => {
      const reason = window.prompt("Reason for starting offboarding:");
      if (!reason || !reason.trim()) return;
      try {
        await api("/api/people/" + person.id + "/offboard", requestOptions("POST", { reason: reason.trim() }));
        setMessage("Offboarding started. Reassignments and review handover remain audited.");
      } catch (error) { setMessage(errorText(error), "error"); }
      render();
    }, true));
  }
  if (person.status === "offboarding" && hasAdminPermission(data, "people.offboard", personPermissionTarget)) {
    actions.append(adminButton("Complete exit", async () => {
      const reason = window.prompt("Reason for completing exit:");
      if (!reason || !reason.trim()) return;
      try {
        await api("/api/people/" + person.id + "/offboard", requestOptions("POST", { final: true, reason: reason.trim() }));
        setMessage("Exit completed; history was preserved.");
      } catch (error) { setMessage(errorText(error), "error"); }
      render();
    }, true));
  }
  item.append(actions);
  if (person.status === "onboarding") {
    if (![
      "people.edit",
      "people.activate",
      "roles.assign",
    ].every((permission) => hasAdminPermission(data, permission))) {
      item.append(noticeElement("You do not have all permissions required to complete onboarding.", "warning"));
      return item;
    }
    const onboardingReadFailures = [
      [data.offices, "offices needed to complete onboarding"],
      [data.departments, "departments needed to complete onboarding"],
      [data.roles, "roles needed to complete onboarding"],
    ].map(([result, resource]) => adminReadFailure(result, resource)).filter(Boolean);
    if (onboardingReadFailures.length) {
      item.append(...onboardingReadFailures);
      return item;
    }
    const form = document.createElement("form");
    form.className = "form-grid onboarding-form";
    form.append(adminField("Designation", "designation", "text", "", true));
    const office = document.createElement("select");
    office.name = "officeId";
    office.required = true;
    office.append(adminOption("", "Choose office"));
    data.offices.offices.forEach((entry) => office.append(adminOption(entry.id, entry.name)));
    const officeLabel = document.createElement("label");
    officeLabel.textContent = "Office";
    officeLabel.append(office);
    form.append(officeLabel);
    form.append(adminField("Employment start (office local date)", "employmentStartsOn", "date", "", true));
    const employmentStartNote = document.createElement("p");
    employmentStartNote.className = "small full";
    employmentStartNote.textContent = "Choose an office; NOVA validates this date using that office's timezone.";
    office.addEventListener("change", () => {
      const selectedOffice = data.offices.offices.find((entry) => entry.id === office.value);
      employmentStartNote.textContent = selectedOffice
        ? `Date is evaluated in ${selectedOffice.timezone}.`
        : "Choose an office; NOVA validates this date using that office's timezone.";
    });
    form.append(employmentStartNote);
    const department = document.createElement("select");
    department.name = "organisationDepartmentId";
    department.required = true;
    department.append(adminOption("", "Choose department"));
    data.departments.departments.forEach((entry) => department.append(adminOption(entry.id, entry.name)));
    const departmentLabel = document.createElement("label");
    departmentLabel.textContent = "Department";
    departmentLabel.append(department);
    form.append(departmentLabel);
    const role = document.createElement("select");
    role.name = "roleId";
    role.required = true;
    role.append(adminOption("", "Choose role"));
    data.roles.roles.filter((entry) => !entry.isProtected && !entry.archivedAt).forEach((entry) => role.append(adminOption(entry.id, entry.name)));
    const roleLabel = document.createElement("label");
    roleLabel.textContent = "Role";
    roleLabel.append(role);
    form.append(roleLabel);
    const manager = document.createElement("select");
    manager.name = "managerPersonId";
    manager.append(adminOption("", "No manager"));
    data.people.people.filter((entry) => entry.id !== person.id && ["active", "notice"].includes(entry.status)).forEach((entry) => manager.append(adminOption(entry.id, entry.displayName)));
    const managerLabel = document.createElement("label");
    managerLabel.textContent = "Manager";
    managerLabel.append(manager);
    form.append(managerLabel);
    const submit = document.createElement("button");
    submit.className = "button compact";
    submit.type = "submit";
    submit.textContent = "Complete onboarding";
    form.append(submit);
    form.addEventListener("submit", (event) => adminFormSubmit(event, async () => {
      const values = formValues(event.currentTarget);
      await api("/api/people/" + person.id + "/complete-onboarding", requestOptions("POST", values));
      setMessage("Onboarding completed.");
    }));
    item.append(form);
  }
  return item;
}

function renderProviderFields() {
  const provider = app.querySelector("[name=provider]").value;
  const target = app.querySelector("#provider-fields");
  const templates = {
    console: '<p class="small full">Console output is for local development only. It has no provider credentials.</p>',
    smtp: '<label>SMTP host<input name="smtpHost" required placeholder="smtp.example.com"></label><label>SMTP port<input name="smtpPort" type="number" required min="1" max="65535" value="587"></label><label>SMTP username<input name="smtpUsername" required autocomplete="username"></label><label>SMTP password<input name="smtpPassword" type="password" required autocomplete="new-password"></label><label class="check full"><input name="smtpSecure" type="checkbox">Use TLS from the first connection (usually port 465)</label>',
    gmail_oauth2: '<p class="small full">Use a customer-owned Google OAuth web client and enable the Gmail API. NOVA sends through Google HTTPS using the send-only <code>gmail.send</code> permission, including on Cloudflare Workers. Google classifies this as a sensitive scope, so public Google OAuth apps may need Google verification.</p>' + (state.publicOrigin ? '<p class="small full">In Google Cloud, add this authorised redirect URI: <code>' + state.publicOrigin + '/api/email-connections/gmail/callback</code></p>' : '<p class="small full">Save the public NOVA URL first; it determines the Google redirect URI.</p>') + '<label>Google OAuth client ID<input name="gmailClientId" required autocomplete="off"></label><label>Google OAuth client secret<input name="gmailClientSecret" type="password" required autocomplete="new-password"></label>',
    resend: '<p class="small full">Create an API key in your Resend account with permission to send from this sender domain.</p><label class="full">Resend API key<input name="resendApiKey" type="password" required autocomplete="new-password"></label>',
  };
  target.innerHTML = templates[provider];
}

function noticeElement(text, kind) {
  const element = document.createElement("p");
  element.className = "notice" + (kind === "error" ? " error" : kind === "warning" ? " warning" : "");
  element.setAttribute("role", "status");
  element.textContent = text;
  return element;
}

function connectionCard(connection, supportedProviders) {
  const supported = supportedProviders.includes(connection.provider);
  const item = document.createElement("article");
  item.className = "connection";
  item.innerHTML =
    '<div><h3></h3><p class="connection-description"></p><p class="connection-tested"></p></div>' +
    '<div class="connection-actions"></div>' +
    '<form class="test-form"><label>Send test email to<input name="recipientEmail" type="email" autocomplete="email" required></label><button class="button compact" type="submit">Send test</button></form>';
  item.querySelector("h3").textContent = connection.name;
  item.querySelector(".connection-description").textContent =
    providerLabel(connection.provider) + " · " + connection.senderEmail +
    (connection.replyToEmail ? " · reply-to " + connection.replyToEmail : "");
  if (!supported) {
    item.querySelector(".connection-description").after(noticeElement(
      "This saved provider cannot send from the current runtime. Deactivate it or configure a provider supported here.",
      "warning",
    ));
  }
  item.querySelector(".connection-tested").textContent = connection.lastTestedAt
    ? connection.lastTestErrorCode ? "Last test failed: " + connection.lastTestErrorCode : "Tested " + new Date(connection.lastTestedAt).toLocaleString()
    : "Not tested yet";
  const actions = item.querySelector(".connection-actions");
  const testForm = item.querySelector(".test-form");
  if (!supported) testForm.remove();
  if (connection.isActive) {
    const active = document.createElement("span");
    active.className = "status" + (supported ? "" : " pending");
    active.textContent = supported ? "Active" : "Active, unavailable here";
    actions.append(active);
    actions.append(actionButton("Deactivate", () => deactivateConnection(connection.id)));
  } else if (supported) {
    actions.append(actionButton("Activate", () => activateConnection(connection.id)));
  }
  if (supported) {
    actions.append(actionButton("Send test", () => {
      testForm.classList.toggle("open");
      testForm.querySelector("input").focus();
    }));
    if (connection.provider === "gmail_oauth2") {
      actions.append(actionButton("Connect Google", () => connectGmail(connection.id)));
    }
  }
  if (supported) testForm.addEventListener("submit", (event) => submitTest(event, connection.id));
  return item;
}

function actionButton(text, handler) {
  const button = document.createElement("button");
  button.className = "button secondary compact";
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

function providerLabel(provider) {
  return { console: "Console", smtp: "SMTP", gmail_oauth2: "Gmail API (OAuth)", resend: "Resend" }[provider] || provider;
}

function configureEmailProviderOptions(supportedProviders) {
  const select = app.querySelector("#connection-form [name=provider]");
  const supported = new Set(supportedProviders);
  const options = Array.from(select.options);
  options.forEach((option) => { if (!supported.has(option.value)) option.remove(); });
  const notice = app.querySelector("#email-runtime-notice");
  notice.replaceChildren();
  if (!supported.has("smtp")) {
    notice.append(noticeElement(
      "SMTP requires a Node.js runtime. Gmail API and Resend use HTTPS and work on this deployment; choose from the methods shown here.",
      "warning",
    ));
  }
  if (select.options.length > 0 && !Array.from(select.options).some((option) => option.value === select.value)) {
    select.value = select.options[0].value;
  }
  renderProviderFields();
}

function renderConnections(connections, supportedProviders) {
  const target = app.querySelector("#connections");
  target.replaceChildren();
  if (!connections.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No email connection exists yet. Add one below, test it, then activate it.";
    target.append(empty);
    return;
  }
  const list = document.createElement("div");
  list.className = "connection-list";
  connections.forEach((connection) => list.append(connectionCard(connection, supportedProviders)));
  target.append(list);
}

function renderInvite() {
  renderShell(
    '<section class="panel"><p class="eyebrow">People</p><h1>Invite a person.</h1>' +
      '<p class="lede">NOVA sends a one-time link. The invited person creates their own password; no temporary password is created or shared.</p>' + feedback() +
      '<form id="invite-form" class="form-grid one"><label>Full name<input name="displayName" autocomplete="name" required maxlength="180"></label><label>Work email<input name="email" type="email" autocomplete="email" required></label><div class="form-actions"><button class="button" type="submit">Send invitation</button></div></form></section>',
    "invite",
  );
  const form = app.querySelector("#invite-form");
  if (!canShowInviteNavigation(state.actorGrants)) {
    form.hidden = true;
    form.insertAdjacentElement("beforebegin", noticeElement("Your role does not include permission to invite people.", "warning"));
  } else {
    form.addEventListener("submit", submitInvite);
  }
  showFeedback();
}

async function renderNotifications() {
  renderShell(
    '<section class="panel"><div class="panel-header"><div><p class="eyebrow">Inbox</p><h1>Notifications</h1><p class="lede">In-app notifications are always available here. Optional notification email is off until you enable it.</p></div><button class="button secondary compact" type="button" data-action="read-all">Mark all read</button></div>' +
      feedback() + '<div id="notification-list"><p class="small">Loading notifications...</p></div></section>' +
    '<section class="panel"><div class="panel-header"><div><h2>Optional email</h2><p class="small">Email is separate from invitation, verification, and password-reset messages. It never blocks NOVA activity.</p></div></div><div id="notification-preferences"><p class="small">Loading preferences...</p></div></section>',
    "notifications",
  );
  showFeedback();
  app.querySelector("[data-action=read-all]").addEventListener("click", async () => {
    try { await api("/api/notifications/read-all", requestOptions("POST")); setMessage("Notifications marked as read."); }
    catch (error) { setMessage(errorText(error), "error"); }
    render();
  });
  try {
    const [items, preferences] = await Promise.all([
      api("/api/notifications?limit=100"),
      api("/api/notification-preferences"),
    ]);
    const list = app.querySelector("#notification-list");
    list.replaceChildren();
    if (!items.notifications.length) {
      list.append(noticeElement("No notifications yet.", "warning"));
    } else {
      items.notifications.forEach((notification) => {
        const item = document.createElement("article");
        item.className = "list-item" + (notification.readAt ? "" : " notice");
        const title = document.createElement("h3");
        title.textContent = notification.title;
        const body = document.createElement("p");
        body.className = "small";
        body.textContent = notification.body;
        const meta = document.createElement("p");
        meta.className = "small";
        meta.textContent = new Date(notification.createdAt).toLocaleString();
        item.append(title, body, meta);
        const actions = document.createElement("div");
        actions.className = "form-actions";
        if (notification.deepLink) {
          const link = document.createElement("a");
          link.className = "button secondary compact";
          link.href = notification.deepLink;
          link.textContent = "Open";
          actions.append(link);
        }
        if (!notification.readAt) {
          actions.append(actionButton("Mark read", async () => {
            try { await api("/api/notifications/" + notification.id + "/read", requestOptions("POST")); }
            catch (error) { setMessage(errorText(error), "error"); }
            render();
          }));
        }
        item.append(actions);
        list.append(item);
      });
    }
    const preferencesTarget = app.querySelector("#notification-preferences");
    preferencesTarget.replaceChildren();
    (preferences.preferences || []).filter((preference) => preference.channel === "email").forEach((preference) => {
      const label = document.createElement("label");
      label.className = "list-item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = preference.enabled;
      input.setAttribute("aria-label", "Email " + preference.label);
      input.addEventListener("change", async () => {
        try {
          await api("/api/notification-preferences", requestOptions("PATCH", {
            eventKey: preference.eventKey, channel: "email", enabled: input.checked,
          }));
          setMessage("Email preference saved.");
        } catch (error) {
          input.checked = !input.checked;
          setMessage(errorText(error), "error");
        }
        showFeedback();
      });
      label.append(input, document.createTextNode(" Email " + preference.label));
      preferencesTarget.append(label);
    });
  } catch (error) {
    const list = app.querySelector("#notification-list");
    if (list) list.replaceChildren(noticeElement(errorText(error), "error"));
  }
}

async function renderAttendance() {
  renderShell(
    '<section class="panel"><p class="eyebrow">Availability</p><h1>Today.</h1><p class="lede">One attendance state for your current office business date. The server resolves the date from the office timezone.</p>' + feedback() + '<div id="attendance-today"><p class="small">Loading today\'s rules...</p></div></section>',
    "today",
  );
  showFeedback();
  try {
    const result = await api("/api/attendance/today");
    const target = app.querySelector("#attendance-today");
    target.replaceChildren();
    const availability = result.availability;
    const summary = document.createElement("p");
    summary.className = "small";
    summary.textContent = availability.businessDate + " · " + availability.officeName + " · " + availability.timezone +
      " · " + (availability.attendanceMode === "scheduled" ? "scheduled attendance" :
        "hour-based attendance (" + availability.requiredAttendanceMinutes + " min)");
    target.append(summary);
    const durationSummary = document.createElement("p");
    durationSummary.className = "small";
    durationSummary.textContent = "Attendance duration: " + result.attendanceSummary.durationMinutes + " min" +
      (availability.attendanceMode === "hour_based"
        ? " · required " + result.attendanceSummary.requiredMinutes + " min" +
          (result.attendanceSummary.requirementSatisfied ? " · satisfied" : " · not yet satisfied")
        : " · schedule-relative states are shown in Work timeline");
    target.append(durationSummary);
    const rule = document.createElement("p");
    rule.className = "notice" + (availability.isHoliday || !availability.isWorkingDay ? " warning" : "");
    rule.textContent = result.onApprovedLeave
      ? "Approved leave — attendance is closed for today."
      : availability.isHoliday
      ? "Office holiday — attendance is closed for today."
      : availability.isWorkingDay
      ? availability.attendanceMode === "scheduled"
        ? availability.shiftId ? "Working day — scheduled shift is configured." : "Working day — no shift is attached."
        : "Working day — measure the required duration; shift times do not create late/early states."
      : "Non-working day — attendance is closed for today.";
    target.append(rule);
    const attendance = result.attendance;
    if (!attendance) {
      const provisional = result.provisionalAttendance;
      if (provisional) {
        const provisionalNote = document.createElement("p");
        provisionalNote.className = "notice" + (provisional.status === "pending" ? " warning" : "");
        provisionalNote.textContent = provisional.status === "pending"
          ? "WFH check-in is provisional. It is not counted as attendance or payroll time unless the request is approved."
          : provisional.status === "discarded"
          ? "This provisional WFH interval was not credited" + (provisional.resolutionReason ? " (" + provisional.resolutionReason.replaceAll("_", " ").toLowerCase() + ")." : ".")
          : "This WFH interval was approved and added to the attendance record.";
        target.append(provisionalNote);
        if (provisional.checkedOutAt) {
          const interval = document.createElement("p");
          interval.className = "small";
          interval.textContent = "Provisional interval: " + new Date(provisional.checkedInAt).toLocaleTimeString() +
            "–" + new Date(provisional.checkedOutAt).toLocaleTimeString();
          target.append(interval);
        } else if (provisional.status === "pending") {
          target.append(actionButton("Check out provisional WFH", () => attendanceAction("/api/attendance/check-out")));
        }
      }
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = provisional?.status === "pending"
        ? "Your task work is separate from this provisional attendance record."
        : "You have not started attendance today.";
      target.append(empty);
      if (!result.onApprovedLeave && !availability.isHoliday && availability.isWorkingDay && availability.calendarId &&
        (availability.attendanceMode !== "scheduled" || availability.shiftId) && provisional?.status !== "pending") {
        const actions = document.createElement("div");
        actions.className = "form-actions";
        const officeCheckIn = actionButton("Check in at office", () => attendanceAction("/api/attendance/check-in", { mode: "office" }));
        const wfhCheckIn = actionButton(result.wfhPending && !result.wfhApproved ? "Provisional WFH check-in" : "Check in from home", () => attendanceAction("/api/attendance/check-in", { mode: "wfh" }));
        officeCheckIn.disabled = result.wfhPending;
        wfhCheckIn.disabled = !availability.wfhAllowed || (!result.wfhApproved && !result.wfhPending);
        actions.append(officeCheckIn, wfhCheckIn);
        target.append(actions);
        if (result.wfhPending) {
          target.append(noticeElement("To switch to office attendance, cancel the pending WFH request first.", "warning"));
        }
      }
      renderLeaveRequestPanel(target);
      renderWfhRequestPanel(target);
      return;
    }
    const stateLine = document.createElement("p");
    stateLine.className = "notice";
    stateLine.textContent = "Checked in " + new Date(attendance.checkedInAt).toLocaleTimeString() + " · mode: " + attendance.mode +
      (attendance.checkedOutAt ? " · checked out " + new Date(attendance.checkedOutAt).toLocaleTimeString() : " · open");
    target.append(stateLine);
    const actions = document.createElement("div");
    actions.className = "form-actions";
    if (!attendance.checkedOutAt) {
      actions.append(actionButton("Check out", () => attendanceAction("/api/attendance/check-out")));
      if (attendance.mode === "office" && availability.wfhAllowed && result.wfhApproved) {
        actions.append(actionButton("Switch to WFH", () => attendanceAction("/api/attendance/change-mode", { mode: "wfh" })));
      } else if (attendance.mode === "wfh") {
        actions.append(actionButton("Switch to office", () => attendanceAction("/api/attendance/change-mode", { mode: "office" })));
      }
    }
    target.append(actions);
    renderLeaveRequestPanel(target);
    renderWfhRequestPanel(target);
  } catch (error) {
    const target = app.querySelector("#attendance-today");
    if (target) target.replaceChildren(noticeElement(errorText(error), "error"));
  }
}

function localDateTimeValue(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function timelineLabel(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

async function renderWork(date) {
  renderShell(
    '<section class="panel"><div class="panel-header"><div><p class="eyebrow">Work</p><h1>One clear work timeline.</h1><p class="lede">Start work against an assignment, keep productive time separate from attendance, and correct eligible historical gaps with an audit trail.</p></div></div>' + feedback() + '<div id="work-board"><p class="small">Loading work...</p></div></section>',
    "work",
  );
  showFeedback();
  const query = date ? "?date=" + encodeURIComponent(date) : "";
  try {
    const [assignmentsResult, sessionsResult, timeline, reviewsResult, reviewerRequestsResult, handoverRequestsResult, workContext, tasksResult, taskCatalogResult, attendanceResult] = await Promise.all([
      api("/api/work/assignments/mine"),
      api("/api/work-sessions/mine"),
      api("/api/work/timeline" + query),
      readOrError(api("/api/reviews/pending"), { reviews: [] }),
      readOrError(api("/api/task-reviewer-requests"), { requests: [] }),
      readOrError(api("/api/task-handover-requests"), { requests: [] }),
      api("/api/work-context"),
      readOrError(api("/api/tasks"), { tasks: [] }),
      readOrError(api("/api/task-catalog"), { entries: [], proposals: [], permissions: {} }),
      readOrError(api("/api/attendance/today"), {}),
    ]);
    const board = app.querySelector("#work-board");
    board.replaceChildren();
    const dateForm = document.createElement("form");
    dateForm.className = "form-actions";
    dateForm.innerHTML = '<label>Timeline date<input name="date" type="date" required></label><button class="button secondary compact" type="submit">Load day</button>';
    dateForm.elements.date.value = timeline.date;
    dateForm.addEventListener("submit", (event) => {
      event.preventDefault();
      renderWork(dateForm.elements.date.value);
    });
    board.append(dateForm);
    const attendanceReadFailure = adminReadFailure(attendanceResult, "today’s attendance status");
    if (attendanceReadFailure) board.append(attendanceReadFailure);
    if (!attendanceReadFailure && (attendanceResult?.wfhPending || attendanceResult?.provisionalAttendance?.status === "pending")) {
      const pendingWfhNote = document.createElement("p");
      pendingWfhNote.className = "notice warning";
      pendingWfhNote.textContent = attendanceResult.provisionalAttendance?.status === "pending"
        ? "WFH approval is pending. Task work is retained independently. A role that requires attendance may run a timer only while this provisional check-in is open; approval promotes attendance, rejection discards only attendance credit and pauses that timer."
        : "WFH approval is pending. Task work may continue. If your role requires attendance, record a provisional WFH check-in on Today before starting a timer.";
      board.append(pendingWfhNote);
    }

    const billingPolicyTools = renderBillingPolicyTools(workContext.clientWorkstreams, taskCatalogResult);
    if (billingPolicyTools) board.append(billingPolicyTools);

    const taskTargets = workContext.taskCreationTargets || [];
    if (taskTargets.length) {
      const createSection = adminSection(
        "Add work to a workstream",
        "Create a task in a workstream your role can edit. Self-assignment is created atomically; client work keeps its review requirement.",
      );
      const taskForm = document.createElement("form");
      taskForm.className = "form-grid one";
      taskForm.append(adminField("Task title", "title", "text", "", true));
      const targetSelect = document.createElement("select");
      targetSelect.name = "contextId";
      targetSelect.required = true;
      targetSelect.append(adminOption("", "Choose a workstream"));
      taskTargets.forEach((target) => targetSelect.append(adminOption(
        target.kind + ":" + target.id,
        (target.kind === "client" ? (target.clientName + " · ") : "Organisation · ") + target.name +
          (target.kind === "client" && !target.billingPolicyClass ? " · billing policy required" : ""),
      )));
      const targetLabel = document.createElement("label");
      targetLabel.textContent = "Workstream";
      targetLabel.append(targetSelect);
      taskForm.append(targetLabel);
      let taskCatalogSelect = null;
      const billingPolicyHint = document.createElement("p");
      billingPolicyHint.className = "small full";
      const updateBillingPolicyHint = () => {
        const selected = taskTargets.find((target) => target.kind + ":" + target.id === targetSelect.value);
      billingPolicyHint.textContent = !selected
          ? "NOVA assigns the class automatically. One-off work uses the workstream default; a predefined task uses its authorized workstream-specific rule when present. Users never choose a class."
          : selected.kind === "organisation"
            ? "NOVA automatically classifies organisation-workstream tasks as non-billable."
            : selected.billingPolicyClass
              ? "NOVA applies the default to one-off tasks and any saved admin rule to a selected predefined task. Users cannot change classification."
            : "This workstream has no billing policy yet. Ask an authorized policy manager to configure it; NOVA will block task creation until then.";
      };
      targetSelect.addEventListener("change", updateBillingPolicyHint);
      updateBillingPolicyHint();
      taskForm.append(billingPolicyHint);
      taskCatalogSelect = appendTaskCatalogSelector(taskForm, taskCatalogResult);
      if (taskCatalogSelect) taskCatalogSelect.addEventListener("change", updateBillingPolicyHint);
      const visibleTasks = tasksResult.tasks || [];
      const correctionReadFailure = adminReadFailure(tasksResult, "existing tasks for correction links");
      if (correctionReadFailure) taskForm.append(correctionReadFailure);
      else appendTaskCorrectionFields(taskForm, visibleTasks, targetSelect);
      const description = document.createElement("label");
      description.textContent = "What needs to be done? (optional)";
      const descriptionInput = document.createElement("textarea");
      descriptionInput.name = "description";
      descriptionInput.maxLength = 10000;
      description.append(descriptionInput);
      taskForm.append(description);
      const dueDate = adminField("Due date (optional)", "dueDate", "date", "", false);
      taskForm.append(dueDate);
      const assignLabel = document.createElement("label");
      assignLabel.className = "check full";
      const assignToSelf = document.createElement("input");
      assignToSelf.type = "checkbox";
      assignToSelf.name = "assignToSelf";
      assignToSelf.checked = workContext.canReceiveAssignments === true;
      assignToSelf.disabled = workContext.canReceiveAssignments === false;
      assignLabel.append(assignToSelf, document.createTextNode("Add this to my assignments now"));
      taskForm.append(assignLabel);
      if (workContext.canReceiveAssignments === false) {
        const assignmentPolicyHint = document.createElement("p");
        assignmentPolicyHint.className = "small full";
        assignmentPolicyHint.textContent = "Your current role or status cannot receive assignments. You can still create the task without assigning it to yourself.";
        taskForm.append(assignmentPolicyHint);
      }
      const hint = document.createElement("p");
      hint.className = "small full";
      hint.textContent = "Client work may require review. After creating it, use the assignment actions below to request a reviewer or handover.";
      taskForm.append(hint, adminSubmit("Create task", true));
      taskForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = taskForm.querySelector('[type="submit"]');
        if (!button) return;
        button.disabled = true;
        const values = formValues(taskForm);
        const [kind, id] = values.contextId.split(":");
        const payload = {
          title: values.title,
          ...(kind === "client" ? { clientWorkstreamId: id } : { organisationWorkstreamId: id }),
          ...taskCatalogProvenance(taskCatalogSelect),
          description: values.description || null,
          dueDate: values.dueDate || null,
          correctionOfTaskId: values.correctionOfTaskId || null,
          correctionReason: values.correctionReason || null,
          assignToSelf: values.assignToSelf === "on",
        };
        try {
          const createdTask = await api("/api/tasks", requestOptions(
            "POST", payload, taskCreateIdempotencyHeaders(payload),
          ));
          clearTaskCreateIdempotency(payload);
          setMessage((createdTask.assignmentId
            ? "Task created and added to your assignments."
            : "Task created without assigning it to you.") + " · " + taskBillingConfirmation(createdTask) +
            taskCorrectionConfirmation(Boolean(payload.correctionOfTaskId)));
          renderWork(timeline.date);
        } catch (error) {
          setMessage(errorText(error), "error");
          showFeedback();
          button.disabled = false;
        }
      });
      createSection.append(taskForm);
      board.append(createSection);
    }
    const taskCatalogTools = renderTaskCatalogTools(taskCatalogResult);
    if (taskCatalogTools) board.append(taskCatalogTools);

    const reviewSection = adminSection("Pending reviews", "Review only the assignments visible through your current tasks.review scope.");
    const reviewList = document.createElement("div");
    reviewList.className = "stack";
    const reviews = reviewsResult.reviews || [];
    const reviewReadFailure = adminReadFailure(reviewsResult, "pending reviews");
    if (reviewReadFailure) reviewList.append(reviewReadFailure);
    else if (!reviews.length) reviewList.append(noticeElement("No pending reviews.", "warning"));
    reviews.forEach((review) => {
      const row = document.createElement("div");
      row.className = "list-item";
      const label = document.createElement("span");
      label.textContent = review.title + " · cycle " + review.cycleNumber + " · submitted " + timelineLabel(review.submittedAt);
      row.append(label);
      row.append(
        adminButton("Approve", async () => {
          try { await api("/api/task-assignments/" + review.assignmentId + "/review", requestOptions("POST", { decision: "approved", feedback: null })); setMessage("Work approved."); }
          catch (error) { setMessage(errorText(error), "error"); }
          renderWork(timeline.date);
        }),
        adminButton("Request changes", async () => {
          const feedback = window.prompt("Explain the changes needed:");
          if (!feedback) return;
          try { await api("/api/task-assignments/" + review.assignmentId + "/review", requestOptions("POST", { decision: "changes_requested", feedback })); setMessage("Changes requested."); }
          catch (error) { setMessage(errorText(error), "error"); }
          renderWork(timeline.date);
        }, true),
      );
      reviewList.append(row);
    });
    reviewSection.append(reviewList);
    board.append(reviewSection);

    const requestSection = adminSection("Collaboration requests", "Accept or decline reviewer and assignment handover requests. Every decision is transactional and audited.");
    const requestList = document.createElement("div");
    requestList.className = "stack";
    const reviewerRequests = (reviewerRequestsResult.requests || []).filter((item) => item.status === "pending");
    const handoverRequests = (handoverRequestsResult.requests || []).filter((item) => item.status === "pending");
    const reviewerRequestsFailure = adminReadFailure(reviewerRequestsResult, "reviewer requests");
    const handoverRequestsFailure = adminReadFailure(handoverRequestsResult, "handover requests");
    if (reviewerRequestsFailure) requestList.append(reviewerRequestsFailure);
    if (handoverRequestsFailure) requestList.append(handoverRequestsFailure);
    if (!reviewerRequestsFailure && !handoverRequestsFailure && !reviewerRequests.length && !handoverRequests.length) {
      requestList.append(noticeElement("No collaboration requests waiting for you.", "warning"));
    }
    reviewerRequests.forEach((item) => {
      const row = document.createElement("div"); row.className = "list-item";
      row.append(document.createTextNode("Reviewer request · " + (item.title || item.assignment_id)));
      if (item.isRecipient) {
        row.append(adminButton("Accept", async () => { try { await api("/api/task-reviewer-requests/" + item.id + "/accept", requestOptions("POST", {})); setMessage("Reviewer request accepted."); } catch (error) { setMessage(errorText(error), "error"); } renderWork(timeline.date); }), adminButton("Decline", async () => { try { await api("/api/task-reviewer-requests/" + item.id + "/decline", requestOptions("POST", {})); setMessage("Reviewer request declined."); } catch (error) { setMessage(errorText(error), "error"); } renderWork(timeline.date); }, true));
      } else row.append(adminButton("Withdraw", async () => { try { await api("/api/task-reviewer-requests/" + item.id + "/withdraw", requestOptions("POST", {})); setMessage("Reviewer request withdrawn."); } catch (error) { setMessage(errorText(error), "error"); } renderWork(timeline.date); }, true));
      requestList.append(row);
    });
    handoverRequests.forEach((item) => {
      const row = document.createElement("div"); row.className = "list-item";
      row.append(document.createTextNode("Handover request · " + (item.title || item.assignment_id)));
      if (item.isRecipient) row.append(adminButton("Accept", async () => { try { await api("/api/task-handover-requests/" + item.id + "/accept", requestOptions("POST", {})); setMessage("Handover accepted."); } catch (error) { setMessage(errorText(error), "error"); } renderWork(timeline.date); }), adminButton("Decline", async () => { try { await api("/api/task-handover-requests/" + item.id + "/decline", requestOptions("POST", {})); setMessage("Handover declined."); } catch (error) { setMessage(errorText(error), "error"); } renderWork(timeline.date); }, true));
      else row.append(adminButton("Withdraw", async () => { try { await api("/api/task-handover-requests/" + item.id + "/withdraw", requestOptions("POST", {})); setMessage("Handover request withdrawn."); } catch (error) { setMessage(errorText(error), "error"); } renderWork(timeline.date); }, true));
      requestList.append(row);
    });
    requestSection.append(requestList);
    board.append(requestSection);

    const assignmentsSection = adminSection("My assignments", "Only work visible through your current tasks.view scope is shown here.");
    const assignmentList = document.createElement("div");
    assignmentList.className = "stack";
    const assignments = assignmentsResult.assignments || [];
    const candidateResults = await Promise.all(assignments.map(async (assignment) => [assignment.assignmentId, await readOrError(
      api("/api/task-assignments/" + assignment.assignmentId + "/candidates"),
      { reviewers: [], handoverTargets: [] },
    )]));
    const candidateMap = new Map(candidateResults);
    if (!assignments.length) assignmentList.append(noticeElement("No active assignments are available.", "warning"));
    assignments.forEach((assignment) => {
      const row = document.createElement("div");
      row.className = "list-item";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = assignment.title;
      const meta = document.createElement("p");
      meta.className = "small";
      meta.textContent = assignment.status + " · " +
        taskBillingConfirmation(assignment) +
        " · " + taskDefinitionProvenance(assignment) +
        (assignment.isCorrection ? " · correction task" + (assignment.correctionOf ? " for “" + assignment.correctionOf.title + "”" : "") +
          (assignment.correctionReason ? " · " + assignment.correctionReason : "") : "") +
        (assignment.dueDate ? " · due " + assignment.dueDate : "") +
        (assignment.reviewRequired ? " · review required" : "") +
        (assignment.resolutionSource === "policy" ? " · completed without review" : "") +
        (assignment.reviewBlockedReason ? " · review blocked: no eligible reviewer" : "");
      copy.append(title, meta);
      row.append(copy);
      const dueDateEditor = taskDueDateEditor(assignment, () => renderWork(timeline.date));
      if (dueDateEditor) row.append(dueDateEditor);
      const actions = document.createElement("div");
      actions.className = "form-actions";
      if (["assigned", "in_progress", "changes_requested"].includes(assignment.status)) {
        actions.append(adminButton("Start / resume", async () => {
          try { await api("/api/work-sessions/start", requestOptions("POST", { assignmentId: assignment.assignmentId })); setMessage("Work session started."); }
          catch (error) { setMessage(errorText(error), "error"); }
          renderWork(timeline.date);
        }));
      }
      if (["in_progress", "changes_requested"].includes(assignment.status)) {
        actions.append(adminButton("Submit", async () => {
          try { await api("/api/task-assignments/" + assignment.assignmentId + "/submit", requestOptions("POST")); setMessage("Assignment submitted."); }
          catch (error) { setMessage(errorText(error), "error"); }
          renderWork(timeline.date);
        }, true));
      }
      if (!["cancelled", "approved"].includes(assignment.status)) {
        const collaboration = document.createElement("details");
        const summary = document.createElement("summary"); summary.textContent = "Request reviewer or handover"; collaboration.append(summary);
        const candidateData = candidateMap.get(assignment.assignmentId) || { reviewers: [], handoverTargets: [] };
        const candidateReadFailure = adminReadFailure(candidateData, "eligible teammates");
        if (candidateReadFailure) {
          collaboration.append(candidateReadFailure);
          actions.append(collaboration);
          row.append(actions);
          assignmentList.append(row);
          return;
        }
        const candidatePeople = (candidateData.reviewers || []).filter((person) => person.id !== assignment.personId);
        const reviewerForm = document.createElement("form"); reviewerForm.className = "form-actions";
        const reviewerSelect = document.createElement("select"); reviewerSelect.name = "candidateReviewerPersonId"; reviewerSelect.append(adminOption("", "Choose reviewer"));
        candidatePeople.forEach((person) => reviewerSelect.append(adminOption(person.id, person.displayName)));
        const reviewerReason = document.createElement("input"); reviewerReason.name = "reason"; reviewerReason.placeholder = "Why is a reviewer needed?"; reviewerReason.required = true; reviewerReason.maxLength = 2000;
        reviewerForm.append(reviewerSelect, reviewerReason, adminSubmit("Request reviewer", true));
        reviewerForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => { const values = formValues(event.currentTarget); await api("/api/task-assignments/" + assignment.assignmentId + "/reviewer-requests", requestOptions("POST", values)); setMessage("Reviewer request sent."); }));
        const handoverForm = document.createElement("form"); handoverForm.className = "form-actions";
        const handoverSelect = document.createElement("select"); handoverSelect.name = "targetPersonId"; handoverSelect.append(adminOption("", "Choose teammate"));
        (candidateData.handoverTargets || []).filter((person) => person.id !== assignment.personId).forEach((person) => handoverSelect.append(adminOption(person.id, person.displayName)));
        const handoverReason = document.createElement("input"); handoverReason.name = "reason"; handoverReason.placeholder = "Why should this be handed over?"; handoverReason.required = true; handoverReason.maxLength = 2000;
        handoverForm.append(handoverSelect, handoverReason, adminSubmit("Request handover", true));
        handoverForm.addEventListener("submit", (event) => adminFormSubmit(event, async () => { const values = formValues(event.currentTarget); await api("/api/task-assignments/" + assignment.assignmentId + "/handover-requests", requestOptions("POST", values)); setMessage("Handover request sent."); }));
        collaboration.append(reviewerForm, handoverForm); actions.append(collaboration);
      }
      row.append(actions);
      assignmentList.append(row);
    });
    assignmentsSection.append(assignmentList);
    board.append(assignmentsSection);

    const sessionsSection = adminSection("Recorded work sessions", "Pause creates a closed segment; starting again creates the next segment without rewriting history.");
    const sessions = sessionsResult.sessions || [];
    const sessionList = document.createElement("div");
    sessionList.className = "stack";
    if (!sessions.length) sessionList.append(noticeElement("No work sessions in the last 31 days.", "warning"));
    sessions.forEach((session) => {
      const row = document.createElement("div");
      row.className = "list-item";
      const text = document.createElement("span");
      text.textContent = session.title + " · " + timelineLabel(session.startedAt) + (session.endedAt ? "–" + new Date(session.endedAt).toLocaleTimeString() : " · running");
      row.append(text);
      if (!session.endedAt) {
        row.append(
          adminButton("Pause", async () => { try { await api("/api/work-sessions/" + session.id + "/pause", requestOptions("POST")); setMessage("Work session paused."); } catch (error) { setMessage(errorText(error), "error"); } renderWork(timeline.date); }),
          adminButton("Stop", async () => { try { await api("/api/work-sessions/" + session.id + "/stop", requestOptions("POST")); setMessage("Work session stopped."); } catch (error) { setMessage(errorText(error), "error"); } renderWork(timeline.date); }, true),
        );
      }
      sessionList.append(row);
    });
    sessionsSection.append(sessionList);
    board.append(sessionsSection);

    const timelineSection = adminSection("Daily timeline", "Attendance and productive work are projected together. Exceptions are visible rather than silently discarded.");
    const attendanceSummary = document.createElement("p");
    attendanceSummary.className = "small";
    attendanceSummary.textContent = "Attendance: " + timeline.attendanceSummary.durationMinutes + " min" +
      (timeline.attendancePolicy?.mode === "hour_based"
        ? " · required " + timeline.attendanceSummary.requiredMinutes + " min" +
          (timeline.attendanceSummary.requirementSatisfied ? " · satisfied" : " · not yet satisfied")
        : timeline.attendancePolicy?.mode === "scheduled"
        ? " · scheduled interpretation"
        : "");
    timelineSection.append(attendanceSummary);
    const timelineList = document.createElement("div");
    timelineList.className = "stack";
    (timeline.events || []).forEach((event) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.textContent = event.type + " · " + timelineLabel(event.at);
      timelineList.append(row);
    });
    (timeline.exceptions || []).forEach((exception) => {
      const row = document.createElement("div");
      row.className = "list-item";
      const label = document.createElement("span");
      label.textContent = exception.type + (exception.startedAt ? " · " + timelineLabel(exception.startedAt) + "–" + timelineLabel(exception.endedAt) : "");
      row.append(label);
      if (exception.type === "work.untracked_gap" && exception.actionable) {
        const form = document.createElement("form");
        form.className = "form-grid one";
        const options = assignments.map((assignment) => '<option value="' + assignment.assignmentId + '">' + assignment.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;") + '</option>').join("");
        form.innerHTML = '<label>Assignment<select name="assignmentId" required>' + options + '</select></label><label>Reason<input name="reason" maxlength="2000" required placeholder="Forgot to start the timer"></label><button class="button compact" type="submit">Correct gap</button>';
        form.addEventListener("submit", (event) => withSubmit(event, async () => {
          const values = formValues(event.currentTarget);
          await api("/api/work/timeline-adjustments", requestOptions("POST", {
            startedAt: exception.startedAt, endedAt: exception.endedAt,
            assignmentId: values.assignmentId, reason: values.reason,
          }));
          setMessage("Timeline gap corrected and audited.");
          renderWork(timeline.date);
        }));
        row.append(form);
      }
      timelineList.append(row);
    });
    if (!timelineList.children.length) timelineList.append(noticeElement("No timeline events or exceptions for this day.", "warning"));
    timelineSection.append(timelineList);
    board.append(timelineSection);
  } catch (error) {
    const board = app.querySelector("#work-board");
    if (board) board.replaceChildren(noticeElement(errorText(error), "error"));
  }
}

async function renderOperations() {
  renderShell(
    '<section class="panel"><p class="eyebrow">Operations</p><h1>Organisation overview.</h1><p class="lede">A permission-filtered snapshot of people, client work, reviews, calendars and basic operational counts.</p>' + feedback() + '<div id="operations-board"><p class="small">Loading operations...</p></div></section>',
    "operations",
  );
  showFeedback();
  try {
    const [peopleResult, tasksResult, availabilityResult, reviewsResult] = await Promise.all([
      readOrError(api("/api/people"), { people: [] }),
      readOrError(api("/api/tasks"), { tasks: [] }),
      readOrError(api("/api/availability/config"), { calendars: [], holidays: [] }),
      readOrError(api("/api/reviews/pending"), { reviews: [] }),
    ]);
    const people = peopleResult.people || [];
    const tasks = tasksResult.tasks || [];
    const calendars = availabilityResult.calendars || [];
    const holidays = availabilityResult.holidays || [];
    const reviews = reviewsResult.reviews || [];
    const board = app.querySelector("#operations-board");
    board.replaceChildren();
    const counts = document.createElement("div");
    counts.className = "card-grid";
    [["People", people.length, peopleResult], ["Visible tasks", tasks.length, tasksResult], ["Pending reviews", reviews.length, reviewsResult], ["Calendars", calendars.length, availabilityResult]].forEach(([label, value, result]) => {
      const card = document.createElement("article");
      card.className = "card";
      const heading = document.createElement("h2");
      heading.textContent = result.readError ? "Unavailable" : String(value);
      const text = document.createElement("p");
      text.textContent = label;
      card.append(heading, text);
      counts.append(card);
    });
    board.append(counts);

    const exports = document.createElement("div");
    exports.className = "form-actions";
    if (!peopleResult.readError) exports.append(adminButton("Download people CSV", () => downloadCsv(
        "nova-people.csv",
        ["Name", "Email", "Status", "Designation", "Start date", "Manager", "Office", "Department", "Role"],
        people.map((person) => [
          person.displayName || person.email,
          person.email,
          person.status,
          person.designation,
          person.employmentStartsOn,
          person.managerName,
          person.office && person.office.name,
          person.department && person.department.name,
          person.role && person.role.name,
        ]),
      ), true));
    else exports.append(adminReadFailure(peopleResult, "people data"));
    if (!tasksResult.readError) exports.append(adminButton("Download work CSV", () => downloadCsv(
        "nova-work.csv",
        ["Title", "Status", "Priority", "Billing class", "Billing policy source", "Billing policy revision", "Task definition provenance", "Correction of", "Due date", "Client", "Workstream", "Group", "Department", "Assignments"],
        tasks.map((task) => [
          task.title,
          task.status,
          task.priority,
          task.billingClass,
          task.billingPolicySource,
          task.billingPolicyRevision,
          taskDefinitionReference(task),
          task.correctionOf && task.correctionOf.title,
          task.dueDate,
          task.client && task.client.name,
          task.workstream && task.workstream.name,
          task.group && task.group.name,
          task.department && task.department.name,
          (task.assignments || []).map((assignment) => assignment.personName).join("; "),
        ]),
      ), true));
    else exports.append(adminReadFailure(tasksResult, "task data"));
    if (!availabilityResult.readError) exports.append(adminButton("Download calendar CSV", () => downloadCsv(
        "nova-calendar.csv",
        ["Type", "Date", "Name", "Office", "Effective date", "Rules"],
        [
          ...calendars.map((calendar) => ["calendar", "", calendar.name, calendar.office && calendar.office.name, calendar.effectiveOn, JSON.stringify(calendar.rules || [])]),
          ...holidays.map((holiday) => ["holiday", holiday.date, holiday.name, holiday.office && holiday.office.name, "", ""]),
        ],
      ), true));
    else exports.append(adminReadFailure(availabilityResult, "calendar data"));
    board.append(exports);

    const teamSection = adminSection("Team and People detail", "People visible through your current people permissions, including lifecycle, employment, manager, office, department and role context.");
    const teamList = document.createElement("div");
    teamList.className = "stack";
    const peopleReadFailure = adminReadFailure(peopleResult, "people");
    if (peopleReadFailure) teamList.append(peopleReadFailure);
    else if (!people.length) teamList.append(noticeElement("No people are visible.", "warning"));
    people.forEach((person) => {
      const row = document.createElement("p");
      row.className = "list-item";
      row.textContent = (person.displayName || person.email) + " · " + person.status +
        [person.designation, person.office && person.office.name, person.department && person.department.name, person.role && person.role.name,
          person.managerName && "manager: " + person.managerName, person.employmentStartsOn && "started: " + person.employmentStartsOn]
          .filter(Boolean).join(" · ");
      teamList.append(row);
    });
    teamSection.append(teamList);
    board.append(teamSection);

    const workSection = adminSection("Client Work and review queue detail", "Visible task context, due dates, assignments and pending review count use the same task/review permissions as the Work and Admin screens.");
    const workList = document.createElement("div");
    workList.className = "stack";
    const tasksReadFailure = adminReadFailure(tasksResult, "tasks");
    const reviewsReadFailure = adminReadFailure(reviewsResult, "pending reviews");
    if (tasksReadFailure) workList.append(tasksReadFailure);
    else if (!tasks.length) workList.append(noticeElement("No visible tasks.", "warning"));
    tasks.forEach((task) => {
      const row = document.createElement("p");
      row.className = "list-item";
      row.textContent = task.title + " · " + task.status + " · " +
        (task.client ? task.client.name + " / " : "Organisation / ") +
        (task.workstream && task.workstream.name || "workstream") +
        (task.dueDate ? " · due " + task.dueDate : "") +
        " · assignments " + (task.assignments || []).length;
      workList.append(row);
    });
    if (reviewsReadFailure) workList.append(reviewsReadFailure);
    else if (reviews.length) workList.append(noticeElement(reviews.length + " review(s) are waiting for your decision."));
    workSection.append(workList);
    board.append(workSection);

    const calendarSection = adminSection("Calendar detail", "Office calendars, timezone-specific rules and holidays are read from the canonical availability configuration.");
    const calendarList = document.createElement("div");
    calendarList.className = "stack";
    calendars.forEach((calendar) => {
      const row = document.createElement("p");
      row.className = "list-item";
      row.textContent = calendar.name + " · " + (calendar.office && calendar.office.name || "office") + " · from " + calendar.effectiveOn;
      calendarList.append(row);
    });
    holidays.slice(0, 20).forEach((holiday) => {
      const row = document.createElement("p");
      row.className = "list-item";
      row.textContent = holiday.date + " · " + holiday.name + " · " + (holiday.office && holiday.office.name || "office");
      calendarList.append(row);
    });
    const calendarReadFailure = adminReadFailure(availabilityResult, "calendar data");
    if (calendarReadFailure) calendarList.append(calendarReadFailure);
    else if (!calendarList.children.length) calendarList.append(noticeElement("No calendars or holidays are configured.", "warning"));
    calendarSection.append(calendarList);
    board.append(calendarSection);
  } catch (error) {
    const board = app.querySelector("#operations-board");
    if (board) board.replaceChildren(noticeElement(errorText(error), "error"));
  }
}

function renderWfhRequestPanel(target) {
  const section = document.createElement("section");
  section.className = "panel nested-panel";
  const heading = document.createElement("h2");
  heading.textContent = "Request work from home";
  const note = document.createElement("p");
  note.className = "small";
  note.textContent = "You may continue task work while a request is pending. A WFH check-in remains provisional—not attendance or payroll credit—until approved. Rejection discards only that credit; task records remain.";
  const form = document.createElement("form");
  form.className = "form-grid";
  form.innerHTML = '<label>Start date<input name="startDate" type="date" required></label>' +
    '<label>End date<input name="endDate" type="date" required></label>' +
    '<label class="full">Reason (optional)<textarea name="reason" maxlength="2000"></textarea></label>' +
    '<div class="form-actions full"><button class="button" type="submit">Submit WFH request</button></div>';
  form.addEventListener("submit", (event) => withSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    await api("/api/availability/wfh", requestOptions("POST", {
      startDate: values.startDate, endDate: values.endDate, reason: values.reason || undefined,
    }));
    setMessage("WFH request submitted for approval.");
    render();
  }));
  const requests = document.createElement("div");
  requests.className = "stack";
  requests.append(noticeElement("Loading your WFH requests...", "warning"));
  section.append(heading, note, form, requests);
  target.append(section);
  api("/api/availability/wfh/mine").then((result) => {
    requests.replaceChildren();
    if (!result.requests.length) {
      requests.append(noticeElement("No WFH requests yet.", "warning"));
      return;
    }
    result.requests.forEach((item) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.textContent = item.startDate + "–" + item.endDate + " · " + item.status +
        (item.reviewReason ? " · " + item.reviewReason : "");
      if (item.status === "pending" || item.status === "approved") {
        const cancel = actionButton("Cancel", async () => {
          try { await api("/api/availability/wfh/" + item.id + "/cancel", requestOptions("POST")); setMessage("WFH request cancelled."); }
          catch (error) { setMessage(errorText(error), "error"); }
          render();
        });
        row.append(cancel);
      }
      requests.append(row);
    });
  }).catch(() => requests.replaceChildren(noticeElement("WFH requests are not available for this role.", "warning")));
}

function renderLeaveRequestPanel(target) {
  const section = document.createElement("section");
  section.className = "panel nested-panel";
  const heading = document.createElement("h2");
  heading.textContent = "Request leave";
  const note = document.createElement("p");
  note.className = "small";
  note.textContent = "Use full-day or half-day portions. Approval never rewrites attendance automatically.";
  const form = document.createElement("form");
  form.className = "form-grid";
  form.innerHTML = '<label>Leave type<input name="leaveType" value="annual" required maxlength="80"></label>' +
    '<label>Start date<input name="startDate" type="date" required></label>' +
    '<label>End date<input name="endDate" type="date" required></label>' +
    '<label>Portion<select name="portion"><option value="1">Full day</option><option value="0.5">Half day</option></select></label>' +
    '<label class="full">Reason (optional)<textarea name="reason" maxlength="2000"></textarea></label>' +
    '<div class="form-actions full"><button class="button" type="submit">Submit leave request</button></div>';
  form.addEventListener("submit", (event) => withSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    const start = new Date(values.startDate + "T00:00:00Z");
    const end = new Date(values.endDate + "T00:00:00Z");
    const days = [];
    for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
      days.push({ date: cursor.toISOString().slice(0, 10), portion: Number(values.portion) });
      if (days.length > 366) throw Object.assign(new Error("LEAVE_REQUEST_INPUT_INVALID"), { code: "LEAVE_REQUEST_INPUT_INVALID" });
    }
    await api("/api/leave", requestOptions("POST", {
      leaveType: values.leaveType, startDate: values.startDate, endDate: values.endDate,
      reason: values.reason || undefined, days,
    }));
    setMessage("Leave request submitted for review.");
    render();
  }));
  const requests = document.createElement("div");
  requests.className = "stack";
  requests.append(noticeElement("Loading your leave requests...", "warning"));
  section.append(heading, note, form, requests);
  target.append(section);
  api("/api/leave/mine").then((result) => {
    requests.replaceChildren();
    if (!result.requests.length) {
      requests.append(noticeElement("No leave requests yet.", "warning"));
      return;
    }
    result.requests.forEach((leave) => {
      const item = document.createElement("p");
      item.className = "list-item";
      item.textContent = leave.leaveType + " · " + leave.startDate + "–" + leave.endDate + " · " + leave.status;
      requests.append(item);
    });
  }).catch(() => requests.replaceChildren(noticeElement("Leave history is not available for this role.", "warning")));
}

async function attendanceAction(path, body) {
  try {
    let payload = body;
    if (body && body.mode === "office") {
      if (!navigator.geolocation) throw Object.assign(new Error("ATTENDANCE_LOCATION_REQUIRED"), { code: "ATTENDANCE_LOCATION_REQUIRED" });
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, maximumAge: 30000, timeout: 10000,
      }));
      payload = { ...body, latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy };
    }
    await api(path, requestOptions("POST", payload));
    setMessage(path.endsWith("check-out") ? "Attendance checked out." : "Attendance updated.");
  } catch (error) {
    setMessage(error && error.code === 1 ? errorText(Object.assign(new Error("ATTENDANCE_LOCATION_REQUIRED"), { code: "ATTENDANCE_LOCATION_REQUIRED" })) : errorText(error), "error");
  }
  render();
}

function renderAccept() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  window.history.replaceState({}, "", "/accept-invite");
  if (!token) {
    app.innerHTML = '<section class="panel"><p class="eyebrow">Invitation</p><h1>This invitation link is incomplete.</h1><p class="lede">Ask the person who invited you to send a new invitation.</p><a class="button secondary" href="/">Return to NOVA</a></section>';
    return;
  }
  app.innerHTML =
    '<section class="panel"><p class="eyebrow">You are invited</p><h1>Create your NOVA account.</h1><p class="lede">Choose your own password. You will then receive a verification email before your onboarding continues.</p>' + feedback() +
    '<form id="accept-form" class="form-grid one"><label>Your name<input name="name" autocomplete="name" required maxlength="180"></label><label>Invited email address<input name="email" type="email" autocomplete="email" required></label><label>New password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label><div class="form-actions"><button class="button" type="submit">Create account</button></div></form></section>';
  app.querySelector("#accept-form").addEventListener("submit", (event) => submitInvitation(event, token));
  showFeedback();
}

function renderForgot() {
  app.innerHTML =
    '<section class="panel"><p class="eyebrow">Password recovery</p><h1>Reset your password.</h1><p class="lede">Enter your work email. If it is registered, NOVA will send a secure reset link.</p>' + feedback() +
    '<form id="forgot-form" class="form-grid one"><label>Email address<input name="email" type="email" autocomplete="email" required></label><div class="form-actions"><button class="button" type="submit">Send reset link</button><button class="button secondary" type="button" data-nav="login">Back to sign in</button></div></form></section>';
  app.querySelector("#forgot-form").addEventListener("submit", submitForgot);
  attachNavigation();
  showFeedback();
}

function renderReset() {
  const query = new URLSearchParams(window.location.search);
  const token = query.get("token");
  const invalid = query.get("error");
  // The reset token is kept only in this short-lived page closure, not in the
  // address bar, local storage, or a later referrer.
  window.history.replaceState({}, "", "/reset-password");
  if (!token || invalid) {
    app.innerHTML =
      '<section class="panel"><p class="eyebrow">Password recovery</p><h1>This reset link is no longer valid.</h1><p class="lede">Request a new password reset link and use the latest email.</p><a class="button secondary" href="/?view=forgot">Request a new link</a></section>';
    return;
  }
  app.innerHTML =
    '<section class="panel"><p class="eyebrow">Password recovery</p><h1>Choose a new password.</h1><p class="lede">After saving it, sign in normally with your new password.</p>' + feedback() +
    '<form id="reset-form" class="form-grid one"><label>New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="8"></label><label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8"></label><div class="form-actions"><button class="button" type="submit">Save new password</button></div></form></section>';
  app.querySelector("#reset-form").addEventListener("submit", (event) => submitReset(event, token));
  showFeedback();
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function withSubmit(event, work) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("[type=submit]");
  button.disabled = true;
  try {
    await work();
  } catch (error) {
    setMessage(errorText(error), "error");
    render();
  } finally {
    button.disabled = false;
  }
}

function submitSetup(event) {
  const form = event.currentTarget;
  return withSubmit(event, async () => {
    const values = formValues(form);
    const headers = { "x-nova-bootstrap-token": values.bootstrapToken };
    state.bootstrapToken = values.bootstrapToken;
    await api("/api/setup/register", requestOptions("POST", {
      email: values.email, name: values.name, password: values.password,
    }, headers));
    let originSaved = false;
    try {
      await api("/api/organisation/bootstrap", requestOptions("POST", {
        organisationName: values.organisationName,
        attendanceMode: values.attendanceMode,
        requiredAttendanceMinutes: Number(values.requiredAttendanceMinutes),
      }, headers));
      try {
        const saved = await api("/api/organisation/public-origin", requestOptions(
          "PATCH",
          { origin: values.publicOrigin },
          headers,
        ));
        originSaved = Boolean(saved.configuredOrigin);
        state.publicOriginConfigured = originSaved;
        state.publicOrigin = saved.configuredOrigin || saved.effectiveOrigin || "";
      } catch (error) {
        state.publicOriginConfigured = false;
        setMessage("Workspace created, but the public URL was not saved: " + errorText(error) + " Set it before configuring email.", "warning");
      }
    } finally {
      form.reset();
    }
    await refreshSession();
    state.view = "settings";
    if (originSaved) {
      setMessage("Workspace created. The public URL is set. Configure and test email delivery, then request the founder verification link.");
    } else if (!state.message) {
      setMessage("Workspace created. Set the public URL before configuring email.", "warning");
    }
    render();
  });
}

function submitLogin(event) {
  return withSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    await api("/api/auth/sign-in/email", requestOptions("POST", {
      email: values.email, password: values.password,
    }));
    await refreshSession();
    if (!state.session) {
      const error = new Error("AUTHENTICATION_REQUIRED");
      error.code = "AUTHENTICATION_REQUIRED";
      throw error;
    }
    state.view = "settings";
    render();
  });
}

function submitChangePassword(event) {
  const form = event.currentTarget;
  return withSubmit(event, async () => {
    const values = formValues(form);
    if (values.newPassword !== values.confirmPassword) {
      const error = new Error("PASSWORDS_DO_NOT_MATCH");
      error.code = "PASSWORDS_DO_NOT_MATCH";
      throw error;
    }
    await api("/api/auth/change-password", requestOptions("POST", {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    }));
    form.reset();
    setMessage("Password changed. Other active sessions were signed out.");
    render();
  });
}

function submitForgot(event) {
  return withSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    await api("/api/auth/request-password-reset", requestOptions("POST", {
      email: values.email,
      redirectTo: window.location.origin + "/reset-password",
    }));
    setMessage("If that email is registered, NOVA has requested password recovery. Check your inbox or contact an administrator if email is unavailable.");
    state.view = "login";
    render();
  });
}

function submitReset(event, token) {
  return withSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    if (values.newPassword !== values.confirmPassword) {
      const error = new Error("PASSWORDS_DO_NOT_MATCH");
      error.code = "PASSWORDS_DO_NOT_MATCH";
      throw error;
    }
    await api("/api/auth/reset-password", requestOptions("POST", {
      newPassword: values.newPassword,
      token,
    }));
    setMessage("Your password has been reset. Sign in with the new password.");
    window.history.replaceState({}, "", "/?view=login");
    state.view = "login";
    render();
  });
}

function submitConnection(event) {
  const form = event.currentTarget;
  return withSubmit(event, async () => {
    const values = formValues(form);
    const input = {
      name: values.name,
      provider: values.provider,
      replyToEmail: values.replyToEmail || undefined,
      senderEmail: values.senderEmail,
    };
    if (values.provider === "smtp") {
      input.credentials = {
        host: values.smtpHost,
        password: values.smtpPassword,
        port: Number(values.smtpPort),
        secure: values.smtpSecure === "on",
        username: values.smtpUsername,
      };
    } else if (values.provider === "gmail_oauth2") {
      input.credentials = { clientId: values.gmailClientId, clientSecret: values.gmailClientSecret };
    } else if (values.provider === "resend") {
      input.credentials = { apiKey: values.resendApiKey };
    }
    const result = await api("/api/email-connections", requestOptions("POST", input));
    form.reset();
    setMessage(
      result.connection.provider === "gmail_oauth2"
        ? "Gmail connection saved. Select Connect Google on it to authorize the sender."
        : "Connection saved. Send a test before activating it.",
      result.connection.provider === "gmail_oauth2" ? "warning" : "success",
    );
    render();
  });
}

function submitTest(event, connectionId) {
  return withSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    await api("/api/email-connections/" + connectionId + "/test", requestOptions("POST", {
      recipientEmail: values.recipientEmail,
    }));
    setMessage("Test email sent successfully.");
    render();
  });
}

async function activateConnection(connectionId) {
  try {
    await api("/api/email-connections/" + connectionId + "/activate", requestOptions("POST"));
    setMessage("This is now NOVA active email connection.");
  } catch (error) {
    setMessage(errorText(error), "error");
  }
  render();
}

async function deactivateConnection(connectionId) {
  try {
    await api("/api/email-connections/" + connectionId + "/deactivate", requestOptions("POST"));
    setMessage("Email delivery is now off. Secure system handoffs remain available for invitations and recovery.", "warning");
  } catch (error) {
    setMessage(errorText(error), "error");
  }
  render();
}

async function connectGmail(connectionId) {
  try {
    const result = await api("/api/email-connections/" + connectionId + "/gmail/connect", requestOptions("POST"));
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    setMessage(errorText(error), "error");
    render();
  }
}

async function sendVerification() {
  try {
    await api("/api/auth/send-verification-email", requestOptions("POST", {
      email: state.session.email,
    }));
    setMessage("Verification requested. Check your inbox, or ask an administrator for a secure system handoff if email is unavailable.");
  } catch (error) {
    setMessage(errorText(error), "error");
  }
  render();
}

function submitInvite(event) {
  const form = event.currentTarget;
  return withSubmit(event, async () => {
    const values = formValues(form);
    const result = await api("/api/people/invitations", requestOptions("POST", values));
    form.reset();
    reflectInvitationDelivery(result);
    render();
  });
}

function reflectInvitationDelivery(result) {
  if (result.delivery === "manual") {
    setMessage("No active email adapter was available. The invitation link is waiting in Secure system handoffs.", "warning");
    state.view = "settings";
    return;
  }
  setMessage("Invitation created and sent.");
}

function submitInvitation(event, invitationToken) {
  return withSubmit(event, async () => {
    const values = formValues(event.currentTarget);
    const result = await api("/api/invitations/accept", requestOptions("POST", {
      email: values.email, invitationToken, name: values.name, password: values.password,
    }));
    setMessage(
      result.verificationSent
        ? "Account created. Check your email to verify it, then sign in."
        : "Account created. No email was delivered. Ask an authorized administrator to reveal your one-time verification link in Secure system handoffs, then return here to sign in.",
      result.verificationSent ? "success" : "warning",
    );
    window.history.replaceState({}, "", "/?view=login");
    state.view = "login";
    render();
  });
}

async function signOut() {
  try {
    await api("/api/auth/sign-out", requestOptions("POST"));
  } catch {
    // A stale cookie should still leave this browser in the signed-out state.
  }
  state.session = null;
  state.actorGrants = null;
  state.view = null;
  setMessage("You have signed out.");
  go(null);
}

async function refreshSession() {
  state.actorGrants = null;
  try {
    const response = await fetch("/api/auth/get-session", requestOptions("GET"));
    if (!response.ok) {
      state.session = null;
      return;
    }
    const result = await response.json().catch(() => null);
    state.session = result && result.user ? result.user : null;
    if (state.session) {
      state.actorGrants = await readOrError(api("/api/me/permission-grants"), {
        actorPersonId: null,
        grants: [],
        isSuperAdmin: false,
      });
    }
  } catch {
    state.session = null;
  }
}

function render() {
  const query = new URLSearchParams(window.location.search);
  if (query.get("gmail") === "connected") {
    setMessage("Google connection completed. Send a test email before activating it.");
    window.history.replaceState({}, "", "/?view=settings");
    state.view = "settings";
  } else if (query.get("gmail") === "failed") {
    setMessage(errorMessages[query.get("error")] || "Google connection did not complete.", "error");
    window.history.replaceState({}, "", "/?view=settings");
    state.view = "settings";
  }
  const view = state.view || routeView();
  if (view === "accept") return renderAccept();
  if (view === "forgot") return renderForgot();
  if (view === "reset") return renderReset();
  if (view === "deploy") return renderDeployment();
  if (view === "setup") return renderSetup();
  if (view === "login") return renderLogin();
  if (!state.session) return renderLanding();
  if (view === "today") return renderAttendance();
  if (view === "work") return renderWork();
  if (view === "operations") return renderOperations();
  if (view === "notifications") return renderNotifications();
  if (view === "invite") return renderInvite();
  if (view === "admin") return renderAdmin();
  return renderSettings();
}

window.addEventListener("popstate", () => {
  state.view = null;
  render();
});

refreshSession().then(render);
