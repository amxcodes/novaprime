const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require(path.resolve(__dirname, "../../../../server/node_modules/typescript"));
const { test } = require("node:test");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const foundationRoot = __dirname;
const tokenSource = fs.readFileSync(path.join(foundationRoot, "tokens.css"), "utf8");
const appearanceSource = fs.readFileSync(path.join(foundationRoot, "appearance.ts"), "utf8");
const {
  ACCENT_SWATCHES,
  applyAppearanceTokens,
  getAccentForeground,
  getAccentHover,
  getReadableAccentText,
} = require("./appearance.ts");

function propertyValue(source, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`));
  assert.ok(match, `Expected ${property} to be present`);
  return match[1].trim();
}

function objectBlock(source, name) {
  const match = source.match(new RegExp(`${name}:\\s*\\{([\\s\\S]*?)\\n  \\}`, "m"));
  assert.ok(match, `Expected ${name} appearance surface configuration`);
  return match[1];
}

function scalarValue(source, property) {
  const match = source.match(new RegExp(`${property}:\\s*"([^"]+)"`));
  assert.ok(match, `Expected ${property} to be present`);
  return match[1];
}

function numberValue(source, property) {
  const match = source.match(new RegExp(`${property}:\\s*([0-9.]+)`));
  assert.ok(match, `Expected ${property} to be present`);
  return Number(match[1]);
}

function arrayValues(source, property) {
  const match = source.match(new RegExp(`${property}:\\s*\\[([^\\]]*)\\]`));
  assert.ok(match, `Expected ${property} to be present`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(source, target, amount) {
  const channels = [1, 3, 5].map((offset) => {
    const from = Number.parseInt(source.slice(offset, offset + 2), 16);
    const to = Number.parseInt(target.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tokenSource.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(match, `Expected ${selector} theme tokens`);
  return match[1];
}

test("appearance contrast backdrops stay aligned with the CSS theme palette", () => {
  const light = objectBlock(appearanceSource, "light");
  const dark = objectBlock(appearanceSource, "dark");
  const themes = [
    {
      name: "light",
      appearance: light,
      css: cssBlock(':root,\n:root[data-theme="light"]'),
      canvasToken: "--nova-palette-canvas-light",
      surfaceTokens: ["--nova-palette-surface-light", "--nova-palette-surface-subtle-light"],
      mixPercent: "10%",
    },
    {
      name: "dark",
      appearance: dark,
      css: cssBlock(':root[data-theme="dark"]'),
      canvasToken: "--nova-palette-canvas-dark",
      surfaceTokens: ["--nova-palette-surface-dark", "--nova-palette-surface-subtle-dark", "--nova-palette-surface-raised-dark"],
      mixPercent: "16%",
    },
  ];

  for (const theme of themes) {
    assert.equal(scalarValue(theme.appearance, "canvas"), propertyValue(tokenSource, theme.canvasToken));
    assert.deepEqual(
      arrayValues(theme.appearance, "surfaces"),
      theme.surfaceTokens.map((token) => propertyValue(tokenSource, token)),
    );
    const mix = numberValue(theme.appearance, "subtleAccentMix");
    assert.equal(mix * 100, Number.parseFloat(theme.mixPercent));
    assert.match(theme.css, new RegExp(`--nova-color-action-subtle:\\s*color-mix\\(in srgb, var\\(--nova-color-action\\) ${theme.mixPercent.replace("%", "")}\\%`));
  }
});

test("approved and custom accents keep button and selected-text contrast in both themes", () => {
  const approvedSwatches = Object.values(ACCENT_SWATCHES);
  assert.deepEqual(Object.keys(ACCENT_SWATCHES), ["nova", "forest", "teal", "lime"]);

  const themes = [
    {
      name: "light",
      canvas: propertyValue(tokenSource, "--nova-palette-canvas-light"),
      surfaces: [
        propertyValue(tokenSource, "--nova-palette-surface-light"),
        propertyValue(tokenSource, "--nova-palette-surface-subtle-light"),
      ],
      subtleMix: 0.1,
    },
    {
      name: "dark",
      canvas: propertyValue(tokenSource, "--nova-palette-canvas-dark"),
      surfaces: [
        propertyValue(tokenSource, "--nova-palette-surface-dark"),
        propertyValue(tokenSource, "--nova-palette-surface-subtle-dark"),
        propertyValue(tokenSource, "--nova-palette-surface-raised-dark"),
      ],
      subtleMix: 0.16,
    },
  ];

  const accents = [...approvedSwatches, "#ff7a00", "#5b4bdb", "#f4e641", "#111111", "#fefefe"];
  for (const accent of accents) {
    const foreground = getAccentForeground(accent);
    const hover = getAccentHover(accent);
    assert.ok(contrastRatio(foreground, accent) >= 4.5, `${accent} button label contrast`);
    assert.ok(contrastRatio(foreground, hover) >= 4.5, `${accent} hover label contrast`);

    for (const theme of themes) {
      const subtleSelection = mixHex(theme.canvas, accent, theme.subtleMix);
      const text = getReadableAccentText(accent, theme.name, accent);
      const hoverText = getReadableAccentText(hover, theme.name, accent);
      for (const backdrop of [theme.canvas, ...theme.surfaces, subtleSelection]) {
        assert.ok(contrastRatio(text, backdrop) >= 4.5, `${accent} ${theme.name} selected text on ${backdrop}`);
        assert.ok(contrastRatio(hoverText, backdrop) >= 4.5, `${accent} ${theme.name} hover text on ${backdrop}`);
      }
    }
  }
});

test("appearance changes replace document-root theme and accent tokens instead of leaving a stale custom accent", () => {
  const properties = new Map();
  const root = {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
  };
  const previousDocument = global.document;
  global.document = { documentElement: root };

  try {
    applyAppearanceTokens({
      theme: "dark",
      accent: "custom",
      customAccent: "#ff7a00",
      density: "compact",
      typeScale: "large",
      font: "system",
      contrast: "high",
      motion: "reduced",
      surface: "soft",
      contentWidth: "wide",
    });
    assert.deepEqual(root.dataset, {
      theme: "dark",
      accent: "custom",
      density: "compact",
      typeScale: "large",
      font: "system",
      contrast: "high",
      motion: "reduced",
      surface: "soft",
      contentWidth: "wide",
    });
    assert.equal(properties.get("--nova-user-accent"), "#ff7a00");
    assert.equal(properties.get("--nova-user-accent-hover"), getAccentHover("#ff7a00"));

    applyAppearanceTokens({
      theme: "light",
      accent: "nova",
      customAccent: "#126a52",
      density: "comfortable",
      typeScale: "default",
      font: "geist",
      contrast: "system",
      motion: "system",
      surface: "standard",
      contentWidth: "comfortable",
    });
    assert.equal(root.dataset.theme, "light");
    assert.equal(root.dataset.accent, "nova");
    assert.equal(properties.get("--nova-user-accent"), ACCENT_SWATCHES.nova);
    assert.equal(properties.get("--nova-user-accent-contrast"), getAccentForeground(ACCENT_SWATCHES.nova));
    assert.notEqual(properties.get("--nova-user-accent"), "#ff7a00");
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});
