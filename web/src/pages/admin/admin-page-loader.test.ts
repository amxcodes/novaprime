import { describe, expect, it } from "bun:test";
import { loadAdminPageData } from "./admin-page-loader";

function createServices(actorGrants: Record<string, unknown>, options: { current?: () => boolean } = {}) {
  const requests: string[] = [];
  return {
    requests,
    services: {
      pageApi: async (path: string) => {
        requests.push(path);
        if (path === "/api/me/permission-grants") return actorGrants;
        if (path === "/api/people") return { people: [] };
        if (path === "/api/audit-events?limit=50") return { events: [] };
        if (path === "/api/offices/geofence-options") return { offices: [{ id: "office-7", name: "North office" }] };
        return {};
      },
      readOrError: async (promise: Promise<Record<string, unknown>>, fallback: Record<string, unknown>) => {
        try {
          return await promise;
        } catch {
          return { ...fallback, readError: "REQUEST_FAILED" };
        }
      },
      skippedAdminRead: (fallback: Record<string, unknown>, requiredPermission: string) => ({
        ...fallback,
        readError: "PREREQUISITE_PERMISSION_REQUIRED",
        requiredPermission,
      }),
      isCurrentPageRequest: () => options.current?.() ?? true,
    },
  };
}

describe("Admin page route data", () => {
  it("loads no ordinary Admin endpoints for a Super Admin without their read grants", async () => {
    const { requests, services } = createServices({ grants: [], isSuperAdmin: true });
    const data = await loadAdminPageData("page-1", Promise.resolve(true), services);

    expect(requests).toEqual(["/api/me/permission-grants"]);
    expect(data?.people.readState).toBe("not-requested");
    expect(data?.workContext.readState).toBe("not-requested");
  });

  it("keeps office-scoped directory grants off the organization-only Admin roster read", async () => {
    const { requests, services } = createServices({ grants: [
      { permissionKey: "people.view", scope: "office", officeId: "office-3" },
    ] });
    const data = await loadAdminPageData("page-1", Promise.resolve(true), services);

    expect(requests).toEqual(["/api/me/permission-grants"]);
    expect(data?.people.readState).toBe("not-requested");
  });

  it("keeps invite-only and department-scoped viewers off the unpaged People roster read", async () => {
    const inviteOnly = createServices({ grants: [
      { permissionKey: "people.invite", scope: "organisation" },
    ] });
    const inviteData = await loadAdminPageData("page-1", Promise.resolve(true), inviteOnly.services);
    expect(inviteOnly.requests).toEqual(["/api/me/permission-grants"]);
    expect(inviteData?.people.readState).toBe("not-requested");

    const departmentScoped = createServices({ grants: [
      { permissionKey: "people.view", scope: "organisation_department", organisationDepartmentId: "dept-4" },
    ] });
    const scopedData = await loadAdminPageData("page-1", Promise.resolve(true), departmentScoped.services);
    expect(departmentScoped.requests).toEqual(["/api/me/permission-grants"]);
    expect(scopedData?.people.readState).toBe("not-requested");
  });

  it("keeps the purpose-limited geofence options read organization-scoped", async () => {
    const { requests, services } = createServices({ grants: [
      { permissionKey: "availability.office_geofence.manage", scope: "organisation" },
    ] });
    const data = await loadAdminPageData("page-1", Promise.resolve(true), services);

    expect(requests).toEqual([
      "/api/me/permission-grants",
      "/api/offices/geofence-options",
    ]);
    expect(data?.geofenceOptions.offices).toEqual([{ id: "office-7", name: "North office" }]);
  });

  it("does not request geofence options for an office-scoped manage grant", async () => {
    const { requests, services } = createServices({ grants: [
      { permissionKey: "availability.office_geofence.manage", scope: "office", officeId: "office-7" },
    ] });
    const data = await loadAdminPageData("page-1", Promise.resolve(true), services);

    expect(requests).toEqual(["/api/me/permission-grants"]);
    expect(data?.geofenceOptions.requiredPermission).toBe("availability.office_geofence.manage at organisation scope");
    expect(data?.geofenceOptions.offices).toEqual([]);
  });

  it("loads only the People and audit reads for organization-scoped people.view", async () => {
    const { requests, services } = createServices({ grants: [
      { permissionKey: "people.view", scope: "organisation" },
    ] });
    const data = await loadAdminPageData("page-1", Promise.resolve(true), services);

    expect(requests).toEqual([
      "/api/me/permission-grants",
      "/api/people",
      "/api/audit-events?limit=50",
    ]);
    expect(data?.people.people).toEqual([]);
  });

  it("reads the WFH policy list only for view; manage-only stays on its separate form grant", async () => {
    const view = createServices({ grants: [
      { permissionKey: "availability.wfh_policy.view", scope: "organisation" },
    ] });
    await loadAdminPageData("page-1", Promise.resolve(true), view.services);
    expect(view.requests).toEqual([
      "/api/me/permission-grants",
      "/api/availability/wfh-policies",
    ]);

    const manage = createServices({ grants: [
      { permissionKey: "availability.wfh_policy.manage", scope: "organisation" },
    ] });
    const data = await loadAdminPageData("page-1", Promise.resolve(true), manage.services);
    expect(manage.requests).toEqual(["/api/me/permission-grants"]);
    expect(data?.wfhPolicies.readError).toBe("PREREQUISITE_PERMISSION_REQUIRED");
    expect(data?.offices.requiredPermission).toBe("organisation.settings.manage");
    expect(data?.departments.requiredPermission).toBe("organisation.settings.manage");
    expect(data?.people.requiredPermission).toBe("people.view");
  });

  it("does not read after the page lifetime becomes stale", async () => {
    let currentChecks = 0;
    const { requests, services } = createServices({ grants: [{ permissionKey: "people.view", scope: "organisation" }] }, {
      current: () => ++currentChecks < 2,
    });

    const data = await loadAdminPageData("page-1", Promise.resolve(true), services);

    expect(data).toBeUndefined();
    expect(requests).toEqual(["/api/me/permission-grants"]);
  });
});
