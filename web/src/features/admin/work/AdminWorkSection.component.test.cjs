const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

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
const { AdminWorkSection, AdminWorkFeatureFailure } = require("./AdminWorkSection.tsx");

test("composes authorized Work responsibilities in the declared order", () => {
  const html = renderToStaticMarkup(React.createElement(AdminWorkSection, {
    contextCreation: React.createElement("p", null, "Context feature"),
    taskComposer: React.createElement("p", null, "Composer feature"),
    taskOperations: React.createElement("p", null, "Operations feature"),
    membershipTargets: React.createElement("p", null, "Membership feature"),
  }));
  const slots = ["context-creation", "task-composer", "task-operations", "membership-targets"]
    .map((name) => html.indexOf(`data-admin-work-slot="${name}"`));

  assert.ok(slots.every((position) => position >= 0));
  assert.deepEqual([...slots].sort((a, b) => a - b), slots);
  assert.match(html, /Client work and task operations/);
  assert.match(html, /data-admin-work-slot="task-composer"><p>Composer feature/);
});

test("omits absent slots and gives an empty authorized composition a useful state", () => {
  const partial = renderToStaticMarkup(React.createElement(AdminWorkSection, {
    taskComposer: React.createElement("p", null, "Composer feature"),
  }));
  assert.match(partial, /data-admin-work-slot="task-composer"/);
  assert.doesNotMatch(partial, /data-admin-work-slot="context-creation"|data-admin-work-slot="task-operations"|data-admin-work-slot="membership-targets"/);

  const empty = renderToStaticMarkup(React.createElement(AdminWorkSection));
  assert.match(empty, /No Work tools are available/);
});

test("isolates one lazy feature failure in a single named section", () => {
  const html = renderToStaticMarkup(React.createElement(AdminWorkFeatureFailure, {
    title: "Task operations",
    message: "The task controls could not load.",
  }));

  assert.match(html, /<section[^>]*aria-labelledby="[^"]+"/);
  assert.match(html, /<h2[^>]*><span id="([^"]+)">Task operations<\/span><\/h2>/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Task operations could not load/);
  assert.match(html, /The task controls could not load\./);
});

test("uses feature container layout and semantic forced-color boundaries", () => {
  const css = fs.readFileSync(path.join(__dirname, "AdminWorkSection.module.css"), "utf8");
  assert.match(css, /container: admin-work-section \/ inline-size/);
  assert.match(css, /@container admin-work-section \(min-width: 64rem\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /data-admin-work-slot="task-operations"/);
  assert.match(css, /data-admin-work-slot="membership-targets"/);
  assert.match(css, /var\(--nova-space-6\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});
