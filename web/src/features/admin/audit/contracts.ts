/**
 * Safe audit fields rendered by the UI. The server response also contains a
 * raw `details` payload; the host must not forward it into this feature.
 */
export interface AuditEventSummary {
  id: string;
  action: string;
  occurredAt: string;
  actorName: string | null;
}

/**
 * Route-owned read result. The current host contract gates the feature/request
 * on effective `people.view` at organisation scope. The host should omit the
 * feature without that grant; `denied` represents a denied planned read and is
 * not a grant calculation. Error messages must already be safe for display.
 */
export type AuditReadState =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string }
  | { status: "empty"; requestLimit: number }
  | { status: "ready"; events: readonly AuditEventSummary[]; requestLimit: number };

export interface AuditEventsProps {
  readState: AuditReadState;
}
