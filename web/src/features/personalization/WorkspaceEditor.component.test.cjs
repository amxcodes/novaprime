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
const { WorkspaceEditor, workspaceHomeDestinationOptions, workspaceHomePreferenceValue } = require("./WorkspaceEditor.tsx");

const baseProps = {
  destinations: [
    { id: "today", label: "My Day", group: "Core" },
    { id: "people", label: "People", group: "Manage" },
  ],
  homeView: "today",
  pinnedDestinationIds: ["today"],
  modules: [
    { id: "attendance", label: "Attendance", enabled: true },
    { id: "assignments", label: "Assignments", enabled: true },
  ],
  writable: true,
  saveStatus: "idle",
  onHomeViewChange() {},
  onPinChange() {},
  onMoveDestination() {},
  onModuleChange() {},
  onMoveModule() {},
  onReset() {},
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(WorkspaceEditor, { ...baseProps, ...overrides }));
}

test("home destinations use a labeled custom combobox and keep only host-authorized choices", () => {
  const html = render();
  assert.match(html, /<section[^>]*aria-labelledby="[^\"]+-title"/);
  assert.match(html, /<h2[^>]*>Workspace<\/h2>/);
  assert.doesNotMatch(html, /<h1\b/);
  assert.equal((html.match(/<h2\b/g) || []).length, 1);
  assert.deepEqual([...html.matchAll(/<h3\b[^>]*>([^<]+)<\/h3>/g)].map((match) => match[1]), ["Home page", "Navigation", "My Day"]);
  assert.match(html, /<label[^>]*for="[^"]+-home"[^>]*><span>Open NOVA to<\/span>/);
  assert.match(html, /role="combobox"[^>]*value="My Day"/);
  assert.doesNotMatch(html, /<select\b/);
  assert.deepEqual(workspaceHomeDestinationOptions(baseProps.destinations, false), [
    { value: "auto", label: "Use NOVA’s best available page" },
    { value: "today", label: "My Day" },
    { value: "people", label: "People" },
  ]);
  assert.equal(workspaceHomePreferenceValue("auto"), "auto");
  assert.equal(workspaceHomePreferenceValue("people"), "people");
  assert.equal(workspaceHomePreferenceValue("unavailable"), null);
  assert.equal(workspaceHomePreferenceValue(""), null);
});

test("an unavailable saved destination remains visibly selected but disabled while authorized choices remain available", () => {
  const html = render({ homeView: "restricted-destination" });
  const options = workspaceHomeDestinationOptions(baseProps.destinations, true);

  assert.match(html, /role="combobox"[^>]*value="Saved page unavailable to this role"/);
  assert.match(html, /Your saved page is unavailable to this role\. It stays saved until you choose another page\./);
  assert.deepEqual(options.find((option) => option.value === "unavailable"), {
    value: "unavailable",
    label: "Saved page unavailable to this role",
    disabled: true,
  });
  assert.ok(options.some((option) => option.value === "auto"));
  assert.ok(options.some((option) => option.value === "people"));
  assert.doesNotMatch(html, /restricted-destination/);
});

test("read-only workspaces keep the custom home control disabled", () => {
  const html = render({ writable: false });
  assert.match(html, /<input(?=[^>]*id="[^"]+-home")(?=[^>]*role="combobox")(?=[^>]*disabled="")[^>]*>/);
});

test("a preference conflict disables home, pin, reorder, module, reset, and retry actions", () => {
  const html = render({
    blockedByConflict: true,
    saveStatus: "error",
    error: "Preference revision conflict.",
    onRetry() {},
  });

  assert.match(html, /Preferences changed elsewhere\./);
  assert.match(html, /Resolve the saved preference conflict in Appearance before editing these settings\./);
  assert.match(html, /<input(?=[^>]*id="[^"]+-home")(?=[^>]*role="combobox")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /<input(?=[^>]*id="[^"]+-pin-people")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /<input(?=[^>]*id="[^"]+-module-attendance")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /<button(?=[^>]*aria-label="Move People up")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /<button(?=[^>]*aria-label="Move Assignments up")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /<button(?=[^>]*aria-label="Move Assignments down")(?=[^>]*disabled="")[^>]*>/);
  assert.match(html, /<button(?=[^>]*disabled="")[^>]*><span>Reset workspace<\/span><\/button>/);
  assert.doesNotMatch(html, /Try again|Preference revision conflict\./);
});

test("omitted and false conflict props preserve the existing editable behavior", () => {
  for (const overrides of [{}, { blockedByConflict: false }]) {
    const html = render({ ...overrides, saveStatus: "error", onRetry() {} });

    assert.doesNotMatch(html, /Preferences changed elsewhere\.|Resolve the saved preference conflict/);
    assert.doesNotMatch(html, /<input(?=[^>]*id="[^"]+-home")(?=[^>]*role="combobox")(?=[^>]*disabled="")[^>]*>/);
    assert.doesNotMatch(html, /<input(?=[^>]*id="[^"]+-pin-people")(?=[^>]*disabled="")[^>]*>/);
    assert.doesNotMatch(html, /<input(?=[^>]*id="[^"]+-module-attendance")(?=[^>]*disabled="")[^>]*>/);
    assert.doesNotMatch(html, /<button(?=[^>]*aria-label="Move People up")(?=[^>]*disabled="")[^>]*>/);
    assert.doesNotMatch(html, /<button(?=[^>]*aria-label="Move Assignments up")(?=[^>]*disabled="")[^>]*>/);
    assert.doesNotMatch(html, /<button(?=[^>]*disabled="")[^>]*><span>Reset workspace<\/span><\/button>/);
    assert.match(html, /Try again/);
  }
});

test("announces only workspace save state, keeping retry controls outside the live region", () => {
  const html = render({ saveStatus: "error", onRetry() {} });
  const statusStart = html.indexOf('<span role="status" aria-live="polite" aria-atomic="true">');
  const statusEnd = html.indexOf("</span>", statusStart);
  const retry = html.indexOf("Try again");

  assert.ok(statusStart >= 0);
  assert.ok(statusEnd > statusStart);
  assert.ok(retry > statusEnd);
  assert.doesNotMatch(html, /class="[^"]+statusRow" aria-live=/);
});
