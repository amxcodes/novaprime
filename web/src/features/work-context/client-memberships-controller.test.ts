import { describe, expect, it } from "bun:test";
import {
  ClientMembershipsController,
  type ClientMembershipControllerDependencies,
  type ClientMembershipRequest,
} from "./client-memberships-controller";

const membership = {
  id: "membership-1",
  person: { id: "person-1", displayName: "Aman Verma" },
  clientDepartment: null,
  membershipLabel: "Delivery lead",
  effectiveOn: "2026-04-01",
  effectiveUntil: null,
};

const addInput = {
  personId: "person-1",
  membershipLabel: "  Delivery lead  ",
  effectiveOn: " 2026-04-01 ",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dependencies(
  overrides: Partial<ClientMembershipControllerDependencies> = {},
): ClientMembershipControllerDependencies {
  return {
    client: { id: "client/one", name: "Northstar" },
    canViewMemberships: true,
    canManageMemberships: true,
    canSearchPeople: true,
    request: async () => ({ memberships: [], limit: 50, hasMore: false, nextCursor: null }),
    runCommand: async (command) => command(),
    isCurrent: () => true,
    errorMessage: () => "Membership action failed.",
    ...overrides,
  };
}

describe("ClientMembershipsController", () => {
  it("requests cursor pages and appends the exact server rows", async () => {
    const calls: ClientMembershipRequest[] = [];
    const controller = new ClientMembershipsController(dependencies({
      request: async (request) => {
        calls.push(request);
        return request.path.includes("cursor=")
          ? { memberships: [{ ...membership, id: "membership-2", effectiveOn: "2026-03-01" }], limit: 50, hasMore: false, nextCursor: null }
          : { memberships: [membership], limit: 50, hasMore: true, nextCursor: "opaque/cursor+value" };
      },
    }));

    await controller.loadFirstPage();
    expect(controller.getSnapshot().read).toEqual({
      status: "ready",
      memberships: [membership],
      hasMore: true,
      nextCursor: "opaque/cursor+value",
      loadingMore: false,
    });

    await controller.loadMore("opaque/cursor+value");
    expect(calls).toEqual([
      { method: "GET", path: "/api/clients/client%2Fone/members?limit=50" },
      { method: "GET", path: "/api/clients/client%2Fone/members?limit=50&cursor=opaque%2Fcursor%2Bvalue" },
    ]);
    expect(controller.getSnapshot().read.memberships.map((row) => [row.id, row.effectiveOn])).toEqual([
      ["membership-1", "2026-04-01"],
      ["membership-2", "2026-03-01"],
    ]);
    expect(controller.getSnapshot().read).toMatchObject({ status: "ready", hasMore: false, nextCursor: null, loadingMore: false });
  });

  it("does not call any endpoint when view or mutation capability is missing", async () => {
    const calls: ClientMembershipRequest[] = [];
    const controller = new ClientMembershipsController(dependencies({
      canViewMemberships: false,
      canManageMemberships: false,
      request: async (request) => {
        calls.push(request);
        return {};
      },
    }));

    await controller.loadFirstPage();
    await controller.add(addInput);
    await controller.end("membership-1", "2026-04-20");

    expect(calls).toEqual([]);
    expect(controller.getSnapshot().read.status).toBe("idle");
  });

  it("does not add a membership without the people-view capability", async () => {
    const calls: ClientMembershipRequest[] = [];
    const controller = new ClientMembershipsController(dependencies({
      canSearchPeople: false,
      request: async (request) => {
        calls.push(request);
        return {};
      },
    }));

    await controller.add(addInput);

    expect(calls).toEqual([]);
  });

  it("settles a stale page read without exposing its late rows", async () => {
    const pendingRead = deferred<unknown>();
    let current = true;
    const controller = new ClientMembershipsController(dependencies({
      request: () => pendingRead.promise,
      isCurrent: () => current,
    }));

    const load = controller.loadFirstPage();
    expect(controller.getSnapshot().read.status).toBe("loading");
    current = false;
    pendingRead.resolve({ memberships: [membership], limit: 50, hasMore: false, nextCursor: null });
    await load;

    expect(controller.getSnapshot().read).toMatchObject({ status: "idle", memberships: [], loadingMore: false });
  });

  it("keeps loaded rows when a later cursor request fails and leaves it retryable", async () => {
    let page = 0;
    const controller = new ClientMembershipsController(dependencies({
      request: async () => {
        page += 1;
        if (page === 1) return { memberships: [membership], limit: 50, hasMore: true, nextCursor: "next" };
        throw new Error("raw server text");
      },
    }));

    await controller.loadFirstPage();
    await controller.loadMore("next");

    expect(controller.getSnapshot().read).toMatchObject({
      status: "ready",
      memberships: [membership],
      nextCursor: "next",
      loadingMore: false,
      error: "Membership action failed.",
    });
  });

  it("clears previously loaded records when the server denies the read capability", async () => {
    let page = 0;
    const controller = new ClientMembershipsController(dependencies({
      request: async () => {
        page += 1;
        if (page === 1) return { memberships: [membership], limit: 50, hasMore: true, nextCursor: "next" };
        throw Object.assign(new Error("permission denied"), { httpStatus: 403 });
      },
    }));

    await controller.loadFirstPage();
    await controller.loadMore("next");

    expect(controller.getSnapshot().read).toMatchObject({
      status: "error",
      memberships: [],
      hasMore: false,
      nextCursor: null,
      loadingMore: false,
      error: "Membership action failed.",
    });
  });

  it("keeps duplicate mutations out while pending and exposes a recoverable error", async () => {
    const pendingPost = deferred<unknown>();
    const calls: ClientMembershipRequest[] = [];
    const controller = new ClientMembershipsController(dependencies({
      request: (request) => {
        calls.push(request);
        if (request.method === "POST") return pendingPost.promise;
        return Promise.resolve({ memberships: [], limit: 50, hasMore: false, nextCursor: null });
      },
    }));

    const firstAttempt = controller.add(addInput);
    await Promise.resolve();
    expect(controller.getSnapshot().addOperation).toEqual({ status: "pending" });
    await controller.add(addInput);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);

    pendingPost.reject(new Error("database detail"));
    await firstAttempt;
    expect(controller.getSnapshot().addOperation).toEqual({ status: "error", error: "Membership action failed." });
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/clients/client%2Fone/members",
      body: { personId: "person-1", membershipLabel: "Delivery lead", effectiveOn: "2026-04-01" },
    });
  });

  it("uses existing POST/PATCH DTOs and refreshes the first page after each successful command", async () => {
    const calls: ClientMembershipRequest[] = [];
    const successMessages: string[] = [];
    const controller = new ClientMembershipsController(dependencies({
      request: async (request) => {
        calls.push(request);
        if (request.method === "GET") return { memberships: [membership], limit: 50, hasMore: false, nextCursor: null };
        return { ok: true };
      },
      runCommand: async (command, message) => {
        const result = await command();
        successMessages.push(message);
        return result;
      },
    }));

    await controller.loadFirstPage();
    await controller.add(addInput);
    await controller.end("member/id", "2026-04-25");

    expect(calls).toEqual([
      { method: "GET", path: "/api/clients/client%2Fone/members?limit=50" },
      {
        method: "POST",
        path: "/api/clients/client%2Fone/members",
        body: { personId: "person-1", membershipLabel: "Delivery lead", effectiveOn: "2026-04-01" },
      },
      { method: "GET", path: "/api/clients/client%2Fone/members?limit=50" },
      {
        method: "PATCH",
        path: "/api/clients/client%2Fone/members/member%2Fid/end",
        body: { effectiveUntil: "2026-04-25" },
      },
      { method: "GET", path: "/api/clients/client%2Fone/members?limit=50" },
    ]);
    expect(successMessages).toEqual(["Client membership added.", "Client membership ended on 2026-04-25."]);
    expect(controller.getSnapshot().read.memberships).toEqual([membership]);
    expect(controller.getSnapshot().endOperations).toEqual({});
  });
});
