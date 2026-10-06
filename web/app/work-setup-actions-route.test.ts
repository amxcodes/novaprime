import { describe, expect, it } from "bun:test";
import { createWorkSetupActionsRoute } from "./work-setup-actions-route.ts";
import type { TaskCatalogPermissions } from "../src/features/work-setup/contracts.ts";

interface RecordedRequest {
  path: string;
  method: string;
  body: unknown;
}

function harness(options: {
  allowed?: string[];
  commandCurrent?: boolean;
  apiResponse?: (path: string) => unknown;
  rulesResponse?: unknown;
  pageReadResponse?: (path: string) => unknown;
  can?: (permissionKey: string, target?: { clientId?: unknown; clientWorkstreamId?: unknown }) => boolean;
} = {}) {
  const source = { isConnected: true } as unknown as Element;
  const lifetime = { id: "work-setup-page" };
  const allowed = new Set(options.allowed ?? [
    "tasks.catalog.propose",
    "tasks.catalog.review",
    "tasks.catalog.view",
    "workstreams.billing_policy.manage",
  ]);
  const checks: Array<{ permissionKey: string; target?: { clientId?: unknown; clientWorkstreamId?: unknown } }> = [];
  const requests: RecordedRequest[] = [];
  const pageReads: Array<{ path: string; lifetime: unknown }> = [];
  const commands: Array<{ source: Element; lifetime: unknown; resource?: string }> = [];
  const route = createWorkSetupActionsRoute({
    can(permissionKey, target) {
      checks.push({ permissionKey, target });
      return options.can ? options.can(permissionKey, target) : allowed.has(permissionKey);
    },
    requestOptions(method, body) {
      return { method, body } as RequestInit;
    },
    async api(path, requestOptions) {
      const request = requestOptions as RequestInit & { body?: unknown };
      requests.push({ path, method: request.method || "GET", body: request.body });
      if (options.apiResponse) return options.apiResponse(path);
      if (path === "/api/task-catalog") return { status: "pending" };
      if (path.endsWith("/archive")) return { status: "pending" };
      if (path.includes("/proposals/")) return { status: "stale" };
      if (path.includes("/definitions/")) return { policyClass: null, revision: 8 };
      if (path.endsWith("/billing-policy")) return { policyClass: "billable", revision: 9 };
      return { status: "saved" };
    },
    async pageApi(path, requestLifetime) {
      pageReads.push({ path, lifetime: requestLifetime });
      if (options.pageReadResponse) return options.pageReadResponse(path);
      if ("rulesResponse" in options) return options.rulesResponse;
      return {
        defaultClass: "billable",
        defaultRevision: 4,
        entries: [{
          entryId: "entry 1",
          title: "Prepare report",
          description: "Quarterly reporting",
          priority: "high",
          catalogRevision: 7,
          billingClass: "non_billable",
          ruleRevision: 3,
          ignoredPrivateField: "not exposed",
        }],
        ignoredPrivateField: "not exposed",
      };
    },
    async runCommand(commandSource, commandLifetime, work, resource) {
      commands.push({ source: commandSource, lifetime: commandLifetime, resource });
      if (options.commandCurrent === false) throw new Error("The page changed before the action could start.");
      return work();
    },
    permissionDenied() {
      return Object.assign(new Error("NOVA could not complete this work-setup action."), { code: "PERMISSION_DENIED" });
    },
  });
  return { route, source, lifetime, allowed, checks, requests, pageReads, commands };
}

const catalogPermissions: TaskCatalogPermissions = {
  view: false,
  propose: true,
  manage: false,
  review: true,
};
const catalogInput = {
  title: "Prepare report",
  description: "Quarterly reporting",
  priority: "high" as const,
  reason: "Recurring team task",
};

describe("Work Setup action route", () => {
  it("rejects a missing task-catalog mutation response instead of reporting success", async () => {
    const state = harness({ apiResponse: () => null });
    const actions = state.route.createCatalogActions({
      source: state.source,
      lifetime: state.lifetime,
      permissions: catalogPermissions,
    });

    await expect(actions.onCreate(catalogInput)).rejects.toThrow("task catalog response could not be read");
    expect(state.requests).toHaveLength(1);
  });

  it("preserves task-catalog endpoints, payloads, and mutation result mapping", async () => {
    const state = harness();
    const actions = state.route.createCatalogActions({
      source: state.source,
      lifetime: state.lifetime,
      permissions: catalogPermissions,
    });

    expect(await actions.onCreate(catalogInput)).toBe("pending");
    expect(await actions.onUpdate("entry 1", { ...catalogInput, expectedRevision: 2 })).toBe("saved");
    expect(await actions.onArchive("entry 1", { reason: "Retired", expectedRevision: 3 })).toBe("pending");
    expect(await actions.onReview("proposal 1", { decision: "approved", reviewNote: null })).toBe("stale");

    expect(state.requests).toEqual([
      { path: "/api/task-catalog", method: "POST", body: catalogInput },
      { path: "/api/task-catalog/entry%201", method: "PATCH", body: { ...catalogInput, expectedRevision: 2 } },
      { path: "/api/task-catalog/entry%201/archive", method: "POST", body: { reason: "Retired", expectedRevision: 3 } },
      { path: "/api/task-catalog/proposals/proposal%201/review", method: "POST", body: { decision: "approved", reviewNote: null } },
    ]);
    expect(state.checks.map((check) => check.permissionKey)).toEqual([
      "tasks.catalog.propose", "tasks.catalog.propose", "tasks.catalog.propose", "tasks.catalog.review",
    ]);
    expect(state.commands).toHaveLength(4);
    expect(state.commands.every((command) => command.source === state.source && command.lifetime === state.lifetime)).toBe(true);
  });

  it("rechecks current catalog permission before every command and fails closed", async () => {
    const state = harness();
    const actions = state.route.createCatalogActions({
      source: state.source,
      lifetime: state.lifetime,
      permissions: catalogPermissions,
    });
    await actions.onCreate(catalogInput);
    state.allowed.delete("tasks.catalog.propose");

    await expect(actions.onArchive("entry-2", { reason: "Retired", expectedRevision: 1 }))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(state.requests).toHaveLength(1);
    expect(state.commands).toHaveLength(1);
  });

  it("checks billing and catalog capabilities against the target workstream and projects rule reads", async () => {
    const state = harness({
      can: (permissionKey, target) => {
        if (permissionKey === "workstreams.billing_policy.manage") {
          return target?.clientId === "client-1" && target.clientWorkstreamId === "stream/1";
        }
        return ["tasks.catalog.view", "tasks.catalog.manage"].includes(permissionKey);
      },
    });
    const actions = state.route.createBillingActions({
      source: state.source,
      lifetime: state.lifetime,
      workContext: {
        clientWorkstreams: [
          { id: "stream/1", client_id: "client-1", canManageBillingPolicy: true },
          { id: "unmanageable", client_id: "client-2", canManageBillingPolicy: false },
        ],
      },
    });

    expect(await actions.onLoadRules("stream/1")).toEqual({
      defaultClass: "billable",
      defaultRevision: 4,
      entries: [{
        entryId: "entry 1",
        title: "Prepare report",
        description: "Quarterly reporting",
        priority: "high",
        catalogRevision: 7,
        billingClass: "non_billable",
        ruleRevision: 3,
      }],
    });
    expect(state.pageReads).toEqual([{
      path: "/api/workstreams/client/stream%2F1/billing-policy/definitions",
      lifetime: state.lifetime,
    }]);
    expect(await actions.onSaveDefault("stream/1", {
      policyClass: "billable", expectedRevision: 4, reason: "Default for one-off tasks",
    })).toEqual({ policyClass: "billable", revision: 9 });
    expect(await actions.onSaveRule("stream/1", "entry 1", {
      policyClass: "non_billable", expectedRevision: 3, reason: "Included in retainer",
    })).toEqual({ policyClass: null, revision: 8 });
    expect(state.requests.map(({ path, method }) => [path, method])).toEqual([
      ["/api/workstreams/client/stream%2F1/billing-policy", "PATCH"],
      ["/api/workstreams/client/stream%2F1/billing-policy/definitions/entry%201", "PATCH"],
    ]);
    expect(state.checks.filter((check) => check.permissionKey === "workstreams.billing_policy.manage")
      .every((check) => check.target?.clientId === "client-1" && check.target.clientWorkstreamId === "stream/1"))
      .toBe(true);
  });

  it("searches workstreams on the server and returns only billing-manageable summaries", async () => {
    const state = harness({ pageReadResponse: () => ({
      clientWorkstreams: [
        { id: "stream-1", name: "Delivery", client_name: "Northstar", canManageBillingPolicy: true,
          billingPolicyClass: "billable", billingPolicyRevision: 4 },
        { id: "stream-2", name: "Restricted", client_name: "Northstar", canManageBillingPolicy: false,
          billingPolicyClass: "billable", billingPolicyRevision: 1 },
      ],
    }) });
    const actions = state.route.createBillingActions({
      source: state.source,
      lifetime: state.lifetime,
      workContext: { clientWorkstreams: [] },
    });

    expect(await actions.onSearchWorkstreams("Northstar")).toEqual([{
      id: "stream-1", name: "Delivery", clientName: "Northstar",
      policyClass: "billable", policyRevision: 4,
    }]);
    expect(state.pageReads).toEqual([{
      path: "/api/work-context?q=Northstar",
      lifetime: state.lifetime,
    }]);
  });

  it("sends predefined-task searches to the permission-checked server read", async () => {
    const state = harness();
    const actions = state.route.createBillingActions({
      source: state.source,
      lifetime: state.lifetime,
      workContext: { clientWorkstreams: [{ id: "stream-1", clientId: "client-1", canManageBillingPolicy: true }] },
    });

    await actions.onLoadRules("stream-1", "delivery");
    expect(state.pageReads).toEqual([{
      path: "/api/workstreams/client/stream-1/billing-policy/definitions?q=delivery",
      lifetime: state.lifetime,
    }]);
  });

  it("rejects malformed billing mutation revisions instead of coercing them to zero", async () => {
    const state = harness({ apiResponse: () => ({ policyClass: "billable" }) });
    const actions = state.route.createBillingActions({
      source: state.source,
      lifetime: state.lifetime,
      workContext: { clientWorkstreams: [{ id: "stream-1", clientId: "client-1", canManageBillingPolicy: true }] },
    });

    await expect(actions.onSaveDefault("stream-1", {
      policyClass: "billable", expectedRevision: 1, reason: "Configure",
    })).rejects.toThrow("billing policy update response could not be read");
    expect(state.requests).toHaveLength(1);
  });

  it("treats only absent or null billing-rule entries as empty and rejects malformed shapes or rows", async () => {
    const workContext = { clientWorkstreams: [{ id: "stream-1", clientId: "client-1", canManageBillingPolicy: true }] };
    for (const rulesResponse of [
      { defaultClass: null, defaultRevision: 1 },
      { defaultClass: null, defaultRevision: 1, entries: null },
    ]) {
      const state = harness({ rulesResponse });
      const actions = state.route.createBillingActions({ source: state.source, lifetime: state.lifetime, workContext });
      expect(await actions.onLoadRules("stream-1")).toEqual({ defaultClass: null, defaultRevision: 1, entries: [] });
    }

    for (const rulesResponse of [
      { defaultClass: null, defaultRevision: 1, entries: "malformed" },
      { defaultClass: null, defaultRevision: 1, entries: [null] },
      null,
    ]) {
      const state = harness({ rulesResponse });
      const actions = state.route.createBillingActions({ source: state.source, lifetime: state.lifetime, workContext });
      await expect(actions.onLoadRules("stream-1")).rejects.toThrow();
    }
  });

  it("rejects missing target/catalog capabilities before calling any billing API", async () => {
    const state = harness({
      can: (permissionKey) => permissionKey === "workstreams.billing_policy.manage",
    });
    const actions = state.route.createBillingActions({
      source: state.source,
      lifetime: state.lifetime,
      workContext: { clientWorkstreams: [{ id: "stream-1", clientId: "client-1", canManageBillingPolicy: true }] },
    });

    await expect(actions.onLoadRules("stream-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(actions.onSaveDefault("stream-1", {
      policyClass: "billable", expectedRevision: 1, reason: "Configure",
    })).resolves.toEqual({ policyClass: "billable", revision: 9 });
    await expect(actions.onSaveRule("stream-1", "entry-1", {
      policyClass: null, expectedRevision: 1, reason: "Override",
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    expect(state.requests).toHaveLength(1);
    expect(state.pageReads).toHaveLength(0);
    expect(state.commands).toHaveLength(1);
  });

  it("keeps stale page/command rejection delegated to the host lifetime guard", async () => {
    const state = harness({ commandCurrent: false });
    const actions = state.route.createCatalogActions({
      source: state.source,
      lifetime: state.lifetime,
      permissions: catalogPermissions,
    });

    await expect(actions.onCreate(catalogInput)).rejects.toThrow("The page changed before the action could start.");
    expect(state.requests).toHaveLength(0);
  });
});
