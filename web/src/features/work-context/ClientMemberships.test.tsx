import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ClientMembershipsView,
  type ClientMembershipsProps,
} from "./ClientMemberships";

const membership = {
  id: "membership-1",
  person: { id: "person-1", displayName: "Aman Verma" },
  clientDepartment: { id: "department-1", name: "Design" },
  membershipLabel: "Delivery lead",
  effectiveOn: "2026-04-01",
  effectiveUntil: null,
} as const;

const baseProps: ClientMembershipsProps = {
  client: { id: "client-1", name: "Northstar" },
  canViewMemberships: true,
  canManageMemberships: true,
  canSearchPeople: true,
  read: { status: "idle", memberships: [], hasMore: false, nextCursor: null, loadingMore: false },
  onSearchPeople: async () => [{ value: "person-1", label: "Aman Verma" }],
  onSearchDepartments: async () => [{ value: "department-1", label: "Design" }],
  onLoadMemberships: () => {},
  onLoadMore: () => {},
  onAddMembership: () => {},
  onEndMembership: () => {},
};

function render(props: Partial<ClientMembershipsProps> = {}) {
  return renderToStaticMarkup(createElement(ClientMembershipsView, { ...baseProps, ...props }));
}

describe("ClientMemberships", () => {
  it("does not expose membership records or commands without the host view capability", () => {
    const markup = render({
      canViewMemberships: false,
      read: { ...baseProps.read, status: "ready", memberships: [membership] },
    });

    expect(markup).toContain("Memberships are unavailable with your current access.");
    expect(markup).not.toContain("Aman Verma");
    expect(markup).not.toContain("Add client membership");
    expect(markup).not.toContain("End membership");
  });

  it("shows a load action only for an idle read and keeps loading explicit", () => {
    const idle = render();
    const loading = render({ read: { ...baseProps.read, status: "loading" } });

    expect(idle).toContain("Memberships have not been loaded.");
    expect(idle).toContain("Load client memberships");
    expect(loading).toContain("Loading memberships…");
    expect(loading).not.toContain("Load client memberships");
  });

  it("reports GET errors and preserves supplied records when a later-page read failed", () => {
    const initialError = render({ read: { ...baseProps.read, status: "error", error: "Memberships unavailable." } });
    const pageError = render({
      read: {
        status: "ready",
        memberships: [membership],
        hasMore: true,
        nextCursor: "effective-date~membership-id~client-id",
        loadingMore: false,
        error: "Older memberships could not be loaded.",
      },
    });

    expect(initialError).toContain("role=\"alert\"");
    expect(initialError).toContain("Retry memberships");
    expect(pageError).toContain("Aman Verma");
    expect(pageError).toContain("Older memberships could not be loaded.");
    expect(pageError).toContain("Retry older memberships");
  });

  it("exposes cursor pagination and a disabled pending state without owning the read", () => {
    const ready = {
      status: "ready" as const,
      memberships: [membership],
      hasMore: true,
      nextCursor: "effective-date~membership-id~client-id",
      loadingMore: false,
    };
    const page = render({ read: ready });
    const loadingMore = render({ read: { ...ready, loadingMore: true } });

    expect(page).toContain("Load older memberships");
    expect(loadingMore).toContain("Loading older memberships…");
    expect(loadingMore).toMatch(/<button[^>]*disabled=\"\"[^>]*>.*Loading older memberships…/);
  });

  it("renders person and client-department pickers without embedding business rows", () => {
    const markup = render();

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('name="personId"');
    expect(markup).toContain("Search people");
    expect(markup).toContain("Client department (optional)");
    expect(markup).toContain("Search client departments");
    expect(markup).not.toContain("<select");
    expect(markup).toContain("Membership label (optional)");
    expect(markup).toContain("Effective from");
  });

  it("does not expose the person picker or add command without organization people.view", () => {
    let loads = 0;
    const markup = render({
      canSearchPeople: false,
      onLoadMemberships: () => { loads += 1; },
    });

    expect(markup).toContain("organization-level people viewing access");
    expect(markup).not.toContain('role="combobox"');
    expect(markup).not.toContain("Add client membership");
    expect(loads).toBe(0);
  });

  it("keeps department search scoped through its feature-owned callback", () => {
    let requested = "";
    const markup = render({ onSearchDepartments: async (query) => { requested = query; return []; } });

    expect(markup).toContain("Client department (optional)");
    expect(markup).toContain("Search client departments");
    expect(markup).toContain('name="clientDepartmentId" value=""');
    expect(markup).not.toContain("<select");
    expect(requested).toBe("");
  });

  it("keeps records readable without management capability and hides add/end forms", () => {
    const markup = render({
      canManageMemberships: false,
      read: { ...baseProps.read, status: "ready", memberships: [membership] },
    });

    expect(markup).toContain("Aman Verma");
    expect(markup).toContain("Current");
    expect(markup).not.toContain("End membership");
    expect(markup).not.toContain("Add a client membership");
  });

  it("renders server operation failures as alerts and keeps the action retryable", () => {
    const markup = render({
      read: { ...baseProps.read, status: "ready", memberships: [membership] },
      addOperation: { status: "error", error: "That person already belongs to this client." },
      endOperations: { "membership-1": { status: "error", error: "Refresh the current membership first." } },
    });

    expect(markup).toContain("That person already belongs to this client.");
    expect(markup).toContain("Refresh the current membership first.");
    expect(markup.match(/role=\"alert\"/g)?.length).toBe(2);
  });

  it("names each membership-ending control with the person it affects", () => {
    const markup = render({
      read: { ...baseProps.read, status: "ready", memberships: [membership] },
    });

    expect(markup).toContain('aria-label="End access on for Aman Verma"');
    expect(markup).toContain('aria-label="End membership for Aman Verma"');
  });

  it("explains the server-enforced business-date minimum for membership end dates", () => {
    const markup = render({
      read: { ...baseProps.read, status: "ready", memberships: [membership] },
    });

    expect(markup).toContain("your current business date");
    expect(markup).toContain('aria-describedby=');
  });
});
