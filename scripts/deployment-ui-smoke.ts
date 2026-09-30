export {};

let markup = "";
type TestButton = {
  dataset: Record<string, string>;
  value?: string;
  addEventListener: (name: string, handler: () => unknown) => void;
  click?: () => unknown;
  change?: () => unknown;
};
let stageButtons: TestButton[] = [];
let probeButton: TestButton | null = null;
let resetButton: TestButton | null = null;
let pathButtons: TestButton[] = [];
let schedulerInputs: TestButton[] = [];

function button(dataset: Record<string, string> = {}): TestButton {
  const control: TestButton = {
    dataset,
    addEventListener(name: string, handler: () => unknown) {
      if (name === "click") control.click = handler;
      if (name === "change") control.change = handler;
    },
  };
  return control;
}

const app = {
  querySelector(selector: string) {
    if (selector === "[data-deployment-probe]") {
      probeButton = button();
      return probeButton;
    }
    if (selector === "[data-deployment-reset]") {
      resetButton = button();
      return resetButton;
    }
    return null;
  },
  querySelectorAll(selector: string) {
    if (selector === "[data-deployment-stage]") {
      stageButtons = Array.from({ length: 7 }, (_, index) => button({ deploymentStage: String(index) }));
      return stageButtons;
    }
    if (selector === "[data-deployment-path]") {
      pathButtons = ["cloudflare-supabase", "netlify-supabase", "vercel-supabase", "vps-postgres", "local-docker"]
        .map((deploymentPath) => button({ deploymentPath }));
      return pathButtons;
    }
    if (selector === "[name=deploymentScheduler]") {
      schedulerInputs = Array.from(markup.matchAll(/name="deploymentScheduler" value="([^"]+)"/g), ([, value]) => {
        const input = button();
        input.value = value;
        return input;
      });
      return schedulerInputs;
    }
    return [];
  },
  set innerHTML(value: string) {
    markup = value;
  },
  get innerHTML() {
    return markup;
  },
};

Object.assign(globalThis, {
  document: { querySelector: () => app },
  window: {
    location: { pathname: "/", search: "?view=deploy", origin: "http://localhost:4173" },
    history: { replaceState() {}, pushState() {} },
    addEventListener() {},
  },
  sessionStorage: {
    getItem: () => JSON.stringify({ path: "cloudflare-supabase", stage: 0, scheduler: "supabase", completed: {} }),
    setItem() {},
  },
});

let healthUnavailable = true;
Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (path: RequestInfo | URL) => {
  const target = String(path);
  if (target.includes("/api/health")) {
    if (healthUnavailable) throw new Error("SIMULATED_NETWORK_FAILURE");
    return Response.json({ service: "nova-api", status: "ok" });
  }
  if (target.includes("/api/ready")) {
    return Response.json({ service: "nova-api", status: "ready", scheduler: "supabase" });
  }
  return new Response(null, { status: 401 });
} });

const appModulePath: string = "../web/app.js";
await import(appModulePath);
await new Promise((resolve) => setTimeout(resolve, 0));
const requiredPredeployText = [
  "How your services connect",
  "Important:</strong> This checklist does not log in to or change provider accounts.",
  "See where each part is configured",
  "NOVA deployment connection",
  "calls NOVA’s same protected background endpoint.",
  "You do:",
  "Then:",
  "Confirm:",
  "GitHub → Cloudflare",
  "Supabase Cloud",
  "Cloudflare Worker → Variables &amp; Secrets + Hyperdrive binding",
  "Host/domain settings, then NOVA",
  "Full action map: what you do and what it changes",
  "Your action → what happens next",
  "Your action / where",
  "What happens",
  "Connect this repository to Cloudflare",
  "After connection, a production-branch push builds and publishes NOVA’s UI and API",
  "On your trusted computer, run <code>bun run setup:supabase</code>",
  "NOVA displays its project ref and asks you to type it before applying migrations",
  "create Hyperdrive from Supabase Connect → Direct using <code>nova_app</code>",
  "Do not set raw <code>DATABASE_URL</code>",
  "The Worker connects through Hyperdrive",
  "You do not choose or configure a separate identity provider",
  "Email starts off",
  "npx wrangler@4.141.0 deploy --config cloudflare/wrangler.supabase-cron.toml",
  "How this selection becomes real",
  "Show the exact provider settings and steps",
  "Where you change it",
  "What switches it on",
  "Where you confirm",
  "Your Supabase project (not the hosting provider)",
  "Selected scheduler: Supabase runs the schedule (inside your database). It runs in Your Supabase project (not the hosting provider)",
  "selecting this option only changes this browser checklist",
];
const missingPredeployText = requiredPredeployText.filter((text) => !markup.includes(text));
const actionMap = markup.match(/<table class="deployment-action-map"[\s\S]*?<\/table>/)?.[0] ?? "";
if (!actionMap.includes("Background work") || actionMap.includes("bun run supabase:scheduler")) {
  throw new Error("DEPLOYMENT_ACTION_MAP_REPEATS_SCHEDULER_STEPS");
}
if (missingPredeployText.length || markup.includes("Compose bootstrap, or the post-readiness Supabase step")) {
  throw new Error(`DEPLOYMENT_PREDEPLOY_ACTION_OWNERSHIP_RENDER_FAILED: ${missingPredeployText.join(" | ")}`);
}
if (markup.includes("bun run supabase:scheduler") || markup.includes("Trusted operator computer → NOVA repository checkout")) {
  throw new Error("SUPABASE_CRON_WRITE_ACTION_SHOWN_BEFORE_READINESS");
}

stageButtons[4]?.click?.();
if (markup.includes("Trusted operator computer → NOVA repository checkout")) throw new Error("SCHEDULER_APPLICATION_ACTION_SHOWN_BEFORE_PROBE");
if (!probeButton?.click) throw new Error("DEPLOYMENT_READINESS_PROBE_MISSING");
await probeButton.click();
if (!markup.includes("API health: unavailable") || markup.includes("Trusted operator computer → NOVA repository checkout")) {
  throw new Error("FAILED_HEALTH_CHECK_DID_NOT_BLOCK_SCHEDULER");
}

healthUnavailable = false;
if (!probeButton?.click) throw new Error("DEPLOYMENT_READINESS_PROBE_MISSING_AFTER_FAILURE");
await probeButton.click();
if (
  !markup.includes("bun run supabase:scheduler</code>") ||
  !markup.includes('<details class="deployment-scheduler-plan" open>') ||
  !markup.includes("Trusted operator computer → NOVA repository checkout") ||
  !markup.includes("type it exactly before any write") ||
  !markup.includes("pg_cron</code> + <code>pg_net")
) throw new Error("READY_SCHEDULER_APPLICATION_STEPS_NOT_SHOWN");

const combinationChecks = [
  ["cloudflare-supabase", "cloudflare", "Your Cloudflare Worker", "production Worker deploy using the Cloudflare Cron Wrangler config"],
  ["cloudflare-supabase", "supabase", "Your Supabase project (not the hosting provider)", "After NOVA passes readiness, the trusted-operator command creates the job in Supabase"],
  ["netlify-supabase", "netlify", "Your Netlify site", "The production build reads NOVA_BACKGROUND_SCHEDULER"],
  ["netlify-supabase", "supabase", "Your Supabase project (not the hosting provider)", "After NOVA passes readiness, the trusted-operator command creates the job in Supabase"],
  ["vercel-supabase", "vercel", "Your Vercel production project", "Production deploy reads NOVA_BACKGROUND_SCHEDULER in vercel.ts"],
  ["vercel-supabase", "supabase", "Your Supabase project (not the hosting provider)", "After NOVA passes readiness, the trusted-operator command creates the job in Supabase"],
  ["vps-postgres", "vps", "The VPS/local server running NOVA", "Docker Compose bootstrap starts one maintenance worker"],
  ["local-docker", "vps", "The VPS/local server running NOVA", "Docker Compose bootstrap starts one maintenance worker"],
] as const;
const schedulerApplicationCopy: Record<string, string> = {
  "cloudflare-supabase:cloudflare": "set the Deploy command to <code>npx wrangler@4.141.0 deploy --config cloudflare/wrangler.toml</code>",
  "cloudflare-supabase:supabase": "set Deploy command to <code>npx wrangler@4.141.0 deploy --config cloudflare/wrangler.supabase-cron.toml</code>",
  "netlify-supabase:netlify": "Set <code>NOVA_BACKGROUND_SCHEDULER=netlify</code> and make it available to Builds and Functions",
  "netlify-supabase:supabase": "Set <code>NOVA_BACKGROUND_SCHEDULER=supabase</code> and make it available to Builds and Functions",
  "vercel-supabase:vercel": "Set <code>NOVA_BACKGROUND_SCHEDULER=vercel</code> before the Production deploy",
  "vercel-supabase:supabase": "Set <code>NOVA_BACKGROUND_SCHEDULER=supabase</code> before the Production deploy",
  "vps-postgres:vps": "Run the documented Compose bootstrap/upgrade and set <code>NOVA_BACKGROUND_SCHEDULER=vps</code>",
  "local-docker:vps": "Run the documented Compose bootstrap/upgrade and set <code>NOVA_BACKGROUND_SCHEDULER=vps</code>",
};
const schedulerWhereCopy: Record<string, string> = {
  cloudflare: "Cloudflare Worker → Settings → Build",
  netlify: "Netlify → Site configuration → Environment variables",
  vercel: "Vercel → Project Settings → Environment Variables → Production",
  supabase: "The API host’s runtime settings, then your Supabase project",
  vps: "The server’s private .env and Docker Compose maintenance service",
};

for (const [path, scheduler, lives, activates] of combinationChecks) {
  if (!resetButton?.click) throw new Error("DEPLOYMENT_RESET_CONTROL_MISSING");
  resetButton.click();
  const selectedPath = pathButtons.find((candidate) => candidate.dataset.deploymentPath === path);
  if (!selectedPath?.click) throw new Error(`DEPLOYMENT_PATH_CONTROL_MISSING_${path}`);
  selectedPath.click();
  const selectedScheduler = schedulerInputs.find((candidate) => candidate.value === scheduler);
  if (!selectedScheduler?.change) throw new Error(`DEPLOYMENT_SCHEDULER_CONTROL_MISSING_${path}_${scheduler}`);
  selectedScheduler.change();
  if (!markup.includes(lives) || !markup.includes(activates) || !markup.includes("This checklist does not log in to or change provider accounts.")) {
    throw new Error(`DEPLOYMENT_COMBINATION_RENDER_FAILED_${path}_${scheduler}: ${markup.slice(markup.indexOf("Background work"), markup.indexOf("Background work") + 700)}`);
  }
  if (!markup.includes("How your services connect") ||
      !markup.includes('<details class="deployment-map-details"><summary>See where each part is configured</summary>') ||
      markup.includes('<details class="deployment-map-details" open>') ||
      !markup.includes("2 · Database") || !markup.includes("3 · Runtime + secrets") ||
      !markup.includes("4 · Domain + links") || !markup.includes("5 · Authentication + email") ||
      !markup.includes("6 · Background scheduler")) {
    throw new Error(`DEPLOYMENT_APPLY_LOCATION_MAP_MISSING_${path}_${scheduler}`);
  }
  if (!markup.includes(schedulerApplicationCopy[`${path}:${scheduler}`])) {
    throw new Error(`DEPLOYMENT_SCHEDULER_APPLY_INSTRUCTION_MISSING_${path}_${scheduler}`);
  }
  if (!markup.includes("How this selection becomes real") ||
    !markup.includes("Where you change it") || !markup.includes(schedulerWhereCopy[scheduler])) {
    throw new Error(`DEPLOYMENT_SCHEDULER_ACTION_LOCATION_MISSING_${path}_${scheduler}`);
  }
  if (!markup.includes('<details class="deployment-scheduler-plan"><summary>Show the exact provider settings and steps</summary>')) {
    throw new Error(`DEPLOYMENT_SCHEDULER_DETAILS_MISSING_${path}_${scheduler}`);
  }
  if (path === "vercel-supabase" && scheduler === "supabase" &&
    (!markup.includes("NOVA_BACKGROUND_SCHEDULER=supabase") || !markup.includes("publishes no Vercel Cron"))) {
    throw new Error("VERCEL_SUPABASE_SELECTION_MUST_OMIT_NATIVE_CRON");
  }
  if (path === "netlify-supabase" && scheduler === "supabase" &&
    (!markup.includes("net._http_response") || !markup.includes("timed_out=false") ||
      !markup.includes("only means pg_net queued"))) {
    throw new Error("SUPABASE_CRON_MUST_VERIFY_ASYNC_HTTP_RESULT");
  }
}

console.info("PASS: deployment action map covers every host/scheduler pairing and distinguishes customer actions from automatic provider effects; Supabase Cron creation remains readiness-gated.");
