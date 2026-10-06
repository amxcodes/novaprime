import { expect, test } from "bun:test";
import {
  ACCENT_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_WORKSPACE,
  WORKSPACE_DESTINATION_IDS,
  normalizeAppearance,
  normalizeWorkspace,
  validateAppearance,
  validateWorkspace,
} from "./ui-preferences.js";

test("appearance API payloads keep their versioned allowlist and safe defaults", () => {
  expect(normalizeAppearance({ theme: "dark", density: "dense", customAccent: "red" })).toEqual({
    ...DEFAULT_APPEARANCE,
    theme: "dark",
  });
  expect(validateAppearance({ ...DEFAULT_APPEARANCE, font: "system", customAccent: "#AABBCC" })).toEqual({
    ...DEFAULT_APPEARANCE,
    font: "system",
    customAccent: "#aabbcc",
  });
  expect(validateAppearance({ ...DEFAULT_APPEARANCE, injected: "url(javascript:...)" })).toBeUndefined();
  expect(validateAppearance({ ...DEFAULT_APPEARANCE, typeScale: "huge" })).toBeUndefined();
  expect(Object.keys(ACCENT_PRESETS)).toEqual(["nova", "forest", "teal", "lime", "custom"]);
});

test("workspace API payloads allowlist routes and My Day modules without granting access", () => {
  const workspace = normalizeWorkspace({
    navigationOrder: ["work", "untrusted", "settings", "work"],
    pinnedDestinations: ["settings", "invite", "not-a-page", "today", "work", "admin"],
    homeView: "admin",
    myDayModules: ["timeline", "attendance", "bogus", "timeline"],
    savedViews: [{ id: "legacy", name: "Do not accept" }],
  });
  expect(workspace.navigationOrder.slice(0, 2)).toEqual(["work", "settings"]);
  expect(workspace.pinnedDestinations).toEqual(["settings", "invite", "today", "work"]);
  expect(workspace.homeView).toBe("admin");
  expect(workspace.myDayModules).toEqual(["timeline", "attendance"]);
  expect(workspace).not.toHaveProperty("savedViews");
  expect(workspace.navigationOrder.every((view) => WORKSPACE_DESTINATION_IDS.includes(view))).toBe(true);
});

test("strict workspace validation rejects unknown properties and defaults older rows", () => {
  expect(normalizeWorkspace(undefined)).toEqual({
    ...DEFAULT_WORKSPACE,
    navigationOrder: [...DEFAULT_WORKSPACE.navigationOrder],
    pinnedDestinations: [],
    myDayModules: [...DEFAULT_WORKSPACE.myDayModules],
  });
  expect(validateWorkspace({ ...DEFAULT_WORKSPACE, untrusted: true })).toBeUndefined();
  expect(validateWorkspace({ ...DEFAULT_WORKSPACE, savedViews: [] })).toBeUndefined();
});
