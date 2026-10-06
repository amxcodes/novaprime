import {
  DEPLOYMENT_PATHS,
  DEPLOYMENT_SCHEDULERS,
  DEPLOYMENT_STAGES,
} from "../src/features/public/deployment/catalog.ts";
import {
  deploymentCanCompleteStage,
  deploymentCanContinue,
  deploymentCanSelectStage,
} from "../src/features/public/deployment/flow.ts";
export { deploymentCanCompleteStage, deploymentCanContinue, deploymentCanSelectStage };

export const deploymentProgressStorageKey = "nova-deployment-progress-v2";

export function normalizeDeploymentProgress(saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  const path = DEPLOYMENT_PATHS.some((candidate) => candidate.id === saved.path) ? saved.path : "";
  const scheduler = (DEPLOYMENT_SCHEDULERS[path] || []).includes(saved.scheduler) ? saved.scheduler : "";
  if (!path || !scheduler) return { path, stage: 0, scheduler, completed: {} };
  const completed = {};
  if (saved.completed && typeof saved.completed === "object" && !Array.isArray(saved.completed)) {
    DEPLOYMENT_STAGES.forEach((_, index) => {
      if (index === Object.keys(completed).length && saved.completed[index] === true) completed[index] = true;
    });
  }
  const unlockedStage = Object.keys(completed).length;
  return {
    path,
    stage: Number.isInteger(saved.stage)
      ? Math.max(0, Math.min(DEPLOYMENT_STAGES.length - 1, unlockedStage, saved.stage))
      : 0,
    scheduler,
    completed,
  };
}

export function selectDeploymentPath(_current, path) {
  return { path, stage: 0, scheduler: "", completed: {} };
}

export function selectDeploymentStage(current, stage) {
  return { ...current, stage };
}

export function selectDeploymentScheduler(current, scheduler) {
  return {
    ...current,
    scheduler,
    completed: current.scheduler === scheduler ? current.completed : {},
  };
}

export function setDeploymentStageCompletion(current, stage, completed) {
  return {
    ...current,
    completed: { ...current.completed, [stage]: completed },
  };
}

export function resetDeploymentProgress() {
  return { path: "", stage: 0, scheduler: "", completed: {} };
}

export function createDeploymentProbeLifecycle() {
  let generation = 0;
  return {
    begin() { generation += 1; return generation; },
    invalidate() { generation += 1; },
    isCurrent(token) { return token === generation; },
  };
}

export async function checkDeploymentEndpoint(path, expectedStatus, fetcher = fetch) {
  try {
    const response = await fetcher(path, {
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
