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
const { PageHeader } = require("../../../design-system/primitives/PageHeader.tsx");
const { NotificationDeliveryOperations } = require("./NotificationDeliveryOperations.tsx");

const delivery = {
  id: "private-delivery-id",
  eventKey: "task.assigned",
  status: "failed",
  attempts: 2,
  availableAt: "2026-10-03T08:00:00.000Z",
  createdAt: "2026-10-03T07:00:00.000Z",
  sentAt: null,
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(NotificationDeliveryOperations, {
    readState: { status: "ready", deliveries: [delivery], limit: 50 },
    canRequeue: true,
    onRequeue() {},
    onRetryRead() {},
    ...overrides,
  }));
}

test("PageHeader keeps its page-level h1 default and supports an embedded h2", () => {
  const pageLevel = renderToStaticMarkup(React.createElement(PageHeader, { title: "Page heading" }));
  const embedded = renderToStaticMarkup(React.createElement(PageHeader, { title: "Section heading", level: 2 }));
  assert.match(pageLevel, /<h1(?:\s[^>]*)?>Page heading<\/h1>/);
  assert.match(embedded, /<h2(?:\s[^>]*)?>Section heading<\/h2>/);
});

test("delivery operations has a distinct heading and accessible bounded loading, failure, and empty states", () => {
  const loading = render({ readState: { status: "loading" } });
  assert.match(loading, /Delivery operations/);
  assert.match(loading, /<h2(?:\s[^>]*)?>Notification delivery<\/h2>/);
  assert.doesNotMatch(loading, /<h1[^>]*>Notification delivery<\/h1>/);
  assert.match(loading, /Inspect recent notification delivery attempts/);
  assert.match(loading, /separate from the employee inbox/);
  assert.match(loading, /Loading recent delivery attempts/);

  const failed = render({ readState: { status: "failed", message: "Try again later." } });
  assert.match(failed, /Delivery attempts could not load/);
  assert.match(failed, /Try again later\./);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /No delivery attempts returned/);

  const empty = render({ readState: { status: "ready", deliveries: [], limit: 25 } });
  assert.match(empty, /0 recent deliveries returned, up to 25/);
  assert.match(empty, /no paging or total count/);
  assert.match(empty, /No delivery attempts returned/);
  assert.doesNotMatch(empty, /Confirm requeue/);
});

test("rows show safe projected fields and never render API-only identities, provider IDs, or raw errors", () => {
  const html = render({
    readState: {
      status: "ready",
      limit: 50,
      deliveries: [{
        ...delivery,
        recipientPersonId: "private-person-id",
        providerMessageId: "private-provider-message-id",
        lastError: "raw-provider-secret-sentinel",
        internalPayload: { token: "raw-payload-sentinel" },
      }],
    },
  });

  assert.match(html, /task\.assigned/);
  assert.match(html, /failed/);
  assert.match(html, /2/);
  assert.match(html, /Delivery failed\. Detailed provider response is not shown\./);
  assert.match(html, /Available at/);
  assert.doesNotMatch(html, /private-delivery-id|private-person-id|private-provider-message-id|raw-provider-secret-sentinel|raw-payload-sentinel/);
});

test("only failed and dead-letter rows show requeue, and only when the independent permission is present", () => {
  const statuses = ["failed", "dead_letter", "pending", "processing", "sent"];
  const rows = statuses.map((status, index) => ({
    ...delivery,
    id: `delivery-${index}`,
    status,
    attempts: status === "pending" ? 99 : 0,
    availableAt: status === "pending" ? "2020-01-01T00:00:00Z" : null,
  }));
  const html = render({ readState: { status: "ready", deliveries: rows, limit: 50 } });
  assert.equal((html.match(/<summary[^>]*>Requeue<\/summary>/g) || []).length, 2);
  assert.match(html, /Current status cannot be requeued/);

  const readOnly = render({ canRequeue: false });
  assert.match(readOnly, /Inspection only/);
  assert.doesNotMatch(readOnly, /Confirm requeue|<summary[^>]*>Requeue/);

  const permissionWithoutEligibleStatus = render({
    readState: { status: "ready", deliveries: [{ ...delivery, status: "pending", attempts: 500, availableAt: "2000-01-01T00:00:00Z" }], limit: 50 },
  });
  assert.doesNotMatch(permissionWithoutEligibleStatus, /Confirm requeue|<summary[^>]*>Requeue/);
});

test("requeue requires an explicit in-component confirmation and reports failures without exposing raw errors", () => {
  const html = render();
  assert.match(html, /<details/);
  assert.match(html, /resets the attempt count and may send this notification again/);
  assert.match(html, /Confirm requeue/);
  assert.match(html, /Cancel/);
  assert.match(html, /role="group" aria-labelledby=/);

  const source = fs.readFileSync(path.join(__dirname, "NotificationDeliveryOperations.tsx"), "utf8");
  const summaryMarkup = source.slice(source.indexOf("<summary"), source.indexOf("</summary>"));
  assert.doesNotMatch(summaryMarkup, /onRequeue/);
  assert.match(source, /await onRequeue\(delivery\.id\)/);
  assert.match(source, /NOVA could not requeue this delivery/);
  assert.match(source, /setLocalPendingId\(deliveryId\)/);
  assert.match(source, /const anyPending = localPendingId !== null/);
});

test("action feedback remains host-owned and contract props stay minimal", () => {
  const contracts = fs.readFileSync(path.join(__dirname, "contracts.ts"), "utf8");
  assert.doesNotMatch(contracts, /pendingId|actionError|actionNotice/);
  assert.doesNotMatch(contracts, /recipientPersonId|providerMessageId|lastError/);
});

test("contracts expose only the safe row projection and CSS is responsive, token-only, and forced-color aware", () => {
  const contracts = fs.readFileSync(path.join(__dirname, "contracts.ts"), "utf8");
  assert.match(contracts, /canRequeue: boolean/);
  assert.match(contracts, /onRequeue: \(deliveryId: string\)/);
  assert.doesNotMatch(contracts, /recipientPersonId|providerMessageId|lastError|permissionKey|grants|errorSummary/);

  const css = fs.readFileSync(path.join(__dirname, "NotificationDeliveryOperations.module.css"), "utf8");
  assert.match(css, /container: notification-delivery \/ inline-size/);
  assert.match(css, /@container notification-delivery \(max-width: 39\.999rem\)/);
  assert.match(css, /min-height: var\(--nova-control-touch-target\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\b(?:white|black|red|green)\b/i);
});
