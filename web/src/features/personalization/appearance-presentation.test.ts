import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { PersonalAppearance } from "../../design-system/foundations/appearance";
import {
  getAccentForeground,
  getAccentHover,
  getAppearanceStatusMessage,
  getReadableAccentText,
  getSelectedAccent,
  getTypefaceAvailabilityMessage,
  isAppearanceHexColor,
  MOTION_PREFERENCE_PRESENTATION,
  TYPEFACE_PREFERENCE_PRESENTATION,
} from "./appearance-presentation";

const motionTokens = readFileSync(new URL("../../design-system/foundations/tokens.css", import.meta.url), "utf8");
const motionReset = readFileSync(new URL("../../design-system/foundations/reset.css", import.meta.url), "utf8");
const navigationStyles = readFileSync(new URL("../../app-shell/Navigation.module.css", import.meta.url), "utf8");
const peopleStyles = readFileSync(new URL("../people/People.module.css", import.meta.url), "utf8");
const adminPageStyles = readFileSync(new URL("../../pages/admin/AdminPage.module.css", import.meta.url), "utf8");
const myDayPageStyles = readFileSync(new URL("../my-day/MyDayPage.module.css", import.meta.url), "utf8");

const appearance: PersonalAppearance = {
  theme: "system",
  accent: "nova",
  customAccent: "#126a52",
  density: "comfortable",
  typeScale: "default",
  font: "geist",
  contrast: "system",
  motion: "system",
  surface: "standard",
  contentWidth: "comfortable",
};

describe("appearance presentation", () => {
  it("uses bundled Figma Inter by default and retains the semantic family fallbacks", () => {
    expect(motionTokens).toContain('--nova-type-family-custom: "Inter Variable";');
    expect(motionTokens).toContain("--nova-type-family-sans: var(--nova-type-family-custom), Inter, ui-sans-serif, system-ui,");
    expect(motionTokens).toContain(':root[data-font="inter"]');
    expect(motionTokens).toContain(':root[data-font="system"]');
  });

  it("accepts only the API's six-digit hexadecimal custom accent format", () => {
    expect(isAppearanceHexColor("#126a52")).toBe(true);
    expect(isAppearanceHexColor("#ABCDEF")).toBe(true);
    expect(isAppearanceHexColor("126a52")).toBe(false);
    expect(isAppearanceHexColor("#fff")).toBe(false);
    expect(isAppearanceHexColor("red")).toBe(false);
  });

  it("selects a legible black or white foreground for custom accents", () => {
    expect(getAccentForeground("#000000")).toBe("#ffffff");
    expect(getAccentForeground("#ffffff")).toBe("#000000");
    expect(getAccentForeground("#777777")).toBe("#000000");
    expect(getAccentForeground("invalid")).toBe("#ffffff");
  });

  it("preserves custom accent hue while keeping text contrast above WCAG AA", () => {
    const lightText = getReadableAccentText("#ffffff", "light");
    const darkText = getReadableAccentText("#000000", "dark");

    expect(lightText).not.toBe("#ffffff");
    expect(darkText).not.toBe("#000000");
    expect(colorContrast(lightText, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(colorContrast(darkText, "#1a212c")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the primary-button foreground at WCAG AA on both the accent and its hover fill", () => {
    const accents = [
      "#777777", "#ffffff", "#000000", "#126a52", "#e6baef", "#34aa77",
      ...[0, 51, 102, 153, 204, 255].flatMap((red) =>
        [0, 102, 204, 255].flatMap((green) => [0, 128, 255].map((blue) => toHex(red, green, blue)))),
    ];

    for (const accent of accents) {
      const foreground = getAccentForeground(accent);
      expect(colorContrast(foreground, accent)).toBeGreaterThanOrEqual(4.5);
      expect(colorContrast(foreground, getAccentHover(accent))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps normal and hover accent text readable on neutral and accent-subtle surfaces in both themes", () => {
    const greySelectionSurface = mixHex("#f3f6fc", "#777777", 0.1);
    expect(colorContrast("#777777", greySelectionSurface)).toBeLessThan(4.5);

    const accents = [
      "#777777", // Previously passed on the canvas but failed on its tinted selection surface.
      "#ffffff",
      "#000000",
      "#126a52",
      "#e6baef",
      "#34aa77",
      ...[0, 51, 102, 153, 204, 255].flatMap((red) =>
        [0, 102, 204, 255].flatMap((green) => [0, 128, 255].map((blue) => toHex(red, green, blue)))),
    ];

    for (const theme of ["light", "dark"] as const) {
      for (const accent of accents) {
        const hoverAccent = mixHex(accent, getAccentForeground(accent), 0.1);
        const textColors = [
          getReadableAccentText(accent, theme),
          getReadableAccentText(hoverAccent, theme, accent),
        ];

        for (const textColor of textColors) {
          for (const surface of themeSurfaces(theme, accent)) {
            expect(colorContrast(textColor, surface)).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it("wires Large text to shared type-size tokens consumed by the shell and feature styles", () => {
    const largeScale = motionTokens.match(/:root\[data-type-scale="large"\]\s*\{([^}]*)\}/)?.[1] || "";

    expect(largeScale).toContain("--nova-type-size-xs:");
    expect(largeScale).toContain("--nova-type-size-sm:");
    expect(largeScale).toContain("--nova-type-size-md:");
    expect(largeScale).toContain("--nova-type-size-lg:");
    expect(largeScale).toContain("--nova-type-size-xl:");
    expect(largeScale).toContain("--nova-type-size-display:");
    expect(navigationStyles).toMatch(/font-size:\s*var\(--nova-type-size-/);
    expect(peopleStyles).toMatch(/font-size:\s*var\(--nova-type-size-/);
    expect(adminPageStyles).toMatch(/font-size:\s*var\(--nova-type-size-display\)/);
    expect(myDayPageStyles).toMatch(/font-size:\s*var\(--nova-type-size-display\)/);
  });

  it("uses the selected curated or custom accent for its preview", () => {
    expect(getSelectedAccent(appearance)).toBe("#3d6bff");
    expect(getSelectedAccent({ ...appearance, accent: "custom" })).toBe("#126a52");
  });

  it("keeps persistence copy aligned with read-only and save states", () => {
    expect(getAppearanceStatusMessage("idle", true)).toBe("Changes save automatically.");
    expect(getAppearanceStatusMessage("saving", true)).toBe("Saving appearance…");
    expect(getAppearanceStatusMessage("saved", true)).toBe("Appearance saved.");
    expect(getAppearanceStatusMessage("error", true)).toBe("Appearance could not be saved.");
    expect(getAppearanceStatusMessage("saved", false)).toBe("Appearance settings are read-only.");
  });

  it("defines distinct system, reduced, and off motion presentations", () => {
    expect(MOTION_PREFERENCE_PRESENTATION).toEqual({
      system: { label: "System", detail: "Follow your device motion setting." },
      reduced: { label: "Reduced", detail: "Keep brief color and opacity feedback; remove moving elements." },
      off: { label: "Off", detail: "Suppress all transitions and animations." },
    });
  });

  it("makes Figma Inter, optional Geist, and System available", () => {
    expect(TYPEFACE_PREFERENCE_PRESENTATION).toEqual({
      geist: {
        label: "Geist",
        detail: "Available · Optional NOVA typeface.",
        available: true,
      },
      inter: {
        label: "Inter",
        detail: "Available · Figma’s bundled variable font.",
        available: true,
      },
      system: {
        label: "System",
        detail: "Available · Use the device sans-serif.",
        available: true,
      },
    });
  });

  it("keeps all available typeface choices free of fallback warnings", () => {
    expect(getTypefaceAvailabilityMessage("geist")).toBeNull();
    expect(getTypefaceAvailabilityMessage("inter")).toBeNull();
    expect(getTypefaceAvailabilityMessage("system")).toBeNull();
  });

  it("keeps reduced feedback brief and non-transforming while off removes all motion", () => {
    expect(motionTokens).toContain("--nova-motion-duration-reduced-feedback: 120ms;");
    expect(motionTokens).toContain("transition-property: color, background-color, border-color, outline-color, box-shadow, opacity, fill, stroke, text-decoration-color !important;");
    expect(motionTokens).toContain(':root[data-motion="reduced"] *::after');
    expect(motionTokens).toContain(':root[data-motion="off"] *::after');
    expect(motionTokens).toContain("animation: none !important;");
    expect(motionTokens).toContain("transition: none !important;");
  });

  it("lets prefers-reduced-motion override the app's reduced feedback mode", () => {
    expect(motionReset).toContain("@media (prefers-reduced-motion: reduce)");
    expect(motionReset).toContain(':root[data-motion="reduced"] *');
    expect(motionReset).toContain("transition: none !important;");
  });
});

function colorContrast(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function themeSurfaces(theme: "light" | "dark", accent: string): string[] {
  const canvas = theme === "light" ? "#f3f6fc" : "#1a212c";
  const neutralSurfaces = theme === "light"
    ? ["#ffffff", "#eef3fa"]
    : ["#242d39", "#2a3544", "#202a37"];
  const subtleMix = theme === "light" ? 0.1 : 0.16;
  return [canvas, ...neutralSurfaces, mixHex(canvas, accent, subtleMix)];
}

function mixHex(source: string, target: string, amount: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const from = Number.parseInt(source.slice(offset, offset + 2), 16);
    const to = Number.parseInt(target.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
