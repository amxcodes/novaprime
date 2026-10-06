const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { toFirstRunSetupValues, validateFirstRunSetup } = require("./validation.ts");

function validDraft(overrides = {}) {
  return {
    name: "Aman",
    organisationName: "NOVA Labs",
    email: "aman@example.test",
    password: "long-enough-password",
    publicOrigin: "https://work.example.test",
    attendanceMode: "hour_based",
    requiredAttendanceMinutes: "480",
    bootstrapToken: "private-token",
    ...overrides,
  };
}

test("valid first-run details produce no errors and preserve exact form values for host orchestration", () => {
  const result = validateFirstRunSetup(validDraft());
  assert.deepEqual(result.errors, {});
  assert.equal(result.requiredAttendanceMinutes, 480);
});

test("missing, malformed, and out-of-range values have field-specific validation", () => {
  const result = validateFirstRunSetup(validDraft({
    name: "   ",
    organisationName: " ",
    email: "not-an-email",
    password: "short",
    publicOrigin: "https://work.example.test/team?next=1",
    requiredAttendanceMinutes: "1441",
    bootstrapToken: "",
  }));
  assert.match(result.errors.name, /founder's name/);
  assert.match(result.errors.organisationName, /organisation name/);
  assert.match(result.errors.email, /valid email/);
  assert.match(result.errors.password, /at least 8/);
  assert.match(result.errors.publicOrigin, /origin only/);
  assert.match(result.errors.requiredAttendanceMinutes, /1 to 1,440/);
  assert.match(result.errors.bootstrapToken, /setup token/);
});

test("server-compatible public origin validation accepts HTTP local testing and rejects non-origin URLs", () => {
  for (const origin of ["http://localhost:4173", "http://127.0.0.1:4173/", "https://work.example.test"]) {
    assert.equal(validateFirstRunSetup(validDraft({ publicOrigin: origin })).errors.publicOrigin, undefined);
  }
  for (const origin of ["", "not a url", "javascript:alert(1)", "https://user:secret@work.example.test", "https://work.example.test/path", "https://work.example.test?debug=1", "https://work.example.test#section"]) {
    assert.ok(validateFirstRunSetup(validDraft({ publicOrigin: origin })).errors.publicOrigin, origin);
  }
});

test("scheduled mode permits an empty hidden duration but always sends a server-valid fallback", () => {
  const blank = validateFirstRunSetup(validDraft({ attendanceMode: "scheduled", requiredAttendanceMinutes: "" }));
  assert.deepEqual(blank.errors, {});
  assert.equal(blank.requiredAttendanceMinutes, 480);

  const invalid = validateFirstRunSetup(validDraft({ attendanceMode: "scheduled", requiredAttendanceMinutes: "9999" }));
  assert.deepEqual(invalid.errors, {});
  assert.equal(invalid.requiredAttendanceMinutes, 480);

  const valid = validateFirstRunSetup(validDraft({ attendanceMode: "scheduled", requiredAttendanceMinutes: "360" }));
  assert.equal(valid.requiredAttendanceMinutes, 360);
});

test("hour-based mode requires an integer duration within the server range", () => {
  for (const value of ["", "0", "1441", "480.5", "abc"]) {
    assert.ok(validateFirstRunSetup(validDraft({ requiredAttendanceMinutes: value })).errors.requiredAttendanceMinutes, value);
  }
  assert.equal(validateFirstRunSetup(validDraft({ requiredAttendanceMinutes: "1" })).requiredAttendanceMinutes, 1);
  assert.equal(validateFirstRunSetup(validDraft({ requiredAttendanceMinutes: "1440" })).requiredAttendanceMinutes, 1440);
});

test("confirmed-founder resume skips founder credential validation but keeps workspace requirements", () => {
  const resumeFounder = { email: "founder@example.test", displayName: "Founder Name" };
  const draft = validDraft({
    name: "",
    email: "",
    password: "",
  });
  assert.deepEqual(validateFirstRunSetup(draft, resumeFounder).errors, {});

  const invalidWorkspace = validateFirstRunSetup(validDraft({
    ...draft,
    organisationName: " ",
    publicOrigin: "https://work.example.test/path",
    requiredAttendanceMinutes: "0",
    bootstrapToken: "",
  }), resumeFounder);
  assert.ok(invalidWorkspace.errors.organisationName);
  assert.ok(invalidWorkspace.errors.publicOrigin);
  assert.ok(invalidWorkspace.errors.requiredAttendanceMinutes);
  assert.ok(invalidWorkspace.errors.bootstrapToken);
  assert.equal(invalidWorkspace.errors.name, undefined);
  assert.equal(invalidWorkspace.errors.email, undefined);
  assert.equal(invalidWorkspace.errors.password, undefined);
});

test("resume submit values use only the confirmed founder identity and omit credentials", () => {
  const values = toFirstRunSetupValues(validDraft({
    name: "Unconfirmed form name",
    email: "unconfirmed@example.test",
    password: "should-not-be-sent",
  }), 480, { email: "confirmed@example.test", displayName: "Confirmed Founder" });
  assert.deepEqual(values, {
    founderMode: "resume",
    email: "confirmed@example.test",
    displayName: "Confirmed Founder",
    organisationName: "NOVA Labs",
    publicOrigin: "https://work.example.test",
    attendanceMode: "hour_based",
    requiredAttendanceMinutes: 480,
    bootstrapToken: "private-token",
  });
  assert.equal("password" in values, false);
  assert.equal("name" in values, false);
});
