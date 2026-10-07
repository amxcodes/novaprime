import type { DeploymentPath, DeploymentPathId, DeploymentScheduler, DeploymentStage } from "./contracts";

export const DEPLOYMENT_PATHS: readonly DeploymentPath[] = [
  {
    id: "netlify-supabase",
    title: "Netlify + Supabase Cloud",
    badge: "Recommended",
    text: "Netlify hosts the NOVA API and client; Supabase Cloud provides managed PostgreSQL.",
  },
  {
    id: "cloudflare-supabase",
    title: "Cloudflare + Supabase Cloud",
    badge: "Hosted",
    text: "Cloudflare hosts the NOVA Worker and client; Supabase Cloud provides managed PostgreSQL.",
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

export const DEPLOYMENT_STAGES: readonly DeploymentStage[] = [
  { title: "Prerequisites", summary: "Choose the host, public URL and scheduler recipe." },
  { title: "Database readiness", summary: "Create PostgreSQL and apply NOVA migrations." },
  { title: "Secret handoff", summary: "Copy runtime values into the API host." },
  { title: "Deploy & runtime readiness", summary: "Publish the configured runtime and check health." },
  { title: "Scheduler verification", summary: "Create Supabase Cron after readiness, or verify the deploy-created trigger." },
  { title: "First-run setup", summary: "Create the founding workspace and attendance policy." },
  { title: "Handoff", summary: "Remove bootstrap material and give the owner the setup URL." },
];

export const DEPLOYMENT_SCHEDULERS: Readonly<Record<DeploymentPathId, readonly DeploymentScheduler[]>> = {
  "cloudflare-supabase": ["cloudflare", "supabase"],
  "netlify-supabase": ["netlify", "supabase"],
  "vercel-supabase": ["vercel", "supabase"],
  "vps-postgres": ["vps"],
  "local-docker": ["vps"],
};

export const DEPLOYMENT_SCHEDULER_LABELS: Readonly<Record<DeploymentScheduler, string>> = {
  cloudflare: "Cloudflare runs the schedule (inside your Worker)",
  netlify: "Netlify runs the schedule (with your published app)",
  vercel: "Vercel runs the schedule (from a production deploy)",
  supabase: "Supabase runs the schedule (inside your database)",
  vps: "This server runs the schedule (Docker worker)",
};

export function supportedDeploymentSchedulers(pathId: DeploymentPathId | ""): readonly DeploymentScheduler[] {
  return pathId ? DEPLOYMENT_SCHEDULERS[pathId] : [];
}

export function deploymentPathById(pathId: DeploymentPathId | ""): DeploymentPath | null {
  return DEPLOYMENT_PATHS.find((candidate) => candidate.id === pathId) ?? null;
}
