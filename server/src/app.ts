import { authenticationConfiguration } from "./auth-configuration.js";
import { database } from "./db.js";
import { isSecretsEncryptionKeyValid } from "./secrets.js";
import { bootstrapOrganisation } from "./commands/bootstrap-organisation.js";
import { acceptInvitation, registerFounder } from "./commands/account-registration.js";
import { createCustomRole, updateCustomRole } from "./commands/create-role.js";
import {
  activateEmailConnection,
  beginGmailConnection,
  completeGmailConnection,
  createEmailConnection,
  deactivateEmailConnection,
  listEmailConnections,
  testEmailConnection,
} from "./commands/email-connections.js";
import { readAuthHandoffs, revealAuthHandoff } from "./commands/auth-handoffs.js";
import { invitePerson, resendInvitation } from "./commands/invite-person.js";
import { freezePerson } from "./commands/freeze-person.js";
import { offboardPerson } from "./commands/offboard-person.js";
import { transferSuperAdmin } from "./commands/owner-transfer.js";
import {
  searchAdminOnboardingOptions,
  searchEligibleOwnerTransferPeople,
} from "./commands/admin-picker-search.js";
import {
  createClientDepartment,
  createClientMembership,
  endClientMembership,
  readClientMemberships,
} from "./commands/client-access.js";
import { readClientMembershipOptions } from "./commands/client-membership-options.js";
import { reviewAssignment, submitAssignment } from "./commands/reviews.js";
import { readPendingReviews } from "./commands/review-queue.js";
import { readReviewerReviewDetail } from "./commands/review-detail.js";
import { readTaskDetail } from "./commands/task-detail.js";
import { readPersonHistory } from "./commands/person-history.js";
import {
  createHandoverRequest,
  createReviewerRequest,
  readHandoverRequests,
  readAssignmentCandidates,
  readReviewerRequests,
  resolveHandoverRequest,
  resolveReviewerRequest,
} from "./commands/task-requests.js";
import { readTimeline } from "./commands/timeline.js";
import { createTimelineAdjustment, searchTimelineCorrectionAssignments } from "./commands/timeline-adjustments.js";
import {
  readAuditEvents,
  readActorPermissionGrants,
  readDepartments,
  readGeofenceOfficeOptions,
  readOffices,
  readOrganisation,
  readPeople,
  readPermissions,
  readRoles,
} from "./commands/admin-read.js";
import { readPeopleDirectory, readPersonDirectoryRecord } from "./commands/people-directory.js";
import { readRoleScopeTargets } from "./commands/role-scope-targets.js";
import {
  searchAvailabilityConfigurationTargets,
  searchWfhPolicyTargets,
} from "./commands/availability-picker-search.js";
import {
  completePersonOnboarding,
  createOffice,
  createOrganisationDepartment,
  updateAttendancePolicy,
  updateOfficeGeofence,
} from "./commands/organisation-setup.js";
import {
  createOfficeHoliday,
  createShift,
  createWorkingCalendar,
  readAvailabilityConfig,
} from "./commands/availability-setup.js";
import { readAvailabilityAgenda } from "./commands/availability-agenda.js";
import { createWfhPolicy, readWfhPolicies } from "./commands/wfh-policy.js";
import {
  readHistoricalExceptions,
  resolveHistoricalException,
} from "./commands/historical-exceptions.js";
import {
  changeAttendanceMode,
  checkIn,
  checkOut,
  readAttendanceActionContext,
  readAttendanceToday,
} from "./commands/attendance.js";
import { readAttendanceRecoveryCandidates, recoverAttendance } from "./commands/attendance-recovery.js";
import { closeWorkSession, readWorkSessions, startWorkSession } from "./commands/work-sessions.js";
import {
  cancelLeave,
  createLeaveRequest,
  readLeaveMine,
  readPendingLeaveRequests,
  resolveLeaveAttendanceConflict,
  reviewLeave,
} from "./commands/leave.js";
import {
  cancelWfhRequest,
  createWfhRequest,
  readPendingWfhRequests,
  readWfhMine,
  reviewWfhRequest,
} from "./commands/wfh-requests.js";
import {
  createClient,
  createClientWorkstream,
  createOrganisationWorkstream,
  updateClientWorkstreamBillingPolicy,
  readClientWorkstreamTaskBillingRules,
  updateClientWorkstreamTaskBillingRule,
  createTask,
  createTaskAssignment,
  createWorkGroup,
  cancelTask,
  updateTaskDueDate,
  grantReviewerException,
  reassignTaskAssignment,
  readWorkContext,
  readMyAssignments,
  readVisibleTasks,
  readTasks,
  readTaskAssignmentOptions,
  updateAssignmentReviewer,
} from "./commands/work-context.js";
import {
  archiveTaskCatalogEntry,
  createTaskCatalogEntry,
  readTaskCatalog,
  reviewTaskCatalogProposal,
  updateTaskCatalogEntry,
} from "./commands/task-catalog.js";
import {
  readTaskComposerCatalogOptions,
  readTaskComposerCorrectionSources,
  readTaskComposerDepartments,
} from "./commands/task-composer-search.js";
import {
  readReviewerExceptionCandidates,
  readReviewerManagementAssignment,
  readReviewerManagementList,
} from "./commands/reviewer-management.js";
import {
  markAllNotificationsRead,
  markNotificationRead,
  readNotificationPreferences,
  readNotificationDelivery,
  requeueNotificationDelivery,
  readNotificationUnreadCount,
  readNotifications,
  updateNotificationPreferences,
} from "./commands/notifications.js";
import { stateChangingRequestError } from "./request-security.js";
import { requestFailureStatus } from "./request-failure.js";
import { readPublicOrigin, updatePublicOrigin } from "./commands/public-origin.js";
import { readPersonalUiPreferences, updatePersonalUiPreferences } from "./commands/ui-preferences.js";
import { deletePersonalTaskView, readPersonalTaskViews, writePersonalTaskView } from "./commands/task-views.js";
import {
  backgroundJobSecretMatches,
  backgroundSchedulerMatches,
  configuredBackgroundScheduler,
  runBackgroundTick,
} from "./maintenance-worker.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

/** Add safe request timing to API responses so browser tools can separate server time from network time. */
export async function handleRequest(request: Request): Promise<Response> {
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await dispatchRequest(request);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    console.error(`NOVA_REQUEST_FAILED ${request.method} ${code}`);
    const status = requestFailureStatus(error);
    response = status === 503
      ? json({ error: "SERVICE_UNAVAILABLE" }, status)
      : json({ error: "INTERNAL_ERROR" }, status);
  }
  const headers = new Headers(response.headers);
  const existingTiming = headers.get("server-timing");
  const appTiming = `nova-app;dur=${Math.max(0, performance.now() - startedAt).toFixed(1)}`;
  headers.set("server-timing", existingTiming ? `${existingTiming}, ${appTiming}` : appTiming);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function dispatchRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const commandPath = pathname.startsWith("/api/")
    ? pathname.slice("/api".length)
    : pathname;

  if (commandPath.startsWith("/auth/")) {
    try {
      authenticationConfiguration();
    } catch {
      return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
    }

    const { auth } = await import("./auth.js");
    return auth.handler(request);
  }

  // Deployment schedulers (Cloudflare Cron, Supabase Cron/pg_net, Netlify,
  // or the VPS worker) all invoke this one provider-neutral tick. It is not a
  // browser route and is protected by a deployment-only secret.
  if (request.method === "POST" && commandPath === "/internal/background/tick") {
    if (!backgroundJobSecretMatches(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null)) {
      return json({ error: "BACKGROUND_JOB_UNAUTHORIZED" }, 401);
    }
    if (!configuredBackgroundScheduler()) {
      return json({ error: "BACKGROUND_SCHEDULER_NOT_CONFIGURED" }, 503);
    }
    if (!backgroundSchedulerMatches(request.headers.get("x-nova-background-scheduler"))) {
      return json({ error: "BACKGROUND_SCHEDULER_NOT_SELECTED" }, 409);
    }
    try {
      return json({ tick: await runBackgroundTick() });
    } catch (error) {
      console.error(`[NOVA background] endpoint tick failed: ${error instanceof Error ? error.message : "BACKGROUND_JOB_FAILED"}`);
      return json({ error: "BACKGROUND_JOB_FAILED" }, 503);
    }
  }

  const requestSecurityError = stateChangingRequestError(request);
  if (requestSecurityError) return requestSecurityError;

  if (request.method === "GET" && commandPath === "/ready") {
    const scheduler = configuredBackgroundScheduler();
    if (!scheduler || !isSecretsEncryptionKeyValid()) {
      return json({ service: "nova-api", status: "not_ready" }, 503);
    }
    try {
      const result = await database().query<{ schema_ready: boolean }>(
        `SELECT to_regclass('nova.people') IS NOT NULL
                AND to_regclass('nova_auth."rateLimit"') IS NOT NULL AS schema_ready`,
      );
      if (result.rows[0]?.schema_ready !== true) {
        return json({ service: "nova-api", status: "not_ready" }, 503);
      }
      return json({ service: "nova-api", status: "ready", scheduler });
    } catch {
      return json({ service: "nova-api", status: "not_ready" }, 503);
    }
  }

  if (
    request.method === "GET" &&
    commandPath === "/email-connections/gmail/callback"
  ) {
    return completeGmailConnection(request);
  }

  if (request.method === "GET" && commandPath === "/email-connections") {
    return listEmailConnections(request);
  }

  if (request.method === "GET" && commandPath === "/auth-handoffs") {
    return readAuthHandoffs(request);
  }

  const authHandoffRoute = commandPath.match(/^\/auth-handoffs\/([0-9a-f-]{36})\/reveal$/i);
  if (request.method === "POST" && authHandoffRoute) {
    return revealAuthHandoff(request, authHandoffRoute[1]);
  }

  if (request.method === "POST" && commandPath === "/email-connections") {
    return createEmailConnection(request);
  }

  const emailConnectionRoute = commandPath.match(
    /^\/email-connections\/([0-9a-f-]{36})\/(test|activate|deactivate|gmail\/connect)$/i,
  );
  if (request.method === "POST" && emailConnectionRoute) {
    const [, connectionId, action] = emailConnectionRoute;
    if (action === "test") {
      return testEmailConnection(request, connectionId);
    }
    if (action === "activate") {
      return activateEmailConnection(request, connectionId);
    }
    if (action === "deactivate") {
      return deactivateEmailConnection(request, connectionId);
    }
    return beginGmailConnection(request, connectionId);
  }

  if (
    request.method === "POST" &&
    commandPath === "/organisation/bootstrap"
  ) {
    return bootstrapOrganisation(request);
  }

  if (request.method === "PATCH" && commandPath === "/organisation/attendance-policy") {
    return updateAttendancePolicy(request);
  }

  if (request.method === "POST" && commandPath === "/organisation/owner-transfer") {
    return transferSuperAdmin(request);
  }
  if (request.method === "GET" && commandPath === "/organisation/owner-transfer/eligible-people") {
    return searchEligibleOwnerTransferPeople(request);
  }

  if (request.method === "POST" && commandPath === "/setup/register") {
    return registerFounder(request);
  }

  if (request.method === "POST" && commandPath === "/invitations/accept") {
    return acceptInvitation(request);
  }

  if (request.method === "POST" && commandPath === "/people/invitations") {
    return invitePerson(request);
  }

  if (request.method === "POST" && commandPath === "/offices") {
    return createOffice(request);
  }
  const officeGeofenceRoute = commandPath.match(/^\/offices\/([0-9a-f-]{36})\/geofence$/i);
  if (request.method === "PATCH" && officeGeofenceRoute) {
    return updateOfficeGeofence(request, officeGeofenceRoute[1]);
  }

  if (
    request.method === "POST" &&
    commandPath === "/organisation-departments"
  ) {
    return createOrganisationDepartment(request);
  }

  if (request.method === "GET" && commandPath === "/work-context") {
    return readWorkContext(request);
  }
  if (request.method === "GET" && commandPath === "/work/assignments/mine") {
    return readMyAssignments(request);
  }
  if (request.method === "GET" && commandPath === "/work/tasks/visible") {
    return readVisibleTasks(request);
  }
  if (request.method === "GET" && commandPath === "/tasks") {
    return readTasks(request);
  }
  if (request.method === "GET" && commandPath === "/task-composer/catalog") {
    return readTaskComposerCatalogOptions(request);
  }
  if (request.method === "GET" && commandPath === "/task-composer/correction-sources") {
    return readTaskComposerCorrectionSources(request);
  }
  if (request.method === "GET" && commandPath === "/task-composer/departments") {
    return readTaskComposerDepartments(request);
  }
  if (request.method === "GET" && commandPath === "/task-assignments/reviewer-management") {
    return readReviewerManagementList(request);
  }
  const taskAssignmentOptionsRoute = commandPath.match(
    /^\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/assignment-options$/i,
  );
  if (request.method === "GET" && taskAssignmentOptionsRoute) {
    return readTaskAssignmentOptions(request, taskAssignmentOptionsRoute[1]);
  }
  const taskDetailRoute = commandPath.match(/^\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (request.method === "GET" && taskDetailRoute) {
    return readTaskDetail(request, taskDetailRoute[1]);
  }
  if (request.method === "GET" && commandPath === "/task-catalog") {
    return readTaskCatalog(request);
  }
  if (request.method === "POST" && commandPath === "/task-catalog") {
    return createTaskCatalogEntry(request);
  }
  const catalogProposalReviewRoute = commandPath.match(/^\/task-catalog\/proposals\/([0-9a-f-]{36})\/review$/i);
  if (request.method === "POST" && catalogProposalReviewRoute) {
    return reviewTaskCatalogProposal(request, catalogProposalReviewRoute[1]);
  }
  const catalogArchiveRoute = commandPath.match(/^\/task-catalog\/([0-9a-f-]{36})\/archive$/i);
  if (request.method === "POST" && catalogArchiveRoute) {
    return archiveTaskCatalogEntry(request, catalogArchiveRoute[1]);
  }
  const catalogEntryRoute = commandPath.match(/^\/task-catalog\/([0-9a-f-]{36})$/i);
  if (request.method === "PATCH" && catalogEntryRoute) {
    return updateTaskCatalogEntry(request, catalogEntryRoute[1]);
  }
  if (request.method === "POST" && commandPath === "/clients") {
    return createClient(request);
  }
  const clientDepartmentRoute = commandPath.match(/^\/clients\/([0-9a-f-]{36})\/departments$/i);
  if (request.method === "POST" && clientDepartmentRoute) {
    return createClientDepartment(request, clientDepartmentRoute[1]);
  }
  const clientMembershipEndRoute = commandPath.match(/^\/clients\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})\/end$/i);
  if (request.method === "PATCH" && clientMembershipEndRoute) {
    return endClientMembership(request, clientMembershipEndRoute[1], clientMembershipEndRoute[2]);
  }
  const clientMembershipOptionsRoute = commandPath.match(/^\/clients\/([0-9a-f-]{36})\/membership-options$/i);
  if (request.method === "GET" && clientMembershipOptionsRoute) {
    return readClientMembershipOptions(request, clientMembershipOptionsRoute[1]);
  }
  const clientMembershipRoute = commandPath.match(/^\/clients\/([0-9a-f-]{36})\/members$/i);
  if (clientMembershipRoute) {
    if (request.method === "GET") return readClientMemberships(request, clientMembershipRoute[1]);
    if (request.method === "POST") return createClientMembership(request, clientMembershipRoute[1]);
  }
  if (request.method === "POST" && commandPath === "/workstreams/client") {
    return createClientWorkstream(request);
  }
  const clientWorkstreamBillingPolicyRoute = commandPath.match(/^\/workstreams\/client\/([0-9a-f-]{36})\/billing-policy$/i);
  if (request.method === "PATCH" && clientWorkstreamBillingPolicyRoute) {
    return updateClientWorkstreamBillingPolicy(request, clientWorkstreamBillingPolicyRoute[1]);
  }
  const clientWorkstreamBillingDefinitionsRoute = commandPath.match(
    /^\/workstreams\/client\/([0-9a-f-]{36})\/billing-policy\/definitions(?:\/([0-9a-f-]{36}))?$/i,
  );
  if (clientWorkstreamBillingDefinitionsRoute) {
    if (request.method === "GET" && !clientWorkstreamBillingDefinitionsRoute[2]) {
      return readClientWorkstreamTaskBillingRules(request, clientWorkstreamBillingDefinitionsRoute[1]);
    }
    if (request.method === "PATCH" && clientWorkstreamBillingDefinitionsRoute[2]) {
      return updateClientWorkstreamTaskBillingRule(
        request, clientWorkstreamBillingDefinitionsRoute[1], clientWorkstreamBillingDefinitionsRoute[2],
      );
    }
  }
  const clientWorkstreamTaskBillingRuleRoute = commandPath.match(
    /^\/workstreams\/client\/([0-9a-f-]{36})\/task-billing-rules\/([0-9a-f-]{36})$/i,
  );
  if (request.method === "PATCH" && clientWorkstreamTaskBillingRuleRoute) {
    return json({
      error: "TASK_BILLING_RULES_ROUTE_REPLACED",
      replacement: "/api/workstreams/client/:workstreamId/billing-policy/definitions/:entryId",
    }, 410);
  }
  if (request.method === "POST" && commandPath === "/workstreams/organisation") {
    return createOrganisationWorkstream(request);
  }
  if (request.method === "POST" && commandPath === "/work-groups") {
    return createWorkGroup(request);
  }
  if (request.method === "POST" && commandPath === "/tasks") {
    return createTask(request);
  }
  const assignmentRoute = commandPath.match(/^\/tasks\/([0-9a-f-]{36})\/assignments$/i);
  if (request.method === "POST" && assignmentRoute) {
    return createTaskAssignment(request, assignmentRoute[1]);
  }
  const taskCancelRoute = commandPath.match(/^\/tasks\/([0-9a-f-]{36})\/cancel$/i);
  if (request.method === "POST" && taskCancelRoute) return cancelTask(request, taskCancelRoute[1]);
  const taskDueDateRoute = commandPath.match(/^\/tasks\/([0-9a-f-]{36})\/due-date$/i);
  if (request.method === "PATCH" && taskDueDateRoute) {
    return updateTaskDueDate(request, taskDueDateRoute[1]);
  }
  const reviewerRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/reviewer$/i);
  if (request.method === "PATCH" && reviewerRoute) {
    return updateAssignmentReviewer(request, reviewerRoute[1]);
  }
  const reassignmentRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/reassign$/i);
  if (request.method === "POST" && reassignmentRoute) return reassignTaskAssignment(request, reassignmentRoute[1]);
  const reviewerExceptionRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/reviewer-exception$/i);
  if (request.method === "POST" && reviewerExceptionRoute) return grantReviewerException(request, reviewerExceptionRoute[1]);
  const reviewerRequestRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/reviewer-requests$/i);
  if (request.method === "POST" && reviewerRequestRoute) return createReviewerRequest(request, reviewerRequestRoute[1]);
  const handoverRequestRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/handover-requests$/i);
  if (request.method === "POST" && handoverRequestRoute) return createHandoverRequest(request, handoverRequestRoute[1]);
  const assignmentCandidatesRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/candidates$/i);
  if (request.method === "GET" && assignmentCandidatesRoute) return readAssignmentCandidates(request, assignmentCandidatesRoute[1]);
  const reviewerExceptionCandidatesRoute = commandPath.match(
    /^\/task-assignments\/([0-9a-f-]{36})\/reviewer-management\/exception-candidates$/i,
  );
  if (request.method === "GET" && reviewerExceptionCandidatesRoute) {
    return readReviewerExceptionCandidates(request, reviewerExceptionCandidatesRoute[1]);
  }
  const reviewerManagementAssignmentRoute = commandPath.match(
    /^\/task-assignments\/([0-9a-f-]{36})\/reviewer-management$/i,
  );
  if (request.method === "GET" && reviewerManagementAssignmentRoute) {
    return readReviewerManagementAssignment(request, reviewerManagementAssignmentRoute[1]);
  }
  const reviewerRequestDecisionRoute = commandPath.match(/^\/task-reviewer-requests\/([0-9a-f-]{36})\/(accept|decline|withdraw)$/i);
  if (request.method === "POST" && reviewerRequestDecisionRoute) return resolveReviewerRequest(request, reviewerRequestDecisionRoute[1], reviewerRequestDecisionRoute[2] as "accept" | "decline" | "withdraw");
  const handoverRequestDecisionRoute = commandPath.match(/^\/task-handover-requests\/([0-9a-f-]{36})\/(accept|decline|withdraw)$/i);
  if (request.method === "POST" && handoverRequestDecisionRoute) return resolveHandoverRequest(request, handoverRequestDecisionRoute[1], handoverRequestDecisionRoute[2] as "accept" | "decline" | "withdraw");
  const submissionRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/submit$/i);
  if (request.method === "POST" && submissionRoute) return submitAssignment(request, submissionRoute[1]);
  const reviewDecisionRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/review$/i);
  if (request.method === "POST" && reviewDecisionRoute) return reviewAssignment(request, reviewDecisionRoute[1]);
  if (request.method === "GET" && commandPath === "/reviews/pending") return readPendingReviews(request);
  const reviewerReviewDetailRoute = commandPath.match(/^\/task-assignments\/([0-9a-f-]{36})\/review$/i);
  if (request.method === "GET" && reviewerReviewDetailRoute) {
    return readReviewerReviewDetail(request, reviewerReviewDetailRoute[1]);
  }
  if (request.method === "GET" && commandPath === "/task-reviewer-requests") return readReviewerRequests(request);
  if (request.method === "GET" && commandPath === "/task-handover-requests") return readHandoverRequests(request);

  if (request.method === "GET" && commandPath === "/availability/config") {
    return readAvailabilityConfig(request);
  }
  if (request.method === "GET" && commandPath === "/availability/configuration-targets") {
    return searchAvailabilityConfigurationTargets(request);
  }
  if (request.method === "GET" && commandPath === "/availability/agenda") {
    return readAvailabilityAgenda(request);
  }
  if (request.method === "POST" && commandPath === "/availability/shifts") {
    return createShift(request);
  }
  if (request.method === "POST" && commandPath === "/availability/calendars") {
    return createWorkingCalendar(request);
  }
  if (request.method === "POST" && commandPath === "/availability/holidays") {
    return createOfficeHoliday(request);
  }
  if (request.method === "GET" && commandPath === "/availability/wfh-policies") {
    return readWfhPolicies(request);
  }
  if (request.method === "GET" && commandPath === "/availability/wfh-policy-targets") {
    return searchWfhPolicyTargets(request);
  }
  if (request.method === "POST" && commandPath === "/availability/wfh-policies") {
    return createWfhPolicy(request);
  }
  if (request.method === "GET" && commandPath === "/availability/wfh/mine") {
    return readWfhMine(request);
  }
  if (request.method === "GET" && commandPath === "/availability/wfh/pending") {
    return readPendingWfhRequests(request);
  }
  if (request.method === "POST" && commandPath === "/availability/wfh") {
    return createWfhRequest(request);
  }
  const wfhRoute = commandPath.match(/^\/availability\/wfh\/([0-9a-f-]{36})\/(review|cancel)$/i);
  if (request.method === "POST" && wfhRoute) {
    return wfhRoute[2] === "review"
      ? reviewWfhRequest(request, wfhRoute[1])
      : cancelWfhRequest(request, wfhRoute[1]);
  }
  if (request.method === "GET" && commandPath === "/historical-exceptions") {
    return readHistoricalExceptions(request);
  }
  const exceptionRoute = commandPath.match(/^\/historical-exceptions\/([0-9a-f-]{36})\/resolve$/i);
  if (request.method === "POST" && exceptionRoute) {
    return resolveHistoricalException(request, exceptionRoute[1]);
  }
  if (request.method === "GET" && commandPath === "/attendance/today") {
    return readAttendanceToday(request);
  }
  if (request.method === "GET" && commandPath === "/attendance/action-context") {
    return readAttendanceActionContext(request);
  }
  if (request.method === "POST" && commandPath === "/attendance/check-in") {
    return checkIn(request);
  }
  if (request.method === "POST" && commandPath === "/attendance/check-out") {
    return checkOut(request);
  }
  if (request.method === "POST" && commandPath === "/attendance/change-mode") {
    return changeAttendanceMode(request);
  }
  if (request.method === "POST" && commandPath === "/attendance/recover") {
    return recoverAttendance(request);
  }
  if (request.method === "GET" && commandPath === "/attendance/recovery-candidates") {
    return readAttendanceRecoveryCandidates(request);
  }
  if (request.method === "GET" && commandPath === "/work-sessions/mine") {
    return readWorkSessions(request);
  }
  if (request.method === "GET" && commandPath === "/work/timeline") {
    return readTimeline(request);
  }
  if (request.method === "GET" && commandPath === "/work/timeline-adjustments/assignments") {
    return searchTimelineCorrectionAssignments(request);
  }
  if (request.method === "POST" && commandPath === "/work/timeline-adjustments") {
    return createTimelineAdjustment(request);
  }
  if (request.method === "POST" && commandPath === "/work-sessions/start") {
    return startWorkSession(request);
  }
  const workSessionRoute = commandPath.match(/^\/work-sessions\/([0-9a-f-]{36})\/(pause|stop)$/i);
  if (request.method === "POST" && workSessionRoute) {
    return closeWorkSession(request, workSessionRoute[1], workSessionRoute[2] === "pause" ? "PAUSED" : "STOPPED");
  }
  if (request.method === "GET" && commandPath === "/leave/mine") {
    return readLeaveMine(request);
  }
  if (request.method === "GET" && commandPath === "/leave/pending") {
    return readPendingLeaveRequests(request);
  }
  if (request.method === "POST" && commandPath === "/leave") {
    return createLeaveRequest(request);
  }
  const leaveReviewRoute = commandPath.match(/^\/leave\/([0-9a-f-]{36})\/(review|cancel|resolve-conflict)$/i);
  if (request.method === "POST" && leaveReviewRoute) {
    if (leaveReviewRoute[2] === "resolve-conflict") {
      return resolveLeaveAttendanceConflict(request, leaveReviewRoute[1]);
    }
    return leaveReviewRoute[2] === "review"
      ? reviewLeave(request, leaveReviewRoute[1])
      : cancelLeave(request, leaveReviewRoute[1]);
  }

  const onboardingRoute = commandPath.match(
    /^\/people\/([0-9a-f-]{36})\/complete-onboarding$/i,
  );
  if (request.method === "POST" && onboardingRoute) {
    const body = await request.json().catch(() => ({}));
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return completePersonOnboarding(new Request(request.url, {
      body: JSON.stringify({
        ...((typeof body === "object" && body !== null) ? body : {}),
        personId: onboardingRoute[1],
      }),
      headers,
      method: request.method,
    }));
  }

  const resendRoute = commandPath.match(
    /^\/people\/([0-9a-f-]{36})\/invitations\/resend$/i,
  );
  if (request.method === "POST" && resendRoute) {
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return resendInvitation(new Request(request.url, {
      body: JSON.stringify({ personId: resendRoute[1] }),
      headers,
      method: request.method,
    }));
  }

  const freezeRoute = commandPath.match(/^\/people\/([0-9a-f-]{36})\/freeze$/i);
  if (request.method === "POST" && freezeRoute) {
    const body = await request.json().catch(() => ({}));
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return freezePerson(new Request(request.url, {
      body: JSON.stringify({
        ...((typeof body === "object" && body !== null) ? body : {}),
        personId: freezeRoute[1],
      }),
      headers,
      method: request.method,
    }));
  }

  const offboardRoute = commandPath.match(/^\/people\/([0-9a-f-]{36})\/offboard$/i);
  if (request.method === "POST" && offboardRoute) {
    const body = await request.json().catch(() => ({}));
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return offboardPerson(new Request(request.url, {
      body: JSON.stringify({
        ...((typeof body === "object" && body !== null) ? body : {}),
        personId: offboardRoute[1],
      }),
      headers,
      method: request.method,
    }));
  }

  if (request.method === "POST" && commandPath === "/roles") {
    return createCustomRole(request);
  }

  const roleUpdateRoute = commandPath.match(/^\/roles\/([0-9a-f-]{36})$/i);
  if (request.method === "PATCH" && roleUpdateRoute) {
    return updateCustomRole(request, roleUpdateRoute[1]);
  }

  if (request.method === "GET" && commandPath === "/organisation") {
    return readOrganisation(request);
  }
  if (request.method === "GET" && commandPath === "/me/permission-grants") {
    return readActorPermissionGrants(request);
  }
  if (request.method === "GET" && commandPath === "/me/ui-preferences") {
    return readPersonalUiPreferences(request);
  }
  if (request.method === "PATCH" && commandPath === "/me/ui-preferences") {
    return updatePersonalUiPreferences(request);
  }
  if (request.method === "GET" && commandPath === "/me/task-views") {
    return readPersonalTaskViews(request);
  }
  if (request.method === "POST" && commandPath === "/me/task-views") {
    return writePersonalTaskView(request);
  }
  const personalTaskViewRoute = commandPath.match(/^\/me\/task-views\/([0-9a-f-]{36})$/i);
  if (request.method === "DELETE" && personalTaskViewRoute) {
    return deletePersonalTaskView(request, personalTaskViewRoute[1]);
  }
  if (request.method === "GET" && commandPath === "/organisation/public-origin") {
    return readPublicOrigin(request);
  }
  if (request.method === "PATCH" && commandPath === "/organisation/public-origin") {
    return updatePublicOrigin(request);
  }
  if (request.method === "GET" && commandPath === "/offices") {
    return readOffices(request);
  }
  if (request.method === "GET" && commandPath === "/offices/geofence-options") {
    return readGeofenceOfficeOptions(request);
  }
  if (request.method === "GET" && commandPath === "/organisation-departments") {
    return readDepartments(request);
  }
  if (request.method === "GET" && commandPath === "/permissions") {
    return readPermissions(request);
  }
  if (request.method === "GET" && commandPath === "/roles") {
    return readRoles(request);
  }
  if (request.method === "GET" && commandPath === "/roles/scope-targets") {
    return readRoleScopeTargets(request);
  }
  if (request.method === "GET" && commandPath === "/people") {
    return readPeople(request);
  }
  if (request.method === "GET" && commandPath === "/people/onboarding-options") {
    return searchAdminOnboardingOptions(request);
  }
  if (request.method === "GET" && commandPath === "/people/directory") {
    return readPeopleDirectory(request);
  }
  const personDirectoryRecordRoute = commandPath.match(/^\/people\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && personDirectoryRecordRoute) {
    return readPersonDirectoryRecord(request, personDirectoryRecordRoute[1]);
  }
  const personHistoryRoute = commandPath.match(/^\/people\/([0-9a-f-]{36})\/history$/i);
  if (request.method === "GET" && personHistoryRoute) {
    return readPersonHistory(request, personHistoryRoute[1]);
  }
  if (request.method === "GET" && commandPath === "/audit-events") {
    return readAuditEvents(request);
  }

  if (request.method === "GET" && commandPath === "/notifications") {
    return readNotifications(request);
  }
  if (request.method === "GET" && commandPath === "/notifications/delivery") {
    return readNotificationDelivery(request);
  }
  if (request.method === "GET" && commandPath === "/notifications/unread-count") {
    return readNotificationUnreadCount(request);
  }
  if (request.method === "GET" && commandPath === "/notification-preferences") {
    return readNotificationPreferences(request);
  }
  if (request.method === "PATCH" && commandPath === "/notification-preferences") {
    return updateNotificationPreferences(request);
  }
  if (request.method === "POST" && commandPath === "/notifications/read-all") {
    return markAllNotificationsRead(request);
  }
  const notificationRoute = commandPath.match(/^\/notifications\/([0-9a-f-]{36})\/read$/i);
  if (request.method === "POST" && notificationRoute) {
    return markNotificationRead(request, notificationRoute[1]);
  }
  const notificationDeliveryRoute = commandPath.match(/^\/notifications\/delivery\/([0-9a-f-]{36})\/requeue$/i);
  if (request.method === "POST" && notificationDeliveryRoute) {
    return requeueNotificationDelivery(request, notificationDeliveryRoute[1]);
  }

  if (request.method === "GET" && commandPath === "/health") {
    return json({ service: "nova-api", status: "ok" });
  }

  return json(
    {
      error: "ROUTE_NOT_FOUND",
      message: "No NOVA command matches this route.",
    },
    404,
  );
}
