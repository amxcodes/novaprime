import { describe, expect, it } from "bun:test";
import { loadAdminPageData } from "./admin-page-loader";
import { preloadAdminPageFeatureModules } from "../../../app/admin-page-route.js";

function createImporters(calls: string[]) {
  return new Proxy({}, {
    get: (_target, name) => () => {
      calls.push(String(name));
      return Promise.resolve({ module: String(name) });
    },
  }) as Record<string, () => Promise<{ module: string }>>;
}

function createServices(actorGrants: Record<string, unknown>, options: { current?: () => boolean } = {}) {
  const requests: string[] = [];
  return {
    requests,
    services: {
      pageApi: async (path: string) => {
        requests.push(path);
        if (path === "/api/me/permission-grants") return actorGrants;
        if (path === "/api/people/directory?q=&limit=25") return { people: [], limit: 25, hasMore: false, nextCursor: null };
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

  it("keeps invite-only and department-scoped viewers off the People directory read", async () => {
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

  it("loads only a bounded People directory page and audit read for organization-scoped people.view", async () => {
    const { requests, services } = createServices({ grants: [
      { permissionKey: "people.view", scope: "organisation" },
    ] });
    const data = await loadAdminPageData("page-1", Promise.resolve(true), services);

    expect(requests).toEqual([
      "/api/me/permission-grants",
      "/api/people/directory?q=&limit=25",
      "/api/audit-events?limit=50",
    ]);
    expect(data?.people.people).toEqual([]);
    expect(data?.people.readState).toBe("not-requested");
    expect(data?.peopleDirectory).toEqual({ people: [], limit: 25, hasMore: false, nextCursor: null });
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

  it("starts only the actor grant read while the Admin shell module is loading", async () => {
    const { requests, services } = createServices({
      grants: [{ permissionKey: "roles.view", scope: "organisation" }],
    });
    let resolvePageReady!: (ready: boolean) => void;
    const pageReady = new Promise<boolean>((resolve) => { resolvePageReady = resolve; });
    let settled = false;
    const load = loadAdminPageData("page-1", pageReady, services).then((data) => {
      settled = true;
      return data;
    });

    expect(requests).toEqual(["/api/me/permission-grants"]);
    expect(settled).toBe(false);

    resolvePageReady(true);
    const data = await load;
    expect(data).toBeDefined();
    expect(requests).toContain("/api/roles");
  });

  it("does not start protected reads or feature imports when the Admin shell fails", async () => {
    const { requests, services } = createServices({
      grants: [{ permissionKey: "roles.view", scope: "organisation" }],
    });
    let resolvePageReady!: (ready: boolean) => void;
    const pageReady = new Promise<boolean>((resolve) => { resolvePageReady = resolve; });
    const imports: string[] = [];
    services.onEffectiveGrantsResolved = (actorGrants) => {
      void preloadAdminPageFeatureModules({ actorGrants }, createImporters(imports));
    };
    const load = loadAdminPageData("page-1", pageReady, services);

    expect(requests).toEqual(["/api/me/permission-grants"]);
    resolvePageReady(false);
    expect(await load).toBeUndefined();
    expect(requests).toEqual(["/api/me/permission-grants"]);
    expect(imports).toEqual([]);
  });

  it("starts only authorized Admin modules before the protected read batch settles", async () => {
    const actorGrants = { grants: [{ permissionKey: "roles.view", scope: "organisation" }] };
    const { requests, services } = createServices(actorGrants);
    const imports: string[] = [];
    const events: string[] = [];
    let releaseReads!: () => void;
    let resolvePreloadStarted!: () => void;
    const readsPending = new Promise<void>((resolve) => { releaseReads = resolve; });
    const preloadStarted = new Promise<void>((resolve) => { resolvePreloadStarted = resolve; });
    let loadSettled = false;
    services.pageApi = async (path: string) => {
      requests.push(path);
      if (path === "/api/me/permission-grants") return actorGrants;
      events.push(`read:${path}`);
      await readsPending;
      return {};
    };
    services.onEffectiveGrantsResolved = (grants) => {
      events.push("grants-resolved");
      void preloadAdminPageFeatureModules({ actorGrants: grants }, createImporters(imports));
      resolvePreloadStarted();
    };

    const load = loadAdminPageData("page-1", Promise.resolve(true), services).then((result) => {
      loadSettled = true;
      return result;
    });
    await preloadStarted;

    const firstProtectedRead = events.findIndex((event) => event.startsWith("read:"));
    expect(imports).toContain("roleSectionModule");
    expect(imports).toContain("roleScopeTargetsRouteModule");
    expect(imports).not.toContain("peopleModule");
    expect(imports).not.toContain("adminWorkModule");
    expect(events.indexOf("grants-resolved")).toBeLessThan(firstProtectedRead);
    expect(loadSettled).toBe(false);

    releaseReads();
    await load;
  });

  it("never starts feature-module imports when the effective grants authorize no Admin features", async () => {
    const { services } = createServices({ grants: [], isSuperAdmin: true });
    const imports: string[] = [];
    services.onEffectiveGrantsResolved = (actorGrants) => {
      void preloadAdminPageFeatureModules({ actorGrants }, createImporters(imports));
    };

    await loadAdminPageData("page-1", Promise.resolve(true), services);

    // The shared section-permission composer is safe and always needed; every
    // optional feature component and route importer stays out of this load.
    expect(imports).toEqual(["adminPageSections"]);
  });
});
