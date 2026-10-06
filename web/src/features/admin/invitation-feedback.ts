export type InvitationIntent = "create" | "resend";
export type InvitationDelivery = "failed" | "manual" | "sent";

export interface InvitationFeedback {
  delivery: InvitationDelivery;
  kind: "success" | "warning";
  message: string;
  navigateToSettings: boolean;
}

/** HTTP 202 may describe a staged handoff or an undelivered invitation, not a sent email. */
export function describeInvitationFeedback(
  response: { delivery?: unknown; error?: unknown; [key: string]: unknown } | null | undefined,
  intent: InvitationIntent = "create",
): InvitationFeedback {
  if (response?.delivery === "manual") {
    return {
      delivery: "manual",
      kind: "warning",
      message: "No active email adapter was available. The invitation link is waiting in Secure system handoffs.",
      navigateToSettings: true,
    };
  }

  if (typeof response?.error === "string") {
    const action = intent === "resend" ? "The invitation link was recreated" : "The invitation was created";
    const detail = response.error === "EMAIL_CONNECTION_NOT_ACTIVE"
      ? "No active email connection or secure handoff was available. Activate email delivery before retrying."
      : "Email delivery failed and NOVA could not stage a secure handoff. Check email delivery before retrying.";
    return {
      delivery: "failed",
      kind: "warning",
      message: `${action}, but delivery did not complete. ${detail}`,
      navigateToSettings: false,
    };
  }

  return {
    delivery: "sent",
    kind: "success",
    message: intent === "resend" ? "Invitation resent." : "Invitation created and sent.",
    navigateToSettings: false,
  };
}
