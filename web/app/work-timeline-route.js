const deniedReadCodes = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);

/** @typedef {import('../src/features/work/timeline/contracts').WorkTimelineProps} WorkTimelineProps */

/**
 * Convert independently permission-planned Work reads into the small
 * presentation contract consumed by WorkTimeline. Raw server DTOs stay in the
 * route host; omitted grants always win over any supplied fallback or data.
 *
 * Retry and correction handlers are supplied by the route host so it can keep
 * identity, page-lifetime, and command checks around existing API calls.
 *
 * @param {object} input
 * @param {Record<string, boolean>} [input.readPlan]
 * @param {Record<string, unknown>} [input.timelineResult]
 * @param {Record<string, unknown>} [input.attendanceResult]
 * @param {Record<string, unknown>} [input.assignmentsResult]
 * @param {() => void} [input.onRetryTimeline]
 * @param {() => void} [input.onRetryAttendance]
 * @param {(correction: import('../src/features/work/timeline/contracts').TimelineGapCorrection) => void | Promise<void>} [input.onCorrectGap]
 * @returns {WorkTimelineProps}
 */
export function projectWorkTimelineProps({
  readPlan = {},
  timelineResult,
  attendanceResult,
  assignmentsResult,
  onRetryTimeline,
  onRetryAttendance,
  onCorrectGap,
} = {}) {
  readPlan = readPlan && typeof readPlan === "object" ? readPlan : {};
  const timeline = readPlan.timeline === true
    ? projectTimelineRead(timelineResult, onRetryTimeline)
    : { status: "not-requested" };
  const attendanceToday = readPlan.attendance === true
    ? projectAttendanceRead(attendanceResult, onRetryAttendance)
    : { status: "not-requested" };

  const correctionAssignments = readPlan.assignments === true && !assignmentsResult?.readError
    ? projectAssignments(assignmentsResult?.assignments)
    : [];

  const props = { timeline, attendanceToday, correctionAssignments };
  if (timeline.status !== "ready" || correctionAssignments.length === 0 || typeof onCorrectGap !== "function") {
    return props;
  }

  const actionableIntervals = new Set(timeline.data.exceptions
    .filter((exception) => exception.type === "work.untracked_gap" && exception.actionable === true && exception.startedAt && exception.endedAt)
    .map((exception) => intervalKey(exception.startedAt, exception.endedAt)));
  const assignmentIds = new Set(correctionAssignments.map((assignment) => assignment.assignmentId));
  if (actionableIntervals.size === 0) return props;

  return {
    ...props,
    onCorrectGap(correction) {
      const reason = typeof correction?.reason === "string" ? correction.reason.trim() : "";
      if (!actionableIntervals.has(intervalKey(correction?.startedAt, correction?.endedAt)) ||
          !assignmentIds.has(correction?.assignmentId) || !reason || reason.length > 2000) {
        throw new Error("TIMELINE_CORRECTION_NOT_IN_AUTHORIZED_PROJECTION");
      }
      return onCorrectGap({
        startedAt: correction.startedAt,
        endedAt: correction.endedAt,
        assignmentId: correction.assignmentId,
        reason,
      });
    },
  };
}

function projectTimelineRead(result, onRetry) {
  const failed = sourceReadFailure(result, "timeline", onRetry);
  if (failed) return failed;
  if (!isValidBusinessDate(result.date) || !isSummary(result.attendanceSummary) ||
      !Array.isArray(result.events) || !Array.isArray(result.exceptions) ||
      !isTimelinePolicy(result.attendancePolicy)) {
    return { status: "error", message: "Daily timeline data is incomplete for this business date.", ...retry(onRetry) };
  }

  const data = {
    date: result.date,
    attendanceSummary: {
      durationMinutes: result.attendanceSummary.durationMinutes,
      requiredMinutes: result.attendanceSummary.requiredMinutes,
      requirementSatisfied: result.attendanceSummary.requirementSatisfied,
    },
    attendancePolicy: projectTimelinePolicy(result.attendancePolicy),
    events: result.events.map(projectEvent).filter(Boolean),
    exceptions: result.exceptions.map(projectException).filter(Boolean),
  };
  return { status: "ready", data };
}

function projectAttendanceRead(result, onRetry) {
  const failed = sourceReadFailure(result, "attendance", onRetry);
  if (failed) return failed;
  const availability = result.availability;
  if (!availability || !isValidBusinessDate(availability.businessDate) ||
      !["hour_based", "scheduled"].includes(availability.attendanceMode) ||
      typeof availability.isHoliday !== "boolean" || typeof availability.isWorkingDay !== "boolean" ||
      typeof availability.officeName !== "string" || typeof availability.timezone !== "string" ||
      typeof result.onApprovedLeave !== "boolean" || typeof result.wfhPending !== "boolean" ||
      !isSummary(result.attendanceSummary) || !isAttendanceRecord(result.attendance) ||
      !isProvisionalAttendance(result.provisionalAttendance)) {
    return { status: "error", message: "Today’s attendance summary is incomplete.", ...retry(onRetry) };
  }

  const data = {
    availability: {
      attendanceMode: availability.attendanceMode,
      businessDate: availability.businessDate,
      isHoliday: availability.isHoliday,
      isWorkingDay: availability.isWorkingDay,
      officeName: availability.officeName,
      timezone: availability.timezone,
    },
    onApprovedLeave: result.onApprovedLeave,
    wfhPending: result.wfhPending,
    attendanceSummary: {
      durationMinutes: result.attendanceSummary.durationMinutes,
      requiredMinutes: result.attendanceSummary.requiredMinutes,
      requirementSatisfied: result.attendanceSummary.requirementSatisfied,
    },
    attendance: result.attendance ? {
      mode: result.attendance.mode,
      checkedInAt: result.attendance.checkedInAt,
      checkedOutAt: result.attendance.checkedOutAt,
    } : null,
    provisionalAttendance: result.provisionalAttendance ? {
      status: result.provisionalAttendance.status,
      checkedInAt: result.provisionalAttendance.checkedInAt,
      checkedOutAt: result.provisionalAttendance.checkedOutAt,
      ...(typeof result.provisionalAttendance.creditable === "boolean"
        ? { creditable: result.provisionalAttendance.creditable }
        : {}),
    } : null,
  };
  return { status: "ready", data };
}

function sourceReadFailure(result, source, onRetry) {
  if (!result || typeof result !== "object") {
    return { status: "error", message: `${sourceTitle(source)} data is unavailable.`, ...retry(onRetry) };
  }
  if (!result.readError) return null;

  if (deniedReadCodes.has(result.readError)) {
    return {
      status: "denied",
      message: source === "timeline"
        ? "Your current access does not allow this timeline."
        : "Your current access does not allow the attendance summary.",
    };
  }

  if (result.readError === "OFFICE_ASSIGNMENT_REQUIRED") {
    return {
      status: "error",
      message: source === "timeline"
        ? "An office assignment is required before the timeline can load."
        : "An office assignment is required before the attendance summary can load.",
      ...retry(onRetry),
    };
  }

  return {
    status: "error",
    message: source === "timeline"
      ? "The daily timeline could not load. Refresh Work to try again."
      : "Today’s attendance summary could not load. Refresh Work to try again.",
    ...retry(onRetry),
  };
}

function projectTimelinePolicy(policy) {
  if (policy === null) return null;
  return {
    mode: policy.mode,
    timezone: policy.timezone,
    scheduledStart: policy.scheduledStart,
    scheduledEnd: policy.scheduledEnd,
    isHoliday: policy.isHoliday,
  };
}

function projectEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string" ||
      !event.type || !isInstant(event.at)) return null;
  return {
    type: event.type,
    at: event.at,
    ...(isNonEmptyString(event.sourceId) ? { sourceId: event.sourceId } : {}),
    ...(event.mode === "office" || event.mode === "wfh" ? { mode: event.mode } : {}),
    ...(typeof event.title === "string" ? { title: event.title } : {}),
    ...(isInstant(event.scheduledAt) ? { scheduledAt: event.scheduledAt } : {}),
    ...(isFiniteNumber(event.minutesLate) ? { minutesLate: event.minutesLate } : {}),
    ...(isFiniteNumber(event.minutesEarly) ? { minutesEarly: event.minutesEarly } : {}),
    ...(isFiniteNumber(event.minutesAfter) ? { minutesAfter: event.minutesAfter } : {}),
  };
}

function projectException(exception) {
  if (!exception || typeof exception !== "object" || typeof exception.type !== "string" || !exception.type) return null;
  const startedAt = isInstant(exception.startedAt) ? exception.startedAt : undefined;
  const endedAt = isInstant(exception.endedAt) ? exception.endedAt : undefined;
  return {
    type: exception.type,
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(exception.type === "work.untracked_gap" && exception.actionable === true && startedAt && endedAt
      ? { actionable: true }
      : {}),
  };
}

function projectAssignments(assignments) {
  if (!Array.isArray(assignments)) return [];
  return assignments
    .filter((assignment) => assignment && isNonEmptyString(assignment.assignmentId) &&
      typeof assignment.title === "string" && assignment.title.trim())
    .map((assignment) => ({
      assignmentId: assignment.assignmentId,
      title: assignment.title,
    }));
}

function isTimelinePolicy(policy) {
  if (policy === null) return true;
  return Boolean(policy && typeof policy === "object" &&
    ["hour_based", "scheduled"].includes(policy.mode) &&
    typeof policy.timezone === "string" && policy.timezone.length > 0 &&
    (policy.scheduledStart === null || isInstant(policy.scheduledStart)) &&
    (policy.scheduledEnd === null || isInstant(policy.scheduledEnd)) &&
    typeof policy.isHoliday === "boolean");
}

function isAttendanceRecord(record) {
  return record === null || Boolean(record && typeof record === "object" &&
    ["office", "wfh"].includes(record.mode) && isInstant(record.checkedInAt) &&
    (record.checkedOutAt === null || isInstant(record.checkedOutAt)));
}

function isProvisionalAttendance(record) {
  return record === null || Boolean(record && typeof record === "object" &&
    isNonEmptyString(record.status) && isInstant(record.checkedInAt) &&
    (record.checkedOutAt === null || isInstant(record.checkedOutAt)) &&
    (record.creditable === undefined || typeof record.creditable === "boolean"));
}

function isSummary(summary) {
  return Boolean(summary && typeof summary === "object" &&
    isNonNegativeFinite(summary.durationMinutes) && isNonNegativeFinite(summary.requiredMinutes) &&
    typeof summary.requirementSatisfied === "boolean");
}

function isValidBusinessDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isInstant(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFinite(value) {
  return isFiniteNumber(value) && value >= 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sourceTitle(source) {
  return source === "timeline" ? "Daily timeline" : "Attendance summary";
}

function retry(handler) {
  return typeof handler === "function" ? { onRetry: handler } : {};
}

function intervalKey(startedAt, endedAt) {
  return `${startedAt ?? ""}\u0000${endedAt ?? ""}`;
}
