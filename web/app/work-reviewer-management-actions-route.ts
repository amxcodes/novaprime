import type {
  ReviewerManagementProps,
  ReviewerManagementSaveResult,
} from "../src/features/work/reviewer-management/contracts.ts";

type CommandContext = unknown;
type Api = (path: string, options: RequestInit) => Promise<unknown>;
type RequestOptions = (method: string, body?: unknown) => RequestInit;

interface WorkReviewerManagementActionServices {
  target: Element | null;
  canManageReviewer: () => boolean;
  captureCommandContext: (source: Element | null) => CommandContext;
  isCurrentCommand: (context: CommandContext) => boolean;
  isCurrentCommandIdentity: (context: CommandContext) => boolean;
  recoverProtectedCommandFailure: (error: unknown, context: CommandContext, feedbackMessage: string) => boolean;
  api: Api;
  requestOptions: RequestOptions;
}

/** Own the reviewer-save command shape while its host keeps permission and identity authority. */
export function createWorkReviewerManagementSaveAction(
  services: WorkReviewerManagementActionServices,
): ReviewerManagementProps["onSaveReviewer"] {
  const {
    target,
    canManageReviewer,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    api,
    requestOptions,
  } = services;

  return async (assignmentId: string, reviewerPersonId: string): Promise<ReviewerManagementSaveResult> => {
    const permitted = canManageReviewer();
    const context = captureCommandContext(target);
    if (!permitted) {
      return { status: "denied", message: "Reviewer management access changed. Refresh Work to check current access." };
    }
    if (!isCurrentCommand(context)) {
      return { status: "stale", message: "The Work page changed before this reviewer update could start." };
    }
    let result: unknown;
    try {
      result = await api(
        "/api/task-assignments/" + encodeURIComponent(assignmentId) + "/reviewer",
        requestOptions("PATCH", { reviewerPersonId }),
      );
    } catch (error) {
      const accessChangedMessage = "Reviewer management access changed. Available controls are being refreshed.";
      if (!isCurrentCommandIdentity(context)) {
        return { status: "stale", message: "Your session changed before this reviewer update could be confirmed." };
      }
      if (recoverProtectedCommandFailure(error, context, accessChangedMessage)) {
        return { status: "denied", message: "Reviewer management access changed. Refresh Work to check current access." };
      }
      if (!isCurrentCommand(context)) {
        return { status: "stale", message: "The Work page changed before this reviewer update could be confirmed." };
      }
      throw error;
    }
    if (!isCurrentCommand(context)) {
      return { status: "stale", message: "The Work page changed before this reviewer update could be confirmed." };
    }
    if (!result || (result as Record<string, unknown>).assignmentId !== assignmentId) {
      return { status: "error", message: "NOVA could not confirm that the reviewer changed. Refresh this assignment before trying again." };
    }
    return { status: "saved" };
  };
}
