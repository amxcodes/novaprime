import type {
  HistoricalExceptionStatus,
  HistoricalExceptionsReadState,
  HistoricalExceptionSummary,
} from "./contracts";

export interface HistoricalExceptionsReadFailure {
  status: "unavailable" | "error";
  message: string;
}

const statuses: readonly HistoricalExceptionStatus[] = ["open", "resolved", "dismissed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectException(value: unknown): HistoricalExceptionSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() ||
      !statuses.includes(value.status as HistoricalExceptionStatus)) return null;

  return {
    id: value.id,
    code: typeof value.code === "string" && value.code ? value.code : "unknown",
    businessDate: typeof value.businessDate === "string" && value.businessDate ? value.businessDate : null,
    status: value.status as HistoricalExceptionStatus,
    sourceType: typeof value.sourceType === "string" && value.sourceType ? value.sourceType : "unknown",
    sourceId: typeof value.sourceId === "string" ? value.sourceId : "",
    resolutionNote: typeof value.resolutionNote === "string" && value.resolutionNote ? value.resolutionNote : null,
  };
}

/** Drop raw exception details and reject malformed collection/row shapes before rendering. */
export function projectHistoricalExceptionsReadState(
  result: unknown,
  failure?: HistoricalExceptionsReadFailure | null,
): HistoricalExceptionsReadState {
  if (failure) {
    return failure.status === "unavailable"
      ? { status: "denied", message: failure.message }
      : { status: "error", message: failure.message };
  }
  if (!isRecord(result) || !Array.isArray(result.exceptions)) {
    return { status: "error", message: "The historical exceptions response could not be read. Refresh Admin to try again." };
  }

  const projected = result.exceptions.map(projectException);
  if (projected.some((exception) => exception === null)) {
    return { status: "error", message: "The historical exceptions response could not be read. Refresh Admin to try again." };
  }
  const exceptions = projected as HistoricalExceptionSummary[];
  return exceptions.length ? { status: "ready", exceptions } : { status: "empty" };
}
