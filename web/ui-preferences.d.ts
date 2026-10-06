export type UiAppearance = {
  theme: "system" | "light" | "dark";
  accent: "nova" | "forest" | "teal" | "lime" | "custom";
  customAccent: string;
  density: "comfortable" | "compact";
  typeScale: "default" | "large";
  font: "geist" | "inter" | "system";
  contrast: "system" | "high";
  motion: "system" | "reduced" | "off";
  surface: "standard" | "soft";
  contentWidth: "comfortable" | "wide";
};

export type UiWorkspace = {
  navigationOrder: string[];
  pinnedDestinations: string[];
  homeView: string;
  myDayModules: string[];
};

export const UI_PREFERENCE_SCHEMA_VERSION: number;
export const WORKSPACE_DESTINATION_IDS: ReadonlyArray<string>;
export const MY_DAY_MODULE_IDS: ReadonlyArray<string>;
export const DEFAULT_APPEARANCE: Readonly<UiAppearance>;
export const DEFAULT_WORKSPACE: Readonly<UiWorkspace>;
export function normalizeAppearance(value: unknown): UiAppearance;
export function validateAppearance(value: unknown): UiAppearance | undefined;
export function normalizeWorkspace(value: unknown): UiWorkspace;
export function validateWorkspace(value: unknown): UiWorkspace | undefined;
