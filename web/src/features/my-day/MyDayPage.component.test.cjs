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
const { MyDayPage } = require("./MyDayPage.tsx");

function render(overrides = {}) {
  const props = {
    modules: [
      { id: "attendance", presentation: "card", title: "Attendance", description: "Today's status." },
      { id: "assignments", presentation: "card", title: "My work", description: "Assigned work." },
      { id: "timeline", presentation: "card", title: "Today’s timeline", description: "Work events.", wide: true },
      { id: "leave", presentation: "island" },
      { id: "wfh", presentation: "island" },
    ],
    onCustomize: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(MyDayPage, props));
}

test("renders the host-supplied module order and stable empty child-island slots", () => {
  const markup = render();
  const positions = ["attendance", "assignments", "timeline", "leave", "wfh"]
    .map((id) => markup.indexOf(`data-my-day-module="${id}"`));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  for (const id of ["attendance", "assignments", "timeline", "leave", "wfh"]) {
    assert.match(markup, new RegExp(`data-my-day-slot="${id}"`));
  }
  assert.match(markup, /data-my-day-slot="leave"[^>]*><\/div>/);
  assert.match(markup, /data-my-day-slot="wfh"[^>]*><\/div>/);
  assert.match(markup, /data-my-day-slot="attendance"[^>]*><p role="status">Loading…<\/p><\/div>/);
  assert.doesNotMatch(markup, /data-my-day-slot="(?:attendance|assignments|timeline)"[^>]*aria-busy/);
});

test("renders only modules supplied by the route host and leaves workspace routing to navigation", () => {
  const markup = render({
    modules: [{ id: "attendance", presentation: "card", title: "Attendance", description: "Today's status." }],
  });

  assert.match(markup, /Attendance/);
  assert.doesNotMatch(markup, /My work|Today’s timeline|Request leave|WFH/);
  assert.doesNotMatch(markup, /Quick access|People|Work/);
});

test("empty modules preserve the Customize My Day action", () => {
  const markup = render({ modules: [] });

  assert.match(markup, /Your My Day modules are hidden\./);
  assert.match(markup, /Choose the modules you want in Settings\./);
  assert.match(markup, /Customize My Day/);
  assert.doesNotMatch(markup, /my-day-shortcuts-heading|Quick access/);
});

test("the route mounts each independent island in the feature-owned slot", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "../../../app/my-day-page-route.ts"), "utf8");

  assert.match(app, /import \{ MyDayPage \} from "\.\/src\/features\/my-day\/MyDayPage\.tsx"/);
  assert.match(app, /await mountMyDayPageRoute\(\{/);
  assert.match(app, /findModuleTarget: \(id\) => app\.querySelector\(`\[data-my-day-slot="\$\{id\}"\]`\)/);
  assert.match(route, /mountReactIsland\(pageRoot, MyDayPage,/);
  assert.match(route, /requestRoute\.renderLeaveRequestPanel\(moduleTarget\("leave"\)\)/);
  assert.match(route, /requestRoute\.renderWfhRequestPanel\(moduleTarget\("wfh"\)\)/);
  assert.match(route, /mountReactIsland\(attendanceTarget,/);
  assert.match(route, /mountReactIsland\(assignmentsTarget,/);
  assert.match(route, /mountReactIsland\(timelineTarget,/);
});

test("feature styles stay locally scoped and adapt to available page width", () => {
  const css = fs.readFileSync(path.join(__dirname, "MyDayPage.module.css"), "utf8");
  const legacyCss = fs.readFileSync(path.join(__dirname, "LegacyMyDayPage.module.css"), "utf8");

  assert.doesNotMatch(css, /:global\(/);
  assert.match(css, /container: my-day-page \/ inline-size/);
  assert.match(css, /@container my-day-page \(max-width: 40rem\)/);
  assert.doesNotMatch(legacyCss, /:global\(/);
});
