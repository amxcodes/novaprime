import { describe, expect, test } from "bun:test";
import {
  deploymentCanCompleteStage,
  deploymentCanContinue,
  deploymentCanSelectStage,
  normalizeDeploymentProgress,
} from "./deployment-route.js";

describe("deployment checklist progression", () => {
  test("restores only a contiguous completion prefix and clamps the current stage", () => {
    const restored = normalizeDeploymentProgress({
      path: "cloudflare-supabase",
      stage: 6,
      scheduler: "supabase",
      completed: { 0: true, 1: true, 3: true, 4: true },
    });

    expect(restored).toEqual({
      path: "cloudflare-supabase",
      stage: 2,
      scheduler: "supabase",
      completed: { 0: true, 1: true },
    });
  });

  test("allows back navigation and only the next stage after current completion", () => {
    const current = { path: "cloudflare-supabase", stage: 2, scheduler: "supabase", completed: { 0: true, 1: true, 2: true } };
    expect(deploymentCanSelectStage(current, 0, null)).toBe(true);
    expect(deploymentCanSelectStage(current, 2, null)).toBe(true);
    expect(deploymentCanSelectStage(current, 3, null)).toBe(true);
    expect(deploymentCanSelectStage(current, 4, null)).toBe(false);
    expect(deploymentCanSelectStage(current, 4, null)).toBe(false);
  });

  test("requires ready health checks to unlock runtime and scheduler stages", () => {
    const runtime = { path: "cloudflare-supabase", stage: 3, scheduler: "supabase", completed: { 0: true, 1: true, 2: true, 3: true } };
    expect(deploymentCanSelectStage(runtime, 4, { checking: true, health: true, ready: true, scheduler: "supabase" })).toBe(false);
    expect(deploymentCanSelectStage(runtime, 4, { health: true, ready: false, scheduler: "supabase" })).toBe(false);
    expect(deploymentCanSelectStage(runtime, 4, { health: true, ready: true, scheduler: "vercel" })).toBe(true);

    const scheduler = { ...runtime, stage: 4, completed: { ...runtime.completed, 3: true, 4: true } };
    expect(deploymentCanContinue(scheduler, { checking: true, health: true, ready: true, scheduler: "supabase" })).toBe(false);
    expect(deploymentCanContinue(scheduler, { health: true, ready: true, scheduler: "vercel" })).toBe(false);
    expect(deploymentCanContinue(scheduler, { health: true, ready: true, scheduler: "supabase" })).toBe(true);

    const unsupportedScheduler = { ...scheduler, scheduler: "vps" };
    expect(deploymentCanCompleteStage("cloudflare-supabase", 4, "vps", { health: true, ready: true, scheduler: "vps" })).toBe(false);
    expect(deploymentCanContinue(unsupportedScheduler, { health: true, ready: true, scheduler: "vps" })).toBe(false);
  });

  test("cannot continue from a late stage if any earlier completion is missing", () => {
    const malformed = {
      path: "cloudflare-supabase",
      stage: 6,
      scheduler: "supabase",
      completed: { 4: true, 5: true, 6: true },
    };
    expect(deploymentCanContinue(malformed, null)).toBe(false);
  });
});
