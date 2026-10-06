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
const { AuditEvents, filterAuditEvents } = require("./AuditEvents.tsx");

function render(readState) {
  return renderToStaticMarkup(React.createElement(AuditEvents, { readState }));
}

test("denied read renders an access state without exposing event data", () => {
  const html = render({ status: "denied", message: "Audit read is unavailable." });

  assert.match(html, /Recent audit activity is unavailable/);
  assert.match(html, /Audit read is unavailable\./);
  assert.doesNotMatch(html, /event-secret|raw-details/);
});

test("failed read renders a recoverable error state", () => {
  const html = render({ status: "error", message: "Try again later." });

  assert.match(html, /Recent audit activity could not be loaded/);
  assert.match(html, /Try again later\./);
  assert.doesNotMatch(html, /No audit events/);
});

test("empty results disclose the request bound without claiming full history", () => {
  const html = render({ status: "empty", requestLimit: 50 });

  assert.match(html, /No audit events/);
  assert.match(html, /only events returned by the request \(maximum 50\)/);
});

test("ready state shows only safe summary fields and labels its loaded bound", () => {
  const html = render({
    status: "ready",
    requestLimit: 50,
    events: [
      {
        id: "event-1",
        action: "person.invited",
        occurredAt: "2026-10-02T10:00:00.000Z",
        actorName: "Aman",
        targetId: "do-not-show-target-id",
        details: { token: "raw-details-secret" },
      },
      {
        id: "event-2",
        action: "role.updated",
        occurredAt: "not-a-date",
        actorName: null,
        details: "event-secret",
      },
    ],
  });

  assert.match(html, /2 loaded · request limit 50/);
  assert.match(html, /Search loaded actions and actors/);
  assert.match(html, /All actions/);
  assert.match(html, /2 of 2 loaded events shown/);
  assert.match(html, /Filters apply only to this request’s returned rows/);
  assert.match(html, /Person invited/);
  assert.match(html, /Aman/);
  assert.match(html, /Role updated/);
  assert.ok(html.includes(Intl.DateTimeFormat().resolvedOptions().timeZone));
  assert.match(html, /System/);
  assert.match(html, /Timestamp unavailable/);
  assert.doesNotMatch(html, /do-not-show-target-id|raw-details-secret|event-secret/);
});

test("local filters match only the safe projected action and actor fields", () => {
  const events = [
    { id: "event-1", action: "person.invited", occurredAt: "2026-10-02T10:00:00.000Z", actorName: "Aman", details: { token: "secret" } },
    { id: "event-2", action: "role.updated", occurredAt: "2026-10-02T09:00:00.000Z", actorName: null, details: "secret" },
  ];

  assert.deepEqual(filterAuditEvents(events, { search: "AMAN", action: null }).map(({ id }) => id), ["event-1"]);
  assert.deepEqual(filterAuditEvents(events, { search: "role updated", action: null }).map(({ id }) => id), ["event-2"]);
  assert.deepEqual(filterAuditEvents(events, { search: "system", action: null }).map(({ id }) => id), ["event-2"]);
  assert.deepEqual(filterAuditEvents(events, { search: "secret", action: null }), []);
  assert.deepEqual(filterAuditEvents(events, { search: "aman", action: "role.updated" }), []);
  assert.deepEqual(filterAuditEvents(events, { search: "", action: "role.updated" }).map(({ id }) => id), ["event-2"]);
  assert.equal(events.length, 2, "filtering must not mutate or page the loaded source rows");
});

test("loading is announced as a status", () => {
  const html = render({ status: "loading" });

  assert.match(html, /role="status"/);
  assert.match(html, /Loading recent audit activity/);
});

test("action identifiers receive readable fallback labels", () => {
  const html = render({
    status: "ready",
    requestLimit: 5,
    events: [
      { id: "event-1", action: "membership.roleAssigned", occurredAt: "not-a-date", actorName: null },
      { id: "event-2", action: "   ", occurredAt: "not-a-date", actorName: null },
    ],
  });
  assert.match(html, /Membership role assigned/);
  assert.match(html, /Organisation activity recorded/);
});

test("the feature contract excludes raw event payloads and grant decisions", () => {
  const source = fs.readFileSync(path.join(__dirname, "contracts.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.match(source, /actorName: string \| null/);
  assert.doesNotMatch(source, /details\??:/);
  assert.doesNotMatch(source, /people\.view|hasPermission|canView/);
});

test("the audit feature filters its supplied rows without fetching or broadening the DTO", () => {
  const source = fs.readFileSync(path.join(__dirname, "AuditEvents.tsx"), "utf8");

  assert.match(source, /filterAuditEvents\(readState\.events/);
  assert.doesNotMatch(source, /fetch\(|\/api\//);
  assert.match(source, /event\.action/);
  assert.match(source, /event\.actorName/);
  assert.match(source, /Only returned events are shown/);
});
