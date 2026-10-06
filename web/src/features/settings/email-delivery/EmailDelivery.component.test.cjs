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
const { EmailDelivery } = require("./EmailDelivery.tsx");
const { EmailDeliveryActionError, classifyEmailDeliveryActionFailure } = require("./contracts.ts");
const { effectiveEmailTestStatus, EmailDeliveryActionFeedback } = require("./ConnectionCard.tsx");

const row = (overrides = {}) => ({
  name: "Primary email",
  provider: "resend",
  senderEmail: "people@example.test",
  replyToEmail: null,
  isActive: false,
  supported: true,
  lastTestedAt: null,
  lastTestStatus: "untested",
  onTest: async () => {},
  onActivate: async () => {},
  onDeactivate: async () => {},
  ...overrides,
});

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(EmailDelivery, {
    readState: { status: "ready" },
    publicOriginConfigured: true,
    publicOrigin: "https://nova.example.test",
    supportedProviders: ["smtp", "gmail_oauth2", "resend", "console"],
    connections: [],
    onRetry() {},
    async onCreate() {},
    ...overrides,
  }));
}

function buttonMarkup(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<button\\b[^>]*>[\\s\\S]*?<span>${escaped}<\\/span><\\/button>`))?.[0] || "";
}

test("ready screen has labelled sections, styled provider combobox, and semantic form fields", () => {
  const html = render();
  assert.match(html, /<h2[^>]*>Email delivery<\/h2>/);
  assert.match(html, /Saved connections/);
  assert.match(html, /Add an email connection/);
  assert.match(html, /No email connections/);
  assert.match(html, /button[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"/);
  assert.match(html, /<select tabindex="-1" name="provider">[\s\S]*?<option value="smtp" selected="">SMTP/);
  assert.match(html, /Provider/);
  assert.match(html, /Connection name/);
  assert.match(html, /Sender email/);
  assert.match(html, /SMTP host/);
  assert.match(html, /SMTP password/);
  assert.doesNotMatch(html, /<select(?! tabindex="-1")/);
  assert.match(html, /Gmail redirect URI:/);
});

test("loading, denied read error, and retry states are distinct", () => {
  const loading = render({ readState: { status: "loading" } });
  assert.match(loading, /Loading email connections/);
  assert.match(loading, /Waiting for the provider list/);
  assert.match(loading, /aria-busy="true"/);

  const error = render({ readState: { status: "error", message: "Permission or network check failed." } });
  assert.match(error, /Connections could not be loaded/);
  assert.match(error, /Permission or network check failed/);
  assert.match(error, /Try again/);
  assert.match(error, /Provider support could not be confirmed/);
});

test("public-origin pending and missing states block sends but keep active connection deactivation visible", () => {
  const pending = render({ publicOriginConfigured: null, connections: [row({ isActive: true })] });
  assert.match(pending, /Checking the approved public origin/);
  assert.match(buttonMarkup(pending, "Send test"), /disabled=""/);

  const missing = render({ publicOriginConfigured: false, publicOrigin: undefined, connections: [row({ isActive: true })] });
  assert.match(missing, /Public origin required/);
  assert.match(missing, /Active connections can still be deactivated/);
  assert.match(missing, /Deactivate/);
  assert.match(buttonMarkup(missing, "Send test"), /disabled=""/);
  assert.match(buttonMarkup(missing, "Save connection"), /disabled=""/);

  const originError = render({
    publicOriginConfigured: null,
    publicOriginError: "Origin settings could not be read.",
    onRetryOrigin() {},
  });
  assert.match(originError, /Public origin could not be checked/);
  assert.match(originError, /Origin settings could not be read/);
  assert.match(originError, /Retry origin check/);
});

test("host-authorized Super Admin can use email actions when origin is unreadable and is told the API will verify it", () => {
  const unknownOrigin = render({
    publicOriginConfigured: null,
    publicOriginError: "Your current access cannot read the approved public origin.",
    canActWithUnknownPublicOrigin: true,
    connections: [row({
      provider: "gmail_oauth2",
      lastTestedAt: "2026-10-02T10:00:00.000Z",
      lastTestStatus: "passed",
      onConnectGoogle: async () => {},
    })],
  });

  assert.match(unknownOrigin, /Public origin details are not visible/);
  assert.match(unknownOrigin, /NOVA will verify that an origin is configured/);
  assert.doesNotMatch(unknownOrigin, /Public origin could not be checked/);
  assert.doesNotMatch(unknownOrigin, /Your current access cannot read/);
  assert.doesNotMatch(buttonMarkup(unknownOrigin, "Save connection"), /disabled=""/);
  assert.doesNotMatch(buttonMarkup(unknownOrigin, "Send test"), /disabled=""/);
  assert.doesNotMatch(buttonMarkup(unknownOrigin, "Send test email"), /disabled=""/);
  assert.doesNotMatch(buttonMarkup(unknownOrigin, "Activate"), /disabled=""/);
  assert.doesNotMatch(buttonMarkup(unknownOrigin, "Connect Google"), /disabled=""/);
});

test("unknown-origin capability does not bypass confirmed-missing or pending/error gating", () => {
  const confirmedMissing = render({
    publicOriginConfigured: false,
    canActWithUnknownPublicOrigin: true,
    connections: [row({ isActive: true })],
  });
  assert.match(confirmedMissing, /Public origin required/);
  assert.match(buttonMarkup(confirmedMissing, "Save connection"), /disabled=""/);
  assert.match(buttonMarkup(confirmedMissing, "Send test"), /disabled=""/);
  assert.ok(buttonMarkup(confirmedMissing, "Deactivate"));

  const pending = render({
    publicOriginConfigured: null,
    canActWithUnknownPublicOrigin: true,
    connections: [row({ isActive: true })],
  });
  assert.match(pending, /Checking the approved public origin/);
  assert.match(buttonMarkup(pending, "Save connection"), /disabled=""/);
  assert.match(buttonMarkup(pending, "Send test"), /disabled=""/);

  const unreadableWithoutCapability = render({
    publicOriginConfigured: null,
    publicOriginError: "Origin settings could not be read.",
    connections: [row({ isActive: true })],
  });
  assert.match(unreadableWithoutCapability, /Public origin could not be checked/);
  assert.match(buttonMarkup(unreadableWithoutCapability, "Save connection"), /disabled=""/);
  assert.match(buttonMarkup(unreadableWithoutCapability, "Send test"), /disabled=""/);
});

test("runtime provider choices are limited to supported options and empty support has an explicit state", () => {
  const resend = render({ supportedProviders: ["resend", "future-provider"] });
  assert.match(resend, /Resend API key/);
  assert.doesNotMatch(resend, /SMTP host/);
  assert.doesNotMatch(resend, /Google OAuth client secret/);

  const unsupportedRuntime = render({ supportedProviders: [] });
  assert.match(unsupportedRuntime, /No supported provider/);
  assert.doesNotMatch(unsupportedRuntime, /name="resendApiKey"/);
});

test("connection actions require test success; unsupported saved connections can still be deactivated", () => {
  const untested = render({ connections: [row()] });
  assert.match(untested, /Send and pass a test before this connection can be activated/);
  assert.match(buttonMarkup(untested, "Activate"), /disabled=""/);
  assert.match(untested, /aria-controls="[^"]+-test-form"/);

  const passed = render({ connections: [row({ lastTestedAt: "2026-10-02T10:00:00.000Z", lastTestStatus: "passed" })] });
  assert.match(passed, /Tested/);
  assert.ok(buttonMarkup(passed, "Activate"));
  assert.doesNotMatch(buttonMarkup(passed, "Activate"), /disabled=""/);

  const failed = render({ connections: [row({ lastTestedAt: "2026-10-02T10:00:00.000Z", lastTestStatus: "failed" })] });
  assert.match(failed, /The latest test failed/);
  assert.match(buttonMarkup(failed, "Activate"), /disabled=""/);

  const unsupported = render({ connections: [row({ supported: false, isActive: true })] });
  assert.match(unsupported, /Unavailable in this runtime/);
  assert.match(unsupported, /Active · unavailable here/);
  assert.match(unsupported, /Deactivate/);
  assert.doesNotMatch(unsupported, /Connect Google/);
});

test("a local test result yields to any newer server test snapshot", () => {
  const serverSnapshot = { lastTestedAt: "2026-10-02T10:00:00.000Z", lastTestStatus: "passed" };
  const localPass = { status: "passed", serverTestedAt: serverSnapshot.lastTestedAt, serverStatus: "passed" };

  assert.equal(effectiveEmailTestStatus(localPass, serverSnapshot), "passed");
  assert.equal(effectiveEmailTestStatus(localPass, {
    lastTestedAt: "2026-10-03T10:00:00.000Z",
    lastTestStatus: "failed",
  }), "failed");

  const localFailure = { status: "failed", serverTestedAt: serverSnapshot.lastTestedAt, serverStatus: "passed" };
  assert.equal(effectiveEmailTestStatus(localFailure, {
    lastTestedAt: "2026-10-03T10:00:00.000Z",
    lastTestStatus: "passed",
  }), "passed");
  assert.equal(effectiveEmailTestStatus(localPass, {
    lastTestedAt: serverSnapshot.lastTestedAt,
    lastTestStatus: "failed",
  }), "failed");
});

test("action failures distinguish definitive rejection from an unconfirmed outcome", () => {
  const serverFailure = Object.assign(new Error("REQUEST_FAILED"), { httpStatus: 503 });
  const rejected = Object.assign(new Error("EMAIL_PROVIDER_INVALID"), { httpStatus: 400 });

  assert.equal(classifyEmailDeliveryActionFailure(new EmailDeliveryActionError("conflict", "Conflict.")), "conflict");
  assert.equal(classifyEmailDeliveryActionFailure(new EmailDeliveryActionError("error", "Access denied.")), "error");
  assert.equal(classifyEmailDeliveryActionFailure(rejected), "error");
  assert.equal(classifyEmailDeliveryActionFailure(serverFailure), "unconfirmed");
  assert.equal(classifyEmailDeliveryActionFailure(new TypeError("Failed to fetch")), "unconfirmed");

  const feedback = renderToStaticMarkup(React.createElement(EmailDeliveryActionFeedback, {
    kind: "unconfirmed",
    message: "REQUEST_FAILED",
    refreshLabel: "Refresh saved connections",
    onRefresh() {},
  }));
  assert.match(feedback, /Outcome unconfirmed/);
  assert.match(feedback, /may have completed/);
  assert.match(feedback, /check the saved connection before trying again/);
  assert.match(feedback, /Refresh saved connections/);
  assert.doesNotMatch(feedback, /Connection was not saved/);
});

test("settings host preserves ambiguous mutation outcomes for feature feedback", () => {
  const route = fs.readFileSync(path.join(__dirname, "../../../../app/settings-email-delivery-route.js"), "utf8");
  const start = route.indexOf("async function performAction(work, conflictCodes = [], refreshAfter = true)");
  const end = route.indexOf("\n  publish();", start);
  const action = route.slice(start, end);

  assert.notEqual(start, -1, "email delivery route action boundary must remain discoverable");
  assert.notEqual(end, -1, "email delivery route action boundary must remain bounded");
  assert.match(route, /const changedMessage = "Super Admin access changed while saving/);
  assert.match(route, /recoverProtectedCommandFailure\(error, context, changedMessage\)/);
  assert.match(action, /new feature\.EmailDeliveryActionError\("unconfirmed"/);
  assert.match(action, /conflictCodes\.includes\(error\?\.code\) \? "conflict" : feature\.classifyEmailDeliveryActionFailure\(error\)/);
});

test("OAuth return stays unverified until the provider test and Google connect affordance remains explicit", () => {
  const returned = render({
    oauthResult: { status: "pending", message: "Send a test email to verify the sender." },
    connections: [row({ provider: "gmail_oauth2", onConnectGoogle: async () => {} })],
  });
  assert.match(returned, /Google return received/);
  assert.match(returned, /Send a test email to verify the sender/);
  assert.match(returned, /Connect Google/);
  assert.doesNotMatch(returned, /Google connected/);
});

test("feature styling uses declared tokens and container-responsive accessible controls", () => {
  const css = fs.readFileSync(path.join(__dirname, "EmailDelivery.module.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "../../../design-system/foundations/tokens.css"), "utf8");
  const declared = new Set([...tokens.matchAll(/(--nova-[\w-]+)\s*:/g)].map((match) => match[1]));
  const referenced = [...new Set([...css.matchAll(/var\((--nova-[\w-]+)/g)].map((match) => match[1]))];

  assert.match(css, /container: email-delivery \/ inline-size/);
  assert.match(css, /@container email-delivery \(min-width: 68rem\)/);
  assert.match(css, /@container email-delivery \(max-width: 44rem\)/);
  assert.match(css, /@media \(any-pointer: coarse\)[\s\S]*?--nova-control-touch-target/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of referenced) assert.ok(declared.has(token), `undefined NOVA token: ${token}`);
});

test("recoverable creation failures preserve credentials and duplicate submission has a synchronous guard", () => {
  const cardSource = fs.readFileSync(path.join(__dirname, "ConnectionCard.tsx"), "utf8");
  const deliverySource = fs.readFileSync(path.join(__dirname, "EmailDelivery.tsx"), "utf8");
  assert.match(deliverySource, /catch \(error\) \{\s*setCreateError\(\{\s*kind: classifyEmailDeliveryActionFailure\(error\),\s*message: safeErrorMessage\(error\),\s*\}\);\s*\}/);
  assert.match(deliverySource, /createInFlight\.current/);
  assert.match(deliverySource, /setSmtpDraft\(\{ host: "", port: "587", username: "", password: "", secure: false \}\)/);
  assert.match(deliverySource, /setResendDraft\(\{ apiKey: "" \}\)/);
  assert.match(deliverySource, /await props\.onCreate\(buildCreateInput\(\)\)/);
  assert.match(deliverySource, /await props\.onCreate\(buildCreateInput\(\)\);\s*setName\(""\)/);
  assert.match(cardSource, /const failureKind = classifyEmailDeliveryActionFailure\(error\)/);
  assert.match(deliverySource, /onRefresh=\{createError\.kind === "unconfirmed" \? props\.onRetry : undefined\}/);
  assert.match(cardSource, /onRefresh=\{actionError\.kind === "unconfirmed" \? onRefresh : undefined\}/);
  assert.match(deliverySource, /createBusy \? <StateMessage kind="loading">Saving connection/);
  assert.match(cardSource, /busyAction \? <StateMessage kind="loading">/);
  assert.match(cardSource, /setLocalActive\(true\)/);
  assert.match(cardSource, /setLocalActive\(false\)/);
  assert.match(cardSource, /action === "test" && failureKind !== "unconfirmed"/);
  assert.match(cardSource, /setLocalTestResult\(\{\s*status: "failed"/);
});
