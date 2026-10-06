import { expect, test } from "bun:test";
import { sanitizePreferenceWorkspace } from "./ui-preferences.js";

const legacyWorkspace = {
  navigationOrder: ["today", "work", "availability", "people", "notifications", "operations", "admin", "invite", "work-setup", "settings"],
  pinnedDestinations: ["work"],
  homeView: "today",
  myDayModules: ["attendance", "assignments", "timeline", "leave", "wfh"],
  savedViews: [{
    id: "legacy-view-1",
    name: "Design review",
    collection: "mine",
    status: "assigned",
    due: "upcoming",
    search: "private search text",
  }],
};

test("generic preference responses and writes strip saved task-view definitions", () => {
  const sanitized = sanitizePreferenceWorkspace(legacyWorkspace);
  expect(sanitized).toEqual({
    navigationOrder: legacyWorkspace.navigationOrder,
    pinnedDestinations: legacyWorkspace.pinnedDestinations,
    homeView: legacyWorkspace.homeView,
    myDayModules: legacyWorkspace.myDayModules,
  });
  expect(sanitized).not.toHaveProperty("savedViews");
  expect(JSON.stringify(sanitized)).not.toContain("private search text");
  expect(legacyWorkspace.savedViews[0]?.search).toBe("private search text");
});

test("legacy saved-view contents cannot invalidate or enter generic workspace preferences", () => {
  const sanitized = sanitizePreferenceWorkspace({
    ...legacyWorkspace,
    savedViews: [{ query: "arbitrary", search: "secret" }],
  });
  expect(sanitized).not.toHaveProperty("savedViews");
  expect(JSON.stringify(sanitized)).not.toContain("secret");
});
