import { describe, expect, it } from "bun:test";
import { planWorkReads } from "./read-capabilities";
import { planWorkReads as legacyPlanWorkReads } from "../../../admin-read-state.js";

const EMPTY = {
  assignments: false,
  sessions: false,
  timeline: false,
  reviews: false,
  reviewerRequests: false,
  handoverRequests: false,
  workContext: false,
  workContextView: false,
  taskDetail: false,
  tasks: false,
  taskCollection: false,
  taskCatalog: false,
  attendance: false,
  reviewerManagement: false,
};

describe("Work feature read capabilities", () => {
  it("keeps the route-host compatibility export bound to the feature planner", () => {
    expect(legacyPlanWorkReads).toBe(planWorkReads);
  });

  it("fails closed for a missing, malformed, or failed grant read", () => {
    expect(planWorkReads(undefined)).toEqual(EMPTY);
    expect(planWorkReads({ grants: null })).toEqual(EMPTY);
    expect(planWorkReads({ readError: "PERMISSION_DENIED", grants: [] })).toEqual(EMPTY);
    expect(planWorkReads({ readError: "REQUEST_FAILED", isSuperAdmin: true, grants: [] })).toEqual(EMPTY);
  });

  it("does not treat Super Admin status as a substitute for ordinary Work grants", () => {
    const plan = planWorkReads({ isSuperAdmin: true, grants: [] });
    expect(plan).toEqual(EMPTY);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(planWorkReads({
      isSuperAdmin: true,
      grants: [{ permissionKey: "tasks.reviewer_manage", scope: "assigned_work" }],
    }).reviewerManagement).toBe(true);
  });

  it("plans only the actor-participant endpoint for an exact collaboration request route", () => {
    expect(planWorkReads({ grants: [] }, { focusedCollaborationRequest: "reviewer" })).toEqual({
      ...EMPTY,
      reviewerRequests: true,
    });
    expect(planWorkReads({ grants: [] }, { focusedCollaborationRequest: "handover" })).toEqual({
      ...EMPTY,
      handoverRequests: true,
    });
  });

  it("keeps assigned-work visibility on the purpose-limited collection path", () => {
    const plan = planWorkReads({
      grants: [{ permissionKey: "tasks.view", scope: "assigned_work" }],
    });
    expect(plan).toEqual({
      ...EMPTY,
      assignments: true,
      taskDetail: true,
    });
    expect(plan.taskCollection).toBe(false);
    expect(plan.tasks).toBe(false);
  });

  it("requires a broad collection grant before enabling the roster endpoint", () => {
    const plan = planWorkReads({ grants: [
      { permissionKey: "tasks.create", scope: "client" },
      { permissionKey: "tasks.view", scope: "group" },
      { permissionKey: "tasks.catalog.manage", scope: "organisation" },
    ] });
    expect(plan).toMatchObject({
      assignments: true,
      workContext: true,
      taskDetail: true,
      taskCollection: true,
      tasks: true,
      taskCatalog: true,
    });
  });

  it("does not expose catalog reads without both composer and catalog grants", () => {
    expect(planWorkReads({ grants: [
      { permissionKey: "tasks.catalog.view", scope: "organisation" },
    ] }).taskCatalog).toBe(false);
    expect(planWorkReads({ grants: [
      { permissionKey: "tasks.create", scope: "group" },
      { permissionKey: "tasks.catalog.view", scope: "client" },
    ] }).taskCatalog).toBe(false);
    expect(planWorkReads({ grants: [
      { permissionKey: "tasks.create", scope: "group" },
      { permissionKey: "tasks.catalog.propose", scope: "organisation" },
    ] }).taskCatalog).toBe(true);
  });

  it("uses self-applicable grants for the personal timeline and attendance projections", () => {
    const plan = planWorkReads({ grants: [
      { permissionKey: "work.timeline.view", scope: "organisation", selfApplicable: true },
      { permissionKey: "attendance.view", scope: "organisation", selfApplicable: true },
      { permissionKey: "work.timeline.view", scope: "assigned_work", selfApplicable: false },
    ] });
    expect(plan.timeline).toBe(true);
    expect(plan.attendance).toBe(true);
    expect(plan.assignments).toBe(false);
  });

  it("keeps review, reviewer-request, and handover reads distinct", () => {
    expect(planWorkReads({ grants: [
      { permissionKey: "tasks.reviewer_request", scope: "assigned_work" },
    ] })).toMatchObject({ assignments: true, reviewerRequests: true, reviews: false, handoverRequests: false });
    expect(planWorkReads({ grants: [
      { permissionKey: "tasks.handover_accept", scope: "assigned_work" },
    ] })).toMatchObject({ assignments: false, reviewerRequests: false, reviews: false, handoverRequests: true });
    expect(planWorkReads({ grants: [
      { permissionKey: "tasks.review", scope: "client_workstream" },
    ] })).toMatchObject({ reviews: true, reviewerRequests: true, handoverRequests: false });
  });

  it("plans reviewer management only from its exact supported permission scopes", () => {
    for (const scope of ["organisation", "client_workstream", "group", "assigned_work"]) {
      expect(planWorkReads({ grants: [{ permissionKey: "tasks.reviewer_manage", scope }] }).reviewerManagement).toBe(true);
    }
    for (const scope of ["client", "office", "own_record"]) {
      expect(planWorkReads({ grants: [{ permissionKey: "tasks.reviewer_manage", scope }] }).reviewerManagement).toBe(false);
    }
    expect(planWorkReads({ grants: [{ permissionKey: "tasks.assign", scope: "organisation" }] }).reviewerManagement).toBe(false);
  });

  it("limits hierarchy reads to the current route's accepted scopes", () => {
    expect(planWorkReads({ grants: [
      { permissionKey: "groups.view", scope: "group" },
    ] })).toMatchObject({ workContext: true, workContextView: true });
    expect(planWorkReads({ grants: [
      { permissionKey: "clients.view", scope: "group" },
    ] })).toMatchObject({ workContext: false, workContextView: false });
    expect(planWorkReads({ grants: [
      { permissionKey: "clients.members.manage", scope: "client" },
    ] })).toMatchObject({ workContext: true, workContextView: true });
  });

  it("preserves the open-session exception without granting unrelated reads", () => {
    const plan = planWorkReads({ hasOpenWorkSession: true, grants: [] });
    expect(plan.sessions).toBe(true);
    expect(plan.assignments).toBe(false);
    expect(plan.timeline).toBe(false);
  });
});
