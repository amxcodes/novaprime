import type { AuditReadState, AuditEventSummary } from "./contracts";

export interface AuditReadFailure {
  status: "unavailable" | "error";
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectEvent(value: unknown): AuditEventSummary | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    action: typeof value.action === "string" ? value.action : "Action unavailable",
    occurredAt: typeof value.occurredAt === "string" ? value.occurredAt : "",
    actorName: typeof value.actorName === "string" ? value.actorName : null,
  };
}

/** Project at most the server response bound into the audit feature's safe DTO. */
export function projectAuditEventsReadState(
  result: unknown,
  failure?: AuditReadFailure | null,
): AuditReadState {
  if (failure) {
    return failure.status === "unavailable"
      ? { status: "denied", message: failure.message }
      : { status: "error", message: failure.message };
  }

  if (!isRecord(result) || !Array.isArray(result.events)) {
    return {
      status: "error",
      message: "The audit response could not be read. Refresh Admin to try again.",
    };
  }

  const events = result.events.slice(0, 50)
    .map(projectEvent)
    .filter((event): event is AuditEventSummary => event !== null);
  return events.length
    ? { status: "ready", events, requestLimit: 50 }
    : { status: "empty", requestLimit: 50 };
}
