import { createOperationsPeopleReportRoute } from "./operations-people-report-route.js";
import { createOperationsTaskReportRoute } from "./operations-task-report-route.js";

/**
 * Own Operations report loading and page composition.
 *
 * The host remains authoritative for effective-grant planning, authenticated
 * transport, request lifetime, recovery mutations, exports, and navigation.
 * Each report still reads independently and the people report keeps its
 * feature-owned cursor/search controller.
 */
export async function mountOperationsRoute({
  board,
  readPlan = {},
  readApi,
  readOrError,
  isCurrent = () => true,
  loadUi = () => Promise.all([
    import("../src/features/operations/index.ts"),
    import("../src/pages/operations/OperationsPage.tsx"),
  ]),
  getReadIssue = () => undefined,
  getAvailabilitySources = () => ({}),
  createPeopleReport = createOperationsPeopleReportRoute,
  createRecoverySlot = () => document.createElement("div"),
  renderRecovery = async () => {},
  mountIsland,
  onLoadError = () => {},
  onRetry = () => {},
  onRestoreScroll = () => {},
  onShowFeedback = () => {},
  personHistoryHref = () => "",
  onViewPersonHistory = () => {},
  taskDetailHref = () => "",
  onOpenTask = () => {},
  downloadCsv = () => {},
  getErrorText = (error) => String(error?.message || error),
} = {}) {
  if (!board) throw new TypeError("board is required");
  if (typeof readApi !== "function") throw new TypeError("readApi must be a function");
  if (typeof readOrError !== "function") throw new TypeError("readOrError must be a function");
  if (typeof isCurrent !== "function") throw new TypeError("isCurrent must be a function");
  if (typeof mountIsland !== "function") throw new TypeError("mountIsland must be a function");

  const isActive = () => board.isConnected && isCurrent();
  let operationsUi;
  let operationsPageUi;
  try {
    [operationsUi, operationsPageUi] = await loadUi();
  } catch (error) {
    if (!isActive()) return;
    onLoadError(error);
    onRestoreScroll();
    return;
  }
  if (!isActive()) return;

  const readState = (enabled, result, resource, data) => {
    if (!enabled) return undefined;
    const issue = getReadIssue(result, resource);
    if (!issue) return { status: "ready", data };
    return {
      status: result.readError === "PERMISSION_DENIED" ? "denied" : "error",
      message: issue.message,
    };
  };
  const read = (path, fallback) => readOrError(readApi(path), fallback);

  let peopleRead = readPlan.people ? { status: "loading", query: "" } : undefined;
  let tasksRead = readPlan.tasks ? { status: "loading" } : undefined;
  let operationsProps = null;
  let peopleReport;
  let tasksReport;
  const mountOperationsOverview = () => {
    if (!operationsProps || !isActive()) return;
    mountIsland(board, operationsPageUi.OperationsPage, {
      overview: {
        ...operationsProps,
        people: peopleRead,
        tasks: tasksRead,
        onSearchPeople: (query) => { void peopleReport?.search(query); },
        onNextPeoplePage: (cursor) => { void peopleReport?.next(cursor); },
        onPreviousPeoplePage: () => { void peopleReport?.previous(); },
        onRetryPeople: () => { void peopleReport?.retry(); },
        onRetryPeoplePage: () => { void peopleReport?.retry(); },
        onNextTasksPage: (cursor) => { void tasksReport?.next(cursor); },
        onPreviousTasksPage: () => { void tasksReport?.previous(); },
        onRetryTasks: () => { void tasksReport?.retry(); },
        onRetryTasksPage: () => { void tasksReport?.retry(); },
        onExportPeople: () => {
          const currentPage = peopleRead?.status === "ready" ? peopleRead.data.people : [];
          downloadCsv(
            "nova-people-page.csv",
            ["Name", "Email", "Status", "Designation", "Start date", "Manager", "Office", "Department", "Role"],
            currentPage.map((person) => [
              person.displayName || person.email,
              person.email,
              person.status,
              person.designation,
              person.employmentStartsOn,
              person.managerName,
              person.office && person.office.name,
              person.department && person.department.name,
              person.role && person.role.name,
            ]),
          );
        },
      },
    });
    onShowFeedback();
  };

  if (readPlan.people) {
    peopleReport = createPeopleReport({
      read: (path) => readApi(path),
      isCurrent: isActive,
      onChange: (next) => {
        peopleRead = next;
        mountOperationsOverview();
      },
      failureMessage: (result) => getReadIssue(result, "people in your current access scope")?.message ||
        "Could not load people in your current access scope. Retry the search.",
      deniedMessage: "You do not have permission to view people in this scope.",
    });
    void peopleReport.start();
  }

  if (readPlan.tasks) {
    tasksReport = createOperationsTaskReportRoute({
      read: async (path) => {
        try {
          return await readApi(path);
        } catch (error) {
          return {
            tasks: [], hasMore: false, nextCursor: null, limit: 30,
            readError: error?.code || "REQUEST_FAILED",
            readStatus: error?.httpStatus,
          };
        }
      },
      isCurrent: isActive,
      onChange: (next) => {
        tasksRead = next;
        mountOperationsOverview();
      },
      failureMessage: (result) => getReadIssue(result, "visible tasks")?.message ||
        "Could not load tasks in your current access scope. Retry this page.",
      deniedMessage: "You do not have permission to view tasks in this scope.",
    });
  }

  try {
    const [initialTasksRead, availabilityResult, reviewsResult, recoveryResult] = await Promise.all([
      readPlan.tasks ? tasksReport.start() : undefined,
      readPlan.availability ? read("/api/availability/config", { shifts: [], calendars: [], holidays: [] }) : { shifts: [], calendars: [], holidays: [] },
      readPlan.reviews ? read("/api/reviews/pending", { reviews: [] }) : { reviews: [] },
      readPlan.recovery ? read("/api/attendance/recovery-candidates?limit=50", { candidates: [] }) : { candidates: [] },
    ]);
    if (!isActive()) return;

    if (readPlan.tasks) tasksRead = initialTasksRead || tasksReport.getState();
    const calendars = Array.isArray(availabilityResult.calendars) ? availabilityResult.calendars : [];
    const holidays = Array.isArray(availabilityResult.holidays) ? availabilityResult.holidays : [];
    const shifts = Array.isArray(availabilityResult.shifts) ? availabilityResult.shifts : [];
    const reviews = Array.isArray(reviewsResult.reviews) ? reviewsResult.reviews : [];
    // Permission reads are a client-side plan. The availability endpoint also
    // returns its transaction-current per-source visibility, so intersect both
    // before any availability data crosses into the feature component.
    const plannedAvailabilitySources = getAvailabilitySources();
    const sourceVisibility = availabilityResult?.visibility;
    const availabilitySources = {
      shifts: plannedAvailabilitySources?.shifts === true && sourceVisibility?.shifts === true,
      calendars: plannedAvailabilitySources?.calendars === true && sourceVisibility?.calendars === true,
      holidays: plannedAvailabilitySources?.holidays === true && sourceVisibility?.holidays === true,
    };
    const availability = {
      shifts: availabilitySources.shifts ? shifts : [],
      calendars: availabilitySources.calendars ? calendars : [],
      holidays: availabilitySources.holidays ? holidays : [],
    };

    const recoverySlot = readPlan.recovery ? createRecoverySlot() : null;
    if (recoverySlot) await renderRecovery(recoverySlot, recoveryResult);
    if (!isActive()) return;

    operationsProps = {
      tasks: tasksRead,
      reviews: readState(readPlan.reviews, reviewsResult, "pending reviews", reviews),
      availability: readState(readPlan.availability, availabilityResult, "availability configuration", {
        ...availability,
      }),
      availabilitySources,
      recoverySlot,
      onRetry,
      personHistoryHref,
      onViewPersonHistory,
      taskDetailHref,
      onOpenTask,
      onExportWork: () => {
        const page = tasksRead?.status === "ready" ? tasksRead.data : undefined;
        if (!page) return;
        downloadCsv(
          `nova-work-page-${page.pageNumber}.csv`,
          ["Title", "Status", "Priority", "Due date", "Client", "Workstream", "Group", "Department", "Non-cancelled assignments"],
          page.tasks.map((task) => [
            task.title,
            task.status,
            task.priority,
            task.dueDate,
            task.client?.name,
            task.workstream?.name,
            task.group?.name,
            task.department?.name,
            task.assignmentCount,
          ]),
        );
      },
      onExportAvailability: () => downloadCsv(
        "nova-calendar.csv",
        operationsUi.OPERATIONS_AVAILABILITY_EXPORT_HEADERS,
        operationsUi.buildAvailabilityExportRows(availability, availabilitySources),
      ),
    };
    mountOperationsOverview();
    onRestoreScroll();
  } catch (error) {
    if (!isActive()) return;
    mountIsland(board, operationsPageUi.OperationsPage, {
      overview: {
        fatalMessage: getErrorText(error),
        onRetry,
        personHistoryHref: () => "",
        onViewPersonHistory: () => {},
        taskDetailHref: () => "",
        onOpenTask: () => {},
      },
    });
    onShowFeedback();
    onRestoreScroll();
  }
}
