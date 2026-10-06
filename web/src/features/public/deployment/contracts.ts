export type DeploymentPathId =
  | "cloudflare-supabase"
  | "netlify-supabase"
  | "vercel-supabase"
  | "vps-postgres"
  | "local-docker";

export type DeploymentScheduler = "cloudflare" | "netlify" | "vercel" | "supabase" | "vps";

export interface DeploymentPath {
  id: DeploymentPathId;
  title: string;
  badge: string;
  text: string;
}

export interface DeploymentStage {
  title: string;
  summary: string;
}

export interface DeploymentProbe {
  checking?: boolean;
  health?: boolean;
  ready?: boolean;
  scheduler?: string | null;
  checkedAt?: string;
}

export interface DeploymentAssistantProps {
  pathId: DeploymentPathId | "";
  stage: number;
  scheduler: DeploymentScheduler | "";
  completed: Readonly<Record<number, boolean>>;
  probe: DeploymentProbe | null;
  onReset: () => void;
  onSelectPath: (path: DeploymentPathId) => void;
  onSelectStage: (stage: number) => void;
  onSelectScheduler: (scheduler: DeploymentScheduler) => void;
  onCompleteChange: (completed: boolean) => void;
  onProbe: () => void;
  onBack: () => void;
  onNext: () => void;
  onNavigateHome: () => void;
}

export interface DeploymentGuideAction {
  phase: "prepare" | "activate";
  where: string;
  change: string;
  result: string;
}

export interface DeploymentSchedulerPlan {
  file?: string;
  actions: DeploymentGuideAction[];
  verify: string;
  warning?: string;
}

export interface DeploymentHostGuide {
  files: string;
  connect: string;
  publish: string;
  runtimeSetup: string[];
  database: string;
  domain: string;
  postSetup: string;
}

export interface DeploymentGuide {
  host: DeploymentHostGuide;
  scheduler: DeploymentSchedulerPlan | null;
}
