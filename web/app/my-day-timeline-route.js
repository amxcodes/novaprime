/**
 * Own the My Day workday-timeline read and its slot-local retry state.
 *
 * The route host remains authoritative for workspace visibility, capability
 * planning, authenticated transport, and page/identity lifetime checks.
 */
export function createMyDayTimelineRoute({
  visible = false,
  readPlan = {},
  readApi,
  isCurrent = () => true,
  getReadIssue = () => undefined,
  onChange = () => {},
} = {}) {
  if (typeof readApi !== "function") throw new TypeError("readApi must be a function");
  if (typeof isCurrent !== "function") throw new TypeError("isCurrent must be a function");

  const canRead = visible === true && readPlan?.timeline === true;
  let state = { status: "loading" };
  let generation = 0;

  const publish = (next) => {
    state = next;
    onChange(state);
  };

  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

  function hasUsableTimelineProjection(result) {
    if (!isRecord(result) || typeof result.date !== "string" ||
      !Array.isArray(result.events) || !Array.isArray(result.exceptions) ||
      !isRecord(result.attendanceSummary) ||
      !isFiniteNumber(result.attendanceSummary.durationMinutes) ||
      !isFiniteNumber(result.attendanceSummary.requiredMinutes) ||
      typeof result.attendanceSummary.requirementSatisfied !== "boolean") return false;

    if (!result.events.every((event) => isRecord(event) && typeof event.type === "string" && typeof event.at === "string")) return false;
    if (!result.exceptions.every((exception) => isRecord(exception) && typeof exception.type === "string")) return false;

    if (result.attendancePolicy === null) return true;
    return isRecord(result.attendancePolicy) &&
      (result.attendancePolicy.mode === "hour_based" || result.attendancePolicy.mode === "scheduled") &&
      typeof result.attendancePolicy.timezone === "string" &&
      typeof result.attendancePolicy.isHoliday === "boolean";
  }

  function project(result) {
    const issue = getReadIssue(result, "your daily timeline");
    if (result?.readError) {
      if (result.readError === "PERMISSION_DENIED") {
        return {
          status: "denied",
          message: issue?.message || "Workday timeline information is unavailable for this view.",
        };
      }
      return {
        status: "error",
        message: issue?.message || "Your daily timeline could not be loaded.",
        onRetry: retry,
      };
    }

    if (hasUsableTimelineProjection(result)) {
      return { status: "ready", data: result };
    }
    return {
      status: "error",
      message: "Your workday timeline is unavailable for this business date.",
      onRetry: retry,
    };
  }

  async function performRead(requestGeneration) {
    let result;
    try {
      result = await readApi("/api/work/timeline");
    } catch (error) {
      result = { readError: error?.code || "REQUEST_FAILED" };
    }

    if (!isCurrent() || requestGeneration !== generation) return false;
    publish(project(result));
    return state.status === "ready" || state.status === "denied";
  }

  function load() {
    if (!canRead || !isCurrent()) return Promise.resolve(false);
    generation += 1;
    return performRead(generation);
  }

  function retry() {
    if (!canRead || !isCurrent()) return Promise.resolve(false);
    generation += 1;
    publish({ status: "loading" });
    return performRead(generation);
  }

  return {
    getState: () => state,
    load,
    retry,
  };
}
