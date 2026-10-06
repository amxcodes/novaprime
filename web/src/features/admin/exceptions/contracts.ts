export type HistoricalExceptionStatus = "open" | "resolved" | "dismissed";
export type HistoricalExceptionOutcome = Exclude<HistoricalExceptionStatus, "open">;

/** Safe presentation projection. Raw server `details` are never passed to this feature. */
export interface HistoricalExceptionSummary {
  id: string;
  code: string;
  businessDate: string | null;
  status: HistoricalExceptionStatus;
  sourceType: string;
  sourceId: string;
  resolutionNote?: string | null;
}

export type HistoricalExceptionsReadState =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; exceptions: readonly HistoricalExceptionSummary[] };

export interface HistoricalExceptionsProps {
  /** Permission decisions are computed by the route host from effective grants. */
  capabilities: { view: boolean; resolve: boolean };
  read: HistoricalExceptionsReadState;
  onResolve: (
    exceptionId: string,
    outcome: HistoricalExceptionOutcome,
    auditNote: string,
  ) => void | Promise<void>;
}
