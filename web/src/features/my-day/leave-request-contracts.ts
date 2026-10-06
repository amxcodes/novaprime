export type LeaveRequestPortion = "1" | "0.5";

/** Form fields intentionally retain the names and values consumed by `/api/leave`. */
export interface LeaveRequestValues {
  leaveType: string;
  startDate: string;
  endDate: string;
  portion: LeaveRequestPortion;
  reason: string;
}

/** Safe display projection from the actor-scoped `/api/leave/mine` response. */
export interface MyLeaveRequest {
  id: string;
  leaveType: string;
  status: string;
  startDate: string;
  endDate: string;
  canCancel: boolean;
}

export type MyLeaveRequestReadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; requests: ReadonlyArray<MyLeaveRequest> };

/**
 * Presentation receives only the actor's own safe summary and callbacks.
 * Permission checks, reads, mutations, and row eligibility stay in the host/API.
 */
export interface LeaveRequestPanelProps {
  read: MyLeaveRequestReadState;
  onRetry: () => void;
  onSubmit: (values: LeaveRequestValues, form: HTMLFormElement) => void | Promise<void>;
  onCancel: (requestId: string, source: HTMLButtonElement) => void | Promise<void>;
}
