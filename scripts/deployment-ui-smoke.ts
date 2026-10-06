import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeploymentAssistant } from "../web/src/features/public/deployment/DeploymentAssistant.tsx";
import {
  DEPLOYMENT_SCHEDULERS,
  DEPLOYMENT_SCHEDULER_LABELS,
  DEPLOYMENT_STAGES,
} from "../web/src/features/public/deployment/catalog.ts";
import type {
  DeploymentAssistantProps,
  DeploymentPathId,
  DeploymentScheduler,
} from "../web/src/features/public/deployment/contracts.ts";
import {
  checkDeploymentEndpoint,
  createDeploymentProbeLifecycle,
  deploymentCanCompleteStage,
  deploymentCanContinue,
  deploymentCanSelectStage,
  deploymentProgressStorageKey,
  normalizeDeploymentProgress,
  resetDeploymentProgress,
  selectDeploymentPath,
  selectDeploymentScheduler,
  selectDeploymentStage,
  setDeploymentStageCompletion,
} from "../web/app/deployment-route.js";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function render(
  pathId: DeploymentPathId | "",
  scheduler: DeploymentScheduler | "",
  stage: number,
  probe: DeploymentAssistantProps["probe"] = null,
  completed: Readonly<Record<number, boolean>> = {},
) {
  const props: DeploymentAssistantProps = {
    pathId,
    scheduler,
    stage,
    probe,
    completed,
    onReset() {},
    onSelectPath() {},
    onSelectStage() {},
    onSelectScheduler() {},
    onCompleteChange() {},
    onProbe() {},
    onBack() {},
    onNext() {},
    onNavigateHome() {},
  };
  return renderToStaticMarkup(createElement(DeploymentAssistant, props));
}

function has(markup: string, value: string, context: string) {
  expect(markup.includes(value), context + ": missing " + value);
}

const pairings: ReadonlyArray<readonly [DeploymentPathId, DeploymentScheduler, string, string, string]> = [
  ["cloudflare-supabase", "cloudflare", "Your Cloudflare Worker", "A production Worker deploy using the Cloudflare Cron Wrangler config", "cloudflare/wrangler.toml"],
  ["cloudflare-supabase", "supabase", "Your Supabase project (not the hosting provider)", "After NOVA passes readiness, the trusted-operator command creates the job in Supabase", "cloudflare/wrangler.supabase-cron.toml"],
  ["netlify-supabase", "netlify", "Your Netlify site", "The production build reads NOVA_BACKGROUND_SCHEDULER", "NOVA_BACKGROUND_SCHEDULER=netlify"],
  ["netlify-supabase", "supabase", "Your Supabase project (not the hosting provider)", "After NOVA passes readiness, the trusted-operator command creates the job in Supabase", "NOVA_BACKGROUND_SCHEDULER=supabase"],
  ["vercel-supabase", "vercel", "Your Vercel production project", "Production deploy reads NOVA_BACKGROUND_SCHEDULER in vercel.ts", "NOVA_BACKGROUND_SCHEDULER=vercel"],
  ["vercel-supabase", "supabase", "Your Supabase project (not the hosting provider)", "After NOVA passes readiness, the trusted-operator command creates the job in Supabase", "publishes no Vercel Cron"],
  ["vps-postgres", "vps", "The VPS/local server running NOVA", "The Docker Compose bootstrap starts one maintenance worker", "NOVA_BACKGROUND_SCHEDULER=vps"],
  ["local-docker", "vps", "The VPS/local server running NOVA", "The Docker Compose bootstrap starts one maintenance worker", "NOVA_BACKGROUND_SCHEDULER=vps"],
];

expect(DEPLOYMENT_STAGES.length === 7, "the guide must preserve the seven ordered stages");
expect(
  pairings.length === Object.values(DEPLOYMENT_SCHEDULERS).reduce((sum, values) => sum + values.length, 0),
  "every supported provider/scheduler pairing must be covered",
);

for (const [path, scheduler, lives, activates, providerSetting] of pairings) {
  const markup = render(path, scheduler, 0);
  has(markup, DEPLOYMENT_SCHEDULER_LABELS[scheduler], path + "/" + scheduler + " label");
  has(markup, lives, path + "/" + scheduler + " runtime owner");
  has(markup, activates, path + "/" + scheduler + " activation contract");
  has(markup, providerSetting, path + "/" + scheduler + " provider action");
  has(markup, "This checklist does not log in to or change provider accounts.", path + "/" + scheduler + " boundary");
  has(markup, "How your services connect", path + "/" + scheduler + " wiring overview");
  has(markup, "Full action map: what you do and what it changes", path + "/" + scheduler + " detailed map");
  expect(!markup.includes("Trusted operator computer → NOVA repository checkout"), path + "/" + scheduler + " exposed the guarded operator action too early");
  expect(!markup.includes("bun run supabase:scheduler</code>"), path + "/" + scheduler + " exposed Supabase Cron creation too early");
}

const failedChecks = [
  { health: false, ready: true, scheduler: "supabase", checkedAt: "2026-10-05T00:00:00.000Z" },
  { health: true, ready: false, scheduler: "supabase", checkedAt: "2026-10-05T00:00:00.000Z" },
  { health: true, ready: true, scheduler: "netlify", checkedAt: "2026-10-05T00:00:00.000Z" },
];
for (const probe of failedChecks) {
  const progress = { path: "cloudflare-supabase", stage: 4, scheduler: "supabase", completed: { 0: true, 1: true, 2: true, 3: true, 4: true } };
  const markup = render("cloudflare-supabase", "supabase", 4, probe, progress.completed);
  expect(!deploymentCanCompleteStage(progress.path, 4, progress.scheduler, probe), "failed health, readiness, or scheduler match must block completion");
  expect(!deploymentCanContinue(progress, probe), "failed or mismatched readiness must block continuation");
  expect(!markup.includes("Trusted operator computer → NOVA repository checkout"), "operator action appeared without the complete readiness proof");
  expect(!markup.includes("bun run supabase:scheduler</code>"), "Supabase Cron command appeared without the complete readiness proof");
  expect(markup.includes("disabled=\"\""), "Continue must remain disabled before readiness passes");
}

const checkingProbe = { checking: true, health: true, ready: true, scheduler: "supabase", checkedAt: "2026-10-05T00:00:00.000Z" };
const checkingProgress = { path: "cloudflare-supabase", stage: 4, scheduler: "supabase", completed: { 0: true, 1: true, 2: true, 3: true, 4: true } };
expect(!deploymentCanCompleteStage(checkingProgress.path, 4, checkingProgress.scheduler, checkingProbe), "old success values must not authorize completion during a live recheck");
expect(!deploymentCanContinue(checkingProgress, checkingProbe), "old success values must not authorize continuation during a live recheck");
expect(!render("cloudflare-supabase", "supabase", 4, checkingProbe, { 4: true }).includes("bun run supabase:scheduler</code>"), "Supabase action must remain hidden while readiness is checking");

const exactProbe = { health: true, ready: true, scheduler: "supabase", checkedAt: "2026-10-05T00:00:00.000Z" };
const allPriorStages = { 0: true, 1: true, 2: true, 3: true, 4: true };
const readyMarkup = render("cloudflare-supabase", "supabase", 4, exactProbe, allPriorStages);
expect(deploymentCanCompleteStage("cloudflare-supabase", 4, "supabase", exactProbe), "matching probe should enable completion");
expect(
  deploymentCanContinue({ path: "cloudflare-supabase", stage: 4, scheduler: "supabase", completed: allPriorStages }, exactProbe),
  "matching probe plus operator confirmation should enable continuation",
);
has(readyMarkup, "Trusted operator computer → NOVA repository checkout", "ready Supabase action location");
has(readyMarkup, "bun run supabase:scheduler</code>", "ready Supabase guarded command");
has(readyMarkup, "type it exactly before any write", "project-ref confirmation");
has(readyMarkup, "pg_cron</code> + <code>pg_net", "Supabase Cron implementation");
has(readyMarkup, "<details class=\"deployment-scheduler-plan\" open=\"\">", "ready action details open");
has(readyMarkup, "only means pg_net queued", "asynchronous HTTP verification copy");
has(readyMarkup, "aria-live=\"polite\" aria-atomic=\"true\"", "current stage announcement semantics");
has(readyMarkup, "The checkbox is an operator attestation, not remote proof.", "operator attestation language");

const runtimeProbe = { health: true, ready: true, scheduler: "vercel", checkedAt: "2026-10-05T00:00:00.000Z" };
expect(deploymentCanCompleteStage("vercel-supabase", 3, "supabase", runtimeProbe), "runtime stage requires health and database readiness only");
expect(!deploymentCanCompleteStage("vercel-supabase", 4, "supabase", runtimeProbe), "scheduler stage additionally requires exact selected scheduler match");

const setupMarkup = render("cloudflare-supabase", "supabase", 0);
has(setupMarkup, "On your trusted computer, run <code>bun run setup:supabase</code>", "inline command formatting");
has(setupMarkup, "Do not set raw <code>DATABASE_URL</code>", "escaped provider guidance");
expect(!setupMarkup.includes("<script"), "guide copy must be rendered as text and never injected as HTML");
const stageZeroControls = Array.from(setupMarkup.matchAll(/<button\b[^>]*data-deployment-stage="(\d+)"[^>]*>/g));
const stageZeroButton = stageZeroControls.find((match) => match[1] === "0")?.[0] ?? "";
const stageOneButton = stageZeroControls.find((match) => match[1] === "1")?.[0] ?? "";
expect(stageZeroButton && !stageZeroButton.includes("disabled=\"\""), "current deployment stage should remain selectable");
expect(stageOneButton.includes("disabled=\"\""), "future stages must be locked before the current stage is completed");
const completedStageZero = render("cloudflare-supabase", "supabase", 1, null, { 0: true });
const stageTwoButton = Array.from(completedStageZero.matchAll(/<button\b[^>]*data-deployment-stage="(\d+)"[^>]*>/g))
  .find((match) => match[1] === "2")?.[0] ?? "";
expect(!stageOneButton || stageTwoButton.includes("disabled=\"\""), "step rail must only unlock one contiguous next stage");

expect(deploymentProgressStorageKey === "nova-deployment-progress-v2", "sessionStorage key version changed");
const restored = normalizeDeploymentProgress({
  path: "cloudflare-supabase",
  stage: 99,
  scheduler: "unsupported",
  completed: { 0: true, 4: true, 7: true, bogus: true },
});
expect(restored?.stage === 0 && restored.path === "cloudflare-supabase" && restored.scheduler === "", "invalid scheduler must return to the path-selection stage");
expect(Object.keys(restored?.completed ?? {}).length === 0, "invalid scheduler must clear every stage attestation");
expect(normalizeDeploymentProgress({ path: "vps-postgres", stage: -4, scheduler: "vps", completed: { 0: true } })?.stage === 0, "negative restored stage must clamp");
expect(normalizeDeploymentProgress({ path: "vps-postgres", stage: 4, scheduler: "supabase", completed: { 4: true } })?.completed[4] === undefined, "unsupported schedule must invalidate stage-four attestation");
const gapped = normalizeDeploymentProgress({ path: "cloudflare-supabase", stage: 6, scheduler: "supabase", completed: { 0: true, 1: true, 2: false, 3: true, 4: true } });
expect(gapped?.stage === 2 && gapped.completed[0] === true && gapped.completed[1] === true && gapped.completed[3] === undefined, "restored progress must stop at the first incomplete stage and clamp the active step");
expect(!deploymentCanContinue({ path: "cloudflare-supabase", stage: 4, scheduler: "supabase", completed: { 0: true, 1: true, 3: true, 4: true } }, exactProbe), "gapped progress must not continue from a later stage");
expect(normalizeDeploymentProgress([]) === null, "malformed array storage must be ignored");

let progress = { path: "cloudflare-supabase", stage: 4, scheduler: "supabase", completed: { 0: true, 4: true } };
progress = selectDeploymentPath(progress, "vercel-supabase");
expect(progress.stage === 0 && progress.scheduler === "" && Object.keys(progress.completed).length === 0, "changing path must reset scheduler, progress, and probe context");
progress = selectDeploymentScheduler({ path: "vercel-supabase", stage: 0, scheduler: "vercel", completed: { 0: true } }, "supabase");
expect(Object.keys(progress.completed).length === 0, "changing scheduler must clear completion attestations");
progress = selectDeploymentScheduler({ path: "vercel-supabase", stage: 0, scheduler: "supabase", completed: { 0: true } }, "supabase");
expect(progress.completed[0] === true, "reselecting the same scheduler must preserve completion attestations");
progress = setDeploymentStageCompletion(progress, 0, false);
progress = selectDeploymentStage(progress, 6);
expect(progress.completed[0] === false && progress.stage === 6, "stage navigation must preserve attestation state");
const reset = resetDeploymentProgress();
expect(reset.path === "" && reset.stage === 0 && reset.scheduler === "" && Object.keys(reset.completed).length === 0, "reset must restore the initial checklist");

const stageOne = { path: "cloudflare-supabase", stage: 0, scheduler: "supabase", completed: { 0: true } };
expect(deploymentCanSelectStage(stageOne, 1, null), "only the immediately next completed stage should unlock");
expect(!deploymentCanSelectStage(stageOne, 2, null), "a forward jump over incomplete stages must stay locked");
expect(deploymentCanSelectStage({ ...stageOne, completed: {} }, 0, null), "the current stage remains selectable");
const stageFour = { path: "cloudflare-supabase", stage: 3, scheduler: "supabase", completed: { 0: true, 1: true, 2: true, 3: true } };
expect(!deploymentCanSelectStage(stageFour, 4, checkingProbe), "a rechecking health/readiness result must keep scheduler verification locked");
expect(deploymentCanSelectStage(stageFour, 4, { health: true, ready: true, scheduler: "netlify" }), "runtime stage entry needs health and readiness; scheduler match is checked at stage four");
expect(deploymentCanSelectStage({ ...stageFour, stage: 5 }, 1, null), "backward jumps must remain available");
expect(!deploymentCanSelectStage({ ...stageFour, stage: 5 }, 7, null), "Handoff cannot be forward-selected across incomplete stages");

const lifecycle = createDeploymentProbeLifecycle();
const staleGeneration = lifecycle.begin();
lifecycle.invalidate();
expect(!lifecycle.isCurrent(staleGeneration), "path/stage/scheduler changes and route exit must invalidate pending probes");
const currentGeneration = lifecycle.begin();
expect(lifecycle.isCurrent(currentGeneration), "the current readiness request must stay current");

const requests: Array<{ path: string; options: RequestInit }> = [];
const mockFetch = async (input: RequestInfo | URL, options?: RequestInit) => {
  const path = String(input);
  requests.push({ path, options: options ?? {} });
  return path === "/api/health"
    ? Response.json({ service: "nova-api", status: "ok" })
    : Response.json({ service: "nova-api", status: "ready", scheduler: "supabase" });
};
const [health, readiness] = await Promise.all([
  checkDeploymentEndpoint("/api/health", "ok", mockFetch),
  checkDeploymentEndpoint("/api/ready", "ready", mockFetch),
]);
expect(Boolean(health) && Boolean(readiness) && requests.length === 2, "health and readiness checks should run as two independent reads");
for (const request of requests) {
  expect(request.options.cache === "no-store", request.path + " should bypass cache");
  expect(request.options.credentials === "omit", request.path + " must send no credentials");
  expect((request.options.headers as Record<string, string>).accept === "application/json", request.path + " should request JSON");
  expect(!(request.options.headers as Record<string, string>).authorization, request.path + " must not send authorization");
  expect(request.options.signal instanceof AbortSignal, request.path + " must retain its bounded timeout");
}
expect(await checkDeploymentEndpoint("/api/ready", "ready", async () => Response.json({ service: "other", status: "ready" })) === false, "unexpected service identity must fail closed");
expect(await checkDeploymentEndpoint("/api/ready", "ready", async () => { throw new Error("offline"); }) === false, "network errors must fail closed");

console.info("PASS: seven stages, every allowed provider/scheduler pairing, contiguous v2 storage restoration, bounded step navigation, credential-free health/readiness checks, stale probe invalidation, and readiness-gated Supabase Cron.");
