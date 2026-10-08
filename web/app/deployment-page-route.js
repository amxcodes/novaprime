import {
  checkDeploymentEndpoint,
  deploymentCanCompleteStage,
  deploymentCanContinue,
  deploymentCanSelectStage,
  resetDeploymentProgress,
  selectDeploymentPath,
  selectDeploymentStage,
  setDeploymentStageCompletion,
} from "./deployment-route.js";

/**
 * Mount the public Deployment Assistant and own its route-level interactions.
 * The host retains checklist persistence, navigation, route freshness, and
 * the probe lifecycle so this adapter cannot alter the public/API boundary.
 */
export async function mountDeploymentPage({
  target,
  getProgress,
  setProgress,
  getProbe,
  setProbe,
  invalidateProbe,
  probeLifecycle,
  persistProgress,
  isCurrent,
  mountIsland,
  showFeedback,
  focusCurrentHeading,
  checkEndpoint = checkDeploymentEndpoint,
  onOpenSetup,
  onNavigateHome,
  loadFeature = () => import("../src/features/public/deployment/index.ts"),
} = {}) {
  const requiredFunctions = {
    getProgress,
    setProgress,
    getProbe,
    setProbe,
    invalidateProbe,
    persistProgress,
    isCurrent,
    mountIsland,
    showFeedback,
    focusCurrentHeading,
    checkEndpoint,
    onOpenSetup,
    onNavigateHome,
    loadFeature,
  };
  for (const [name, service] of Object.entries(requiredFunctions)) {
    if (typeof service !== "function") throw new TypeError(`Deployment page route service ${name} must be a function`);
  }
  if (!target) throw new TypeError("Deployment page route target is required");
  if (!probeLifecycle || typeof probeLifecycle.begin !== "function" ||
      typeof probeLifecycle.isCurrent !== "function") {
    throw new TypeError("Deployment probe lifecycle is required");
  }

  const feature = await loadFeature();
  if (!isCurrent() || !target.isConnected) return null;
  const { DeploymentAssistant, DEPLOYMENT_STAGES, deploymentPathById } = feature;
  if (typeof DeploymentAssistant !== "function" || !Array.isArray(DEPLOYMENT_STAGES) ||
      typeof deploymentPathById !== "function") {
    throw new TypeError("Deployment feature exports are incomplete");
  }

  function render() {
    if (!isCurrent() || !target.isConnected) return false;
    const progress = getProgress();
    mountIsland(target, DeploymentAssistant, {
      pathId: progress.path,
      stage: progress.stage,
      scheduler: progress.scheduler,
      completed: progress.completed,
      probe: getProbe(),
      onReset: () => {
        setProgress(resetDeploymentProgress());
        invalidateProbe();
        persistProgress();
        render();
      },
      onSelectPath: (path) => {
        if (!isCurrent() || !deploymentPathById(path)) return;
        setProgress(selectDeploymentPath(getProgress(), path));
        invalidateProbe();
        persistProgress();
        render();
        focusCurrentHeading();
      },
      onSelectStage: (stage) => {
        if (!isCurrent() || !Number.isInteger(stage) || stage < 0 || stage >= DEPLOYMENT_STAGES.length) return;
        if (!deploymentCanSelectStage(getProgress(), stage, getProbe())) return;
        setProgress(selectDeploymentStage(getProgress(), stage));
        invalidateProbe();
        persistProgress();
        render();
      },
      onCompleteChange: (completed) => {
        const current = getProgress();
        if (!isCurrent() || !deploymentCanCompleteStage(current.path, current.stage, current.scheduler, getProbe())) return;
        setProgress(setDeploymentStageCompletion(current, current.stage, completed));
        persistProgress();
        render();
      },
      onProbe: async () => {
        if (!isCurrent()) return;
        const context = {
          path: getProgress().path,
          stage: getProgress().stage,
          scheduler: getProgress().scheduler,
        };
        const generation = probeLifecycle.begin();
        setProbe({ checking: true });
        render();
        const [health, ready] = await Promise.all([
          checkEndpoint("/api/health", "ok"),
          checkEndpoint("/api/ready", "ready"),
        ]);
        const current = getProgress();
        const checklistStillCurrent = context.path === current.path &&
          context.stage === current.stage && context.scheduler === current.scheduler;
        if (!probeLifecycle.isCurrent(generation) || !isCurrent() || !target.isConnected || !checklistStillCurrent) return;
        setProbe({
          health: Boolean(health),
          ready: Boolean(ready),
          scheduler: ready?.scheduler ?? null,
          checkedAt: new Date().toISOString(),
        });
        render();
      },
      onBack: () => {
        if (!isCurrent()) return;
        setProgress(selectDeploymentStage(getProgress(), Math.max(0, getProgress().stage - 1)));
        invalidateProbe();
        persistProgress();
        render();
      },
      onNext: () => {
        const current = getProgress();
        if (!isCurrent() || !deploymentCanContinue(current, getProbe())) return;
        if (current.stage === DEPLOYMENT_STAGES.length - 1) {
          invalidateProbe();
          onOpenSetup();
          return;
        }
        setProgress(setDeploymentStageCompletion(current, current.stage, true));
        setProgress(selectDeploymentStage(getProgress(), current.stage + 1));
        invalidateProbe();
        persistProgress();
        render();
      },
      onNavigateHome: () => {
        if (isCurrent()) onNavigateHome();
      },
    });
    showFeedback();
    return true;
  }

  render();
  return Object.freeze({ render });
}
