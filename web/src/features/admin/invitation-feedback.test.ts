import { expect, test } from "bun:test";
import { describeInvitationFeedback } from "./invitation-feedback";

test("successful invitation delivery is reported as sent", () => {
  expect(describeInvitationFeedback({ invitationId: "invitation-1" })).toEqual({
    delivery: "sent",
    kind: "success",
    message: "Invitation created and sent.",
    navigateToSettings: false,
  });
});

test("manual handoff is reported as a warning and opens secure handoffs", () => {
  expect(describeInvitationFeedback({ delivery: "manual" }, "resend")).toMatchObject({
    delivery: "manual",
    kind: "warning",
    navigateToSettings: true,
  });
});

test("HTTP 202 email failures are not mistaken for successful delivery", () => {
  for (const error of ["EMAIL_CONNECTION_NOT_ACTIVE", "INVITATION_CREATED_EMAIL_NOT_SENT"]) {
    const result = describeInvitationFeedback({ error });
    expect(result.delivery).toBe("failed");
    expect(result.kind).toBe("warning");
    expect(result.navigateToSettings).toBe(false);
    expect(result.message).toContain("delivery did not complete");
  }
});

test("resent invitations retain resend-specific success and failure wording", () => {
  expect(describeInvitationFeedback({}, "resend").message).toBe("Invitation resent.");
  expect(describeInvitationFeedback({ error: "EMAIL_CONNECTION_NOT_ACTIVE" }, "resend").message)
    .toContain("The invitation link was recreated");
});

test("server error codes are never copied into customer-facing delivery feedback", () => {
  const result = describeInvitationFeedback({ error: "SENSITIVE_PROVIDER_ERROR_BODY" });
  expect(result.message).not.toContain("SENSITIVE_PROVIDER_ERROR_BODY");
});
