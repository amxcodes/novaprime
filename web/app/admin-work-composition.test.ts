import { describe, expect, it } from "bun:test";
import { isValidElement } from "react";
import { createAdminWorkComposition } from "./admin-work-composition.js";

function adminData(grants: Array<{ permissionKey: string; scope: string; clientId?: string }> = []) {
  return {
    actorGrants: { workVisible: true, grants },
    workContext: { clients: [{ id: "client-1", name: "Northstar" }] },
  };
}

function harness(data: ReturnType<typeof adminData>, modules: Record<string, unknown> = {}) {
  const state = { identityEpoch: 4, identityPersonId: "actor-1", adminData: data };
  const target = { isConnected: true };
  const lifetime = { id: "admin" };
  const calls: string[] = [];
  const host = {
    canShowAdminFeature: (read: typeof data["actorGrants"], feature: string) => feature === "work" && read.workVisible,
    hasAdminPermission: (read: typeof data, permissionKey: string, target: Record<string, string> = {}) =>
      read.actorGrants.grants.some((grant) => grant.permissionKey === permissionKey &&
        (grant.scope === "organisation" || (grant.scope === "client" && grant.clientId === target.clientId))),
    hasAnyPermissionGrant: (read: typeof data["actorGrants"], permissionKeys: string[], scopes: string[]) =>
      read.grants.some((grant) => permissionKeys.includes(grant.permissionKey) && scopes.includes(grant.scope)),
    planAdminReads: () => ({ tasks: false }),
    isCurrentPageRequest: () => true,
    adminReadIssue: () => undefined,
    adminFeatureReadError: () => null,
    adminCommandUiError: (message: string) => new Error(message),
    runAdminProtectedCommand: async () => undefined,
    pageApi: async () => ({}),
    requestOptions: () => ({}),
    errorText: () => "error",
    setMessage: () => undefined,
    taskCreateIdempotencyHeaders: () => ({}),
    clearTaskCreateIdempotency: () => undefined,
    taskBillingConfirmation: () => "",
    taskCorrectionConfirmation: () => "",
    projectTaskComposerOptions: () => ({}),
    canViewAdminPeople: () => false,
    captureCommandContext: () => ({}),
    isCurrentCommand: () => true,
    isCurrentCommandIdentity: () => true,
    recoverProtectedCommandFailure: () => false,
    api: async () => ({}),
    isWithinApp: () => true,
  };
  return {
    calls,
    compose(overrides: Partial<Parameters<typeof createAdminWorkComposition>[0]> = {}) {
      return createAdminWorkComposition({
        data,
        state,
        target,
        lifetime,
        identityEpoch: state.identityEpoch,
        revision: 3,
        modules: { ...modules },
        fallback: () => null,
        host,
        ...overrides,
      });
    },
  };
}

describe("Admin Work route composition", () => {
  it("does not compose or invoke feature adapters without the Work capability", () => {
    const data = adminData();
    data.actorGrants.workVisible = false;
    const contextRoute = () => { throw new Error("hidden feature adapter was invoked"); };
    const result = harness(data, { adminWorkContextCreationRoute: contextRoute }).compose();
    expect(result).toBeNull();
  });

  it("composes only the granted Work feature and passes the current Admin snapshot", () => {
    const data = adminData([{ permissionKey: "clients.create", scope: "organisation" }]);
    function AdminWorkSection() {}
    function WorkContextCreation() {}
    function TaskComposer() {}
    function WorkOperations() {}
    function AdminClientMembershipTargets() {}
    function AdminClientMembershipEditor() {}
    let receivedData: unknown;
    const routeFactory = () => ({ createProps: (current: unknown) => { receivedData = current; return { readState: { status: "ready" } }; } });
    const composition = harness(data, {
      AdminWorkSection,
      WorkContextCreation,
      TaskComposer,
      WorkOperations,
      AdminClientMembershipTargets,
      AdminClientMembershipEditor,
      adminWorkContextCreationRoute: routeFactory,
    }).compose();

    expect(isValidElement(composition)).toBe(true);
    expect(composition?.type).toBe(AdminWorkSection);
    expect(composition?.props.contextCreation.type).toBe(WorkContextCreation);
    expect(composition?.props.taskComposer).toBeNull();
    expect(composition?.props.taskOperations).toBeNull();
    expect(composition?.props.membershipTargets).toBeNull();
    expect(receivedData).toBe(data);
  });

  it("keeps membership editors lazy behind authorized client targets", () => {
    const data = adminData([{ permissionKey: "clients.members.manage", scope: "client", clientId: "client-1" }]);
    function AdminWorkSection() {}
    function AdminClientMembershipTargets() {}
    function AdminClientMembershipEditor() {}
    const routeFactory = () => ({
      projectTargets: () => [{ id: "client-1", name: "Northstar" }],
      createProps: (_current: unknown, client: { id: string }, isCurrent: () => boolean) => ({ client, isCurrent }),
    });
    const composition = harness(data, {
      AdminWorkSection,
      AdminClientMembershipTargets,
      AdminClientMembershipEditor,
      adminClientMembershipsRoute: routeFactory,
    }).compose();

    const targets = composition?.props.membershipTargets;
    expect(targets.type).toBe(AdminClientMembershipTargets);
    expect(targets.props.targets).toEqual({ status: "ready", targets: [{ id: "client-1", name: "Northstar" }] });
    expect(typeof targets.props.renderMemberships).toBe("function");
    const isCurrent = () => false;
    const editor = targets.props.renderMemberships({ id: "client-1", name: "Northstar" }, isCurrent);
    expect(editor.type).toBe(AdminClientMembershipEditor);
    expect(editor.props.client.id).toBe("client-1");
    expect(editor.props.isCurrent).toBe(isCurrent);
  });
});
