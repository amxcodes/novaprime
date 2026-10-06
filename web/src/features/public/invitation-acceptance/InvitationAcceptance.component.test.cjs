const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
const { InvitationAcceptance, validateInvitationFields } = require("./InvitationAcceptance.tsx");

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(InvitationAcceptance, {
    async onAccept() {},
    invitationAvailable: true,
    onBackToSignIn() {},
    onReturnToNOVA() {},
    ...props,
  }));
}

test("invitation form uses semantic labels, native constraints, and reusable controls", () => {
  const html = render();
  assert.match(html, /<h1[^>]*>Create your NOVA account\.<\/h1>/);
  assert.match(html, /Your name/);
  assert.match(html, /name="name"/);
  assert.match(html, /autoComplete="name"/);
  assert.match(html, /Invited email address/);
  assert.match(html, /type="email"/);
  assert.match(html, /autoComplete="email"/);
  assert.match(html, /New password/);
  assert.match(html, /type="password"/);
  assert.match(html, /autoComplete="new-password"/);
  assert.match(html, /minLength="8"/);
  assert.match(html, /noValidate=""/);
  assert.match(html, /Create account/);
  assert.doesNotMatch(html, /<select\b/);
});

test("invitation validation returns field-specific errors without submitting invalid values", () => {
  assert.deepEqual(validateInvitationFields({ name: "  ", email: "  ", emailTypeMismatch: false, password: "" }), {
    name: "Enter your name.",
    email: "Enter your email address.",
    password: "Enter your password.",
  });
  assert.deepEqual(validateInvitationFields({ name: "Aman", email: "aman@example.com", emailTypeMismatch: true, password: "short" }), {
    name: "",
    email: "Enter a valid email address.",
    password: "Use at least 8 characters.",
  });
  assert.deepEqual(validateInvitationFields({ name: "Aman", email: "aman@example.com", emailTypeMismatch: false, password: "long-enough" }), {
    name: "",
    email: "",
    password: "",
  });
});

test("component receives only form values and delegates acceptance without owning URL or API logic", () => {
  const source = fs.readFileSync(path.join(__dirname, "InvitationAcceptance.tsx"), "utf8");
  assert.match(source, /await onAccept\(values\)/);
  assert.doesNotMatch(source, /fetch\s*\(|localStorage|sessionStorage|URLSearchParams|window\.location|invitationToken/);
  assert.doesNotMatch(source, /console\.(log|info|warn|error)/);
});

test("host notice and safe local completion/error states have accessible announcements", () => {
  const html = render({ notice: { kind: "info", message: "Use the invited address." } });
  assert.match(html, /Use the invited address\./);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Your password is private to you/);
});

test("an incomplete invite URL omits credential fields and offers a safe return action", () => {
  const html = render({ invitationAvailable: false });
  assert.match(html, /This invitation link is incomplete\./);
  assert.match(html, /Ask the person who invited you to send a new invitation link\./);
  assert.match(html, /Return to NOVA/);
  assert.doesNotMatch(html, /name="password"|name="email"|Create account/);
});

test("normalized blank names are field errors, and successful completion removes credentials and focuses the next action", () => {
  const source = fs.readFileSync(path.join(__dirname, "InvitationAcceptance.tsx"), "utf8");
  assert.match(source, /const trimmedName = name\.trim\(\)/);
  assert.match(source, /emailTypeMismatch: Boolean\(emailRef\.current\?\.validity\.typeMismatch\)/);
  assert.match(source, /setEmailError\(nextErrors\.email\)/);
  assert.match(source, /setPasswordError\(nextErrors\.password\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => firstInvalidControl\.current\?\.focus\(\)\)/);
  assert.match(source, /error=\{nameError \|\| undefined\}/);
  assert.match(source, /error=\{emailError \|\| undefined\}/);
  assert.match(source, /error=\{passwordError \|\| undefined\}/);
  assert.match(source, /noValidate onSubmit/);
  assert.match(source, /if \(completed\) continueRef\.current\?\.focus/);
  assert.match(source, /invitationAvailable && !completed \? <form/);
  assert.match(source, /Continue to sign in/);
  const css = fs.readFileSync(path.join(__dirname, "InvitationAcceptance.module.css"), "utf8");
  assert.match(css, /\.title:focus-visible\s*\{\s*outline:\s*none;/);
});

test("public auth features leave viewport height and vertical shell padding to the public frame", () => {
  for (const feature of ["sign-in", "password-recovery", "invitation-acceptance"]) {
    const css = fs.readFileSync(path.join(__dirname, `../${feature}/${feature === "sign-in" ? "SignIn" : feature === "password-recovery" ? "PasswordRecovery" : "InvitationAcceptance"}.module.css`), "utf8");
    const root = css.match(/\.root\s*\{([^}]*)\}/)?.[1] || "";
    assert.ok(root, `${feature} root style exists`);
    assert.doesNotMatch(root, /min-height|padding-block/, `${feature} must not duplicate public shell sizing`);
  }

  const publicShell = fs.readFileSync(path.join(__dirname, "../public-pages.css"), "utf8");
  const appFrame = publicShell.match(/body:not\(\.workspace-mode\) #app\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(appFrame, /min-height:/);
  assert.match(appFrame, /padding-block:/);
});
