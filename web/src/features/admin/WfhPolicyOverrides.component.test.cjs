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
const {
  WfhPolicyOverrides,
  availableWfhPolicyTargetTypes,
  projectWfhPolicyTargetTypeOptions,
  projectWfhPolicyTargetOptions,
} = require("./WfhPolicyOverrides.tsx");
const { buildWfhPolicyInput } = require("./wfh-policy-model.ts");

const policy = {
  id: "policy-1",
  targetType: "office",
  targetId: "office-1",
  targetName: "Central office",
  allowed: false,
  effectiveOn: "2026-10-01",
  effectiveUntil: "2026-10-31",
  reason: "Seasonal restriction",
};

function read(status = "unavailable", targets = [], error) {
  return { status, targets, error };
}

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(WfhPolicyOverrides, {
    canView: false,
    canManage: false,
    policyRead: { status: "unavailable", policies: [] },
    targetReads: {
      office: read(),
      organisation_department: read(),
      person: read(),
    },
    onCreate() {},
    ...props,
  }));
}

test("view-only actors receive only supplied policy rows", () => {
  const html = render({
    canView: true,
    policyRead: { status: "ready", policies: [policy] },
  });

  assert.match(html, /Existing overrides/);
  assert.match(html, /Central office/);
  assert.match(html, /WFH not allowed/);
  assert.match(html, /Seasonal restriction/);
  assert.doesNotMatch(html, /Add an override|Add WFH override|<form/);
});

test("manage-only without target options hides supplied policy data and explains the unavailable form", () => {
  const html = render({
    canManage: true,
    policyRead: { status: "ready", policies: [{ ...policy, targetName: "Private list sentinel" }] },
  });

  assert.match(html, /Existing overrides are hidden/);
  assert.match(html, /No target options available/);
  assert.doesNotMatch(html, /Private list sentinel|<form|Add WFH override/);
});

test("a single ready target category produces a usable form without loading any data", () => {
  let calls = 0;
  const html = render({
    canManage: true,
    targetReads: {
      office: read("ready", [{ id: "office-1", name: "Central office" }]),
      organisation_department: read(),
      person: read(),
    },
    onCreate() { calls += 1; },
  });

  assert.match(html, /Add an override/);
  assert.match(html, /<span id="[^"]+"><span>Target type<\/span>/);
  assert.match(html, /<button id="[^"]+-target-type"[^>]*aria-labelledby="[^"]+ [^"]+"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /<select tabindex="-1" required="" name="targetType">[\s\S]*?<option value="office" selected="">Office/);
  assert.match(html, /<input type="hidden" name="targetId" value=""/);
  assert.match(html, /button id="[^"]+-target-type"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="[^"]+-target"[^>]*role="combobox"/);
  assert.match(html, /Only target options supplied for this authorized form are shown/);
  assert.doesNotMatch(html, /<select(?! tabindex="-1")/);
  assert.deepEqual(availableWfhPolicyTargetTypes({
    office: read("ready", [{ id: "office-1", name: "Central office" }]),
    organisation_department: read(),
    person: read(),
  }), ["office"]);
  assert.deepEqual(projectWfhPolicyTargetTypeOptions(["office"]), [
    { value: "office", label: "Office" },
  ]);
  assert.deepEqual(projectWfhPolicyTargetOptions([{ id: "office-1", name: "Central office" }]), [
    { value: "", label: "Choose a target" },
    { value: "office-1", label: "Central office" },
  ]);
  assert.match(html, /Effective from/);
  assert.match(html, /Effective until \(optional\)/);
  assert.match(html, /WFH allowed/);
  assert.match(html, /Reason \(optional\)/);
  assert.equal(calls, 0);
});

test("view and manage surfaces compose independently when both are granted", () => {
  const html = render({
    canView: true,
    canManage: true,
    policyRead: { status: "ready", policies: [policy] },
    targetReads: {
      office: read("ready", [{ id: "office-2", name: "North office" }]),
      organisation_department: read("ready", [{ id: "dept-1", name: "People" }]),
      person: read("ready", [{ id: "person-1", displayName: "Jordan Lee" }]),
    },
  });

  assert.match(html, /Existing overrides/);
  assert.match(html, /Central office/);
  assert.match(html, /Add an override/);
  assert.match(html, /<select tabindex="-1" required="" name="targetType">[\s\S]*?<option value="office" selected="">Office/);
  assert.deepEqual(availableWfhPolicyTargetTypes({
    office: read("ready", [{ id: "office-2", name: "North office" }]),
    organisation_department: read("ready", [{ id: "dept-1", name: "People" }]),
    person: read("ready", [{ id: "person-1", displayName: "Jordan Lee" }]),
  }), ["office", "organisation_department", "person"]);
  assert.deepEqual(projectWfhPolicyTargetOptions([
    { id: "office-2", name: "North office" },
  ]), [
    { value: "", label: "Choose a target" },
    { value: "office-2", label: "North office" },
  ]);
  assert.doesNotMatch(html, /<select(?! tabindex="-1")/);
  assert.doesNotMatch(html, /Jordan Lee/);
});

test("partial target-list failure reports the failed source and keeps ready categories usable", () => {
  const html = render({
    canManage: true,
    targetReads: {
      office: read("ready", [{ id: "office-1", name: "Central office" }]),
      organisation_department: read("error", [], "Department lookup is temporarily unavailable."),
      person: read(),
    },
  });

  assert.match(html, /Department targets unavailable/);
  assert.match(html, /Department lookup is temporarily unavailable/);
  assert.match(html, /Available target categories remain usable/);
  assert.deepEqual(availableWfhPolicyTargetTypes({
    office: read("ready", [{ id: "office-1", name: "Central office" }]),
    organisation_department: read("error", [], "Department lookup is temporarily unavailable."),
    person: read(),
  }), ["office"]);
  assert.doesNotMatch(html, /<select(?! tabindex="-1")/);
});

test("policy list failure does not remove independently usable create form", () => {
  const html = render({
    canView: true,
    canManage: true,
    policyRead: { status: "error", policies: [], error: "Policy list unavailable." },
    targetReads: {
      office: read("ready", [{ id: "office-1", name: "Central office" }]),
      organisation_department: read(),
      person: read(),
    },
  });

  assert.match(html, /WFH overrides could not load/);
  assert.match(html, /Policy list unavailable/);
  assert.match(html, /Add an override/);
  assert.match(html, /id="[^"]+-target"[^>]*role="combobox"/);
  assert.deepEqual(projectWfhPolicyTargetOptions([{ id: "office-1", name: "Central office" }]), [
    { value: "", label: "Choose a target" },
    { value: "office-1", label: "Central office" },
  ]);
});

test("create failures render a focusable alert and field errors are associated with controls", () => {
  const html = render({
    canManage: true,
    createError: "The target changed. Review and try again.",
    targetReads: {
      office: read("ready", [{ id: "office-1", name: "Central office" }]),
      organisation_department: read(),
      person: read(),
    },
  });
  const source = fs.readFileSync(path.join(__dirname, "WfhPolicyOverrides.tsx"), "utf8");

  assert.match(html, /role="alert"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /The target changed/);
  assert.match(source, /errorRef\.current\?\.focus\(\)/);
  assert.match(source, /error=\{fieldErrors\.effectiveOn\}/);
  assert.match(source, /error=\{fieldErrors\.targetId\}/);
});

test("payload matches the API DTO, trims optional reason, and rejects targets outside supplied options", () => {
  const base = {
    targetType: "person",
    targetId: "person-1",
    allowed: true,
    effectiveOn: "2026-10-01",
    effectiveUntil: "",
    reason: "  Temporary arrangement  ",
  };
  const valid = buildWfhPolicyInput(base, [{ id: "person-1", displayName: "Jordan Lee" }]);

  assert.deepEqual(valid, {
    input: {
      targetType: "person",
      targetId: "person-1",
      allowed: true,
      effectiveOn: "2026-10-01",
      reason: "Temporary arrangement",
    },
    errors: {},
  });
  const invalid = buildWfhPolicyInput({ ...base, targetId: "other-person", effectiveUntil: "2026-09-30" }, [
    { id: "person-1", displayName: "Jordan Lee" },
  ]);
  assert.equal(invalid.input, null);
  assert.equal(invalid.errors.targetId, "Choose an available target.");
  assert.equal(invalid.errors.effectiveUntil, "Effective until must be on or after the start date.");
});

test("layout adapts at compact, medium, and expanded widths using semantic tokens", () => {
  const css = fs.readFileSync(path.join(__dirname, "WfhPolicyOverrides.module.css"), "utf8");

  assert.match(css, /@container wfh-overrides \(max-width: 39\.999rem\)/);
  assert.match(css, /@container wfh-overrides \(min-width: 40rem\) and \(max-width: 63\.999rem\)/);
  assert.match(css, /@container wfh-overrides \(min-width: 64rem\)/);
  assert.match(css, /var\(--nova-control-touch-target\)/);
  assert.match(css, /var\(--nova-color-surface\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});

test("feature root does not add a duplicate named landmark under its heading-owning section", () => {
  const html = render({ canView: true, policyRead: { status: "ready", policies: [] } });
  const source = fs.readFileSync(path.join(__dirname, "WfhPolicyOverrides.tsx"), "utf8");
  assert.doesNotMatch(html, /<section[^>]*aria-label="WFH eligibility overrides"/);
  assert.match(source, /<div className=\{styles\.section\} aria-busy=/);
  assert.match(source, /role="group" aria-label="Target list status"/);
});

test("allowed checkbox uses its labeled row as the single focus-ring owner", () => {
  const css = fs.readFileSync(path.join(__dirname, "WfhPolicyOverrides.module.css"), "utf8");
  assert.match(css, /\.allowedControl:has\(input:focus-visible\)\s*,\s*\.section :global\(:focus-visible\):not\(input\[type="checkbox"\]\):not\(input\[type="radio"\]\)/s);
  assert.match(css, /\.allowedControl:has\(input:focus-visible\) input\s*\{\s*outline:\s*none;/s);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.allowedControl:has\(input:focus-visible\)\s*\{\s*outline:\s*2px solid Highlight;/s);
});
