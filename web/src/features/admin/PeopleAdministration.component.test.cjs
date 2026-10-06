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
const { OnboardingValidationFeedback, PeopleAdministration, employmentStartDateHint, onboardingValidationSummary, prepareAuditReason, prepareOnboardingSubmission } = require("./PeopleAdministration.tsx");

const activePerson = {
  id: "person-1",
  displayName: "Aman Verma",
  email: "aman@example.test",
  status: "active",
  office: { id: "office-1", name: "Bengaluru" },
  department: { id: "department-1", name: "Engineering" },
  role: { id: "role-1", name: "Employee" },
  actions: {
    resendInvitation: false,
    freeze: true,
    startOffboarding: true,
    completeExit: false,
    completeOnboarding: false,
  },
};

function peoplePage(people = [], overrides = {}) {
  return { people, limit: 25, hasMore: false, nextCursor: null, ...overrides };
}

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(PeopleAdministration, {
    canInvite: true,
    canViewPeople: true,
    peopleRead: { status: "ready" },
    peoplePage: peoplePage([activePerson]),
    searchPeopleDirectory: async () => peoplePage([]),
    onInvite() {},
    onResendInvitation() {},
    onFreeze() {},
    onStartOffboarding() {},
    onCompleteExit() {},
    onCompleteOnboarding() {},
    searchOnboardingOptions: async () => [],
    ...props,
  }));
}

test("invite-only capability renders the invitation form without rendering supplied directory records", () => {
  const html = render({ canViewPeople: false, peopleRead: { status: "ready" } });
  assert.match(html, /People and onboarding/);
  assert.match(html, /Invite a person/);
  assert.match(html, /Full name/);
  assert.match(html, /Work email/);
  assert.match(html, /one-time link/);
  assert.doesNotMatch(html, /Aman Verma|aman@example\.test|People in your scope/);
});

test("without invite or directory visibility, person data and actions are omitted", () => {
  const html = render({ canInvite: false, canViewPeople: false });
  assert.doesNotMatch(html, /Aman Verma|aman@example\.test|Freeze access|Start offboarding|Send invitation/);
  assert.doesNotMatch(html, /People in your scope/);
});

test("view-only capability renders authorized rows without exposing invitation controls", () => {
  const html = render({ canInvite: false });
  assert.match(html, /Aman Verma/);
  assert.match(html, /aman@example\.test/);
  assert.match(html, /active/);
  assert.match(html, /Bengaluru · Engineering · Employee/);
  assert.doesNotMatch(html, /Invite a person|Send invitation/);
});

test("people lifecycle statuses use shared badge geometry and semantic tones", () => {
  const cases = [
    ["active", "success", "Active"],
    ["invited", "info", "Invited"],
    ["onboarding", "info", "Onboarding"],
    ["notice", "warning", "Notice"],
    ["offboarding", "warning", "Offboarding"],
    ["frozen", "danger", "Frozen"],
    ["offboarded", "danger", "Offboarded"],
    ["future_status", "neutral", "Future Status"],
  ];

  for (const [status, tone, label] of cases) {
    const person = { ...activePerson, status };
    const html = render({ peoplePage: peoplePage([person]) });
    assert.match(html, new RegExp(`data-status="${status}"[^>]*data-tone="${tone}"`));
    assert.match(html, new RegExp(`>${label}<`));
  }

  const source = fs.readFileSync(require("node:path").join(__dirname, "PeopleAdministration.tsx"), "utf8");
  assert.match(source, /<Badge className=\{styles\.status\} data-status=/);
});

test("person actions follow host-projected target visibility", () => {
  const html = render();
  assert.match(html, /Freeze access/);
  assert.match(html, /Start offboarding/);
  assert.match(html, /role="group" aria-label="Actions for Aman Verma"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Freeze Aman Verma’s access\?/);
  assert.match(html, /closes their active work and attendance and revokes their active sessions/);
  assert.match(html, /Confirm freeze/);
  assert.match(html, /Start offboarding for Aman Verma/);
  assert.doesNotMatch(html, /Resend invitation|Complete exit/);
  const reasonInput = html.match(/<textarea(?=[^>]*name="reason")[^>]*>/)?.[0];
  assert.ok(reasonInput?.includes('required=""'));
  assert.match(reasonInput || "", /maxLength="500"/i);
  assert.match(html, /included in the audited access change/);
});

test("person-action disclosures use the feature chevron and preserve system accessibility modes", () => {
  const css = fs.readFileSync(__dirname + "/PeopleAdministration.module.css", "utf8");
  assert.match(css, /\.reasonAction summary::marker\s*\{\s*content:\s*"";\s*\}/);
  assert.match(css, /\.reasonAction summary::-webkit-details-marker\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.reasonAction\[open\] summary::after\s*\{[^}]*transform:\s*rotate\(225deg\)/s);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*\.reasonAction summary::after/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.reasonAction summary::after\s*\{\s*transition:\s*none;/);
});

test("audited offboarding reasons reject whitespace and retain trimmed valid text", () => {
  assert.deepEqual(prepareAuditReason("  \n  "), {
    reason: null,
    error: "Enter a reason for this audited access change.",
  });
  assert.deepEqual(prepareAuditReason("  Role transition complete.  "), {
    reason: "Role transition complete.",
    error: null,
  });
});

test("invited person gets the resend action only when the host grants it", () => {
  const invited = {
    ...activePerson,
    status: "invited",
    actions: { ...activePerson.actions, freeze: false, startOffboarding: false, resendInvitation: true },
  };
  const html = render({ peoplePage: peoplePage([invited]) });
  assert.match(html, /Resend invitation/);
  assert.doesNotMatch(html, /Freeze access|Start offboarding/);
});

test("onboarding uses authored pickers for required choices and keeps manager optional", () => {
  const onboarding = {
    ...activePerson,
    status: "onboarding",
    actions: { ...activePerson.actions, freeze: false, startOffboarding: false, completeOnboarding: true },
    onboarding: { status: "ready" },
  };
  const html = render({ peoplePage: peoplePage([onboarding]) });
  assert.match(html, /Complete onboarding/);
  assert.match(html, /Employment start \(office local date\)/);
  assert.match(html, /Choose an office; NOVA validates this date using that office&#x27;s timezone\./);
  assert.match(html, /name="officeId" value=""/);
  assert.match(html, /name="organisationDepartmentId" value=""/);
  assert.match(html, /name="roleId" value=""/);
  assert.match(html, /id="[^"]+-office" required="" role="combobox"/);
  assert.match(html, /id="[^"]+-department" required="" role="combobox"/);
  assert.match(html, /id="[^"]+-role" required="" role="combobox"/);
  assert.match(html, /<label[^>]*for="[^\"]+-manager"[^>]*><span>Manager \(optional\)<\/span>/);
  assert.match(html, /id="[^"]+-manager"[^>]*role="combobox"/);
  assert.match(html, /<input type="hidden" name="managerPersonId" value=""/);
  assert.doesNotMatch(html, /<select\b/i);
});

test("onboarding submission preserves selected authorized IDs and the optional manager value", () => {
  const result = prepareOnboardingSubmission({
    designation: "  Product designer  ",
    officeId: "office-2",
    employmentStartsOn: "2026-10-03",
    organisationDepartmentId: "department-2",
    roleId: "role-2",
    managerPersonId: "",
  }, {
    office: { id: "office-2", name: "Remote office", timezone: "Asia/Kolkata" },
    department: { id: "department-2", name: "Product" },
    role: { id: "role-2", name: "Designer" },
    manager: null,
  });
  assert.deepEqual(result, {
    input: {
      designation: "Product designer",
      officeId: "office-2",
      employmentStartsOn: "2026-10-03",
      organisationDepartmentId: "department-2",
      roleId: "role-2",
      managerPersonId: "",
    },
    errors: {},
  });
});

test("employment-date guidance follows the selected office timezone", () => {
  assert.equal(employmentStartDateHint({ id: "office-2", name: "Remote office", timezone: "Asia/Kolkata" }), "Date is evaluated in Asia/Kolkata.");
  assert.match(employmentStartDateHint(), /Choose an office/);
});

test("onboarding rejects blank and typed-but-unselected required values before command submission", () => {
  const blank = prepareOnboardingSubmission({
    designation: "",
    officeId: "",
    employmentStartsOn: "",
    organisationDepartmentId: "",
    roleId: "",
    managerPersonId: "",
  }, { office: null, department: null, role: null, manager: null });
  assert.equal(blank.input, null);
  assert.deepEqual(blank.errors, {
    designation: "Enter a designation.",
    employmentStartsOn: "Choose an employment start date.",
    officeId: "Choose an office from the list.",
    organisationDepartmentId: "Choose a department from the list.",
    roleId: "Choose a role from the list.",
  });

  const typedText = prepareOnboardingSubmission({
    designation: "Designer",
    officeId: "Remote office",
    employmentStartsOn: "2026-10-03",
    organisationDepartmentId: "Product",
    roleId: "role-from-another-scope",
    managerPersonId: "",
  }, { office: null, department: null, role: null, manager: null });
  assert.equal(typedText.input, null);
  assert.deepEqual(typedText.errors, {
    officeId: "Choose an office from the list.",
    organisationDepartmentId: "Choose a department from the list.",
    roleId: "Choose a role from the list.",
  });
});

test("onboarding validation produces a concise announced summary for invalid submissions", () => {
  const errors = {
    designation: "Enter a designation.",
    officeId: "Choose an office from the list.",
  };
  assert.equal(onboardingValidationSummary(errors), "2 onboarding fields need attention. Enter a designation. Choose an office from the list.");
  assert.equal(onboardingValidationSummary({}), null);
  const html = renderToStaticMarkup(React.createElement(OnboardingValidationFeedback, { errors }));
  assert.match(html, /role="alert" aria-live="assertive" aria-atomic="true"/);
  assert.match(html, /2 onboarding fields need attention\. Enter a designation\. Choose an office from the list\./);
  assert.equal(renderToStaticMarkup(React.createElement(OnboardingValidationFeedback, { errors: {} })), "");
});

test("onboarding denied reads stay unavailable while remote options do not require a preloaded roster", () => {
  const denied = {
    ...activePerson,
    status: "onboarding",
    actions: { ...activePerson.actions, completeOnboarding: true },
    onboarding: { status: "denied", message: "Office and role access are required." },
  };
  const deniedHtml = render({ peoplePage: peoplePage([denied]) });
  assert.match(deniedHtml, /Onboarding is unavailable/);
  assert.match(deniedHtml, /Office and role access are required\./);
  assert.doesNotMatch(deniedHtml, /role="combobox"/);

  const emptyLegacyRead = {
    ...denied,
    onboarding: { status: "ready" },
  };
  const remoteHtml = render({ peoplePage: peoplePage([emptyLegacyRead]) });
  assert.match(remoteHtml, /role="combobox"/);
  assert.match(remoteHtml, /name="officeId" value=""/);
});

test("all onboarding business pickers use remote server results and keep selected IDs explicit", () => {
  const source = fs.readFileSync(require("node:path").join(__dirname, "PeopleAdministration.tsx"), "utf8");
  assert.equal((source.match(/searchMode="remote"/g) || []).length, 4);
  assert.match(source, /remoteSearch\("manager", query\)/);
  assert.match(source, /selectedOptions\.manager\?\.id !== values\.managerPersonId/);
});

test("People list loading, errors, unavailable state, and empty state remain distinct", () => {
  assert.match(render({ peopleRead: { status: "loading" }, peoplePage: peoplePage([]) }), /Loading people/);
  assert.match(render({ peopleRead: { status: "error", message: "Directory read failed." }, peoplePage: peoplePage([]) }), /Directory read failed\./);
  assert.match(render({ peopleRead: { status: "unavailable", message: "People access is required." }, peoplePage: peoplePage([]) }), /People access is required\./);
  const emptyHtml = render({ peopleRead: { status: "ready" }, peoplePage: peoplePage([]) });
  assert.match(emptyHtml, /No people are visible in your current scope/);
  assert.match(emptyHtml, /role="status" aria-live="polite" aria-atomic="true"/);
  const populatedHtml = render({ peopleRead: { status: "ready" } });
  assert.match(populatedHtml, /1 visible record on page 1/);
});

test("People directory exposes bounded server search and paging controls without local filtering", () => {
  const html = render({ peoplePage: peoplePage([activePerson], { hasMore: true, nextCursor: "opaque-next" }) });
  assert.match(html, /role="search" aria-label="Search people in your scope"/);
  assert.match(html, /Search people you can view/);
  assert.match(html, /Search runs on the server across your authorized directory\./);
  assert.match(html, /Name, email, office, department, or role/);
  assert.match(html, /aria-label="People directory pages"/);
  assert.match(html, />Previous</);
  assert.match(html, />Next</);
  assert.match(html, /1 visible record on page 1/);
  const source = fs.readFileSync(require("node:path").join(__dirname, "PeopleAdministration.tsx"), "utf8");
  assert.match(source, /searchPeopleDirectory\(nextQuery, cursor\)/);
  assert.doesNotMatch(source, /people\.filter\(|people\.some\(.*query/i);
});

test("feature styles reflow the editor and keep product controls touch-sized", () => {
  const css = fs.readFileSync(require("node:path").join(__dirname, "PeopleAdministration.module.css"), "utf8");
  assert.match(css, /@container people-administration \(min-width: 42rem\)/);
  assert.match(css, /@container people-administration \(max-width: 36rem\)/);
  assert.match(css, /\.freezeConfirmation\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(css, /\.freezeConfirmationActions > button\s*\{\s*width:\s*100%/);
  assert.match(css, /--nova-control-touch-target/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.directorySearch\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(css, /@container people-administration \(min-width: 56rem\)[\s\S]*\.personHeader\s*\{\s*grid-column:\s*1;/);
  assert.match(css, /@container people-administration \(max-width: 36rem\)[\s\S]*\.directorySearch\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(css, /\.directoryPagination\s*\{[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*space-between;/s);
  assert.match(css, /\.directoryPagination > span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.peopleList\s*\{[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.person\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.doesNotMatch(css, /^\s*min-width:\s*(?:[4-9]\d|\d{3,})rem/m);
});
