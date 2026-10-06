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
const { AttendancePulse } = require("./attendance-pulse.tsx");

test("missing office assignment is presented as setup guidance, not a load failure", () => {
  const html = renderToStaticMarkup(React.createElement(AttendancePulse, {
    read: {
      status: "setup-required",
      message: "An active office assignment is required to use attendance.",
    },
    capabilities: { checkIn: false, checkOut: false, changeMode: false },
    onAction() {},
  }));

  assert.match(html, /Attendance setup needed/);
  assert.match(html, /An active office assignment is required to use attendance\./);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /Attendance could not load|role="alert"/);
});
