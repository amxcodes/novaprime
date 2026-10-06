import { projectReadResult, projectWorkOperations } from "../src/features/admin/work-operations/projection.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve the permission target used by Admin's task operations. Keep this in
 * the host adapter so scoped-grant checks never depend on presentation data.
 */
export function adminWorkOperationsPermissionTarget(task) {
  const target = { taskId: task?.id };
  if (task?.client?.id) target.clientId = task.client.id;
  if (task?.workstream?.kind === "client" && task.workstream.id) {
    target.clientWorkstreamId = task.workstream.id;
  }
  if (task?.group?.id) target.groupId = task.group.id;
  return target;
}

/**
 * Admin host adapter for the bounded task operations feature. Transport,
 * snapshot/identity guards, scoped grants and global command feedback remain
 * owned by the Admin host.
 *
 * @param {object} dependencies
 * @returns {{createProps(data: object): import('../src/features/admin/work-operations/contracts').WorkOperationsProps}}
 */
export function createAdminWorkOperationsRoute({
  state,
  target,
  lifetime,
  identityEpoch,
  isCurrentPageRequest,
  hasAdminPermission,
  pageApi,
  runAdminProtectedCommand,
  requestOptions,
  errorText,
  adminCommandUiError,
  setMessage,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    hasAdminPermission,
    pageApi,
    runAdminProtectedCommand,
    requestOptions,
    errorText,
    adminCommandUiError,
    setMessage,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  const mountedIdentityEpoch = identityEpoch ?? state.identityEpoch;

  function createProps(data) {
    const actorPersonId = state.identityPersonId || data.actorGrants?.actorPersonId || null;
    const assignmentOptionsByTask = new Map();
    const mountIsCurrent = () => target.isConnected === true && isCurrentPageRequest(lifetime) &&
      mountedIdentityEpoch === state.identityEpoch &&
      actorPersonId === (state.identityPersonId || state.actorGrants?.actorPersonId || null) &&
      state.adminData === data;
    const ensureCurrentMount = () => {
      if (!mountIsCurrent()) {
        throw adminCommandUiError("The Admin page or account changed. Refresh Admin before trying again.");
      }
    };
    const taskAllowsAssignmentOptions = (task, grantRead = data) => Boolean(task &&
      ["tasks.assign", "tasks.reassign"].some((permission) => hasAdminPermission(
        grantRead,
        permission,
        adminWorkOperationsPermissionTarget(task),
      )));
    const projectAssignmentOptions = (result) => {
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw adminCommandUiError("Assignment choices could not be read. Refresh Admin and try again.");
      }
      const projectPeople = (people) => {
        if (!Array.isArray(people)) {
          throw adminCommandUiError("Assignment choices could not be read. Refresh Admin and try again.");
        }
        const seen = new Set();
        return people.map((person) => {
          if (!person || typeof person !== "object" || Array.isArray(person) ||
              typeof person.id !== "string" || !uuidPattern.test(person.id) ||
              typeof person.name !== "string" || !person.name.trim() || seen.has(person.id)) {
            throw adminCommandUiError("Assignment choices were incomplete. Refresh Admin and try again.");
          }
          seen.add(person.id);
          return { id: person.id, name: person.name.trim() };
        });
      };
      return {
        assignees: projectPeople(result.assignees),
        reviewers: projectPeople(result.reviewers),
      };
    };
    const loadAssignmentOptions = async (taskId, readOptions = {}) => {
      ensureCurrentMount();
      const task = data.tasks?.tasks?.find((candidate) => candidate.id === taskId);
      if (!task || !taskAllowsAssignmentOptions(task)) {
        throw adminCommandUiError("Your current access does not allow assignment choices for this task.");
      }
      if (typeof readOptions.query === "string") {
        const query = readOptions.query.trim();
        const path = `/api/tasks/${encodeURIComponent(taskId)}/assignment-options?q=${encodeURIComponent(query)}`;
        return pageApi(path, lifetime).then((result) => {
          ensureCurrentMount();
          const options = projectAssignmentOptions(result);
          const cached = assignmentOptionsByTask.get(taskId);
          if (cached?.settled) {
            const merge = (current, incoming) => [...current, ...incoming.filter((candidate) =>
              !current.some((existing) => existing.id === candidate.id))];
            cached.options = {
              assignees: merge(cached.options.assignees, options.assignees),
              reviewers: merge(cached.options.reviewers, options.reviewers),
            };
          }
          return options;
        }).catch((error) => {
          if (!mountIsCurrent()) {
            throw adminCommandUiError("The Admin page or account changed. Refresh Admin before trying again.");
          }
          if (error?.uiMessage) throw error;
          throw adminCommandUiError(errorText(error));
        });
      }
      const cached = assignmentOptionsByTask.get(taskId);
      if (cached && (readOptions.refresh !== true || cached.settled !== true)) {
        return cached.settled ? Promise.resolve(cached.options) : cached.promise;
      }
      if (cached) assignmentOptionsByTask.delete(taskId);

      const entry = { promise: null, options: null, settled: false };
      const promise = pageApi(`/api/tasks/${encodeURIComponent(taskId)}/assignment-options`, lifetime)
        .then((result) => {
          ensureCurrentMount();
          const options = projectAssignmentOptions(result);
          entry.options = options;
          entry.settled = true;
          return options;
        })
        .catch((error) => {
          if (assignmentOptionsByTask.get(taskId) === entry) assignmentOptionsByTask.delete(taskId);
          if (!mountIsCurrent()) {
            throw adminCommandUiError("The Admin page or account changed. Refresh Admin before trying again.");
          }
          if (error?.uiMessage) throw error;
          throw adminCommandUiError(errorText(error));
        });
      entry.promise = promise;
      assignmentOptionsByTask.set(taskId, entry);
      return promise;
    };
    const validateAssignmentChoices = async (taskId, input) => {
      ensureCurrentMount();
      if (!input || typeof input !== "object" ||
          typeof input.personId !== "string" || !uuidPattern.test(input.personId) ||
          typeof input.reviewRequired !== "boolean" ||
          (input.reviewerPersonId !== null &&
            (typeof input.reviewerPersonId !== "string" || !uuidPattern.test(input.reviewerPersonId)))) {
        throw adminCommandUiError("Choose an assignee and review option from the current task choices.");
      }
      const requestInput = {
        personId: input.personId,
        reviewerPersonId: input.reviewerPersonId,
        reviewRequired: input.reviewRequired,
      };
      const task = data.tasks?.tasks?.find((candidate) => candidate.id === taskId);
      if (!task || (task.workstream?.kind === "client" && !requestInput.reviewRequired)) {
        throw adminCommandUiError("Client work requires review. Refresh Admin and try again.");
      }
      if (requestInput.reviewRequired && !requestInput.reviewerPersonId) {
        throw adminCommandUiError("Choose an eligible reviewer when review is required.");
      }
      const options = await loadAssignmentOptions(taskId);
      ensureCurrentMount();
      const assigneeAllowed = options.assignees.some((person) => person.id === requestInput.personId);
      const reviewerAllowed = requestInput.reviewerPersonId === null ||
        (requestInput.reviewerPersonId !== requestInput.personId &&
          options.reviewers.some((person) => person.id === requestInput.reviewerPersonId));
      if (!assigneeAllowed || !reviewerAllowed) {
        throw adminCommandUiError("Choose an eligible assignee and reviewer from the current task options.");
      }
      return { task, options, input: requestInput };
    };

    const workOperations = projectWorkOperations({
      taskRead: projectReadResult(data.tasks, "tasks", "tasks"),
      hasTaskPermission: (permission, task) => hasAdminPermission(
        data,
        permission,
        adminWorkOperationsPermissionTarget(task),
      ),
    });
    const taskPermissionAllowed = (latest, taskId, permission) => {
      if (latest !== data) return false;
      const task = data.tasks?.tasks?.find((candidate) => candidate.id === taskId);
      return Boolean(task && hasAdminPermission(
        latest,
        permission,
        adminWorkOperationsPermissionTarget(task),
      ));
    };
    const taskCanRun = (latest, taskId, permission, serverFlag) => {
      const task = latest === data ? data.tasks?.tasks?.find((candidate) => candidate.id === taskId) : null;
      return Boolean(task && task[serverFlag] === true && taskPermissionAllowed(latest, taskId, permission));
    };
    const findCurrentTask = (taskId) => data.tasks?.tasks?.find((candidate) => candidate.id === taskId);

    return {
      ...workOperations,
      loadAssignmentOptions,
      onAssign: (taskId, input) => {
        const task = findCurrentTask(taskId);
        if (!task || ["cancelled", "done"].includes(task.status) ||
            !taskCanRun(data, taskId, "tasks.assign", "canAssign")) {
          throw adminCommandUiError("Your current access no longer allows assignment for this task. Refresh Admin to check access.");
        }
        const permission = (latest) => taskCanRun(latest, taskId, "tasks.assign", "canAssign") &&
          !["cancelled", "done"].includes(latest.tasks?.tasks?.find((item) => item.id === taskId)?.status) &&
          taskAllowsAssignmentOptions(latest.tasks?.tasks?.find((item) => item.id === taskId), latest);
        return validateAssignmentChoices(taskId, input).then(({ options, input: requestInput }) => {
          const choicesStillEligible = () => options.assignees.some((person) => person.id === requestInput.personId) &&
            (requestInput.reviewerPersonId === null ||
              (requestInput.reviewerPersonId !== requestInput.personId &&
                options.reviewers.some((person) => person.id === requestInput.reviewerPersonId))) &&
            (!requestInput.reviewRequired || Boolean(requestInput.reviewerPersonId));
          if (!choicesStillEligible()) {
            throw adminCommandUiError("The selected assignee is no longer eligible. Refresh Admin and try again.");
          }
          return runAdminProtectedCommand(
            target, lifetime, (latest) => permission(latest) && choicesStillEligible(),
            adminWorkOperationsPermissionTarget(task),
            "POST", `/api/tasks/${encodeURIComponent(taskId)}/assignments`, requestInput, "Task assigned.",
          ).then((result) => {
            assignmentOptionsByTask.delete(taskId);
            return result;
          });
        });
      },
      onReassign: (taskId, assignmentId, input) => {
        const task = findCurrentTask(taskId);
        const assignment = task?.assignments?.find((item) => item.id === assignmentId);
        const allowed = task && assignment && assignment.canReassign === true &&
          !["cancelled", "approved"].includes(assignment.status) &&
          taskPermissionAllowed(data, taskId, "tasks.reassign") &&
          input?.personId !== assignment.personId;
        if (!allowed) throw adminCommandUiError("This assignment or replacement is no longer eligible. Refresh Admin and try again.");
        return validateAssignmentChoices(taskId, input).then(({ options, input: requestInput }) => {
          if (!options.assignees.some((person) => person.id === requestInput.personId) ||
              (requestInput.reviewRequired && !requestInput.reviewerPersonId)) {
            throw adminCommandUiError("The selected replacement is no longer eligible. Refresh Admin and try again.");
          }
          const permission = (latest) => {
            const freshTask = latest === data ? findCurrentTask(taskId) : null;
            const freshAssignment = freshTask?.assignments?.find((item) => item.id === assignmentId);
            return Boolean(freshTask && freshAssignment?.canReassign === true &&
              !["cancelled", "approved"].includes(freshAssignment.status) &&
              taskPermissionAllowed(latest, taskId, "tasks.reassign") &&
              taskAllowsAssignmentOptions(freshTask, latest) &&
              requestInput.personId !== freshAssignment.personId &&
              options.assignees.some((person) => person.id === requestInput.personId) &&
              (requestInput.reviewerPersonId === null ||
                (requestInput.reviewerPersonId !== requestInput.personId &&
                  options.reviewers.some((person) => person.id === requestInput.reviewerPersonId))) &&
              (!requestInput.reviewRequired || Boolean(requestInput.reviewerPersonId)));
          };
          return runAdminProtectedCommand(
            target, lifetime, permission, adminWorkOperationsPermissionTarget(task),
            "POST", `/api/task-assignments/${encodeURIComponent(assignmentId)}/reassign`, requestInput,
            "Assignment reassigned; recorded history was preserved.",
          ).then((result) => {
            assignmentOptionsByTask.delete(taskId);
            return result;
          });
        });
      },
      onCancel: (taskId) => {
        const task = findCurrentTask(taskId);
        if (!task || ["approved", "cancelled", "done"].includes(task.status) ||
            !taskCanRun(data, taskId, "tasks.edit", "canCancel")) {
          throw adminCommandUiError("This task can no longer be cancelled from Admin. Refresh the list and try again.");
        }
        return runAdminProtectedCommand(
          target, lifetime,
          (latest) => taskCanRun(latest, taskId, "tasks.edit", "canCancel") &&
            !["approved", "cancelled", "done"].includes(latest.tasks?.tasks?.find((item) => item.id === taskId)?.status),
          adminWorkOperationsPermissionTarget(task),
          "POST", `/api/tasks/${encodeURIComponent(taskId)}/cancel`, undefined,
          "Task cancelled; recorded history was preserved.",
        );
      },
      onUpdateDueDate: (taskId, input) => {
        const task = findCurrentTask(taskId);
        if (!task || task.dueDate !== input.expectedDueDate || task.dueDateRevision !== input.expectedDueDateRevision ||
            ["approved", "done", "cancelled"].includes(task.status) ||
            !taskCanRun(data, taskId, "tasks.edit", "canEditDueDate")) {
          throw adminCommandUiError("This task or due-date revision changed. Refresh Admin before saving again.");
        }
        return runAdminProtectedCommand(
          target, lifetime,
          (latest) => {
            const latestTask = latest === data ? findCurrentTask(taskId) : null;
            return Boolean(latestTask && latestTask.dueDate === input.expectedDueDate &&
              latestTask.dueDateRevision === input.expectedDueDateRevision &&
              !["approved", "done", "cancelled"].includes(latestTask.status) &&
              taskCanRun(latest, taskId, "tasks.edit", "canEditDueDate"));
          },
          adminWorkOperationsPermissionTarget(task),
          "PATCH", `/api/tasks/${encodeURIComponent(taskId)}/due-date`, {
            dueDate: input.dueDate,
            expectedDueDate: input.expectedDueDate,
            expectedDueDateRevision: input.expectedDueDateRevision,
          }, "", (result) => {
            const notifiedCount = Number(result.notifiedAssigneeCount || 0);
            const notificationMessage = notifiedCount === 0
              ? "No active assignees to notify."
              : `${notifiedCount} active assignee${notifiedCount === 1 ? "" : "s"} notified.`;
            setMessage(result.changed ? `Due date updated; ${notificationMessage}` : "Due date is unchanged.");
          },
        );
      },
    };
  }

  return { createProps };
}
