import { describe, expect, test } from "bun:test";
import { searchAuthorizedWorkContext, type WorkContextSearchSource } from "./work-context-search.js";

const source: WorkContextSearchSource = {
  clients: [{ id: "client-1", name: "Northstar" }],
  clientWorkstreams: [
    { id: "client-stream-1", client_id: "client-1", client_name: "Northstar", name: "Delivery" },
    { id: "client-stream-2", client_id: "client-2", client_name: "Restricted client label", name: "Context-only stream" },
  ],
  organisationWorkstreams: [{ id: "org-stream-1", name: "Internal operations" }],
  taskCreationTargets: [
    { id: "target-client", name: "Client setup target", kind: "client", clientName: "Northstar" },
    { id: "target-org", name: "Planning", kind: "organisation" },
    { id: "hidden-group-target", name: "Private team", kind: "client", requiredGroupId: "group-hidden" },
  ],
  groups: [
    { id: "group-visible", name: "Launch team", clientWorkstreamId: "client-stream-1", organisationWorkstreamId: null, canViewGroup: true, canCreateTask: false },
    { id: "group-create", name: "Task target group", clientWorkstreamId: null, organisationWorkstreamId: "org-stream-1", canViewGroup: false, canCreateTask: true },
    { id: "group-hidden", name: "Hidden group", clientWorkstreamId: null, organisationWorkstreamId: "org-stream-1", canViewGroup: false, canCreateTask: false },
  ],
};

describe("authorized server-side work-context search", () => {
  test("returns only matched rows plus visible parent context", () => {
    const result = searchAuthorizedWorkContext(source, "launch team");
    expect(result.clients.map(({ id }) => id)).toEqual(["client-1"]);
    expect(result.clientWorkstreams.map(({ id }) => id)).toEqual(["client-stream-1"]);
    expect(result.groups.map(({ id }) => id)).toEqual(["group-visible"]);
    expect(result.organisationWorkstreams).toEqual([]);
    expect(result.taskCreationTargets).toEqual([]);
  });

  test("does not search IDs or hidden labels", () => {
    expect(searchAuthorizedWorkContext(source, "group-hidden").groups).toEqual([]);
    expect(searchAuthorizedWorkContext(source, "Hidden group").groups).toEqual([]);
  });

  test("keeps create-only targets out of browsable client and group data", () => {
    const result = searchAuthorizedWorkContext(source, "Task target group");
    expect(result.groups.map(({ id }) => id)).toEqual(["group-create"]);
    expect(result.clients).toEqual([]);
    expect(result.clientWorkstreams).toEqual([]);
    expect(result.organisationWorkstreams).toEqual([]);
    expect(result.taskCreationTargets).toEqual([]);
  });

  test("keeps context-only client names attached to their authorized stream", () => {
    const result = searchAuthorizedWorkContext(source, "Restricted client label");
    expect(result.clients).toEqual([]);
    expect(result.clientWorkstreams.map(({ id }) => id)).toEqual(["client-stream-2"]);
  });
});
