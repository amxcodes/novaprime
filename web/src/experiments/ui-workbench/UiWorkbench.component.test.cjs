const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
const { UiWorkbench } = require("./UiWorkbench.tsx");
const repoRoot = path.resolve(__dirname, "../../../..");
const webRoot = path.join(repoRoot, "web");

test("workbench composes shared components with labeled examples and feedback states", () => {
  const html = renderToStaticMarkup(React.createElement(UiWorkbench));

  assert.match(html, /<h1[^>]*>Design system workbench<\/h1>/);
  assert.match(html, /<h2[^>]*>Appearance preview<\/h2>/);
  for (const label of [
    "Theme", "Accent color", "Density", "Text size", "Typeface", "Contrast", "Motion", "Surface style", "Content width",
  ]) assert.match(html, new RegExp(`>${label}<\\/span>`));
  assert.match(html, /These controls change this development preview only\. They are not saved\./);
  assert.match(html, /Work email/);
  assert.match(html, /Managed setting/);
  assert.match(html, /Add a short reason before continuing\./);
  assert.match(html, /Attendance mode/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /Complete/);
  assert.match(html, /role="alert"[^>]*aria-live="assertive"/);
  assert.match(html, /Nothing needs your attention/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  const source = fs.readFileSync(path.join(__dirname, "UiWorkbench.tsx"), "utf8");
  assert.match(source, /applyAppearanceTokens\(appearance\)/);
  assert.doesNotMatch(source, /document\.documentElement\.dataset\./);
  assert.doesNotMatch(source, /fetch\s*\(|\.save(?:Appearance|Workspace)?\s*\(/);
  assert.match(source, /appearanceAttributes\.map\(\(name\) => \[name, root\.getAttribute\(name\)\]/);
  assert.match(source, /appearanceProperties\.map\(\(name\) => \[/);
  assert.match(source, /font: \[/);
  assert.doesNotMatch(source, /value: "inter"/);
  assert.match(source, /value: "custom", label: "Custom"/);
  assert.match(source, /isAppearanceHexColor\(customAccentDraft\)/);
  assert.match(source, /pattern="#\[\\da-fA-F\]\{6\}"/);
  assert.match(source, /className=\{styles\.accentSwatch\}/);
  assert.match(source, /setCustomAccentDraft\(appearance\.customAccent\)/);
});

test("workbench layout styles respond to the content container and small viewport padding", () => {
  const css = fs.readFileSync(path.join(__dirname, "UiWorkbench.module.css"), "utf8");
  const compactContainer = css.match(/@container ui-workbench\s*\(max-width:\s*34rem\)\s*\{([\s\S]*?)\n\}/)?.[1];

  assert.match(css, /\.frame\s*\{[^}]*container:\s*ui-workbench\s*\/\s*inline-size;/s);
  assert.ok(compactContainer);
  assert.match(compactContainer, /\.fieldGrid,\s*\.surfaceGrid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.doesNotMatch(compactContainer, /\.page\s*\{/);
  assert.match(css, /\.appearanceGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
  assert.match(css, /@container ui-workbench \(max-width: 52rem\)[\s\S]*?\.appearanceGrid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(compactContainer, /\.appearanceGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
  assert.match(css, /@container ui-workbench \(max-width: 20rem\)[\s\S]*?\.appearanceGrid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(css, /@media\s*\(max-width:\s*34rem\)\s*\{\s*\.page\s*\{[^}]*padding:\s*var\(--nova-space-3\);/s);
  assert.match(css, /@media\s*\(any-pointer:\s*coarse\)[\s\S]*?\.accentFieldRow\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\);/);
  assert.match(css, /\.accentFieldRow:focus-within\s*\{[^}]*--nova-color-focus/s);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.accentFieldRow/);
});

test("the global reset does not force horizontal overflow at a 320px viewport", () => {
  const reset = fs.readFileSync(path.join(repoRoot, "web", "src", "design-system", "foundations", "reset.css"), "utf8");

  assert.doesNotMatch(reset, /html\s*\{[^}]*min-width\s*:/s);
  assert.doesNotMatch(reset, /body\s*\{[^}]*min-width\s*:/s);
});

test("development workbench is excluded from production Rollup inputs and emitted output", { timeout: 120_000 }, () => {
  const configPath = path.join(repoRoot, "vite.config.ts");
  const config = fs.readFileSync(configPath, "utf8");
  const inputs = config.match(/rollupOptions:\s*\{\s*input:\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(inputs, "production config keeps an explicit HTML entry map");
  assert.doesNotMatch(inputs[1], /ui-workbench/i);

  const devHtml = path.join(webRoot, "ui-workbench.html");
  const devEntry = path.join(webRoot, "src/experiments/ui-workbench/main.tsx");
  assert.ok(fs.existsSync(devHtml));
  assert.ok(fs.existsSync(devEntry));

  const viteRoot = path.dirname(require.resolve("vite/package.json"));
  const viteCli = path.join(viteRoot, "bin/vite.js");
  const temporaryPrefix = "nova-ui-workbench-production-";
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), temporaryPrefix));
  try {
    execFileSync(process.execPath, [
      viteCli,
      "build",
      "--config",
      configPath,
      "--configLoader",
      "runner",
      "--outDir",
      outputDirectory,
      "--emptyOutDir",
    ], { cwd: repoRoot, stdio: "pipe", maxBuffer: 4 * 1024 * 1024 });

    const emittedFiles = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolutePath);
        else emittedFiles.push(absolutePath);
      }
    };
    visit(outputDirectory);

    assert.ok(emittedFiles.some((file) => path.basename(file) === "index.html"));
    assert.equal(emittedFiles.some((file) => /ui-workbench/i.test(path.relative(outputDirectory, file))), false);
    assert.equal(emittedFiles.some((file) => path.basename(file) === "ui-workbench.html"), false);
    const emittedText = emittedFiles
      .filter((file) => /\.(?:html|js|css)$/i.test(file))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    assert.doesNotMatch(emittedText, /Design system workbench/);
  } finally {
    const resolvedOutput = path.resolve(outputDirectory);
    const resolvedTempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolvedOutput.startsWith(resolvedTempRoot), "only remove the generated temporary build directory");
    assert.ok(path.basename(resolvedOutput).startsWith(temporaryPrefix), "temporary output name must match this test");
    fs.rmSync(resolvedOutput, { recursive: true, force: true });
  }
});
