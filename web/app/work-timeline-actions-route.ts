import type {
  TimelineCorrectionAssignment,
  TimelineGapCorrection,
  WorkTimelineProps,
} from "../src/features/work/timeline/contracts.ts";

type CommandContext = unknown;
type Api = (path: string, options: RequestInit) => Promise<unknown>;

interface WorkTimelineActionServices {
  target: Element;
  canAdjustTimeline: () => boolean;
  captureCommandContext: (source: Element) => CommandContext;
  isCurrentCommand: (context: CommandContext) => boolean;
  api: Api;
  requestOptions: (method: string, body?: unknown) => RequestInit;
  recoverProtectedCommandFailure: (error: unknown, context: CommandContext, feedbackMessage: string) => boolean;
  adminCommandUiError: (message: string) => Error;
  errorText: (error: unknown) => string;
  setMessage: (message: string) => void;
  refreshWork: () => unknown;
}

type WorkTimelineSearchServices = Pick<WorkTimelineActionServices,
  "target" | "canAdjustTimeline" | "captureCommandContext" | "isCurrentCommand" | "api" | "requestOptions" | "recoverProtectedCommandFailure" | "adminCommandUiError">;

const assignmentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Search correction sources independently of the visible My Work page and its filters. */
export function createWorkTimelineCorrectionAssignmentSearch(
  services: WorkTimelineSearchServices,
): NonNullable<WorkTimelineProps["onSearchCorrectionAssignments"]> {
  const {
    target,
    canAdjustTimeline,
    captureCommandContext,
    isCurrentCommand,
    api,
    requestOptions,
    recoverProtectedCommandFailure,
    adminCommandUiError,
  } = services;

  return async (query: string): Promise<ReadonlyArray<TimelineCorrectionAssignment>> => {
    const commandContext = captureCommandContext(target);
    if (!canAdjustTimeline() || !isCurrentCommand(commandContext)) {
      throw adminCommandUiError("Your time-correction access changed. Refresh Work before searching assignments.");
    }
    const normalized = typeof query === "string" ? query.normalize("NFC").trim() : "";
    if (normalized.length > 100 || normalized.includes("\u0000")) {
      throw adminCommandUiError("Search text must be 100 characters or fewer.");
    }
    const queryString = normalized ? `?q=${encodeURIComponent(normalized)}` : "";
    let result: unknown;
    try {
      result = await api(`/api/work/timeline-adjustments/assignments${queryString}`, requestOptions("GET"));
    } catch (error) {
      if (recoverProtectedCommandFailure(error, commandContext, "Your time-correction access changed. Available actions are being refreshed.")) {
        throw adminCommandUiError("Your access changed. Refresh Work before searching assignments.");
      }
      throw error;
    }
    if (!isCurrentCommand(commandContext)) {
      throw adminCommandUiError("The Work page changed before assignment search completed.");
    }
    if (!result || typeof result !== "object") throw adminCommandUiError("Assignment search returned an invalid response.");
    const response = result as { assignments?: unknown; hasMore?: unknown; limit?: unknown };
    if (response.limit !== 30 || typeof response.hasMore !== "boolean" ||
        !Array.isArray(response.assignments) || response.assignments.length > 30 ||
        response.assignments.some((assignment) => !assignment || typeof assignment !== "object" ||
          typeof (assignment as Partial<TimelineCorrectionAssignment>).assignmentId !== "string" ||
          !assignmentIdPattern.test((assignment as TimelineCorrectionAssignment).assignmentId) ||
          typeof (assignment as Partial<TimelineCorrectionAssignment>).title !== "string" ||
          !(assignment as TimelineCorrectionAssignment).title.trim())) {
      throw adminCommandUiError("Assignment search returned an invalid response.");
    }
    return response.assignments.map((assignment) => {
      const value = assignment as TimelineCorrectionAssignment;
      return { assignmentId: value.assignmentId, title: value.title };
    });
  };
}

/** Keep timeline correction transport and command recovery with the route host. */
export function createWorkTimelineCorrectionAction(
  services: WorkTimelineActionServices,
): NonNullable<WorkTimelineProps["onCorrectGap"]> {
  const {
    target,
    canAdjustTimeline,
    captureCommandContext,
    isCurrentCommand,
    api,
    requestOptions,
    recoverProtectedCommandFailure,
    adminCommandUiError,
    errorText,
    setMessage,
    refreshWork,
  } = services;

  return async (correction: TimelineGapCorrection): Promise<void> => {
    const permitted = canAdjustTimeline();
    const commandContext = captureCommandContext(target);
    if (!permitted || !isCurrentCommand(commandContext)) {
      throw adminCommandUiError("Your time-correction access changed. Refresh Work before continuing.");
    }
    try {
      await api("/api/work/timeline-adjustments", requestOptions("POST", correction));
    } catch (error) {
      if (recoverProtectedCommandFailure(error, commandContext, "Your time-correction access changed. Available actions are being refreshed.")) {
        throw adminCommandUiError("Your access changed. Refresh Work before continuing.");
      }
      throw adminCommandUiError(errorText(error));
    }
    if (!isCurrentCommand(commandContext)) throw adminCommandUiError("The Work page changed before this correction completed.");
    setMessage("Timeline gap corrected and audited.");
    refreshWork();
  };
}
