import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createDeploymentProbeLifecycle,
  checkDeploymentEndpoint,
  deploymentProgressStorageKey,
} from "./deployment-route.js";
import { mountDeploymentPage } from "./deployment-page-route.js";

const stages = Array.from({ length: 7 }, (_, index) => ({ title: `Stage ${index}` }));
const assistant = function DeploymentAssistant() {};
const feature = {
  DeploymentAssistant: assistant,
  DEPLOYMENT_STAGES: stages,
  deploymentPathById: (id) => id === "cloudflare-supabase" ? { id } : undefined,
  supportedDeploymentSchedulers: (path) => path === "cloudflare-supabase" ? ["supabase"] : [],
};

function createFixture(overrides = {}) {
  let progress = { path: "", stage: 0, scheduler: "", completed: {} };
  let probe = null;
  let current = true;
  let connected = true;
  const probeLifecycle = createDeploymentProbeLifecycle();
  const mounts = [];
  const saved = [];
  const invalidations = [];
  const feedback = [];
  const focused = [];
  const setupNavigations = [];
  const homeNavigations = [];
  const endpointCalls = [];
  let loadCount = 0;
  const target = { get isConnected() { return connected; } };
  const routePromise = mountDeploymentPage({
    target,
    getProgress: () => progress,
    setProgress: (next) => { progress = next; },
    getProbe: () => probe,
    setProbe: (next) => { probe = next; },
    invalidateProbe: () => {
      invalidations.push(true);
      probeLifecycle.invalidate();
      probe = null;
    },
    probeLifecycle,
    persistProgress: () => saved.push(structuredClone(progress)),
    isCurrent: () => current,
    mountIsland: (root, Component, props) => mounts.push({ root, Component, props }),
    showFeedback: () => feedback.push(true),
    focusCurrentHeading: () => focused.push(true),
    checkEndpoint: async (path, expectedStatus) => {
      endpointCalls.push([path, expectedStatus]);
      return path === "/api/ready" ? { scheduler: "supabase" } : { status: "ok" };
    },
    onOpenSetup: () => setupNavigations.push(true),
    onNavigateHome: () => homeNavigations.push(true),
    loadFeature: async () => { loadCount += 1; return feature; },
    ...overrides,
  });
  return {
    routePromise,
    target,
    mounts,
    saved,
    invalidations,
    feedback,
    focused,
    setupNavigations,
    homeNavigations,
    endpointCalls,
    get progress() { return progress; },
    setProgress(next) { progress = next; },
    get probe() { return probe; },
    setProbe(next) { probe = next; },
    set current(value) { current = value; },
    set connected(value) { connected = value; },
    get loadCount() { return loadCount; },
    get props() { return mounts.at(-1)?.props; },
  };
}

describe("Deployment page route adapter", () => {
  test("loads the feature on route mount and preserves checklist persistence and navigation callbacks", async () => {
    const fixture = createFixture();
    await fixture.routePromise;

    expect(fixture.loadCount).toBe(1);
    expect(fixture.mounts).toHaveLength(1);
    expect(fixture.mounts[0]).toMatchObject({ root: fixture.target, Component: assistant });
    expect(fixture.props).toMatchObject({ pathId: "", stage: 0, scheduler: "", completed: {}, probe: null });

    fixture.props.onSelectPath("invalid");
    expect(fixture.progress.path).toBe("");
    fixture.props.onSelectPath("cloudflare-supabase");
    expect(fixture.progress).toEqual({ path: "cloudflare-supabase", stage: 0, scheduler: "", completed: {} });
    expect(fixture.saved).toHaveLength(1);
    expect(fixture.invalidations).toHaveLength(1);
    expect(fixture.focused).toHaveLength(1);

    fixture.props.onSelectScheduler("supabase");
    expect(fixture.progress.scheduler).toBe("supabase");
    expect(fixture.saved).toHaveLength(2);
    fixture.props.onReset();
    expect(fixture.progress).toEqual({ path: "", stage: 0, scheduler: "", completed: {} });
    expect(fixture.saved).toHaveLength(3);
    expect(fixture.feedback.length).toBeGreaterThan(0);
    expect(fixture.loadCount).toBe(1);

    fixture.props.onNavigateHome();
    expect(fixture.homeNavigations).toHaveLength(1);
    fixture.setProgress({
      path: "cloudflare-supabase",
      stage: 6,
      scheduler: "supabase",
      completed: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true },
    });
    fixture.setProbe({ health: true, ready: true, scheduler: "supabase" });
    fixture.props.onNext();
    expect(fixture.setupNavigations).toHaveLength(1);
  });

  test("probes the same health and readiness endpoints concurrently and renders their result", async () => {
    const fixture = createFixture();
    await fixture.routePromise;

    await fixture.props.onProbe();
    expect(fixture.endpointCalls).toEqual([["/api/health", "ok"], ["/api/ready", "ready"]]);
    expect(fixture.probe).toMatchObject({ health: true, ready: true, scheduler: "supabase" });
    expect(typeof fixture.probe.checkedAt).toBe("string");
    expect(fixture.props.probe).toEqual(fixture.probe);
  });

  test("drops a readiness result after the deployment route becomes stale", async () => {
    let resolveHealth;
    let resolveReady;
    const fixture = createFixture({
      checkEndpoint: (path) => new Promise((resolve) => {
        if (path === "/api/health") resolveHealth = resolve;
        else resolveReady = resolve;
      }),
    });
    await fixture.routePromise;

    const pending = fixture.props.onProbe();
    expect(fixture.probe).toEqual({ checking: true });
    fixture.current = false;
    fixture.connected = false;
    resolveHealth({ status: "ok" });
    resolveReady({ scheduler: "supabase" });
    await pending;

    expect(fixture.probe).toEqual({ checking: true });
    expect(fixture.mounts).toHaveLength(2);
  });

  test("propagates a lazy feature import failure for the app route's local fallback", async () => {
    const fixture = createFixture({ loadFeature: async () => { throw new Error("chunk failure"); } });

    await expect(fixture.routePromise).rejects.toThrow("chunk failure");
    expect(fixture.mounts).toHaveLength(0);
  });

  test("a newer probe generation prevents an older pair of checks from replacing it", async () => {
    const pendingChecks = [];
    const fixture = createFixture({
      checkEndpoint: (path, expectedStatus) => new Promise((resolve) => {
        pendingChecks.push({ path, expectedStatus, resolve });
      }),
    });
    await fixture.routePromise;

    const first = fixture.props.onProbe();
    const second = fixture.props.onProbe();
    expect(pendingChecks.map(({ path, expectedStatus }) => [path, expectedStatus])).toEqual([
      ["/api/health", "ok"], ["/api/ready", "ready"],
      ["/api/health", "ok"], ["/api/ready", "ready"],
    ]);
    pendingChecks[2].resolve({ status: "ok" });
    pendingChecks[3].resolve({ scheduler: "supabase" });
    await second;
    const currentResult = structuredClone(fixture.probe);

    pendingChecks[0].resolve(false);
    pendingChecks[1].resolve(false);
    await first;
    expect(fixture.probe).toEqual(currentResult);
  });

  test("health helper retains credential-free no-store GET semantics", async () => {
    const calls = [];
    const result = await checkDeploymentEndpoint("/api/health", "ok", async (...args) => {
      calls.push(args);
      return { ok: true, json: async () => ({ service: "nova-api", status: "ok" }) };
    });

    expect(result).toEqual({ service: "nova-api", status: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("/api/health");
    expect(calls[0][1]).toMatchObject({ cache: "no-store", credentials: "omit", headers: { accept: "application/json" } });
    expect(calls[0][1]).not.toHaveProperty("method");
  });

  test("the app selects the adapter by route and has no eager DeploymentAssistant import", () => {
    const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    expect(appSource).toMatch(/async function renderDeployment\(lifetime\)/);
    expect(appSource).toMatch(/import\("\.\/app\/deployment-page-route\.js"\)/);
    expect(appSource).toMatch(/if \(view === "deploy"\) return renderDeployment\(lifetime\)/);
    expect(appSource).not.toMatch(/from "\.\/src\/features\/public\/deployment\/index\.ts"/);
    expect(appSource).toContain("deploymentProgressStorageKey");
    expect(appSource).toMatch(/sessionStorage\.setItem\(deploymentProgressStorageKey/);
    expect(deploymentProgressStorageKey).toBe("nova-deployment-progress-v2");
    expect(appSource).toMatch(/Deployment guide could not load/);
  });
});
