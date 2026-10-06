import { DEPLOYMENT_SCHEDULERS, DEPLOYMENT_STAGES } from "./catalog";
import type {
  DeploymentPathId,
  DeploymentProbe,
  DeploymentScheduler,
} from "./contracts";

export interface DeploymentChecklistProgress {
  path: DeploymentPathId | "";
  stage: number;
  scheduler: DeploymentScheduler | "";
  completed: Readonly<Record<number, boolean>>;
}

export function deploymentProbePassed(stage: number, scheduler: DeploymentScheduler | "", probe: DeploymentProbe | null): boolean {
  if (stage !== 3 && stage !== 4) return true;
  if (probe?.checking === true) return false;
  if (stage === 3) return probe?.health === true && probe?.ready === true;
  return probe?.health === true && probe?.ready === true && probe?.scheduler === scheduler;
}

export function deploymentCanCompleteStage(
  path: DeploymentPathId | "",
  stage: number,
  scheduler: DeploymentScheduler | "",
  probe: DeploymentProbe | null,
): boolean {
  const available = path ? DEPLOYMENT_SCHEDULERS[path] : [];
  const schedulerSelected = stage !== 0 || available.includes(scheduler as DeploymentScheduler);
  return schedulerSelected && deploymentProbePassed(stage, scheduler, probe);
}

export function deploymentCanContinue(progress: DeploymentChecklistProgress, probe: DeploymentProbe | null): boolean {
  if (!progress.path || !Number.isInteger(progress.stage) || progress.stage < 0 || progress.stage >= DEPLOYMENT_STAGES.length) return false;
  for (let stage = 0; stage < progress.stage; stage += 1) {
    if (progress.completed[stage] !== true) return false;
  }
  const available = progress.path ? DEPLOYMENT_SCHEDULERS[progress.path] : [];
  const schedulerSelected = (progress.stage !== 0 && progress.stage !== 4) || available.includes(progress.scheduler as DeploymentScheduler);
  return progress.completed[progress.stage] === true &&
    deploymentProbePassed(progress.stage, progress.scheduler, probe) && schedulerSelected;
}

/** Backward navigation stays available; only the immediately next, unlocked stage can be selected. */
export function deploymentCanSelectStage(
  progress: DeploymentChecklistProgress,
  target: number,
  probe: DeploymentProbe | null,
): boolean {
  if (!Number.isInteger(target) || target < 0 || target >= DEPLOYMENT_STAGES.length) return false;
  if (target <= progress.stage) return true;
  if (target !== progress.stage + 1 || progress.completed[progress.stage] !== true) return false;
  return deploymentCanCompleteStage(progress.path, progress.stage, progress.scheduler, probe);
}
