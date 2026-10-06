import type { PersonalAppearance } from "../../design-system/foundations/appearance";
import { ACCENT_SWATCHES, getAccentForeground, getAccentHover, getReadableAccentText } from "../../design-system/foundations/appearance";

export type AppearanceSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
export { ACCENT_SWATCHES, getAccentForeground, getAccentHover, getReadableAccentText };

export const MOTION_PREFERENCE_PRESENTATION = {
  system: { label: "System", detail: "Follow your device motion setting." },
  reduced: { label: "Reduced", detail: "Keep brief color and opacity feedback; remove moving elements." },
  off: { label: "Off", detail: "Suppress all transitions and animations." },
} as const satisfies Record<PersonalAppearance["motion"], { label: string; detail: string }>;

export const TYPEFACE_PREFERENCE_PRESENTATION = {
  geist: {
    label: "Geist",
    detail: "Available · NOVA’s bundled variable font.",
    available: true,
  },
  inter: {
    label: "Inter",
    detail: "Unavailable until this deployment configures an Inter font asset.",
    available: false,
  },
  system: {
    label: "System",
    detail: "Available · Use the device sans-serif.",
    available: true,
  },
} as const satisfies Record<PersonalAppearance["font"], { label: string; detail: string; available: boolean }>;

export function getTypefaceAvailabilityMessage(font: PersonalAppearance["font"]): string | null {
  if (TYPEFACE_PREFERENCE_PRESENTATION[font].available) return null;
  return `${TYPEFACE_PREFERENCE_PRESENTATION[font].label} is saved, but its font asset is not configured for this deployment. NOVA currently displays the device sans-serif fallback. Select System to save the active device font preference.`;
}

export function isAppearanceHexColor(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value);
}

export function getSelectedAccent(appearance: PersonalAppearance): string {
  return appearance.accent === "custom"
    ? appearance.customAccent
    : ACCENT_SWATCHES[appearance.accent];
}

export function getAppearanceStatusMessage(
  status: AppearanceSaveStatus,
  writable: boolean,
): string {
  if (!writable) return "Appearance settings are read-only.";
  switch (status) {
    case "saving": return "Saving appearance…";
    case "pending": return "Unsaved appearance changes.";
    case "saved": return "Appearance saved.";
    case "error": return "Appearance could not be saved.";
    default: return "Changes save automatically.";
  }
}
