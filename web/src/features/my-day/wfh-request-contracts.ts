/** Form values retain the exact field names and shape consumed by `/api/availability/wfh`. */
export interface WfhRequestValues {
  startDate: string;
  endDate: string;
  reason: string;
}

/** Safe display projection of one actor-scoped `/api/availability/wfh/mine` record. */
export interface MyWfhRequest {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  reviewReason?: string | null;
  /** Server projection of the current cancel eligibility; commands recheck it. */
  canCancel: boolean;
}

export type MyWfhRequestReadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; requests: ReadonlyArray<MyWfhRequest> };

/** Presentation receives summaries and callbacks; permission, transport, and mutation policy stay in the host/API. */
export interface WfhRequestPanelProps {
  read: MyWfhRequestReadState;
  onRetry: () => void;
  onSubmit: (values: WfhRequestValues, form: HTMLFormElement) => void | Promise<void>;
  onCancel: (requestId: string, source: HTMLButtonElement) => void | Promise<void>;
}
