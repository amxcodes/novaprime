const taskIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Bind the Work task-detail screen to host-owned transport and request state.
 * Only the feature's allowlisted projection and action callbacks cross into React.
 */
export function createWorkTaskDetailRoute(host) {
  const requiredServices = [
    "beginPageRequestLifetime",
    "api",
    "captureCommandContext",
    "errorText",
    "getSubmittedDueDate",
    "isCurrentCommand",
    "isCurrentCommandIdentity",
    "isCurrentPageRequest",
    "leaveTaskDetail",
    "mountReactIsland",
    "pageApi",
    "projectTaskDetail",
    "recoverProtectedCommandFailure",
    "requestOptions",
  ];
  for (const name of requiredServices) {
    if (typeof host?.[name] !== "function") {
      throw new TypeError(`Work task-detail route service ${name} must be a function`);
    }
  }

  return async function renderWorkTaskDetail({ taskId, board, lifetime, Component }) {
    let expectedDueDate = null;
    let expectedDueDateRevision = null;

    const publish = (read) => host.mountReactIsland(board, Component, {
      read,
      onBack: host.leaveTaskDetail,
      onRetry: () => {
        const nextLifetime = host.beginPageRequestLifetime();
        publish({ status: "loading" });
        void load(nextLifetime);
      },
      onSaveDueDate: async (form) => {
        const context = host.captureCommandContext(form);
        const submittedDueDate = host.getSubmittedDueDate(form);
        const dueDate = typeof submittedDueDate === "string" && submittedDueDate ? submittedDueDate : null;
        try {
          const result = await host.api("/api/tasks/" + encodeURIComponent(taskId) + "/due-date", host.requestOptions("PATCH", {
            dueDate,
            expectedDueDate,
            expectedDueDateRevision,
          }));
          if (!host.isCurrentCommand(context)) return { status: "aborted" };
          expectedDueDate = result.dueDate ?? null;
          expectedDueDateRevision = result.dueDateRevision;
          const notifiedCount = Number(result.notifiedAssigneeCount || 0);
          const notificationMessage = notifiedCount === 0
            ? "No active assignees to notify."
            : `${notifiedCount} active assignee${notifiedCount === 1 ? "" : "s"} notified.`;
          return {
            status: result.changed ? "saved" : "unchanged",
            dueDate: expectedDueDate,
            message: result.changed ? `Due date updated; ${notificationMessage}` : "Due date is unchanged.",
          };
        } catch (error) {
          if (!host.isCurrentCommandIdentity(context)) return { status: "aborted" };
          if (host.recoverProtectedCommandFailure(error, context)) return { status: "aborted" };
          if (!host.isCurrentCommand(context)) return { status: "aborted" };
          if (error?.code === "TASK_DUE_DATE_CONFLICT") return {
            status: "conflict",
            message: "This due date changed since the task was opened. Reload task details to see the current date, then enter your change again.",
          };
          if (error?.code === "TASK_DUE_DATE_NOT_EDITABLE") return {
            status: "conflict",
            message: "The task status changed and its due date is no longer editable. Reload task details.",
          };
          if (error?.code === "TASK_NOT_FOUND") return {
            status: "conflict",
            message: "This task is no longer available. Reload to confirm its current access.",
          };
          return { status: "error", message: host.errorText(error) };
        }
      },
    });

    const load = async (requestLifetime) => {
      if (!taskIdPattern.test(taskId)) {
        publish({ status: "unavailable", message: "This task is not available to your account.", canRetry: false });
        return;
      }
      try {
        const result = await host.pageApi("/api/tasks/" + encodeURIComponent(taskId), requestLifetime);
        if (!host.isCurrentPageRequest(requestLifetime)) return;
        expectedDueDate = result.task.dueDate ?? null;
        expectedDueDateRevision = Number.isSafeInteger(result.task.dueDateRevision) ? result.task.dueDateRevision : null;
        publish({ status: "ready", data: host.projectTaskDetail(result.task) });
      } catch (error) {
        if (!host.isCurrentPageRequest(requestLifetime)) return;
        if (error?.httpStatus === 403 || error?.httpStatus === 404) {
          publish({
            status: "unavailable",
            message: "This task is not available to your account. It may have moved or your access may have changed.",
            canRetry: false,
          });
          return;
        }
        publish({
          status: "unavailable",
          message: host.errorText(error),
          canRetry: true,
        });
      }
    };

    publish({ status: "loading" });
    await load(lifetime);
  };
}
