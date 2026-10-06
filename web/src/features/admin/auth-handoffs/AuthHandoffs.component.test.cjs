const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
require.extensions[".css"] = (module) => { module.exports = new Proxy({}, { get: (_target, key) => String(key) }); };

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { AuthHandoffs } = require("./AuthHandoffs.tsx");

function render(readState, overrides = {}) {
  return renderToStaticMarkup(React.createElement(AuthHandoffs, {
    readState,
    canRead: true,
    revealPending: false,
    onRetry() {},
    ...overrides,
  }));
}

const row = {
  viewKey: "handoff-view-test",
  purpose: "verification",
  targetDisplayName: "Taylor Example",
  targetEmail: "taylor@example.test",
  reason: "Email unavailable",
  expiresAt: "2026-10-04T12:30:00.000Z",
  onReveal: async () => "https://private.example.test/secret-token",
};

test("loading, error, and empty states have explicit recovery/eligibility language", () => {
  assert.match(render({ status: "loading" }), /Loading eligible handoffs/);
  assert.match(render({ status: "error", message: "Try again safely." }), /Handoffs could not be loaded/);
  assert.match(render({ status: "error", message: "Try again safely." }), /Try again/);
  assert.match(render({ status: "ready", handoffs: [] }), /No pending handoffs/);
});

test("ready list separates purpose and requires a deliberate one-time reveal action", () => {
  const html = render({ status: "ready", handoffs: [row] });
  assert.match(html, /Email verification/);
  assert.match(html, /Taylor Example/);
  assert.match(html, /taylor@example\.test/);
  assert.match(html, /Reveal once/);
  assert.match(html, /Each link can be revealed one time/);
  assert.doesNotMatch(html, /secret-token|<select\b/);
});

test("pending reveals lock refresh and other reveal controls, while lost bootstrap access locks controls", () => {
  const pending = render({ status: "ready", handoffs: [row] }, { revealPending: true });
  assert.match(pending, /A one-time link is being revealed/);
  assert.match(pending, /disabled/);
  assert.match(pending, /Wait for current reveal/);

  const bootstrapComplete = render({ status: "ready", handoffs: [row] }, { canRead: false });
  assert.match(bootstrapComplete, /self-verification link has been revealed/);
  assert.match(bootstrapComplete, /No longer available/);
  assert.match(bootstrapComplete, /disabled/);

  const attempted = render({ status: "ready", handoffs: [{ ...row, revealBlocked: true }] });
  assert.match(attempted, /NOVA will not retry this one-time link/);
  assert.match(attempted, /Reveal already attempted/);
});
