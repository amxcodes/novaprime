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
const { SearchableSelect } = require("./SearchableSelect.tsx");

function render(value = "assignment-1") {
  return renderToStaticMarkup(React.createElement("form", null, React.createElement(SearchableSelect, {
    id: "assignment",
    name: "assignmentId",
    label: "Assignment",
    hint: "Choose an eligible assignment.",
    required: true,
    value,
    options: [
      { value: "assignment-1", label: "Prepare report", description: "Client · Delivery" },
      { value: "assignment-2", label: "Review request" },
    ],
    placeholder: "Select an assignment",
    emptyMessage: "No eligible assignments match this search.",
    clearLabel: "Clear assignment selection",
    onChange() {},
  })));
}

function renderRemoteSelectedOption() {
  return renderToStaticMarkup(React.createElement(SearchableSelect, {
    id: "remote-person",
    label: "Person",
    value: "person-1",
    options: [],
    searchMode: "remote",
    onSearch: async () => [],
    selectedOption: { value: "person-1", label: "Aman Lee" },
    placeholder: "Search people",
    emptyMessage: "No people match.",
    onChange() {},
  }));
}

test("renders an accessible labeled combobox and submits the selected ID through a hidden named value", () => {
  const html = render();
  assert.match(html, /<label[^>]*for="assignment"[^>]*><span>Assignment<\/span>/);
  assert.match(html, /<input type="hidden" name="assignmentId" value="assignment-1"/);
  assert.match(html, /id="assignment"[^>]*role="combobox"/);
  assert.match(html, /aria-required="true"/);
  assert.match(html, /placeholder="Select an assignment"/);
  assert.match(html, /Choose an eligible assignment\./);
  assert.doesNotMatch(html, /<select\b/);
});

test("preserves an empty named value so hosts can validate against their authorized options", () => {
  const html = render("");
  assert.match(html, /<input type="hidden" name="assignmentId" value=""/);
  assert.match(html, /aria-required="true"/);
});

test("remote mode keeps its selected label from the explicit selected option", () => {
  const html = renderRemoteSelectedOption();
  assert.match(html, /id="remote-person"[^>]*value="Aman Lee"/);
});

test("the shared popup owns tokenized responsive and forced-colors styling", () => {
  const css = fs.readFileSync(require.resolve("./SearchableSelect.module.css"), "utf8");
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /--nova-layer-menu/);
  assert.match(css, /--nova-control-touch-target/);
  assert.match(css, /\.option\s*\{\s*display:\s*flex;\s*min-width:\s*0;\s*min-height:\s*var\(--nova-control-height\)/);
  assert.match(css, /@media\s*\(any-pointer:\s*coarse\)[\s\S]*?\.option\s*\{\s*min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(css, /Highlight/);
  assert.match(css, /-webkit-appearance:\s*none/);
  assert.match(css, /appearance:\s*none/);
  assert.match(css, /\.choiceShell input\[aria-expanded="true"\]\s*\{[^}]*background:\s*var\(--nova-color-action-subtle\)[^}]*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/s);
  assert.match(css, /\.option\s*\{[^}]*border-radius:\s*var\(--nova-radius-option\)/s);
  assert.match(css, /\.option\[data-active="true"\]\s*\{\s*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/);
  assert.match(css, /@media\s*\(any-pointer:\s*coarse\)[\s\S]*?min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
});

test("the clear action stays inside the select control at pointer and touch sizes", () => {
  const css = fs.readFileSync(require.resolve("./SearchableSelect.module.css"), "utf8");
  const clearChoice = css.match(/\.clearChoice\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(clearChoice, /inset-block:\s*0/);
  assert.doesNotMatch(clearChoice, /min-height:/);
});

test("popup touch scrolls do not trigger tap dismissal, while outside blur and selection still close", () => {
  const source = fs.readFileSync(require.resolve("./SearchableSelect.tsx"), "utf8");
  assert.match(source, /document\.addEventListener\("pointerdown", closeOnOutsidePointerDown, true\)/);
  assert.match(source, /isSearchableSelectPointerOutside\(event\.target, choiceShellRef\.current, popupRef\.current\)/);
  assert.match(source, /ref=\{popupRef\}/);
  assert.match(source, /onPointerMoveCapture=\{onPopupPointerMove\}/);
  assert.match(source, /onPointerCancelCapture=\{onPopupPointerCancel\}/);
  assert.match(source, /const shouldClose = !touchPointerMoved\.current && document\.activeElement !== inputRef\.current/);
  assert.match(source, /onBlur=\{\(\) => \{ if \(!touchPointerInsidePopup\.current\) closeAfterBlur\(\); \}\}/);
  assert.match(source, /function choose\([\s\S]*?setOpen\(false\)/);
  assert.match(source, /setActiveIndex\(findSearchableSelectBoundaryIndex\(filtered, "first"\)\)/);
  assert.match(source, /setActiveIndex\(findSearchableSelectBoundaryIndex\(filtered, "last"\)\)/);
});

test("does not route IME candidate confirmation to the active option", () => {
  const source = fs.readFileSync(require.resolve("./SearchableSelect.tsx"), "utf8");
  assert.match(source, /shouldCommitSearchableSelectSelection\(\s*event\.nativeEvent\.key,\s*event\.nativeEvent\.isComposing,\s*event\.nativeEvent\.keyCode/);
});

test("Home and End navigate options only when they cannot steal a nonempty query's caret editing", () => {
  const source = fs.readFileSync(require.resolve("./SearchableSelect.tsx"), "utf8");
  assert.match(source, /const canNavigateBoundary = shouldUseSearchableSelectBoundaryNavigation\([\s\S]*?event\.key,[\s\S]*?query,[\s\S]*?event\.nativeEvent\.isComposing/);
  assert.match(source, /canNavigateBoundary && event\.key === "Home"/);
  assert.match(source, /canNavigateBoundary && event\.key === "End"/);
});

test("remote search is opt-in, debounced, race guarded, and displays server results without local filtering", () => {
  const source = fs.readFileSync(require.resolve("./SearchableSelect.tsx"), "utf8");
  assert.match(source, /searchMode: "remote"/);
  assert.match(source, /onSearch: \(query: string\) => Promise<readonly SearchableSelectOption\[\]>/);
  assert.match(source, /searchMode === "remote"\s*\? currentRemoteState\?\.status === "ready" \? currentRemoteState\.options : \[\]/);
  assert.match(source, /window\.setTimeout\(\(\) =>/);
  assert.match(source, /isCurrentSearchableSelectRequest\(requestId\.current, currentRequestId/);
  assert.match(source, /setRemoteState\(\{ query: normalizedQuery, status: "loading", options: \[\] \}\)/);
  assert.match(source, /role="alert">\{searchErrorMessage\}/);
  assert.match(source, /currentRemoteState\?\.status === "ready" && !filtered\.length/);
  assert.match(source, /role="status" aria-live="polite">\{loadingMessage\}/);
  assert.match(source, /data-state="loading" role="status"/);
  assert.match(source, /data-state="error" role="alert"/);
  assert.match(source, /data-state="empty" role="status"/);
});

test("Enter commits the active enabled result and keeps the combobox linked to the listbox option", () => {
  const source = fs.readFileSync(require.resolve("./SearchableSelect.tsx"), "utf8");
  assert.match(source, /aria-activedescendant=\{ariaState\.activeDescendant\}/);
  assert.match(source, /shouldCommitSearchableSelectSelection\([\s\S]*?\) && open && activeOption\)\s*\{\s*event\.preventDefault\(\);\s*choose\(activeOption\);/);
});
