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
  let classes;
  classes = new Proxy({}, {
    get: (_target, key) => key === "__esModule" ? true : key === "default" ? classes : `module-${String(key)}`,
  });
  module.exports = classes;
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { DeploymentAssistant } = require("./DeploymentAssistant.tsx");

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(DeploymentAssistant, {
    pathId: "",
    stage: 0,
    scheduler: "",
    completed: {},
    probe: null,
    onReset() {},
    onSelectPath() {},
    onSelectStage() {},
    onSelectScheduler() {},
    onCompleteChange() {},
    onProbe() {},
    onBack() {},
    onNext() {},
    onNavigateHome() {},
    ...overrides,
  }));
}

test("deployment assistant owns its outer surface and uses the shared action buttons", () => {
  const markup = render();

  assert.match(markup, /<section class="module-root">/);
  assert.match(markup, /class="module-header"/);
  assert.match(markup, /class="module-button module-publicAction"/);
  assert.match(markup, /data-variant="secondary"/);
  assert.match(markup, /data-deployment-reset/);
  assert.doesNotMatch(markup, /class="panel deployment-assistant"/);
  assert.doesNotMatch(markup, /class="button secondary/);
});

test("deployment stage actions stay inside the feature-owned action row", () => {
  const markup = render({ pathId: "local-docker", scheduler: "vps" });

  assert.match(markup, /class="module-formActions"/);
  assert.match(markup, /data-deployment-back/);
  assert.match(markup, /data-deployment-next/);
  assert.match(markup, /class="module-button module-publicAction"/);
  assert.doesNotMatch(markup, /class="form-actions"/);
});

test("deployment disclosures replace browser markers and honor system accessibility modes", () => {
  const css = fs.readFileSync(__dirname + "/DeploymentAssistant.module.css", "utf8");
  for (const disclosure of ["deployment-map-details", "deployment-wiring", "deployment-scheduler-plan"]) {
    assert.ok(css.includes(`.${disclosure} > summary::-webkit-details-marker`));
    assert.ok(css.includes(`.${disclosure}[open] > summary)::after`));
  }
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*deployment-scheduler-plan > summary\)::after/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*deployment-scheduler-plan > summary\)::after/);
});
