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
const { WorkContextCreation } = require("./WorkContextCreation.tsx");

const baseProps = {
  readState: { status: "ready" },
  canCreateClient: false,
  canCreateClientWorkstream: false,
  canCreateOrganisationWorkstream: false,
  canCreateGroup: false,
  clientOptions: [],
  groupWorkstreamOptions: [],
  onCreateClient: async () => {},
  onCreateClientWorkstream: async () => {},
  onCreateOrganisationWorkstream: async () => {},
  onCreateGroup: async () => {},
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(WorkContextCreation, { ...baseProps, ...overrides }));
}

test("does not render work-context creation for actors without create grants", () => {
  assert.equal(render(), "");
});

test("keeps independent client and organisation forms available when parent choices fail", () => {
  const html = render({
    readState: { status: "unavailable", message: "The scoped work context could not be loaded." },
    canCreateClient: true,
    canCreateClientWorkstream: true,
    canCreateOrganisationWorkstream: true,
    canCreateGroup: true,
  });

  assert.match(html, /New client/);
  assert.match(html, /New organisation workstream/);
  assert.match(html, /client choices unavailable/i);
  assert.match(html, /workstream choices unavailable/);
  assert.doesNotMatch(html, /<select\b/);
});

test("uses authored searchable choices only for authorized client and group targets", () => {
  const html = render({
    canCreateClientWorkstream: true,
    canCreateGroup: true,
    clientOptions: [{ id: "client-1", name: "Northstar" }],
    groupWorkstreamOptions: [{ id: "stream-1", name: "Delivery", kind: "client" }],
  });

  assert.match(html, /New client workstream/);
  assert.match(html, /New group/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /Client/);
  assert.match(html, /Workstream/);
  assert.doesNotMatch(html, /<select\b/);
});
