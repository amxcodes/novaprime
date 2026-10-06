import type {
  NotificationDeliveryReadState,
  NotificationDeliveryRecord,
} from "./contracts";

export interface NotificationDeliveryReadFailure {
  status: "unavailable" | "error";
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectDelivery(value: unknown): NotificationDeliveryRecord | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  return {
    id: value.id,
    eventKey: typeof value.eventKey === "string" ? value.eventKey : "unknown.event",
    status: typeof value.status === "string" ? value.status : "unknown",
    attempts: typeof value.attempts === "number" && Number.isSafeInteger(value.attempts)
      ? value.attempts
      : -1,
    availableAt: typeof value.availableAt === "string" ? value.availableAt : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    sentAt: typeof value.sentAt === "string" ? value.sentAt : null,
  };
}

/** Keep API-only outbox fields out of the delivery feature's render props. */
export function projectNotificationDeliveryReadState(
  result: unknown,
  failure?: NotificationDeliveryReadFailure | null,
): NotificationDeliveryReadState {
  if (failure) return { status: "failed", message: failure.message };
  if (!isRecord(result) || !Array.isArray(result.deliveries)) {
    return {
      status: "failed",
      message: "The delivery response could not be read. Refresh Admin to try again.",
    };
  }

  const deliveries = result.deliveries
    .map(projectDelivery)
    .filter((delivery): delivery is NotificationDeliveryRecord => delivery !== null);
  return { status: "ready", deliveries, limit: 50 };
}
