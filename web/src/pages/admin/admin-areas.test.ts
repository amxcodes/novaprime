import { describe, expect, it } from "bun:test";
import { adminAreaForView, canShowAdminArea, planAdminAreaReads } from "./admin-areas";

const grant = (permissionKey: string) => ({ permissionKey, scope: "organisation" });

describe("focused Admin areas", () => {
  it("maps each route only to its granted area and keeps the legacy route permission-selected", () => {
    const accessOnly = { actorPersonId: "role-admin", grants: [grant("roles.view")] };
    expect(adminAreaForView("admin-access", accessOnly)?.id).toBe("access");
    expect(adminAreaForView("admin-availability", accessOnly)).toBeNull();
    expect(adminAreaForView("admin", accessOnly)?.id).toBe("access");
    expect(adminAreaForView("admin", { actorPersonId: "empty", grants: [] })).toBeNull();
  });

  it("limits each area read plan to its own page and declared selector prerequisites", () => {
    const organisation = planAdminAreaReads({ grants: [grant("organisation.settings.manage")] }, "organisation");
    expect(Object.entries(organisation).filter(([, enabled]) => enabled).map(([key]) => key))
      .toEqual(["organisation", "offices", "departments"]);

    const availability = planAdminAreaReads({ grants: [grant("availability.calendar.view")] }, "availability");
    expect(Object.entries(availability).filter(([, enabled]) => enabled).map(([key]) => key))
      .toEqual(["availability"]);

    const access = planAdminAreaReads({ grants: [grant("roles.view")] }, "access");
    expect(Object.entries(access).filter(([, enabled]) => enabled).map(([key]) => key))
      .toEqual(["permissions", "roles"]);

    const audit = planAdminAreaReads({ grants: [grant("people.view")] }, "audit");
    expect(Object.entries(audit).filter(([, enabled]) => enabled).map(([key]) => key))
      .toEqual(["audit"]);
  });

  it("does not treat Super Admin status or one area's grants as permission for another area", () => {
    const noGrants = { isSuperAdmin: true, grants: [] };
    expect(canShowAdminArea(noGrants, "organisation")).toBe(false);
    expect(canShowAdminArea({ grants: [grant("availability.calendar.view")] }, "audit")).toBe(false);
    expect(Object.values(planAdminAreaReads(noGrants, "work")).some(Boolean)).toBe(false);
  });
});
