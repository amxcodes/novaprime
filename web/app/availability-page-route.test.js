import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canAccessWorkspaceDestination } from "../workspace-destinations.js";
import { mountAvailabilityPage } from "./availability-page-route.js";

const page = function AvailabilityPage() {};

function fixture({ grants = [], search = "?view=availability", pageApi, loadFeature, refreshPermissions } = {}) {
  const actorGrants = { actorPersonId: "person-1", grants };
  let current = true;
  let connected = true;
  const target = { get isConnected() { return connected; } };
  const location = { origin: "https://nova.test", search };
  const history = {
    state: { scroll: 72 },
    calls: [],
    replaceState(...args) { this.calls.push(args); },
  };
  const mounts = [];
  const feedback = [];
  const scrollRestores = [];
  const apiCalls = [];
  const issueCalls = [];
  const permissionRefreshes = [];
  const routePromise = mountAvailabilityPage({
    target,
    actorGrants,
    location,
    history,
    isCurrentPageRequest: () => current,
    pageApi: (path) => {
      apiCalls.push(path);
      return pageApi ? pageApi(path) : Promise.resolve({ events: [{ id: "event-1" }] });
    },
    refreshPermissions: () => {
      permissionRefreshes.push(true);
      return refreshPermissions?.();
    },
    mountIsland: (root, Component, props) => mounts.push({ root, Component, props }),
    getReadIssue: (response, resource) => {
      issueCalls.push([response, resource]);
      return response?.readError ? { message: `Could not load ${resource}.` } : undefined;
    },
    businessTimeLabel: (value) => value,
    showFeedback: () => feedback.push(true),
    restorePendingRouteScroll: () => scrollRestores.push(true),
    loadFeature: loadFeature || (async () => ({ AvailabilityPage: page })),
  });
  return {
    routePromise,
    target,
    history,
    mounts,
    feedback,
    scrollRestores,
    apiCalls,
    issueCalls,
    permissionRefreshes,
    actorGrants,
    set current(value) { current = value; },
    set connected(value) { connected = value; },
    get props() { return mounts.at(-1)?.props; },
  };
}

describe("Availability page route adapter", () => {
  test("mounts only after a permitted source is planned and retains range, cursor, and source labels", async () => {
    const grants = [{ permissionKey: "attendance.view", scope: "own_record" }];
    expect(canAccessWorkspaceDestination("availability", { actorPersonId: "person-1", grants })).toBe(true);
    const route = fixture({
      grants,
      search: "?view=availability&startDate=2026-10-01&endDate=2026-10-10&cursor=next-token",
    });
    await route.routePromise;

    expect(route.mounts).toHaveLength(1);
    expect(route.mounts[0]).toMatchObject({ root: route.target, Component: page });
    expect(route.props.agenda).toMatchObject({
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      cursor: "next-token",
      sourceLabels: ["attendance"],
    });
    expect(route.feedback).toHaveLength(1);
    expect(route.scrollRestores).toHaveLength(1);

    await route.props.agenda.loadEvents("2026-10-01", "2026-10-10", "next-token");
    const requested = new URL(route.apiCalls[0], "https://nova.test");
    expect(requested.pathname).toBe("/api/availability/agenda");
    expect(Object.fromEntries(requested.searchParams)).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      limit: "50",
      cursor: "next-token",
    });
  });

  test("fails closed when no Availability source is authorized", () => {
    const grants = [{ permissionKey: "attendance.view", scope: "client" }];
    expect(canAccessWorkspaceDestination("availability", { actorPersonId: "person-1", grants })).toBe(false);
  });

  test("preserves read failure fallback and feature-facing error copy", async () => {
    const route = fixture({
      grants: [{ permissionKey: "availability.holiday.view", scope: "organisation" }],
      pageApi: async () => { throw Object.assign(new Error("untrusted detail"), { code: "REQUEST_FAILED" }); },
    });
    await route.routePromise;

    const response = await route.props.agenda.loadEvents("2026-10-01", "2026-10-02", null);
    expect(response).toEqual({ events: [], readError: "REQUEST_FAILED" });
    expect(route.props.agenda.readErrorMessage(response)).toBe("Could not load availability agenda.");
    expect(route.issueCalls).toHaveLength(1);
    expect(route.issueCalls[0][0]).toMatchObject({ readError: "REQUEST_FAILED" });
  });

  test("clears an obsolete deep-link cursor and refreshes grants after a server access revision changes", async () => {
    const route = fixture({
      grants: [{ permissionKey: "attendance.view", scope: "office", officeId: "office-1" }],
      search: "?view=availability&startDate=2026-10-01&endDate=2026-10-31&cursor=old-page&keep=1",
      pageApi: async () => {
        throw Object.assign(new Error("PERMISSION_DENIED"), {
          code: "PERMISSION_DENIED",
          httpStatus: 409,
          payload: { error: "PERMISSION_DENIED", reason: "AVAILABILITY_ACCESS_CHANGED" },
        });
      },
    });
    await route.routePromise;

    const response = await route.props.agenda.loadEvents("2026-10-01", "2026-10-31", "old-page");
    expect(response).toEqual({ events: [], readError: "PERMISSION_DENIED", accessChanged: true });
    expect(route.permissionRefreshes).toHaveLength(1);
    const rewritten = new URL(route.history.calls[0][2]);
    expect(Object.fromEntries(rewritten.searchParams)).toEqual({
      view: "availability",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      keep: "1",
    });
  });

  test("drops a late feature result after route or target becomes stale", async () => {
    let resolveFeature;
    const route = fixture({
      grants: [{ permissionKey: "availability.holiday.view", scope: "organisation" }],
      loadFeature: () => new Promise((resolve) => { resolveFeature = resolve; }),
    });
    route.current = false;
    route.connected = false;
    resolveFeature({ AvailabilityPage: page });
    await route.routePromise;

    expect(route.mounts).toHaveLength(0);
    expect(route.feedback).toHaveLength(0);
    expect(route.scrollRestores).toHaveLength(0);
  });

  test("updates only the Availability range in the URL while retaining history state", async () => {
    const route = fixture({
      grants: [{ permissionKey: "availability.holiday.view", scope: "organisation" }],
      search: "?view=availability&cursor=old-token&other=kept-until-range-change",
    });
    await route.routePromise;

    route.props.agenda.updateRange("2026-11-01", "2026-11-14");
    expect(route.history.calls).toHaveLength(1);
    expect(route.history.calls[0][0]).toEqual({ scroll: 72 });
    expect(route.history.calls[0][1]).toBe("");
    const updated = new URL(route.history.calls[0][2]);
    expect(updated.pathname).toBe("/");
    expect(Object.fromEntries(updated.searchParams)).toEqual({
      view: "availability",
      startDate: "2026-11-01",
      endDate: "2026-11-14",
    });
  });

  test("the app route is permission-gated, lazy, and keeps the local import failure state", () => {
    const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    expect(appSource).toMatch(/if \(!canOpenView\(view\)\)[\s\S]*?if \(view === "availability"\) return renderAvailability\(lifetime\)/);
    expect(appSource).toMatch(/async function renderAvailability\(lifetime\)/);
    expect(appSource).toMatch(/import\("\.\/app\/availability-page-route\.js"\)/);
    expect(appSource).toMatch(/refreshPermissions: \(\) => \{[\s\S]*?refreshActorPermissions\(state\.identityEpoch, actorPersonId\)/);
    expect(appSource).not.toMatch(/import\("\.\/src\/pages\/availability\/AvailabilityPage\.tsx"\)/);
    expect(appSource).toMatch(/target\.replaceChildren\(noticeElement\(errorText\(error\), "error"\)\)/);
  });
});
