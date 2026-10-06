export interface PersonalAppearance {
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
}

export const ACCENT_SWATCHES = {
  nova: "#3d6bff",
  forest: "#27674a",
  teal: "#2b7489",
  lime: "#778642",
} as const;

const DARK_ACCENT_SWATCHES = {
  nova: "#3d6bff",
  forest: "#89d5a4",
  teal: "#78c9dc",
  lime: "#c4d584",
} as const;

const APPEARANCE_SURFACES = {
  light: {
    canvas: "#f3f6fc",
    surfaces: ["#ffffff", "#eef3fa"],
    subtleAccentMix: 0.1,
  },
  dark: {
    canvas: "#1a212c",
    surfaces: ["#242d39", "#2a3544", "#242d39"],
    subtleAccentMix: 0.16,
  },
} as const;

/** Apply validated, persisted presentation choices at the single document boundary. */
export function applyAppearanceTokens(appearance: PersonalAppearance): void {
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;
  root.dataset.accent = appearance.accent;
  root.dataset.density = appearance.density;
  root.dataset.typeScale = appearance.typeScale;
  root.dataset.font = appearance.font;
  root.dataset.contrast = appearance.contrast;
  root.dataset.motion = appearance.motion;
  root.dataset.surface = appearance.surface;
  root.dataset.contentWidth = appearance.contentWidth;

  const accentOverrides = [
    "--nova-user-accent-light", "--nova-user-accent-dark",
    "--nova-user-accent-edge-light", "--nova-user-accent-edge-dark",
    "--nova-user-accent-contrast-light", "--nova-user-accent-contrast-dark",
    "--nova-user-accent-hover-light", "--nova-user-accent-hover-dark",
    "--nova-user-accent-text-light", "--nova-user-accent-text-light-hover",
    "--nova-user-accent-text-dark", "--nova-user-accent-text-dark-hover",
    "--nova-user-focus-light", "--nova-user-focus-dark",
    "--nova-user-accent-subtle-light", "--nova-user-accent-subtle-dark",
  ];
  for (const property of accentOverrides) root.style.removeProperty(property);

  // The default preset inherits the exact Figma semantic palette; only an
  // explicitly selected non-default accent writes account-specific overrides.
  if (appearance.accent === "nova") return;

  const requested = appearance.accent === "custom"
    ? appearance.customAccent
    : ACCENT_SWATCHES[appearance.accent];
  const selectedAccent = /^#[\da-f]{6}$/i.test(requested) ? requested.toLowerCase() : ACCENT_SWATCHES.nova;
  const lightAccent = selectedAccent;
  const darkAccent = appearance.accent === "custom"
    ? selectedAccent
    : DARK_ACCENT_SWATCHES[appearance.accent];
  const lightHover = getAccentHover(lightAccent);
  const darkHover = getAccentHover(darkAccent);
  root.style.setProperty("--nova-user-accent-light", lightAccent);
  root.style.setProperty("--nova-user-accent-dark", darkAccent);
  root.style.setProperty("--nova-user-accent-edge-light", mix(lightAccent, "#243146", 0.18));
  root.style.setProperty("--nova-user-accent-edge-dark", mix(darkAccent, "#f0f3f8", 0.18));
  root.style.setProperty("--nova-user-accent-contrast-light", getAccentForeground(lightAccent));
  root.style.setProperty("--nova-user-accent-contrast-dark", getAccentForeground(darkAccent));
  root.style.setProperty("--nova-user-accent-hover-light", lightHover);
  root.style.setProperty("--nova-user-accent-hover-dark", darkHover);
  root.style.setProperty("--nova-user-accent-text-light", getReadableAccentText(lightAccent, "light"));
  root.style.setProperty("--nova-user-accent-text-light-hover", getReadableAccentText(lightHover, "light", lightAccent));
  root.style.setProperty("--nova-user-accent-text-dark", getReadableAccentText(darkAccent, "dark"));
  root.style.setProperty("--nova-user-accent-text-dark-hover", getReadableAccentText(darkHover, "dark", darkAccent));
  root.style.setProperty("--nova-user-focus-light", getReadableAccentText(lightAccent, "light"));
  root.style.setProperty("--nova-user-focus-dark", getReadableAccentText(darkAccent, "dark"));
  root.style.setProperty("--nova-user-accent-subtle-light", mix("#f3f6fc", lightAccent, 0.1));
  root.style.setProperty("--nova-user-accent-subtle-dark", mix("#1a212c", darkAccent, 0.16));
}

export function getAccentForeground(hex: string): "#000000" | "#ffffff" {
  if (!/^#[\da-f]{6}$/i.test(hex)) return "#ffffff";
  const luminance = relativeLuminance(hex);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return blackContrast > whiteContrast ? "#000000" : "#ffffff";
}

/** Move the hover fill away from its button text color so its contrast cannot shrink. */
export function getAccentHover(hex: string): string {
  const accent = /^#[\da-f]{6}$/i.test(hex) ? hex.toLowerCase() : ACCENT_SWATCHES.nova;
  const foreground = getAccentForeground(accent);
  return mix(accent, foreground === "#000000" ? "#ffffff" : "#000000", 0.1);
}

/** Keep accent-colored text readable on canvas, raised/soft surfaces, and accent selections. */
export function getReadableAccentText(
  hex: string,
  theme: "light" | "dark",
  selectionAccent = hex,
): string {
  const accent = /^#[\da-f]{6}$/i.test(hex) ? hex.toLowerCase() : ACCENT_SWATCHES.nova;
  const palette = APPEARANCE_SURFACES[theme];
  const selection = /^#[\da-f]{6}$/i.test(selectionAccent) ? selectionAccent.toLowerCase() : accent;
  const backdrops = [
    palette.canvas,
    ...palette.surfaces,
    mix(palette.canvas, selection, palette.subtleAccentMix),
  ];
  const accessibleTarget = theme === "light" ? "#000000" : "#ffffff";
  return ensureContrast(accent, backdrops, accessibleTarget);
}

function ensureContrast(hex: string, backdrops: readonly string[], target: string, minimumRatio = 4.6): string {
  if (meetsContrast(hex, backdrops, minimumRatio)) return hex;
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mix(hex, target, step / 100);
    if (meetsContrast(candidate, backdrops, minimumRatio)) return candidate;
  }
  return target;
}

function meetsContrast(hex: string, backdrops: readonly string[], minimumRatio: number): boolean {
  return backdrops.every((backdrop) => contrastRatio(hex, backdrop) >= minimumRatio);
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function mix(source: string, target: string, amount: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const from = Number.parseInt(source.slice(offset, offset + 2), 16);
    const to = Number.parseInt(target.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}
