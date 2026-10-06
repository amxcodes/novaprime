import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mountSettingsPage } from "./settings-page-route.js";

const component = function SettingsPage() {};

function fixture({ roots, capabilities = {}, loadPage, expireAtEmail = false } = {}) {
  const availableRoots = roots || {
    account: {}, notifications: {}, origin: {}, email: {}, handoffs: {},
  };
  const target = {
    isConnected: true,
    querySelector(selector) {
      return ({
        "#account-security-root": availableRoots.account,
        "#notification-preferences-root": availableRoots.notifications,
        "#public-origin-root": availableRoots.origin,
        "#email-delivery-root": availableRoots.email,
        "#auth-handoffs-root": availableRoots.handoffs,
      })[selector] || null;
    },
  };
  let current = true;
  const order = [];
  const featureErrors = [];
  const mountCalls = [];
  const bridges = [];
  const routePromise = mountSettingsPage({
    target,
    capabilities: {
      canManagePublicOrigin: true,
      canManageEmail: true,
      canShowAuthHandoffs: true,
      ...capabilities,
    },
    isCurrentSettings: () => current && target.isConnected,
    mountIsland: (root, Page, props) => {
      order.push("page");
      mountCalls.push({ root, Page, props });
    },
    showFeedback: () => order.push("feedback"),
    renderLoadError: (message) => featureErrors.push(message),
    sections: {
      mountAccountSecurity: (root) => { order.push("account"); mountCalls.push({ key: "account", root }); },
      mountNotificationPreferences: (root) => { order.push("notifications"); mountCalls.push({ key: "notifications", root }); },
      renderAppearance: () => order.push("appearance"),
      updateWorkspace: () => order.push("workspace"),
      updateSavedTaskViews: () => order.push("saved-views"),
      mountPublicOrigin: (root, isCurrent, bridge) => {
        order.push("origin");
        bridges.push(bridge);
        mountCalls.push({ key: "origin", root, isCurrent, bridge });
      },
      mountEmailDelivery: (input) => {
        order.push("email");
        bridges.push(input.originBridge);
        mountCalls.push({ key: "email", ...input });
        if (expireAtEmail) current = false;
      },
      mountAuthHandoffs: (root) => { order.push("handoffs"); mountCalls.push({ key: "handoffs", root }); },
    },
    loadPage: loadPage || (async () => ({ SettingsPage: component })),
  });
  return {
    routePromise,
    target,
    order,
    featureErrors,
    mountCalls,
    bridges,
    set current(value) { current = value; },
  };
}

describe("Settings page route adapter", () => {
  test("mounts the page and every existing section callback in the current route order", async () => {
    const route = fixture();
    expect(await route.routePromise).toBe(true);

    expect(route.mountCalls[0]).toMatchObject({ root: route.target, Page: component, props: {
      canManagePublicOrigin: true,
      canManageEmail: true,
      canShowAuthHandoffs: true,
    } });
    expect(route.order).toEqual([
      "page", "feedback", "account", "notifications", "appearance", "workspace",
      "saved-views", "origin", "email", "handoffs",
    ]);
    expect(route.bridges[0]).toBe(route.bridges[1]);
    expect(route.mountCalls.find(({ key }) => key === "email")).toMatchObject({
      canReadOrigin: true,
      canActWithUnknownPublicOrigin: false,
    });
  });

  test("does not mount protected sections whose page slots are absent", async () => {
    const route = fixture({
      capabilities: {
        canManagePublicOrigin: false,
        canManageEmail: false,
        canShowAuthHandoffs: false,
      },
      roots: { account: {}, notifications: {} },
    });
    await route.routePromise;

    expect(route.order).toEqual([
      "page", "feedback", "account", "notifications", "appearance", "workspace", "saved-views",
    ]);
    expect(route.mountCalls.some(({ key }) => ["origin", "email", "handoffs"].includes(key))).toBe(false);
  });

  test("keeps Settings load failure local and ignores it after the identity/page becomes stale", async () => {
    const active = fixture({ loadPage: async () => { throw new Error("chunk failure"); } });
    expect(await active.routePromise).toBe(false);
    expect(active.featureErrors).toEqual(["Settings could not load. Reload the page to try again."]);
    expect(active.order).toEqual([]);

    let rejectLoad;
    const stale = fixture({ loadPage: () => new Promise((_resolve, reject) => { rejectLoad = reject; }) });
    stale.current = false;
    rejectLoad(new Error("late chunk failure"));
    expect(await stale.routePromise).toBe(false);
    expect(stale.featureErrors).toEqual([]);
    expect(stale.order).toEqual([]);
  });

  test("stops before the final handoff slot when the Settings page expires during composition", async () => {
    const route = fixture({ expireAtEmail: true });
    await route.routePromise;
    expect(route.order.at(-1)).toBe("email");
    expect(route.order).not.toContain("handoffs");
  });

  test("the app lazily selects the adapter while keeping permissions, identity, state, and APIs in the host", () => {
    const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    const start = appSource.indexOf("async function renderSettings(lifetime)");
    const end = appSource.indexOf("\nasync function mountSettingsNotificationPreferences(", start);
    const host = appSource.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(host).toMatch(/const canManageEmail = state\.actorGrants\?\.isSuperAdmin === true/);
    expect(host).toMatch(/hasPermissionGrant\(state\.actorGrants, "organisation\.public_origin\.manage"\)/);
    expect(host).toMatch(/const isCurrentSettings = \(\) => isCurrentPageRequest\(lifetime\) && state\.identityEpoch === settingsIdentityEpoch/);
    expect(host).toMatch(/import\("\.\/app\/settings-page-route\.js"\)/);
    expect(host).not.toMatch(/import\("\.\/src\/pages\/settings\/SettingsPage\.tsx"\)/);
    expect(host).toMatch(/api,\s*requestOptions,\s*captureCommandContext,\s*isCurrentCommand/);
    expect(host).toMatch(/mountSettingsNotificationPreferences\(target, isCurrent, lifetime\)/);
    expect(host).toMatch(/mountSettingsAuthHandoffs/);
  });
});
