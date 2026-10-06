import { describe, expect, it } from "bun:test";
import {
  ADMIN_FEATURES,
  canCreateOffice,
  canShowOwnerTransfer,
  canShowAdminFeature,
  planAdminReads,
} from "./capabilities";
import {
  ADMIN_FEATURES as legacyAdminFeatures,
  canCreateOffice as legacyCanCreateOffice,
  canShowAdminFeature as legacyCanShowAdminFeature,
  planAdminReads as legacyPlanAdminReads,
} from "../../../admin-read-state.js";

describe("Admin capability ownership", () => {
  it("re-exports the feature-owned capabilities as the same bindings", () => {
    expect(legacyAdminFeatures).toBe(ADMIN_FEATURES);
    expect(legacyCanCreateOffice).toBe(canCreateOffice);
    expect(legacyCanShowAdminFeature).toBe(canShowAdminFeature);
    expect(legacyPlanAdminReads).toBe(planAdminReads);
  });

  it("fails closed for missing, malformed, or failed reads", () => {
    expect(canShowAdminFeature(undefined, "people")).toBe(false);
    expect(canShowAdminFeature({ grants: null }, "people")).toBe(false);
    expect(canShowAdminFeature({ grants: [], readError: "REQUEST_FAILED" }, "people")).toBe(false);
    expect(planAdminReads(undefined).people).toBe(false);
    expect(planAdminReads({ grants: [], readError: "REQUEST_FAILED" }).people).toBe(false);
    expect(canCreateOffice({ grants: [], readError: "REQUEST_FAILED" })).toBe(false);
  });

  it("keeps Admin discovery within the endpoint's supported scope and actor identity", () => {
    expect(canShowAdminFeature({
      actorPersonId: "actor-1",
      grants: [{ permissionKey: "people.view", scope: "own_record", selfApplicable: true }],
    }, "people")).toBe(false);
    expect(canShowAdminFeature({
      grants: [{ permissionKey: "leave.review", scope: "own_record", selfApplicable: true }],
    }, "leaveReview")).toBe(false);
    expect(canShowAdminFeature({
      grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-1" }],
    }, "people")).toBe(false);
    expect(canShowAdminFeature({
      grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-1" }],
    }, "audit")).toBe(false);
    expect(planAdminReads({
      grants: [{ permissionKey: "people.view", scope: "office", officeId: "office-1" }],
    }).people).toBe(false);
  });

  it("does not treat Super Admin status as a substitute for endpoint read grants", () => {
    const superAdminWithoutGrants = { isSuperAdmin: true, grants: [] };
    expect(canShowAdminFeature(superAdminWithoutGrants, "people")).toBe(false);
    expect(canShowAdminFeature(superAdminWithoutGrants, "audit")).toBe(false);
    expect(planAdminReads(superAdminWithoutGrants)).toEqual(planAdminReads({ grants: [] }));
    expect(Object.values(planAdminReads(superAdminWithoutGrants)).some(Boolean)).toBe(false);
  });

  it("requires the independent organization People list before exposing Owner Transfer", () => {
    expect(canShowOwnerTransfer({ isSuperAdmin: true, grants: [] })).toBe(false);
    expect(canShowOwnerTransfer({ isSuperAdmin: true, grants: [
      { permissionKey: "people.view", scope: "office", officeId: "office-7" },
    ] })).toBe(false);
    expect(canShowOwnerTransfer({ isSuperAdmin: true, grants: [
      { permissionKey: "people.view", scope: "organisation" },
    ] })).toBe(true);
    expect(canShowOwnerTransfer({ isSuperAdmin: true, readError: "REQUEST_FAILED", grants: [
      { permissionKey: "people.view", scope: "organisation" },
    ] })).toBe(false);
  });

  it("plans notification delivery reads only for organization-scoped view permission", () => {
    const manageOnly = {
      grants: [{ permissionKey: "notifications.manage", scope: "organisation" }],
    };
    expect(planAdminReads(manageOnly).notificationDelivery).toBe(false);
    expect(canShowAdminFeature(manageOnly, "notificationDelivery")).toBe(false);

    expect(planAdminReads({
      grants: [{ permissionKey: "notifications.delivery.view", scope: "office", officeId: "office-1" }],
    }).notificationDelivery).toBe(false);

    const viewOnly = {
      grants: [{ permissionKey: "notifications.delivery.view", scope: "organisation" }],
    };
    expect(planAdminReads(viewOnly).notificationDelivery).toBe(true);
    expect(canShowAdminFeature(viewOnly, "notificationDelivery")).toBe(true);

    const viewAndManage = {
      grants: [
        { permissionKey: "notifications.delivery.view", scope: "organisation" },
        { permissionKey: "notifications.manage", scope: "organisation" },
      ],
    };
    expect(planAdminReads(viewAndManage).notificationDelivery).toBe(true);
    expect(canShowAdminFeature(viewAndManage, "notificationDelivery")).toBe(true);
  });

  it("keeps WFH override visibility independent from its organization-scoped list read", () => {
    const viewOnly = { grants: [
      { permissionKey: "availability.wfh_policy.view", scope: "organisation" },
    ] };
    expect(canShowAdminFeature(viewOnly, "wfhOverrides")).toBe(true);
    expect(planAdminReads(viewOnly).wfhPolicies).toBe(true);

    const manageOnly = { grants: [
      { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    ] };
    expect(canShowAdminFeature(manageOnly, "wfhOverrides")).toBe(true);
    expect(planAdminReads(manageOnly).wfhPolicies).toBe(false);

    expect(canShowAdminFeature({ grants: [
      { permissionKey: "availability.wfh_policy.manage", scope: "office", officeId: "office-7" },
    ] }, "wfhOverrides")).toBe(false);
  });

  it("keeps Roles and Permissions view, editor, and selector reads on their separate grants", () => {
    const viewOnly = { grants: [
      { permissionKey: "roles.view", scope: "organisation" },
    ] };
    expect(canShowAdminFeature(viewOnly, "roles")).toBe(true);
    expect(planAdminReads(viewOnly)).toMatchObject({ roles: true, permissions: true, workContext: false });

    const assignOnly = { grants: [
      { permissionKey: "roles.assign", scope: "organisation" },
    ] };
    expect(canShowAdminFeature(assignOnly, "roles")).toBe(false);
    expect(planAdminReads(assignOnly)).toMatchObject({ roles: false, permissions: false, workContext: false });

    const viewAndCreate = { grants: [
      { permissionKey: "roles.view", scope: "organisation" },
      { permissionKey: "roles.create", scope: "organisation" },
    ] };
    expect(canShowAdminFeature(viewAndCreate, "roles")).toBe(true);
    expect(planAdminReads(viewAndCreate)).toMatchObject({ roles: true, permissions: true, workContext: true });

    const viewAndEdit = { grants: [
      { permissionKey: "roles.view", scope: "organisation" },
      { permissionKey: "roles.edit", scope: "organisation" },
    ] };
    expect(planAdminReads(viewAndEdit)).toMatchObject({ roles: true, permissions: true, workContext: true });

    const scopedEditorWithoutView = { grants: [
      { permissionKey: "roles.create", scope: "office", officeId: "office-7" },
      { permissionKey: "roles.edit", scope: "office", officeId: "office-7" },
    ] };
    expect(canShowAdminFeature(scopedEditorWithoutView, "roles")).toBe(false);
    expect(planAdminReads(scopedEditorWithoutView)).toMatchObject({ roles: false, permissions: false, workContext: false });
  });
});
