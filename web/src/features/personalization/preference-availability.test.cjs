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

const {
  canEditPersonalPreferenceDraft,
  canPersistPersonalPreferences,
  personalPreferenceReadStatus,
} = require("./preference-availability.ts");

test("a failed database read is previewable but never writable", () => {
  const status = personalPreferenceReadStatus({ readError: "INTERNAL_ERROR", readHttpStatus: 500, writable: false });

  assert.equal(status, "read-failed");
  assert.equal(canEditPersonalPreferenceDraft(status, false, false, false), true);
  assert.equal(canPersistPersonalPreferences(status, false, false), false);
});

test("a successful read distinguishes writable schema from unsupported schema", () => {
  assert.equal(personalPreferenceReadStatus({ writable: true }), "ready");
  assert.equal(personalPreferenceReadStatus({ writable: false }), "unsupported");
  assert.equal(canEditPersonalPreferenceDraft("unsupported", false, false, false), false);
  assert.equal(canPersistPersonalPreferences("unsupported", false, false), false);
});

test("authentication failures stay distinct and cannot be edited as a local preview", () => {
  for (const statusCode of [401, 403]) {
    const status = personalPreferenceReadStatus({ readError: "ACCESS_DENIED", readHttpStatus: statusCode });
    assert.equal(status, "access-lost");
    assert.equal(canEditPersonalPreferenceDraft(status, false, false, false), false);
  }
});

test("saving and revision conflicts temporarily block otherwise editable drafts", () => {
  assert.equal(canEditPersonalPreferenceDraft("ready", true, true, false), false);
  assert.equal(canEditPersonalPreferenceDraft("read-failed", false, false, true), false);
  assert.equal(canPersistPersonalPreferences("ready", true, true), false);
});
