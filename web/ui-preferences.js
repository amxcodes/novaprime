/**
 * Personal appearance preferences shared by the browser and API validator.
 * Keep persisted choices finite and versionable; never store arbitrary CSS.
 */
export const UI_PREFERENCE_SCHEMA_VERSION = 1;

export const WORKSPACE_DESTINATION_IDS = Object.freeze([
  "today", "work", "availability", "people", "notifications", "operations", "admin", "invite", "work-setup", "settings",
]);
export const MY_DAY_MODULE_IDS = Object.freeze([
  "attendance", "assignments", "timeline", "leave", "wfh",
]);
export const DEFAULT_WORKSPACE = Object.freeze({
  navigationOrder: WORKSPACE_DESTINATION_IDS,
  pinnedDestinations: Object.freeze([]),
  homeView: "auto",
  myDayModules: MY_DAY_MODULE_IDS,
});

export const DEFAULT_APPEARANCE = Object.freeze({
  theme: "light",
  accent: "nova",
  customAccent: "#2b57aa",
  density: "comfortable",
  typeScale: "default",
  font: "geist",
  contrast: "system",
  motion: "system",
  surface: "standard",
  contentWidth: "comfortable",
});

export const ACCENT_PRESETS = Object.freeze({
  nova: Object.freeze({ name: "NOVA cobalt" }),
  forest: Object.freeze({ name: "Forest" }),
  teal: Object.freeze({ name: "Teal" }),
  lime: Object.freeze({ name: "Lime" }),
  custom: Object.freeze({ name: "Custom" }),
});

const appearanceOptions = Object.freeze({
  theme: ["system", "light", "dark"],
  accent: Object.keys(ACCENT_PRESETS),
  density: ["comfortable", "compact"],
  typeScale: ["default", "large"],
  font: ["geist", "inter", "system"],
  contrast: ["system", "high"],
  motion: ["system", "reduced", "off"],
  surface: ["standard", "soft"],
  contentWidth: ["comfortable", "wide"],
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return a complete, safe preference from untrusted or older saved data. */
export function normalizeAppearance(value) {
  if (!isRecord(value)) return { ...DEFAULT_APPEARANCE };
  const result = { ...DEFAULT_APPEARANCE };
  for (const [key, allowed] of Object.entries(appearanceOptions)) {
    if (allowed.includes(value[key])) result[key] = value[key];
  }
  if (typeof value.customAccent === "string" && /^#[\da-f]{6}$/i.test(value.customAccent)) {
    result.customAccent = value.customAccent.toLowerCase();
  }
  return result;
}

/** Strict allowlist validator used before an appearance can be persisted. */
export function validateAppearance(value) {
  if (!isRecord(value)) return undefined;
  const keys = new Set([...Object.keys(appearanceOptions), "customAccent"]);
  if (Object.keys(value).some((key) => !keys.has(key))) return undefined;
  for (const [key, allowed] of Object.entries(appearanceOptions)) {
    if (!allowed.includes(value[key])) return undefined;
  }
  if (typeof value.customAccent !== "string" || !/^#[\da-f]{6}$/i.test(value.customAccent)) return undefined;
  return normalizeAppearance(value);
}

function normalizeIdList(value, allowed, maximum) {
  if (!Array.isArray(value)) return [...allowed];
  const seen = new Set();
  return value.filter((id) => {
    if (!allowed.includes(id) || seen.has(id) || seen.size >= maximum) return false;
    seen.add(id);
    return true;
  });
}

/** Normalize personal workspace choices without ever granting feature access. */
export function normalizeWorkspace(value) {
  if (!isRecord(value)) return {
    navigationOrder: [...DEFAULT_WORKSPACE.navigationOrder],
    pinnedDestinations: [],
    homeView: "auto",
    myDayModules: [...DEFAULT_WORKSPACE.myDayModules],
  };
  const homeView = value.homeView === "auto" || WORKSPACE_DESTINATION_IDS.includes(value.homeView)
    ? value.homeView
    : "auto";
  const navigationOrder = normalizeIdList(value.navigationOrder, WORKSPACE_DESTINATION_IDS, WORKSPACE_DESTINATION_IDS.length);
  return {
    navigationOrder: [...navigationOrder, ...WORKSPACE_DESTINATION_IDS.filter((id) => !navigationOrder.includes(id))],
    pinnedDestinations: Array.isArray(value.pinnedDestinations)
      ? normalizeIdList(value.pinnedDestinations, WORKSPACE_DESTINATION_IDS, 4)
      : [],
    homeView,
    myDayModules: normalizeIdList(value.myDayModules, MY_DAY_MODULE_IDS, MY_DAY_MODULE_IDS.length),
  };
}

/** Strict allowlist validator for persisted navigation and My Day preferences. */
export function validateWorkspace(value) {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    !["navigationOrder", "pinnedDestinations", "homeView", "myDayModules"].includes(key))) return undefined;
  if (!Array.isArray(value.navigationOrder) || value.navigationOrder.length > WORKSPACE_DESTINATION_IDS.length ||
    value.navigationOrder.some((id) => !WORKSPACE_DESTINATION_IDS.includes(id)) ||
    new Set(value.navigationOrder).size !== value.navigationOrder.length ||
    !Array.isArray(value.pinnedDestinations) || value.pinnedDestinations.length > 4 ||
    value.pinnedDestinations.some((id) => !WORKSPACE_DESTINATION_IDS.includes(id)) ||
    new Set(value.pinnedDestinations).size !== value.pinnedDestinations.length ||
    !Array.isArray(value.myDayModules) || value.myDayModules.length > MY_DAY_MODULE_IDS.length ||
    value.myDayModules.some((id) => !MY_DAY_MODULE_IDS.includes(id)) ||
    new Set(value.myDayModules).size !== value.myDayModules.length ||
    !(value.homeView === "auto" || WORKSPACE_DESTINATION_IDS.includes(value.homeView))) return undefined;
  return normalizeWorkspace(value);
}
