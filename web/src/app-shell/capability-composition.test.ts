import { createElement } from "react";
import { describe, expect, it } from "bun:test";
import { getVisibleWorkspaceDestinations, canAccessWorkspaceDestination } from "../../workspace-destinations.js";
import { planAvailabilityAgendaReads } from "../features/availability/capabilities";
import { planAdminReads } from "../features/admin/capabilities";
import { planOperationsReads } from "../features/operations/capabilities";
import { planWorkReads } from "../features/work/read-capabilities";
import {
  buildAuthorizedAdminPageSections,
  type AdminPageSectionDefinitions,
} from "../pages/admin/admin-page-sections";

const adminSectionIds = [
  "organization-structure",
  "geofence",
  "attendance-policy",
  "availability-configuration",
  "wfh-overrides",
  "roles",
  "work",
  "people",
  "owner-transfer",
  "leave-review",
  "wfh-review",
  "historical-exceptions",
  "audit",
  "notification-delivery",
] as const;

const adminDefinitions = Object.fromEntries(
  adminSectionIds.map((id) => [id, createElement("div", { "data-admin-section": id })]),
) as AdminPageSectionDefinitions;

type CapabilityRead = Parameters<typeof getVisibleWorkspaceDestinations>[0];

function visibleViews(read: CapabilityRead): string[] {
  return getVisibleWorkspaceDestinations(read).map(({ view }) => view);
}

function visibleAdminSections(read: CapabilityRead): string[] {
  return buildAuthorizedAdminPageSections(read, adminDefinitions).map(({ id }) => id);
}

function enabledKeys(plan: Readonly<Record<string, boolean>>): string[] {
  return Object.entries(plan).filter(([, enabled]) => enabled).map(([key]) => key);
}

function expectDirectRoutes(read: CapabilityRead, enabled: readonly string[], disabled: readonly string[]) {
  for (const view of enabled) expect(canAccessWorkspaceDestination(view, read), `${view} should be available`).toBe(true);
  for (const view of disabled) expect(canAccessWorkspaceDestination(view, read), `${view} should be denied`).toBe(false);
}

describe("capability composition across routes, Admin sections, and feature read plans", () => {
  it("does not expose Admin to a Super Admin without the independent People target-list grant", () => {
    const read = { actorPersonId: "owner-1", isSuperAdmin: true, grants: [] };

    expect(visibleViews(read)).toEqual(["notifications", "settings"]);
    expectDirectRoutes(read, ["notifications", "settings"], ["today", "work", "people", "operations", "invite", "work-setup", "admin"]);
    expect(visibleAdminSections(read)).toEqual([]);
    expect(enabledKeys(planAdminReads(read))).toEqual([]);
    expect(enabledKeys(planOperationsReads(read))).toEqual([]);
    expect(enabledKeys(planWorkReads(read))).toEqual([]);
    expect(enabledKeys(planAvailabilityAgendaReads(read))).toEqual([]);
  });

  it("exposes Owner Transfer only when Super Admin and organization people.view are both present", () => {
    const read = {
      actorPersonId: "owner-1",
      isSuperAdmin: true,
      grants: [{ permissionKey: "people.view", scope: "organisation" }],
    };
    expect(visibleViews(read)).toContain("admin");
    expect(canAccessWorkspaceDestination("admin", read)).toBe(true);
    expect(visibleAdminSections(read)).toContain("owner-transfer");
    expect(enabledKeys(planAdminReads(read))).toContain("people");
  });

  it("keeps an invite-only actor on the invitation flow without reading or exposing the roster", () => {
    const read = {
      actorPersonId: "inviter-1",
      grants: [{ permissionKey: "people.invite", scope: "organisation" }],
    };

    expect(visibleViews(read)).toEqual(["notifications", "invite", "settings"]);
    expectDirectRoutes(read, ["invite", "notifications", "settings"], ["admin", "people", "operations"]);
    expect(visibleAdminSections(read)).toEqual(["people"]);
    expect(enabledKeys(planAdminReads(read))).toEqual([]);
    expect(enabledKeys(planOperationsReads(read))).toEqual([]);
  });

  it("routes a mixed-scope people manager and reviewer only to independently authorized surfaces", () => {
    const read = {
      actorPersonId: "manager-reviewer-1",
      grants: [
        { permissionKey: "people.view", scope: "office", officeId: "office-7" },
        { permissionKey: "leave.review", scope: "office", officeId: "office-7" },
        { permissionKey: "availability.wfh.review", scope: "organisation_department", organisationDepartmentId: "dept-4" },
        { permissionKey: "tasks.review", scope: "assigned_work" },
        { permissionKey: "attendance.recover", scope: "office", officeId: "office-7" },
      ],
    };

    expect(visibleViews(read)).toEqual([
      "work", "availability", "people", "notifications", "operations", "admin", "settings",
    ]);
    expectDirectRoutes(read, ["work", "availability", "people", "operations", "admin"], ["today", "invite", "work-setup"]);
    expect(visibleAdminSections(read)).toEqual(["leave-review", "wfh-review"]);

    expect(enabledKeys(planAdminReads(read))).toEqual(["leavePending", "wfhPending"]);
    expect(enabledKeys(planWorkReads(read))).toEqual(["reviews", "reviewerRequests"]);
    expect(enabledKeys(planAvailabilityAgendaReads(read))).toEqual(["leave", "wfh"]);
    expect(enabledKeys(planOperationsReads(read))).toEqual(["people", "reviews", "recovery"]);
  });

  it("does not promote scoped People view into the organization-only Admin roster or audit reads", () => {
    const read = {
      actorPersonId: "office-reader-1",
      grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-7" }],
    };

    expect(visibleViews(read)).toEqual(["people", "notifications", "operations", "settings"]);
    expect(canAccessWorkspaceDestination("people", read)).toBe(true);
    expect(canAccessWorkspaceDestination("admin", read)).toBe(false);
    expect(canAccessWorkspaceDestination("operations", read)).toBe(true);
    expect(visibleAdminSections(read)).toEqual([]);
    expect(enabledKeys(planAdminReads(read))).toEqual([]);
    expect(enabledKeys(planOperationsReads(read))).toEqual(["people"]);
  });
});
