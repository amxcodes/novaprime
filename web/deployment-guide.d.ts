import type {
  DeploymentGuide,
  DeploymentGuideAction,
} from "./src/features/public/deployment/contracts";

export function deploymentGuide(pathId: string, schedulerId?: string): DeploymentGuide | null;

export function deploymentSchedulerActions(
  pathId: string,
  schedulerId: string,
  stage: number,
  readinessPassed: boolean,
): DeploymentGuideAction[];
