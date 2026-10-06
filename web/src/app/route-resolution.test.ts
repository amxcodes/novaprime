import { describe, expect, test } from "bun:test";
import {
  resolveApplicationRoute,
  WORKSPACE_ROUTE_IDS,
} from "./route-resolution";
import {
  resolveWorkspaceDestinationView,
  WORKSPACE_DESTINATIONS,
  WORKSPACE_DESTINATION_VIEW_IDS,
} from "../../workspace-destinations.js";

const resolve = (pathname: string, search = "") => resolveApplicationRoute(
  { pathname, search },
  resolveWorkspaceDestinationView,
);

describe("application route resolution", () => {
  test("resolves invitation and password-reset paths before query destinations", () => {
    expect(resolve("/accept-invite", "?view=settings")).toEqual({ kind: "public", view: "accept" });
    expect(resolve("/nested/accept-invite/", "?view=login")).toEqual({ kind: "public", view: "accept" });
    expect(resolve("/reset-password", "?view=settings")).toEqual({ kind: "public", view: "reset" });
    expect(resolve("/nested/reset-password/", "?view=forgot")).toEqual({ kind: "public", view: "reset" });
  });

  test("resolves supported public query routes and leaves unknown views unresolved", () => {
    for (const view of ["setup", "login", "forgot", "deploy"] as const) {
      expect(resolve("/", `?view=${view}`)).toEqual({ kind: "public", view });
    }
    expect(resolve("/", "?view=unknown")).toEqual({ kind: "workspace", view: null });
    expect(resolve("/", "")).toEqual({ kind: "workspace", view: null });
  });

  test("uses the existing destination resolver for workspace aliases and deep links", () => {
    expect(resolve("/", "?view=work")).toEqual({ kind: "workspace", view: "work" });
    expect(resolve("/", "?view=today&task=task-1")).toEqual({ kind: "workspace", view: "work" });
    expect(resolve("/", "?view=work&reviewerRequest=11111111-1111-4111-8111-111111111111"))
      .toEqual({ kind: "workspace", view: "work" });
    expect(resolve("/", "?view=work&reviewerRequest=not-an-id"))
      .toEqual({ kind: "workspace", view: null });
  });

  test("keeps route IDs synchronized with the capability-filtered workspace registry", () => {
    expect(WORKSPACE_ROUTE_IDS).toEqual(WORKSPACE_DESTINATION_VIEW_IDS);
    expect(WORKSPACE_DESTINATIONS.map(({ view }) => view)).toEqual(WORKSPACE_ROUTE_IDS);
    expect(resolve("/", "?view=admin")).toEqual({ kind: "workspace", view: "admin" });
  });
});
