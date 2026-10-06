import type {
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
