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
    text: "Cloudflare hosts the NOVA Worker and client; Supabase provides PostgreSQL and Cron.",
  },
  {
    id: "vps-postgres",
    title: "Self-hosted Docker + PostgreSQL",
    badge: "Self-hosted",
    text: "Run NOVA, PostgreSQL, and scheduled work on an always-on computer or server you control, with Nginx at the entry point.",
  },
];

export const DEPLOYMENT_STAGES: readonly DeploymentStage[] = [
  { title: "Prerequisites", summary: "Choose one supported profile and its public URL." },
  { title: "Database readiness", summary: "Create PostgreSQL and apply NOVA migrations." },
  { title: "Secret handoff", summary: "Copy runtime values into the API host." },
  { title: "Deploy & runtime readiness", summary: "Publish the configured runtime and check health." },
  { title: "Scheduler verification", summary: "Verify the profile's single recommended scheduled-work runner." },
  { title: "First-run setup", summary: "Create the founding workspace and attendance policy." },
  { title: "Handoff", summary: "Remove bootstrap material and give the owner the setup URL." },
];

export const DEPLOYMENT_SCHEDULERS: Readonly<Record<DeploymentPathId, DeploymentScheduler>> = {
  "cloudflare-supabase": "supabase",
  "netlify-supabase": "supabase",
  "vps-postgres": "vps",
};

export const DEPLOYMENT_SCHEDULER_LABELS: Readonly<Record<DeploymentScheduler, string>> = {
  supabase: "Supabase runs the schedule (inside your database)",
  vps: "The self-hosted Docker worker runs the schedule",
};

export function deploymentPathById(pathId: DeploymentPathId | ""): DeploymentPath | null {
  return DEPLOYMENT_PATHS.find((candidate) => candidate.id === pathId) ?? null;
}
