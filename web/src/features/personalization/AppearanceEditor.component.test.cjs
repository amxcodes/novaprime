const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AppearanceEditor } = require("./AppearanceEditor.tsx");

const baseAppearance = {
  theme: "system",
  accent: "nova",
  customAccent: "#176a43",
  density: "comfortable",
  typeScale: "default",
  font: "system",
  contrast: "system",
  motion: "system",
  surface: "standard",
  contentWidth: "comfortable",
};

function render(font = "system", overrides = {}) {
  return renderToStaticMarkup(React.createElement(AppearanceEditor, {
    appearance: { ...baseAppearance, font },
    readStatus: "ready",
    writable: true,
    saveStatus: "idle",
    revision: 1,
    onChange() {},
    onReset() {},
    onRetry() {},
    onReload() {},
    onResolveConflict() {},
    ...overrides,
  }));
}

function fontRadio(markup, value) {
  const input = markup.match(new RegExp(`<input(?=[^>]*name="[^"]+-font")(?=[^>]*value="${value}")[^>]*>`));
  assert.ok(input, `expected ${value} typeface radio`);
  return input[0];
}

test("bundled Geist and System are selectable while unconfigured Inter remains unavailable", () => {
  const html = render("system");

  assert.doesNotMatch(fontRadio(html, "geist"), /disabled=""/);
  assert.match(fontRadio(html, "inter"), /disabled=""/);
  assert.doesNotMatch(fontRadio(html, "system"), /disabled=""/);
  assert.match(fontRadio(html, "system"), /checked=""/);
  assert.match(html, /Available · NOVA’s bundled variable font\./);
  assert.match(html, /Available · Use the device sans-serif\./);
});

test("every persisted appearance field renders a complete radio group with one selected value", () => {
  const html = render();
  const expectedOptions = {
    theme: ["system", "light", "dark"],
    accent: ["nova", "forest", "teal", "lime", "custom"],
    scale: ["default", "large"],
    font: ["system", "geist", "inter"],
    density: ["comfortable", "compact"],
    surface: ["standard", "soft"],
    width: ["comfortable", "wide"],
    contrast: ["system", "high"],
    motion: ["system", "reduced", "off"],
  };

  for (const [group, expected] of Object.entries(expectedOptions)) {
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)]
      .map(([input]) => input)
      .filter((input) => new RegExp(`name="[^"]+-${group}"`).test(input));
    const values = inputs.map((input) => input.match(/\bvalue="([^"]+)"/)?.[1]);

    assert.deepEqual(values, expected, `${group} should expose all supported values in stable order`);
    assert.equal(inputs.filter((input) => /\schecked=""/.test(input)).length, 1, `${group} should select exactly one saved value`);
  }
});

test("appearance settings compose from their feature width inside split and tablet layouts", () => {
  const html = render();
  const css = fs.readFileSync(`${__dirname}/AppearanceEditor.module.css`, "utf8");
  const expanded = css.match(/@container appearance-editor \(min-width: 48rem\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const compact = css.match(/@container appearance-editor \(max-width: 36rem\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(css, /\.editor\s*\{[^}]*container:\s*appearance-editor \/ inline-size;/s);
  assert.match(html, /<section[^>]*aria-labelledby="[^\"]+-title"/);
  assert.match(html, /<h2[^>]*>Appearance<\/h2>/);
  assert.doesNotMatch(html, /<h1\b/);
  assert.equal((html.match(/<h2\b/g) || []).length, 1);
  assert.equal((html.match(/<h3\b/g) || []).length, 4);
  const conflict = render("system", { conflict: { submittedRevision: 1, currentRevision: 2 } });
  assert.match(conflict, /<h3[^>]*>Appearance changed elsewhere<\/h3>/);
  assert.equal((conflict.match(/<h2\b/g) || []).length, 1);
  assert.match(css, /\.editor\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.doesNotMatch(css.match(/\.editor\s*\{([^}]*)\}/s)?.[1] || "", /padding:|max-width:|margin-inline:/);
  assert.match(expanded, /\.layout\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(compact, /\.header\s*\{\s*flex-direction:\s*column;/);
  assert.match(compact, /\.choices\[data-columns="three"\]\s*\{\s*grid-template-columns:\s*1fr;/);
  assert.match(compact, /\.conflict\s*\{\s*flex-direction:\s*column;/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*36rem\)/);
});

test("custom accent errors are announced and an empty draft is marked required and invalid", () => {
  const html = render("system", {
    appearance: { ...baseAppearance, accent: "custom", customAccent: "" },
  });
  const input = html.match(/<input(?=[^>]*id="[^"]+-custom-accent")[^>]*>/)?.[0] || "";
  const error = html.match(/<p(?=[^>]*id="[^"]+-accent-error")[^>]*>([\s\S]*?)<\/p>/)?.[0] || "";

  assert.match(input, /aria-required="true"/);
  assert.match(input, /aria-invalid="true"/);
  assert.match(input, /aria-describedby="[^"]+-accent-help [^"]+-accent-error"/);
  assert.match(error, /role="status"/);
  assert.match(error, /aria-live="polite"/);
  assert.match(error, /Enter a color like #176a43\./);
});

test("live preview uses the same semantic action tokens as product controls", () => {
  const html = render();
  const css = fs.readFileSync(`${__dirname}/AppearanceEditor.module.css`, "utf8");
  const previewAction = html.match(/<button\b[^>]*>Continue<\/button>/)?.[0] || "";
  const previewRule = css.match(/\.previewAction\s*\{([^}]*)\}/)?.[1] || "";

  assert.ok(previewAction, "expected the appearance sample action");
  assert.doesNotMatch(previewAction, /style=/, "appearance preview colors should not be independently computed inline");
  assert.match(previewRule, /color:\s*var\(--nova-color-action-contrast\)/);
  assert.match(previewRule, /background:\s*var\(--nova-color-action\)/);
  assert.doesNotMatch(previewRule, /--preview-accent/);
});

test("announces only appearance save state, keeping retry and revision controls outside the live region", () => {
  const html = render("system", { saveStatus: "error", revision: 3 });
  const statusStart = html.indexOf('<span role="status" aria-live="polite" aria-atomic="true">');
  const statusEnd = html.indexOf("</span>", statusStart);
  const retry = html.indexOf("Try again");

  assert.ok(statusStart >= 0);
  assert.ok(statusEnd > statusStart);
  assert.ok(retry > statusEnd);
  assert.match(html, /Revision 3/);
  assert.doesNotMatch(html, /class="[^"]+statusRow" aria-live=/);
});

test("a failed preference read permits a clearly preview-only appearance draft without enabling persistence", () => {
  const html = render("system", { readStatus: "read-failed", writable: false, saveStatus: "idle" });
  const system = fontRadio(html, "system");
  const reset = html.match(/<button\b[^>]*>Reset appearance<\/button>/)?.[0] || "";

  assert.doesNotMatch(system, /disabled=""/);
  assert.doesNotMatch(reset, /disabled=""/);
  assert.match(html, /could not be loaded/);
  assert.match(html, /they will not be saved until the preferences load successfully/);
  assert.match(html, /Reloading replaces this preview with the saved settings/);
  assert.match(html, /Reload saved settings/);
  assert.doesNotMatch(html, /Your account does not currently allow/);
});

test("unsupported and access-lost preference states stay read-only and explain the actual state", () => {
  for (const [readStatus, message] of [
    ["unsupported", /not supported by the current preference schema/],
    ["access-lost", /session cannot currently read personal appearance settings/],
  ]) {
    const html = render("system", { readStatus, writable: false, saveStatus: "idle" });
    assert.match(html, /<fieldset[^>]*disabled=""/);
    assert.match(html, message);
    assert.doesNotMatch(html, /preview-only/);
  }
});

test("custom accent input meets the shared touch-target size on coarse pointers", () => {
  const css = fs.readFileSync(`${__dirname}/AppearanceEditor.module.css`, "utf8");
  const coarse = css.match(/@media\s*\(any-pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(coarse, /\.hexField\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\);/);
  assert.match(coarse, /\.textInput\s*\{[^}]*min-height:\s*calc\(var\(--nova-control-touch-target\)\s*-\s*2px\);/);
});

for (const font of ["inter"]) {
  test(`a previously saved ${font} value stays represented and can be changed to System`, () => {
    const html = render(font);
    const unavailable = fontRadio(html, font);
    const system = fontRadio(html, "system");

    assert.match(unavailable, /disabled=""/);
    assert.match(unavailable, /checked=""/);
    assert.doesNotMatch(system, /disabled=""/);
    assert.match(html, new RegExp(`${font === "geist" ? "Geist" : "Inter"} is saved`));
    assert.match(html, /device sans-serif fallback/);
    assert.match(html, /Select System to save the active device font preference\./);
  });
}
