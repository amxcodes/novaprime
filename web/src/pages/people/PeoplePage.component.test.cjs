const assert = require("node:assert/strict");
const fs = require("node:fs");
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
const { PeoplePage } = require("./PeoplePage.tsx");

function render(mode) {
  return renderToStaticMarkup(React.createElement(PeoplePage, { mode }));
}

test("People route frame provides one mode-specific page heading and a stable loading feature slot", () => {
  for (const [mode, title] of [["directory", "People"], ["history", "Person history"]]) {
    const html = render(mode);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.match(html, new RegExp(`<h1[^>]*><span id="people-page-title">${title}<\\/span><\\/h1>`));
    assert.match(html, /id="feedback" class="notice [^"]+" role="status" hidden=""/);
    const loadingText = mode === "history" ? "Loading person history…" : "Loading people…";
    assert.ok(html.includes(`<div id="people-content"><p role="status">${loadingText}</p></div>`));
    assert.doesNotMatch(html, /<main\b|class="panel/);
  }
});

test("People route frame uses a narrow, token-based responsive composition", () => {
  const css = fs.readFileSync(path.join(__dirname, "PeoplePage.module.css"), "utf8");
  const page = css.match(/\.page\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(page, /container:\s*people-page\s*\/\s*inline-size/);
  assert.match(page, /width:\s*100%;/);
  assert.match(page, /min-width:\s*0;/);
  assert.doesNotMatch(page, /max-width:|padding-inline:|margin-inline:/);
  assert.match(css, /@container people-page \(max-width: 60rem\)/);
  assert.match(css, /@container people-page \(max-width: 40rem\)/);
  assert.match(css, /var\(--nova-color-border\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
});

test("People host delegates composition while retaining route ownership and popstate integration", () => {
  const host = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8");
  const start = host.indexOf("async function renderPeople(lifetime)");
  const end = host.indexOf("\nasync function renderAvailability(", start);
  const people = host.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(people, /isPeopleDirectoryContext\(personId, window\.history\.state, peopleWorkspaceSessionId\)/);
  assert.match(people, /activePeopleWorkspace = await peoplePageRoute\(/);
  assert.doesNotMatch(people, /pageApi\(|window\.history\.pushState|createPeopleHistoryRoute/);

  const route = fs.readFileSync(path.join(__dirname, "../../../app/people-page-route.js"), "utf8");
  assert.match(route, /import\("\.\.\/src\/pages\/people\/PeoplePage\.tsx"\)/);
  assert.match(route, /PeoplePage, \{ mode: directoryContext \? "directory" : "history" \}/);
  assert.match(route, /import\("\.\.\/src\/features\/people\/index\.ts"\)/);
  assert.match(route, /directoryContext \? loadDirectoryRoute\(\) : Promise\.resolve\(null\)/);
  assert.match(route, /Promise\.all\(\[loadHistoryRoute\(\), loadLifecycleHost\(\)\]\)/);
  assert.match(route, /createPeopleHistoryRoute\(/);
  assert.match(route, /readPerson: \(id\) => readWithStatus\("\/api\/people\/" \+ encodeURIComponent\(id\)/);
  assert.match(route, /createPeopleDirectoryRoute\(/);
  assert.match(route, /mountReactIsland\(target, PeopleWorkspace/);
  assert.match(route, /await route\.select\(id, directoryPerson\)/);
  assert.match(route, /void selectHistoryPerson\(personId\)/);
  assert.match(route, /void selectHistoryPerson\(nextPersonId, person\)/);
  assert.match(route, /novaPeopleWorkspace: \{[\s\S]*?\.\.\.safeHistoryState\.novaPeopleWorkspace,[\s\S]*?fromDirectory: true,[\s\S]*?sessionId: host\.getWorkspaceSessionId\(\)/);
  assert.doesNotMatch(route, /mountReactIsland\(target, PersonHistory|mountReactIsland\(target, PeopleDirectory/);

  const render = host.slice(host.indexOf("function render() {"), host.indexOf("\nwindow.addEventListener(\"popstate\"", host.indexOf("function render() {")));
  const popstate = host.slice(host.indexOf("window.addEventListener(\"popstate\""));
  assert.match(render, /activePeopleWorkspace = null/);
  assert.match(popstate, /activePeopleWorkspace\?\.handlePopState\(event\)/);
});

test("feedback updates keep the page's CSS Module class while applying message tone", () => {
  const host = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8");
  const start = host.indexOf("function showFeedback()");
  const end = host.indexOf("\nfunction attachNavigation(", start);
  const feedback = host.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(feedback, /element\.classList\.add\("notice"\)/);
  assert.match(feedback, /element\.classList\.remove\("error", "warning"\)/);
  assert.match(feedback, /element\.classList\.add\(state\.messageKind\)/);
  assert.doesNotMatch(feedback, /element\.className\s*=/);
});
