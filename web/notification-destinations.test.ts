import { describe, expect, it } from "bun:test";
import { resolveNotificationDeepLink } from "./notification-destinations";
import { planAdminReads } from "./src/features/admin/capabilities";

const requestId = "101f0c80-51de-4fe8-a6d2-58f935318dd0";
const origin = "https://nova.example";

const leaveReviewer = {
  actorPersonId: "reviewer",
  grants: [{ permissionKey: "leave.review", scope: "organisation" }],
};
const wfhReviewer = {
  actorPersonId: "reviewer",
  grants: [{ permissionKey: "availability.wfh.review", scope: "organisation" }],
};
const requester = {
  actorPersonId: "requester",
  grants: [
    { permissionKey: "leave.request", scope: "own_record", selfApplicable: true },
    { permissionKey: "availability.wfh.request", scope: "own_record", selfApplicable: true },
  ],
};
const both = {
  actorPersonId: "reviewer",
  grants: [
    ...leaveReviewer.grants,
    ...wfhReviewer.grants,
    ...requester.grants,
  ],
};

function resolve(parameter: "leave" | "wfh", eventKey: string, grants: typeof requester | typeof leaveReviewer | typeof wfhReviewer | typeof both, id = requestId) {
  return resolveNotificationDeepLink(
    `/?view=today&${parameter}=${encodeURIComponent(id)}`,
    { origin, grants, eventKey },
  );
}

describe("availability notification destinations", () => {
  it("sends reviewer leave and WFH notices to their exact authorized Admin queues", () => {
    expect(resolve("leave", "leave.requested", leaveReviewer))
      .toBe(`/?view=admin&focus=leave-review&leave=${requestId}`);
    expect(resolve("wfh", "wfh.requested", wfhReviewer))
      .toBe(`/?view=admin&focus=wfh-review&wfh=${requestId}`);
  });

  it("keeps requester status notices in My Day even when the person also reviews", () => {
    expect(resolve("leave", "leave.approved", both))
      .toBe(`/?view=today&leave=${requestId}`);
    expect(resolve("wfh", "wfh.rejected", both))
      .toBe(`/?view=today&wfh=${requestId}`);
  });

  it("fails closed when the exact review grant is missing or the notification target mismatches", () => {
    expect(resolve("leave", "leave.requested", requester)).toBeNull();
    expect(resolve("wfh", "wfh.requested", requester)).toBeNull();
    expect(resolve("leave", "wfh.requested", both)).toBeNull();
    expect(resolve("wfh", "leave.requested", both)).toBeNull();
    expect(resolve("leave", "leave.approved", leaveReviewer)).toBeNull();
  });

  it("rejects malformed, duplicate, ambiguous, and non-UUID request targets", () => {
    for (const id of ["", "not-an-id", "101f0c80-51de-4fe8-a6d2-58f935318dd", "../leave"]) {
      expect(resolve("leave", "leave.requested", leaveReviewer, id)).toBeNull();
    }
    expect(resolveNotificationDeepLink(
      `/?view=today&leave=${requestId}&leave=${requestId}`,
      { origin, grants: leaveReviewer, eventKey: "leave.requested" },
    )).toBeNull();
    expect(resolveNotificationDeepLink(
      `/?view=today&leave=${requestId}&wfh=${requestId}`,
      { origin, grants: both, eventKey: "leave.requested" },
    )).toBeNull();
    expect(resolveNotificationDeepLink(
      `/?view=today&view=admin&leave=${requestId}`,
      { origin, grants: leaveReviewer, eventKey: "leave.requested" },
    )).toBeNull();
  });

  it("does not authorize a hidden Admin read from an unauthorized notification target", () => {
    expect(resolve("leave", "leave.requested", requester)).toBeNull();
    expect(resolve("wfh", "wfh.requested", leaveReviewer)).toBeNull();
    expect(planAdminReads(requester).leavePending).toBe(false);
    expect(planAdminReads(requester).wfhPending).toBe(false);
    expect(planAdminReads(leaveReviewer).leavePending).toBe(true);
    expect(planAdminReads(leaveReviewer).wfhPending).toBe(false);
  });

  it("leaves missing or not-yet-loaded rows to the authorized queue instead of requesting them directly", () => {
    const destination = resolve("leave", "leave.requested", leaveReviewer);
    expect(destination).toBe(`/?view=admin&focus=leave-review&leave=${requestId}`);
    // Resolution is pure routing: row lookup and reads remain the queue's existing,
    // permission-gated pending-list contract.
    const failedReviewer = { ...leaveReviewer, readError: "REQUEST_FAILED" };
    expect(resolve("leave", "leave.requested", failedReviewer)).toBeNull();
  });
});
