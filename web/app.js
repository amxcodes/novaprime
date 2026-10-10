import { createElement } from "react";
import { resolveApplicationRoute } from "./src/app/route-resolution.ts";
import { createAdminPageRoute, preloadAdminPageFeatureModules } from "./app/admin-page-route.js";
import { adminAreaForView } from "./src/pages/admin/admin-areas.ts";
import { createMyDayRequestRoute } from "./app/my-day-request-route.js";
import { mountMyDayPageRoute } from "./app/my-day-page-route.ts";
import { createWorkSetupRoute } from "./app/work-setup-route.js";
import { createWorkSetupActionsRoute } from "./app/work-setup-actions-route.ts";
import {
  adminReadIssue,
  canShowAdminFeature,
  canShowInviteNavigation,
  canShowPeopleNavigation,
  canViewAuthHandoffs,
  hasPermissionGrant,
  hasAnyPermissionGrant,
  planAdminReads,
  planMyDayReads,
  planOperationsAvailabilitySources,
  planOperationsReads,
  planWorkReads,
  planWorkSetupReads,
  adminPermissionNoticeMessage,
  readOrError,
  skippedAdminRead,
} from "./admin-read-state.js";
import {
  canAccessWorkspaceDestination,
  getVisibleWorkspaceDestinations,
  resolveWorkspaceDestinationView,
  resolveWorkspaceHome,
} from "./workspace-destinations.js";
import { projectWorkCollaborationReadState } from "./app/work-collaboration-route.js";
import { createWorkCollaborationResolveAction } from "./app/work-collaboration-actions-route.js";
import { renameSavedTaskViewFromSettings as renameSavedTaskViewCommand } from "./app/settings-task-view-rename.js";
import {
  readFocusedCollaborationRequest,
  resolveWorkRouteContext,
  taskDetailUrl as buildTaskDetailUrl,
  visibleTaskFilters as readVisibleTaskFilters,
  workAssignmentFilters as readWorkAssignmentFilters,
} from "./app/work-route.js";
import { describeInvitationFeedback } from "./src/features/admin/invitation-feedback.ts";
import { canInviteAdminPeople, canShowOwnerTransfer, canViewAdminPeople } from "./src/features/admin/capabilities.ts";
import { LegacyRouteShell } from "./src/app-shell/LegacyRouteShell.tsx";
import { installPermissionRefreshOnResume } from "./src/app-shell/permission-refresh.ts";
import { RouteUnavailablePage } from "./src/pages/route-unavailable/RouteUnavailablePage.tsx";
import { MyDayPage } from "./src/features/my-day/MyDayPage.tsx";
import {
  checkDeploymentEndpoint,
  createDeploymentProbeLifecycle,
  deploymentProgressStorageKey,
  normalizeDeploymentProgress,
} from "./app/deployment-route.js";
import { canRenderLeaveConflictAction, canRenderRequestReviewActions } from "./review-actions.js";
import { projectWorkTaskDetail } from "./src/features/work/task-detail/projection.ts";
import { createWorkTaskDetailRoute } from "./app/work-task-detail-route.js";
import { createWorkReviewActions, mountWorkReviewsRoute, projectWorkReviews } from "./app/work-reviews-route.js";
import { createReviewFeedbackDraftStore, reconcileReviewFeedbackDraftAccess as reconcileReviewDraftAccess } from "./app/review-feedback-drafts.js";
import { mountWorkReviewerManagementRoute } from "./app/work-reviewer-management-route.js";
import { createWorkReviewerManagementSaveAction } from "./app/work-reviewer-management-actions-route.ts";
import { createMyAssignmentsRoute } from "./app/my-assignments-route.js";
import { createMyAssignmentActionsRoute } from "./app/my-assignment-actions-route.ts";
import { mountWorkTaskComposerRoute } from "./app/work-task-composer-route.js";
import { readWorkRouteData } from "./app/work-read-route.js";
import { loadWorkRouteFeatures } from "./app/work-route-features.js";
import {
  createWorkTimelineCorrectionAction,
  createWorkTimelineCorrectionAssignmentSearch,
} from "./app/work-timeline-actions-route.ts";
import { mountWorkContextRoute } from "./app/work-context-route.js";
import { createWorkContextDepartmentCommandAction } from "./app/work-context-actions-route.ts";
import { createPeoplePageRoute, isPeopleDirectoryContext } from "./app/people-page-route.js";
import { getAuthHandoffAccess, mountSettingsAuthHandoffs as mountAuthHandoffsRoute } from "./app/auth-handoffs-route.js";
import { mountSettingsEmailDeliveryRoute } from "./app/settings-email-delivery-route.js";
import { mountSettingsPublicOriginRoute } from "./app/settings-public-origin-route.js";
import { mountPublicLanding as mountPublicLandingRoute } from "./app/public-landing-route.js";
import { mountPublicSignIn as mountPublicSignInRoute } from "./app/public-sign-in-route.js";
import { mountPublicPasswordRecovery as mountPublicPasswordRecoveryRoute } from "./app/public-password-recovery-route.js";
import { mountPublicInvitationAcceptance as mountPublicInvitationAcceptanceRoute } from "./app/public-invitation-acceptance-route.js";
import { mountPublicPasswordReset as mountPublicPasswordResetRoute } from "./app/public-password-reset-route.js";
import { createPublicFirstRunSetupRoute } from "./app/public-first-run-setup-route.js";
import { clearReactIslands, mountReactIsland, unmountReactIslandsWithin } from "./src/app/react-islands.tsx";
import { applyAppearanceTokens } from "./src/design-system/foundations/appearance.ts";
import { renderAttendanceRecovery as mountAttendanceRecovery } from "./features/attendance/recovery.js";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_WORKSPACE,
  UI_PREFERENCE_SCHEMA_VERSION,
  normalizeAppearance,
  normalizeWorkspace,
} from "./ui-preferences.js";
import {
  canEditPersonalPreferenceDraft,
  canPersistPersonalPreferences,
  personalPreferenceReadStatus,
} from "./src/features/personalization/preference-availability.ts";
import {
  createRequestLifecycle,
  isCommandContextCurrent,
  isCommandIdentityCurrent,
  withPageReadSignal,
} from "./request-lifecycle.js";

const app = document.querySelector("#app");
const mountPublicFirstRunSetupRoute = createPublicFirstRunSetupRoute();
let deploymentProbe = null;
const deploymentProbeLifecycle = createDeploymentProbeLifecycle();
let appearanceSaveTimer = null;
let appearanceSaveInFlight = false;
let uiPreferenceReadRetry = null;
let appearanceSaveGeneration = 0;
let appearanceEditorRenderGeneration = 0;
let workspaceEditorRenderGeneration = 0;
let savedTaskViewsRenderGeneration = 0;
let savedTaskViewsReadRequest = null;
// Reviewer notes stay in memory only and are scoped to the actor's current review grants.
const reviewFeedbackDrafts = createReviewFeedbackDraftStore();
const pageRequestLifecycle = createRequestLifecycle();
let pageRequestLifetime = null;
let activePeopleWorkspace = null;
// Keep directory selection reversible inside this document, while allowing a
// reload of a person URL to behave like a direct deep link.
const peopleWorkspaceSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const state = {
  adminData: null,
  actorGrants: null,
  uiPreferences: { appearance: { ...DEFAULT_APPEARANCE }, workspace: normalizeWorkspace(DEFAULT_WORKSPACE) },
  savedTaskViews: [],
  savedTaskViewsLoading: false,
  savedTaskViewsReadError: false,
  savedTaskViewsLoaded: false,
  savedTaskViewsRequestGeneration: 0,
  uiPreferenceRevision: 0,
  uiPreferencePersonId: null,
  identityPersonId: null,
  uiPreferenceWritable: false,
  uiPreferenceReadStatus: "unavailable",
  uiPreferenceSaveStatus: "idle",
  uiPreferenceConflict: null,
  identityEpoch: 0,
  pendingAdminCommandFocus: false,
  message: "",
  messageKind: "success",
  session: null,
  bootstrapToken: "",
  bootstrapFounderEmail: "",
  publicOriginConfigured: false,
  publicOrigin: "",
  emailOAuthResult: null,
  taskCreateFingerprint: "",
  taskCreateRequestKey: "",
  unreadNotificationCount: null,
  unreadNotificationGeneration: 0,
  deployment: {
    path: "",
    stage: 0,
    scheduler: "",
    completed: {},
  },
  view: null,
  pendingRouteScrollY: null,
  pendingRouteFocusTaskId: null,
  pendingRouteFocusTaskSource: null,
  pendingWorkAssignmentFocus: false,
  pendingVisibleTaskFocus: null,
};


function persistDeployment() {
  try {
    sessionStorage.setItem(deploymentProgressStorageKey, JSON.stringify(state.deployment));
  } catch {
    // Private browsing may deny storage; the in-memory checklist still works.
  }
}

function restoreDeployment() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(deploymentProgressStorageKey) || "null");
    const normalized = normalizeDeploymentProgress(saved);
    if (normalized) state.deployment = normalized;
  } catch {
    // Ignore malformed or unavailable browser storage.
  }
}

restoreDeployment();

const errorMessages = {
  ACCOUNT_NOT_OPERATIONAL: "This account is not currently allowed to perform that action.",
  ATTENDANCE_ALREADY_CLOSED: "Today's attendance is already closed.",
  ATTENDANCE_ALREADY_EXISTS: "Today's attendance has already been started.",
  ATTENDANCE_CALENDAR_REQUIRED: "An active working calendar is not configured for this office.",
  ATTENDANCE_HOLIDAY: "Today is an office holiday; attendance cannot be started.",
  ATTENDANCE_MODE_INVALID: "Choose a valid attendance mode.",
  ATTENDANCE_NON_WORKING_DAY: "Today is not a working day on the office calendar.",
  ATTENDANCE_SCHEDULE_REQUIRED: "This scheduled-attendance day has no shift configured yet.",
  ATTENDANCE_NOT_FOUND: "No open attendance exists for today.",
  ATTENDANCE_APPROVED_LEAVE: "Approved leave covers today; attendance cannot be started.",
  WORK_ON_APPROVED_LEAVE: "Approved leave covers today; productive work cannot be started.",
  ATTENDANCE_OFFICE_ASSIGNMENT_REQUIRED: "An active office assignment is required before attendance can start.",
  ATTENDANCE_CHECKOUT_RESULT_MISSING: "Attendance could not be closed safely. Try again.",
  ATTENDANCE_INPUT_INVALID: "Choose a valid attendance mode and location.",
  ATTENDANCE_GEOFENCE_NOT_CONFIGURED: "This office does not have an attendance geofence configured yet.",
  ATTENDANCE_LOCATION_REQUIRED: "Allow location access to check in at the office.",
  ATTENDANCE_LOCATION_ACCURACY_TOO_LOW: "Your location accuracy is too low for this office geofence.",
  ATTENDANCE_OUTSIDE_GEOFENCE: "You are outside the configured office attendance radius.",
  OFFICE_ASSIGNMENT_REQUIRED: "An active office assignment is required before attendance can start.",
  AUTHENTICATION_CONFIGURATION_REQUIRED: "NOVA authentication is not configured in this deployment yet.",
  AUTHENTICATION_REQUIRED: "Please sign in to continue.",
  AUTH_HANDOFF_NOT_AVAILABLE: "This secure handoff is expired, revoked, or already revealed. Generate a new one.",
  AUTH_HANDOFF_NOT_FOUND: "That secure handoff no longer exists.",
  EMAIL_CONNECTION_NOT_ACTIVE: "Set up and activate an email connection first, or use the secure system handoff in Admin.",
  EMAIL_CONNECTION_ALREADY_EXISTS: "A connection with these details already exists. Review the saved connections before adding another.",
  EMAIL_CONNECTION_NOT_FOUND: "This connection is no longer available. Refresh the list and try again.",
  GMAIL_CONNECTION_NOT_FOUND: "This Google connection is no longer available. Refresh the list and try again.",
  EMAIL_CONNECTION_CREDENTIALS_INVALID: "The saved Google credentials are incomplete. Update the connection credentials and try again.",
  EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME: "This deployment cannot use that provider from its runtime. Choose an HTTPS email provider such as Resend.",
  INVALID_PASSWORD: "The current password is not correct.",
  CALENDAR_ALREADY_EXISTS: "A working calendar with that name already exists.",
  CALENDAR_INPUT_INVALID: "Check the calendar name, office, effective date, and weekly rules.",
  CALENDAR_EFFECTIVE_DATE_INVALID: "A new calendar must begin after the office's latest calendar assignment.",
  EMAIL_CONNECTION_NOT_TESTED: "Test this connection successfully before activating it.",
  EMAIL_PROVIDER_DELIVERY_FAILED: "The provider could not send that email. Check its settings and try again.",
  EMAIL_CONNECTION_INPUT_INVALID: "Check the email connection details and try again.",
  SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED: "NOVA cannot securely store provider credentials in this deployment yet. Contact the deployment operator.",
  PUBLIC_ORIGIN_INPUT_INVALID: "Enter an origin such as https://work.example.com without a path.",
  PUBLIC_ORIGIN_NOT_ALLOWED: "That origin is not approved by the deployment operator yet.",
  PUBLIC_ORIGIN_NOT_CONFIGURED: "Choose and save the public NOVA URL first. New email links and callbacks are blocked until it is set.",
  PUBLIC_ORIGIN_REQUIRED_WHILE_EMAIL_ACTIVE: "Deactivate the active email connection before clearing the public URL, so queued links cannot be generated for an unknown host.",
  PUBLIC_ORIGIN_CHANGE_BLOCKED_DURING_GMAIL_AUTH: "Finish or cancel the current Google connection before changing the public URL.",
  EMAIL_TEST_INPUT_INVALID: "Enter a valid recipient email address for the test.",
  FOUNDER_REGISTRATION_INPUT_INVALID: "Check the founder details and try again.",
  HOLIDAY_ALREADY_EXISTS: "That office already has a holiday on this date.",
  HOLIDAY_INPUT_INVALID: "Check the holiday name, office, and date.",
  GMAIL_OAUTH_CALLBACK_FAILED: "Google connection could not be completed. Try connecting it again.",
  GMAIL_OAUTH_CALLBACK_INVALID: "Google did not return a valid authorization result.",
  GMAIL_AUTHORIZATION_URL_INVALID: "NOVA could not verify Google's authorization address. Try connecting again.",
  OWNER_TRANSFER_INPUT_INVALID: "Type the exact confirmation phrase before transferring ownership.",
  OWNER_TRANSFER_TARGET_INVALID: "Choose another eligible person to become the new owner.",
  TARGET_NOT_FOUND: "That person is no longer available. Refresh Admin and choose an eligible person.",
  TARGET_NOT_OPERATIONAL: "That person is no longer active or in notice. Refresh Admin and choose another person.",
  TARGET_ALREADY_OWNER: "That person is already a Super Admin. Choose another eligible person.",
  INVITATION_INVALID_OR_EXPIRED: "This invitation is no longer valid. Ask your administrator for a new one.",
  PERSON_INVITATION_INPUT_INVALID: "Enter a name and valid work email address.",
  PERSON_FREEZE_INPUT_INVALID: "That person could not be frozen with the supplied details.",
  ORGANISATION_BOOTSTRAP_ALREADY_COMPLETED: "This NOVA deployment has already been set up.",
  ORGANISATION_BOOTSTRAP_TOKEN_INVALID: "The setup token was not accepted.",
  PASSWORDS_DO_NOT_MATCH: "The two new passwords do not match.",
  INVALID_ORIGIN: "This browser address is not trusted by NOVA. Check BETTER_AUTH_URL and NOVA_ALLOWED_ORIGINS in the hosting provider, then reload.",
  EMAIL_MISMATCH: "The requested email does not match the signed-in account. Refresh the page and try again.",
  EMAIL_ALREADY_VERIFIED: "This account is already verified. Sign out and sign in again.",
  VERIFICATION_EMAIL_NOT_ENABLED: "This deployment cannot send verification email. Ask an administrator to use the secure system handoff.",
  TOO_MANY_REQUESTS: "Too many attempts were made. Wait before trying again.",
  UNAUTHORIZED: "Your session expired or is not allowed to do that. Sign in again.",
  PERMISSION_DENIED: "Your account does not have permission for that action.",
  ROLE_ALREADY_EXISTS: "A role with that key or name already exists.",
  ROLE_NOT_FOUND: "That role no longer exists or cannot be changed.",
  ROLE_VERSION_CONFLICT: "Another administrator changed this role. Your changes were not saved; reopen the latest role and reapply them.",
  ROLE_INPUT_INVALID: "Check the role name, permissions, scopes, and policy choices.",
  ROLE_SEARCH_INPUT_INVALID: "Enter a role search of 100 characters or fewer.",
  AUDIT_SEARCH_INPUT_INVALID: "Enter an audit search of 100 characters or fewer.",
  WORK_CONTEXT_SEARCH_INPUT_INVALID: "Enter a work-context search of 120 characters or fewer.",
  BILLING_POLICY_SEARCH_INPUT_INVALID: "Enter a task-definition search of 100 characters or fewer.",
  ROLE_GRANT_REQUIRED: "Keep at least one scope for every selected permission, or turn that permission off.",
  ROLE_GRANT_TARGET_REQUIRED: "Choose a target for each office, department, client, workstream, or group scope.",
  ROLE_GRANT_DUPLICATE: "Remove duplicate permission scopes before saving this role.",
  PERSON_ONBOARDING_INPUT_INVALID: "Check the onboarding details and try again.",
  PERSON_NOT_FOUND: "That person could not be found.",
  PERSON_NOT_ONBOARDING: "This person is not currently waiting for onboarding.",
  PERSON_ALREADY_FROZEN: "This person is already frozen.",
  PERSON_NOT_FREEZABLE: "This person cannot be frozen in its current lifecycle state.",
  ACTIVE_ASSIGNMENTS_REMAIN: "Reassign or close this person's active assignments before offboarding.",
  PERSON_ALREADY_OFFBOARDING: "This person's offboarding has already started.",
  PERSON_ALREADY_EXITED: "This person has already exited.",
  OWNER_TRANSFER_INPUT_INVALID: "Choose a new owner and type TRANSFER SUPER ADMIN exactly.",
  OWNER_TRANSFER_TARGET_INVALID: "Choose a different person as the new owner.",
  TARGET_NOT_FOUND: "That ownership target is no longer available.",
  TARGET_NOT_OPERATIONAL: "The ownership target must be active or serving notice.",
  TARGET_ALREADY_OWNER: "That person is already a Super Admin.",
  SHIFT_ALREADY_EXISTS: "A shift with that name already exists.",
  SHIFT_INPUT_INVALID: "Check the shift times, break, grace period, and overtime setting.",
  OFFICE_NOT_FOUND: "The selected office is no longer available.",
  SHIFT_NOT_FOUND: "One of the selected shifts is no longer available.",
  WFH_NOT_ALLOWED: "Your current role does not allow working from home.",
  WFH_APPROVAL_REQUIRED: "Submit a WFH request and wait for approval before checking in from home.",
  WFH_REQUEST_CANCEL_BEFORE_OFFICE_CHECK_IN: "Cancel the pending WFH request first, then check in at the office.",
  WFH_ATTENDANCE_CONFLICT: "This request overlaps recorded attendance. Resolve that date before submitting or approving WFH.",
  WFH_REQUEST_INPUT_INVALID: "Check the WFH dates and reason.",
  WFH_REQUEST_OVERLAP: "Those dates overlap another WFH request.",
  WFH_REQUEST_NOT_PENDING: "This WFH request has already been decided.",
  WFH_REQUEST_NOT_CANCELLABLE: "This WFH request cannot be cancelled in its current state.",
  WFH_REVIEW_INPUT_INVALID: "Choose approve or reject and check the review reason.",
  OFFICE_GEOFENCE_INPUT_INVALID: "Enter valid coordinates and a radius between 10 and 100,000 metres.",
  WFH_POLICY_INPUT_INVALID: "Check the WFH target, effective dates, and policy choice.",
  WFH_POLICY_ALREADY_EXISTS: "An overlapping WFH policy already covers that target and period.",
  WFH_POLICY_TARGET_NOT_FOUND: "The selected WFH policy target is no longer available.",
  HISTORICAL_EXCEPTION_RESOLUTION_INVALID: "Enter a resolution note and choose resolved or dismissed.",
  HISTORICAL_EXCEPTION_NOT_OPEN: "That historical exception is already closed.",
  HISTORICAL_EXCEPTION_NOT_FOUND: "That historical exception no longer exists.",
  LEAVE_REQUEST_INPUT_INVALID: "Check the leave type, dates, portions, and reason.",
  LEAVE_REVIEW_INPUT_INVALID: "Choose approve or reject and check the review reason.",
  LEAVE_REQUEST_OVERLAP: "Those dates already have an open or approved leave request.",
  LEAVE_REQUEST_NOT_PENDING: "This leave request has already been decided.",
  LEAVE_REQUEST_NOT_CANCELLABLE: "This leave request cannot be cancelled in its current state.",
  LEAVE_ATTENDANCE_CONFLICT: "Attendance already exists on one of these dates; recover it before approving leave.",
  LEAVE_WORK_CONFLICT: "A running work timer covers one of these dates; stop it before approving leave.",
  LEAVE_CONFLICT_DECISION_INVALID: "Choose an outcome and provide a recovery note.",
  LEAVE_CONFLICT_NOT_FOUND: "No open attendance conflict remains for this request.",
  LEAVE_CONFLICT_REQUIRES_DECISION: "This conflict must be resolved from the leave request.",
  NOTIFICATION_EVENT_INVALID: "That notification event is not available.",
  NOTIFICATION_PREFERENCE_INPUT_INVALID: "Choose a valid notification preference.",
  NOTIFICATION_REQUIRED: "Required in-app notifications cannot be disabled.",
  CSRF_ORIGIN_INVALID: "This request was blocked because it did not come from the NOVA site. Refresh the page and try again.",
  TASK_NOT_CANCELLABLE: "That task cannot be cancelled in its current state.",
  TASK_CORRECTION_SOURCE_NOT_FOUND: "That source task is unavailable. Choose completed work you are authorized to view.",
  TASK_BILLING_CLASS_SERVER_ASSIGNED: "NOVA assigns billing automatically from the workstream policy. Task creators and reusable task definitions cannot choose a class.",
  TASK_BILLING_POLICY_NOT_CONFIGURED: "This client workstream needs an authorized billing policy before tasks can be created.",
  ASSIGNMENT_NOT_REASSIGNABLE: "That assignment cannot be reassigned in its current state.",
  PERSON_ALREADY_ASSIGNED: "This person already has an active assignment for the task. Choose another colleague or resolve that assignment first.",
  PERSON_NOT_ASSIGNABLE: "That person is inactive or is not eligible to receive work under their current role or status.",
  REVIEWER_REQUIRED: "Choose a reviewer before reassigning this review-required assignment.",
  ASSIGNMENT_REVIEWER_NOT_CHANGEABLE: "A completed or cancelled assignment cannot change its reviewer.",
  REVIEWER_EXCEPTION_INPUT_INVALID: "Choose an active reviewer and explain why an exception is needed.",
  ASSIGNMENT_NOT_EXCEPTION_ELIGIBLE: "This assignment cannot receive a reviewer exception in its current state.",
  SELF_REVIEW_NOT_ALLOWED: "The assignee cannot review their own work.",
  REVIEWER_NOT_ASSIGNABLE: "That reviewer is not active and cannot receive this review.",
  REVIEW_POLICY_REQUIRES_REVIEW: "Client work must have an eligible reviewer.",
  REVIEWER_REQUEST_INPUT_INVALID: "Choose an eligible reviewer and explain the request.",
  REVIEWER_REQUEST_ALREADY_PENDING: "A reviewer request is already waiting for a decision.",
  REQUEST_NOT_PENDING: "That request has already been decided.",
  REQUEST_RECIPIENT_ONLY: "Only the requested person can decide this request.",
  REQUEST_REQUESTER_ONLY: "Only the person who created this request can withdraw it.",
  REQUEST_EXPIRED: "That request has expired.",
  REQUEST_NOT_AUTHORIZED: "Only a participant in that request can resolve it.",
  ASSIGNMENT_NOT_REQUESTABLE: "This assignment cannot accept a reviewer request now.",
  HANDOVER_REQUEST_INPUT_INVALID: "Choose an active replacement and explain the handover.",
  HANDOVER_REQUEST_ALREADY_PENDING: "A handover request is already waiting for a decision.",
  ASSIGNMENT_NOT_HANDOVERABLE: "This assignment cannot be handed over in its current state.",
  SELF_HANDOVER_NOT_ALLOWED: "Choose another person for the handover.",
  REVIEWER_UNAVAILABLE: "The selected reviewer is no longer eligible; request a replacement.",
  REVIEW_INPUT_INVALID: "Enter a nonblank explanation of what needs to change, within the character limit.",
  REVIEW_NOT_OPEN: "This review is no longer open. The queue will refresh and your unsent note will stay in this session.",
  REVIEW_CYCLE_STALE: "A newer submission arrived. Review the current cycle before sending your preserved feedback.",
  REVIEW_CYCLE_CONFLICT: "This review changed while you were deciding. The queue will refresh; your unsent note will stay in this session.",
  NOTIFICATION_DELIVERY_NOT_FOUND: "That delivery row is no longer available.",
  ATTENDANCE_REQUIRED: "This correction must be covered by a closed attendance period.",
  TIMELINE_ADJUSTMENT_OVERLAP: "That time overlaps recorded work or another correction.",
  TIMELINE_ADJUSTMENT_INPUT_INVALID: "Enter a past time range, assignment, and reason.",
  TARGET_NOT_OPERATIONAL: "That person is not currently operational.",
  SECRETS_ENCRYPTION_CONFIGURATION_REQUIRED: "Email delivery needs NOVA_SECRETS_ENCRYPTION_KEY in the server environment.",
  ATTENDANCE_POLICY_INPUT_INVALID: "Choose an attendance mode and a required duration between 1 minute and 24 hours.",
  ATTENDANCE_POLICY_DATE_INVALID: "Attendance policy changes must begin on or after the next available business date.",
  ATTENDANCE_RECOVERY_INPUT_INVALID: "Use valid past timestamps and provide a correction reason.",
  ATTENDANCE_RECOVERY_WINDOW_INVALID: "This attendance date is outside the allowed recovery window.",
  ATTENDANCE_RECOVERY_BOUNDARY_INVALID: "Both timestamps must fall on the selected office business date, and check-out must follow check-in.",
  ATTENDANCE_RECOVERY_CANDIDATES_INPUT_INVALID: "The recovery list request is invalid. Refresh this page and try again.",
  OFFICE_ASSIGNMENT_REQUIRED: "This person did not have an office assignment on the selected date, so attendance cannot be recovered.",
  CLIENT_MEMBERSHIP_INPUT_INVALID: "Choose a person, effective date, and a membership label of 120 characters or fewer.",
  CLIENT_MEMBERSHIP_END_DATE_INVALID: "Choose an end date on or after the membership start and the current business date.",
  CLIENT_MEMBERSHIP_END_ALREADY_SET: "This membership already has an end date. Refresh the client list to see the latest record.",
  CLIENT_MEMBERSHIP_ALREADY_EXISTS: "That person already has a membership for this client.",
  AVAILABILITY_AGENDA_QUERY_INVALID: "Choose a valid business-date range of no more than 31 days.",
  TASK_VIEW_INPUT_INVALID: "Check the saved view name and filters.",
  TASK_VIEW_NOT_FOUND: "That saved view no longer exists. Refresh your settings and try again.",
  TASK_VIEW_CONFLICT: "This saved view changed in another tab. The list was refreshed; try your change again.",
  TASK_VIEW_SCHEMA_UNSUPPORTED: "This saved view uses a newer format. Refresh NOVA before changing it.",
  TASK_VIEW_LIMIT_REACHED: "You can save up to 12 task views. Delete one from Settings to make room.",
  TASK_VIEW_IDENTITY_CHANGED: "Your account changed while this saved view was being edited. Refresh the page and try again.",
};

const adminPageRoute = createAdminPageRoute({
  state,
  getTarget: () => app.querySelector("#admin-console"),
  isCurrentPageRequest,
  mountAdminPage,
  hasPermissionGrant,
  captureCommandContext,
  isCurrentCommand,
  isCurrentCommandIdentity,
  recoverProtectedCommandFailure,
  api,
  pageApi,
  requestOptions,
  errorText,
  adminCommandUiError,
  adminFeatureReadError,
  hasAdminPermission,
  runAdminProtectedCommand,
  runAdminRequestReviewCommand,
  saveAdminRole,
  setMessage,
  showFeedback,
  renderAdmin,
  render,
  taskCreateIdempotencyHeaders,
  clearTaskCreateIdempotency,
  reflectInvitationDelivery,
  taskBillingConfirmation,
  taskCorrectionConfirmation,
  isWithinApp: (node) => app.contains(node),
  errorMessages,
});

const myDayRequestRoute = createMyDayRequestRoute({
  getPageRequestLifetime: () => pageRequestLifetime,
  isCurrentPageRequest,
  mountReactIsland,
  api,
  pageApi,
  requestOptions,
  errorText,
  setMessage,
  render,
  withSubmitForm,
  runActionButton,
  isCurrentCommand,
  showFeedback,
});

const myAssignmentsRoute = createMyAssignmentsRoute({
  isCurrentPageRequest,
  readIssue: adminReadIssue,
  mountReactIsland,
  readAssignmentCandidates: (assignmentId, lifetime, query) => {
    const path = "/api/task-assignments/" + encodeURIComponent(assignmentId) + "/candidates" +
      (typeof query === "string" ? "?q=" + encodeURIComponent(query.trim()) : "");
    return readOrError(pageApi(path, lifetime), { reviewers: [], handoverTargets: [] });
  },
});

const workSetupRoute = createWorkSetupRoute({
  isCurrentPageRequest,
  mountReactIsland,
  noticeElement,
  loadCatalogSection: () => import("./src/features/work-setup/TaskCatalogSection.tsx"),
  loadBillingPolicySection: () => import("./src/features/work-setup/BillingPolicySection.tsx"),
  readIssue: adminReadIssue,
});
const workSetupActionsRoute = createWorkSetupActionsRoute({
  can: (permissionKey, target) => workSetupPermission(state.actorGrants, permissionKey, target),
  api,
  pageApi,
  requestOptions,
  runCommand: runWorkSetupCommand,
  permissionDenied: () => workSetupSafeError({ code: "PERMISSION_DENIED" }),
});

const workTaskDetailRoute = createWorkTaskDetailRoute({
  beginPageRequestLifetime,
  api,
  captureCommandContext,
  errorText,
  getSubmittedDueDate: (form) => new FormData(form).get("dueDate"),
  isCurrentCommand,
  isCurrentCommandIdentity,
  isCurrentPageRequest,
  leaveTaskDetail,
  mountReactIsland,
  pageApi,
  projectTaskDetail: projectWorkTaskDetail,
  recoverProtectedCommandFailure,
  requestOptions,
});

const peoplePageRoute = createPeoplePageRoute({
  getLocationHref: () => window.location.href,
  getHistoryState: () => window.history.state,
  getWorkspaceSessionId: () => peopleWorkspaceSessionId,
  pushHistoryState: (...args) => window.history.pushState(...args),
  setActiveView: (view) => { state.view = view; },
  resetPopStateState: () => {
    state.pendingRouteScrollY = null;
    state.pendingRouteFocusTaskId = null;
    state.pendingRouteFocusTaskSource = null;
  },
  navigatePersonHistory,
  isCurrentPageRequest,
  pageApi,
  mountReactIsland,
  showFeedback,
  noticeElement,
  readIssue: adminReadIssue,
  createLifecycleActionProvider: ({ lifecycleHostUi, requestedPersonId, lifetime, pageRoot }) =>
    lifecycleHostUi.createPeopleLifecyclePageActionProvider({
      requestedPersonId,
      lifetime,
      pageRoot,
      getActorGrants: () => state.actorGrants,
      getIdentityEpoch: () => state.identityEpoch,
      getActorPersonId: () => state.identityPersonId || state.actorGrants?.actorPersonId,
      isCurrentPageRequest,
      hasPermissionGrant,
      api,
      requestOptions,
      pageApi,
      captureCommandContext,
      isCurrentCommand,
      recoverProtectedCommandFailure,
      refreshActorPermissions: (...args) => { void refreshActorPermissions(...args); },
      setMessage,
      render,
      mapError: errorText,
    }),
});

function requestOptions(method, body, headers) {
  const options = {
    credentials: "include",
    headers: { accept: "application/json", ...(headers || {}) },
    method,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers["content-type"] = "application/json";
  }
  return options;
}

function beginPageRequestLifetime() {
  pageRequestLifetime = pageRequestLifecycle.begin(state.identityEpoch);
  return pageRequestLifetime;
}

function isCurrentPageRequest(lifetime) {
  return pageRequestLifecycle.isCurrent(lifetime, state.identityEpoch);
}

function pageApi(path, lifetime) {
  return api(path, withPageReadSignal(requestOptions("GET"), lifetime)).catch((error) => {
    // A page read can be wrapped by readOrError and therefore never reach a
    // route-level command catch. Expired sessions still need to clear all
    // protected UI before that read is reduced to its safe feature state.
    if ((error?.httpStatus === 401 || (error?.httpStatus === 403 && error?.code === "ACCOUNT_NOT_OPERATIONAL")) && isCurrentPageRequest(lifetime)) {
      recoverProtectedCommandFailure(error);
    }
    throw error;
  });
}

async function api(path, options) {
  const response = await fetch(path, options || requestOptions("GET"));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Better Auth reports stable `code`/`message` fields, while NOVA domain
    // routes report `error`. Preserve only the stable code for safe UI copy;
    // never display provider, SQL, or raw authentication exception details.
    const errorCode = payload.error || payload.code || "REQUEST_FAILED";
    const error = new Error(errorCode);
    error.code = errorCode;
    error.httpStatus = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function setMessage(message, kind) {
  state.message = message;
  state.messageKind = kind || "success";
}

function errorText(error) {
  return errorMessages[error && error.code] ||
    "Something went wrong. Nothing was saved unless NOVA confirms it below.";
}

function routeView() {
  return resolveApplicationRoute(window.location, resolveWorkspaceDestinationView).view;
}

function go(view) {
  const url = new URL("/", window.location.origin);
  if (view) url.searchParams.set("view", view);
  window.history.pushState({}, "", url);
  state.view = view;
  render();
  window.requestAnimationFrame(focusPageHeading);
}

function taskDetailUrl(taskId) {
  return buildTaskDetailUrl(taskId, new URLSearchParams(window.location.search));
}

function navigateWorkAssignments(filters, timelineDate) {
  const url = new URL(window.location.href);
  url.pathname = "/";
  url.searchParams.set("view", "work");
  url.searchParams.delete("task");
  url.searchParams.delete("review");
  ["assignmentStatus", "assignmentDue", "assignmentSearch", "assignmentCursor"].forEach((key) => {
    url.searchParams.delete(key);
  });
  if (filters.status !== "all") url.searchParams.set("assignmentStatus", filters.status);
  if (filters.due !== "any") url.searchParams.set("assignmentDue", filters.due);
  if (filters.search) url.searchParams.set("assignmentSearch", filters.search);
  if (filters.cursor) url.searchParams.set("assignmentCursor", filters.cursor);
  window.history.pushState({ novaWorkAssignmentPage: true }, "", url.pathname + url.search);
  state.pendingWorkAssignmentFocus = true;
  renderWork(timelineDate);
}

function openReviewAssignment(assignmentId) {
  const url = new URL(window.location.href);
  url.pathname = "/";
  url.searchParams.set("view", "work");
  url.searchParams.set("review", assignmentId);
  url.searchParams.delete("task");
  window.history.pushState({ novaReviewDetail: true }, "", url.pathname + url.search);
  state.view = null;
  renderWork();
  window.requestAnimationFrame(focusPageHeading);
}

function navigateVisibleTasks(filters, timelineDate, focusTarget = "heading") {
  const url = new URL(window.location.href);
  url.pathname = "/";
  url.searchParams.set("view", "work");
  url.searchParams.delete("task");
  url.searchParams.delete("review");
  ["taskStatus", "taskDue", "taskSearch", "taskCursor"].forEach((key) => url.searchParams.delete(key));
  if (filters.status !== "open") url.searchParams.set("taskStatus", filters.status);
  if (filters.due !== "any") url.searchParams.set("taskDue", filters.due);
  if (filters.search) url.searchParams.set("taskSearch", filters.search);
  if (filters.cursor) url.searchParams.set("taskCursor", filters.cursor);
  window.history.pushState({ novaVisibleTaskPage: true }, "", url.pathname + url.search);
  state.pendingVisibleTaskFocus = focusTarget;
  renderWork(timelineDate);
}

function openTaskDetail(taskId, taskSource) {
  const currentState = window.history.state && typeof window.history.state === "object"
    ? window.history.state
    : {};
  window.history.replaceState(
    { ...currentState, novaReturnScrollY: window.scrollY, novaReturnFocusTaskId: taskId,
      novaReturnFocusTaskSource: taskSource || null },
    "",
    window.location.pathname + window.location.search + window.location.hash,
  );
  window.history.pushState({ novaTaskDetail: true }, "", taskDetailUrl(taskId));
  state.view = "work";
  window.scrollTo(0, 0);
  render();
}

function leaveTaskDetail() {
  if (window.history.state?.novaTaskDetail && window.history.length > 1) {
    window.history.back();
  } else {
    go("work");
  }
}

function restorePendingRouteScroll() {
  const top = state.pendingRouteScrollY;
  const taskId = state.pendingRouteFocusTaskId;
  const taskSource = state.pendingRouteFocusTaskSource;
  state.pendingRouteScrollY = null;
  state.pendingRouteFocusTaskId = null;
  state.pendingRouteFocusTaskSource = null;
  if (!Number.isFinite(top) && !taskId) return;
  window.requestAnimationFrame(() => {
    if (Number.isFinite(top)) window.scrollTo(0, top);
    if (!taskId) return;
    window.requestAnimationFrame(() => {
      const taskLinks = [...app.querySelectorAll("a[data-task-detail-id]")]
        .filter((link) => link.dataset.taskDetailId === taskId);
      const returnLink = taskLinks.find((link) => link.dataset.taskDetailSource === taskSource) || taskLinks[0];
      const target = returnLink || app.querySelector("h1");
      if (!target) return;
      if (!returnLink) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
  });
}

function focusPageHeading() {
  const heading = app.querySelector("h1");
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function showFeedback() {
  const element = app.querySelector("#feedback");
  if (!element || !state.message) return;
  element.hidden = false;
  element.classList.add("notice");
  element.classList.remove("error", "warning");
  if (state.messageKind === "error" || state.messageKind === "warning") {
    element.classList.add(state.messageKind);
  }
  element.textContent = state.message;
  state.message = "";
}

function attachNavigation() {
  app.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.nav === "home" ? workspaceHomeView() : button.dataset.nav));
  });
  const openWorkspaceMenu = app.querySelector("[data-action=open-workspace-menu]");
  const workspaceDialog = app.querySelector("#mobile-workspace-dialog");
  if (openWorkspaceMenu && workspaceDialog) {
    openWorkspaceMenu.addEventListener("click", () => {
      if (!workspaceDialog.open) workspaceDialog.showModal();
    });
    workspaceDialog.querySelectorAll("[data-action=close-workspace-menu]").forEach((button) => {
      button.addEventListener("click", () => workspaceDialog.close());
    });
    workspaceDialog.addEventListener("click", (event) => {
      const bounds = workspaceDialog.getBoundingClientRect();
      if (event.target === workspaceDialog && event.clientX < bounds.left) workspaceDialog.close();
    });
    workspaceDialog.addEventListener("close", () => {
      if (openWorkspaceMenu.isConnected) openWorkspaceMenu.focus({ preventScroll: true });
    });
  }
  app.querySelectorAll("[data-action=logout]").forEach((logout) => logout.addEventListener("click", signOut));
}

function renderLanding(lifetime) {
  app.removeAttribute("role");
  app.innerHTML = '<div id="public-landing-root"><p class="loading" role="status">Loading NOVA…</p></div>';
  const target = app.querySelector("#public-landing-root");
  void mountPublicLandingRoute(target, lifetime, {
    isCurrentPageRequest,
    isTargetMounted: (candidate) => app.contains(candidate),
    mountReactIsland,
    noticeElement,
    navigateToSetup: () => go("setup"),
    navigateToSignIn: () => go("login"),
    navigateToInvitation: () => {
      window.history.pushState({}, "", "/accept-invite");
      state.view = "accept";
      render();
    },
    navigateToDeploymentGuide: () => go("deploy"),
  });
}

function invalidateDeploymentProbe() {
  deploymentProbeLifecycle.invalidate();
  deploymentProbe = null;
}

async function renderDeployment(lifetime) {
  const isCurrentDeployment = () => isCurrentPageRequest(lifetime) &&
    (state.view || routeView()) === "deploy" && app.isConnected;
  app.replaceChildren(createElement("p", { className: "loading", role: "status" }, "Loading deployment guide…"));
  try {
    const { mountDeploymentPage } = await import("./app/deployment-page-route.js");
    if (!isCurrentDeployment()) return;
    await mountDeploymentPage({
      target: app,
      getProgress: () => state.deployment,
      setProgress: (progress) => { state.deployment = progress; },
      getProbe: () => deploymentProbe,
      setProbe: (probe) => { deploymentProbe = probe; },
      invalidateProbe: invalidateDeploymentProbe,
      probeLifecycle: deploymentProbeLifecycle,
      persistProgress: persistDeployment,
      isCurrent: isCurrentDeployment,
      mountIsland: mountReactIsland,
      showFeedback,
      focusCurrentHeading: () => {
        const heading = app.querySelector("#deployment-current-heading");
        if (!heading) return;
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      },
      checkEndpoint: checkDeploymentEndpoint,
      onOpenSetup: () => go("setup"),
      onNavigateHome: () => go(workspaceHomeView()),
    });
  } catch {
    if (!isCurrentDeployment()) return;
    app.replaceChildren(noticeElement("Deployment guide could not load. Reload the page to try again.", "error"));
    showFeedback();
  }
}
function renderLogin(lifetime) {
  const notice = state.message ? { kind: state.messageKind, message: state.message } : null;
  app.innerHTML = '<div id="sign-in-root"><p class="loading" role="status">Loading sign-in…</p></div>';
  const target = app.querySelector("#sign-in-root");
  void mountPublicSignInRoute(target, lifetime, {
    state,
    notice,
    api,
    requestOptions,
    refreshSession,
    isCurrentPageRequest,
    isTargetMounted: (candidate) => app.contains(candidate),
    captureCommandContext,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    mountReactIsland,
    noticeElement,
    consumeNotice: (shownNotice) => {
      if (shownNotice && state.message === shownNotice.message) state.message = "";
    },
    isLoginRoute: () => (state.view || routeView()) === "login",
    completeSignIn: () => {
      state.view = "settings";
      render();
    },
    renderCurrentRoute: () => render(),
    navigateToForgotPassword: () => go("forgot"),
    navigateBack: () => go(null),
  });
}

function renderSetup(lifetime) {
  app.innerHTML = '<div id="first-run-setup-root"><p class="loading" role="status">Loading first-run setup…</p></div>';
  const target = app.querySelector("#first-run-setup-root");
  const notice = state.message ? { kind: state.messageKind, message: state.message } : null;
  void mountPublicFirstRunSetupRoute(target, lifetime, {
    isCurrentPageRequest,
    isTargetMounted: (candidate) => app.contains(candidate),
    mountReactIsland,
    api,
    requestOptions,
    publicOrigin: () => window.location.origin,
    noticeElement,
    notice,
    resumeFounder: () => {
      const email = String(state.session?.email || "").trim().toLowerCase();
      if (!email || state.session?.emailVerified !== false ||
        state.actorGrants?.readError !== "ACCOUNT_NOT_OPERATIONAL" || state.actorGrants?.actorPersonId) return null;
      return { email, displayName: String(state.session?.name || email) };
    },
    currentSessionEmail: () => String(state.session?.email || "").trim().toLowerCase(),
    readCurrentSessionEmail: async () => {
      const result = await api("/api/auth/get-session", requestOptions("GET"));
      return String(result?.user?.email || "").trim().toLowerCase();
    },
    isResumableFounder: (email) => {
      const founder = String(state.session?.email || "").trim().toLowerCase();
      return Boolean(founder) && founder === email && state.session?.emailVerified === false &&
        state.actorGrants?.readError === "ACCOUNT_NOT_OPERATIONAL" && !state.actorGrants?.actorPersonId;
    },
    hasBootstrapCredentials: (email) => Boolean(state.bootstrapToken) && state.bootstrapFounderEmail === email,
    retainBootstrapCredentials: (token, email) => {
      state.bootstrapToken = token;
      state.bootstrapFounderEmail = email;
    },
    recordPublicOrigin: (result) => {
      state.publicOriginConfigured = Boolean(result.configuredOrigin);
      state.publicOrigin = result.configuredOrigin || result.effectiveOrigin || "";
    },
    publicOriginSaveFailed: (error) => {
      state.publicOriginConfigured = false;
      setMessage("Workspace created, but the public URL was not saved: " + errorText(error) + " Set it before configuring email.", "warning");
    },
    completeSetup: async ({ originSaved }) => {
      // refreshSession can advance the identity epoch during first-run setup;
      // the mounted target, rather than its pre-setup lifetime, owns navigation.
      await refreshSession();
      if (!app.contains(target)) return;
      state.view = "settings";
      if (originSaved) {
        setMessage("Workspace created. The public URL is set. Configure and test email delivery, then request the founder verification link.");
      } else if (!state.message) {
        setMessage("Workspace created. Set the public URL before configuring email.", "warning");
      }
      render();
    },
    navigateBack: () => go(null),
  });
}

function renderShell(children, active) {
  document.body?.classList.add("workspace-mode");
  app.removeAttribute("role");
  const publicNavigation = document.querySelector(".site-nav");
  if (publicNavigation) publicNavigation.hidden = true;
  const workspace = normalizeWorkspace(state.uiPreferences.workspace);
  const navigation = getVisibleWorkspaceDestinations(state.actorGrants)
    .sort((left, right) => workspace.navigationOrder.indexOf(left.view) - workspace.navigationOrder.indexOf(right.view));
  const pinnedNavigation = navigation.filter((item) => workspace.pinnedDestinations.includes(item.view));
  const orderedDestinations = [
    ...pinnedNavigation.map((item) => ({ ...item, group: "Pinned" })),
    ...navigation.filter((item) => !workspace.pinnedDestinations.includes(item.view)),
  ].map((item) => {
    const url = new URL("/", window.location.origin);
    url.searchParams.set("view", item.view);
    return { id: item.view, label: item.label, group: item.group, href: url.pathname + url.search };
  });
  const activeLabel = navigation.find((item) => item.view === active)?.label || "Workspace";
  mountReactIsland(app, LegacyRouteShell, {
    children,
    destinations: orderedDestinations,
    activeItemId: active,
    displayName: String(state.session?.name || state.session?.email || "NOVA account"),
    currentPageLabel: activeLabel,
    unreadCount: Number.isSafeInteger(state.unreadNotificationCount) ? state.unreadNotificationCount : null,
    navigationNotice: adminPermissionNoticeMessage(state.actorGrants, state.session),
    onNavigate: (item) => go(item.id === "home" ? workspaceHomeView() : item.id),
  });
  attachNavigation();
  void refreshUnreadNotificationCount();
}

async function refreshUnreadNotificationCount() {
  const actorPersonId = state.actorGrants?.actorPersonId;
  if (!actorPersonId || !state.session) return;
  const generation = ++state.unreadNotificationGeneration;
  const identityEpoch = state.identityEpoch;
  try {
    const result = await api("/api/notifications/unread-count");
    if (generation !== state.unreadNotificationGeneration || identityEpoch !== state.identityEpoch || actorPersonId !== state.actorGrants?.actorPersonId) return;
    const previousCount = state.unreadNotificationCount;
    const count = Number(result.count);
    state.unreadNotificationCount = Number.isSafeInteger(count) && count >= 0 ? count : null;
    const label = state.unreadNotificationCount === null ? "" : state.unreadNotificationCount === 1
      ? "1 unread notification."
      : state.unreadNotificationCount + " unread notifications.";
    app.querySelectorAll('[data-nav="notifications"]').forEach((button) => {
      const badge = button.querySelector(".nav-count");
      const nextCount = state.unreadNotificationCount ?? 0;
      if (nextCount > 0) {
        const countText = nextCount > 99 ? "99+" : String(nextCount);
        if (badge) badge.textContent = countText;
        else {
          const nextBadge = document.createElement("span");
          nextBadge.className = "nav-count";
          nextBadge.setAttribute("aria-hidden", "true");
          nextBadge.textContent = countText;
          button.append(nextBadge);
        }
        button.setAttribute("aria-label", "Notifications, " + nextCount + " unread");
      } else {
        badge?.remove();
        button.removeAttribute("aria-label");
      }
    });
    const status = app.querySelector("#notification-unread-status");
    if (status && previousCount !== state.unreadNotificationCount) {
      status.textContent = state.unreadNotificationCount > 0
        ? label
        : previousCount === null ? "" : "All notifications are read.";
    }
  } catch (error) {
    if (generation !== state.unreadNotificationGeneration || identityEpoch !== state.identityEpoch || actorPersonId !== state.actorGrants?.actorPersonId) return;
    if (error?.httpStatus === 401 || (error?.httpStatus === 403 && error?.code === "ACCOUNT_NOT_OPERATIONAL")) {
      state.unreadNotificationCount = null;
      recoverProtectedCommandFailure(error, { identityEpoch, actorPersonId });
      return;
    }
    state.unreadNotificationCount = null;
    app.querySelectorAll('[data-nav="notifications"]').forEach((button) => {
      button.querySelector(".nav-count")?.remove();
      button.removeAttribute("aria-label");
    });
    const status = app.querySelector("#notification-unread-status");
    if (status) status.textContent = "";
  }
}

function currentWorkspaceDestinations(workspace = normalizeWorkspace(state.uiPreferences.workspace)) {
  return getVisibleWorkspaceDestinations(state.actorGrants)
    .slice()
    .sort((left, right) => workspace.navigationOrder.indexOf(left.view) - workspace.navigationOrder.indexOf(right.view));
}

function currentWorkspaceModules(workspace = normalizeWorkspace(state.uiPreferences.workspace)) {
  const readPlan = planMyDayReads(state.actorGrants);
  return [
    ...(readPlan.attendance || readPlan.attendanceActionContext ? [{ id: "attendance", label: "Attendance" }] : []),
    ...(readPlan.assignments ? [{ id: "assignments", label: "My work" }] : []),
    ...(readPlan.timeline ? [{ id: "timeline", label: "Today’s timeline" }] : []),
    ...(readPlan.leaveRequest ? [{ id: "leave", label: "Leave requests" }] : []),
    ...(readPlan.wfhRequest ? [{ id: "wfh", label: "Work-from-home requests" }] : []),
  ].map((module) => ({ ...module, enabled: workspace.myDayModules.includes(module.id) }))
    .sort((left, right) => workspace.myDayModules.indexOf(left.id) - workspace.myDayModules.indexOf(right.id));
}

async function updateWorkspaceEditor() {
  const target = app.querySelector("#workspace-customization-content");
  if (!target) return;
  const generation = ++workspaceEditorRenderGeneration;
  const identityEpoch = state.identityEpoch;
  const workspace = normalizeWorkspace(state.uiPreferences.workspace);
  let WorkspaceEditor;
  let updatePinnedDestinations;
  try {
    ({ WorkspaceEditor, updatePinnedDestinations } = await import("./src/features/personalization/index.js"));
  } catch {
    if (generation === workspaceEditorRenderGeneration && target.isConnected) {
      target.replaceChildren(noticeElement("Workspace controls could not load. Reload Settings to try again.", "error"));
    }
    return;
  }
  if (generation !== workspaceEditorRenderGeneration || identityEpoch !== state.identityEpoch || !target.isConnected) return;
  const visibleDestinations = currentWorkspaceDestinations(workspace);
  const destinations = visibleDestinations.map((item) => ({ id: item.view, label: item.label, group: item.group }));
  const modules = currentWorkspaceModules(workspace);
  const error = state.uiPreferenceConflict
      ? "Preferences changed in another session. Resolve the conflict in Appearance before saving workspace changes."
      : state.uiPreferenceSaveStatus === "error"
        ? "NOVA could not save the current workspace preferences."
        : undefined;
  mountReactIsland(target, WorkspaceEditor, {
    destinations,
    homeView: workspace.homeView,
    pinnedDestinationIds: workspace.pinnedDestinations,
    modules,
    readStatus: state.uiPreferenceReadStatus,
    writable: state.uiPreferenceWritable,
    blockedByConflict: Boolean(state.uiPreferenceConflict),
    saveStatus: state.uiPreferenceSaveStatus,
    error,
    onHomeViewChange: (view) => {
      const allowed = getVisibleWorkspaceDestinations(state.actorGrants).some((item) => item.view === view);
      if (view !== "auto" && !allowed) return;
      setWorkspace({ ...normalizeWorkspace(state.uiPreferences.workspace), homeView: view });
    },
    onPinChange: (destinationId, pinned) => {
      const current = normalizeWorkspace(state.uiPreferences.workspace);
      const authorizedDestinationIds = currentWorkspaceDestinations(current).map((item) => item.view);
      const pinnedDestinations = updatePinnedDestinations(
        current.pinnedDestinations,
        authorizedDestinationIds,
        destinationId,
        pinned,
      );
      if (pinnedDestinations === current.pinnedDestinations) return;
      setWorkspace({ ...current, pinnedDestinations });
    },
    onMoveDestination: (destinationId, direction) => {
      const current = normalizeWorkspace(state.uiPreferences.workspace);
      const visible = currentWorkspaceDestinations(current).map((item) => item.view);
      if (!visible.includes(destinationId)) return;
      const navigationOrder = reorderPreferenceList(current.navigationOrder, visible, destinationId, direction < 0 ? "up" : "down");
      setWorkspace({ ...current, navigationOrder });
    },
    onModuleChange: (moduleId, enabled) => {
      const current = normalizeWorkspace(state.uiPreferences.workspace);
      const available = new Set(currentWorkspaceModules(current).map((module) => module.id));
      if (!available.has(moduleId) || current.myDayModules.includes(moduleId) === enabled) return;
      const myDayModules = enabled
        ? [...current.myDayModules, moduleId]
        : current.myDayModules.filter((id) => id !== moduleId);
      setWorkspace({ ...current, myDayModules });
    },
    onMoveModule: (moduleId, direction) => {
      const current = normalizeWorkspace(state.uiPreferences.workspace);
      const visible = currentWorkspaceModules(current).filter((module) => module.enabled).map((module) => module.id);
      if (!visible.includes(moduleId)) return;
      const myDayModules = reorderPreferenceList(current.myDayModules, visible, moduleId, direction < 0 ? "up" : "down");
      setWorkspace({ ...current, myDayModules });
    },
    onReset: () => setWorkspace({ ...DEFAULT_WORKSPACE }),
    onReload: () => { void reloadUiPreferences(); },
    onRetry: state.uiPreferenceConflict ? undefined : () => {
      state.uiPreferenceSaveStatus = "pending";
      void updateWorkspaceEditor();
      void saveAppearancePreferences();
    },
  });
}

async function updateSavedTaskViewsEditor() {
  const target = app.querySelector("#saved-task-views-content");
  if (!target) return;
  const generation = ++savedTaskViewsRenderGeneration;
  const identityEpoch = state.identityEpoch;
  const workPlan = planWorkReads(state.actorGrants);
  const allowedCollections = [
    ...(workPlan.assignments ? ["mine"] : []),
    ...(workPlan.taskCollection ? ["visible"] : []),
  ];
  const personId = state.identityPersonId || state.actorGrants?.actorPersonId || null;
  if (personId && allowedCollections.length > 0 && !state.savedTaskViewsLoaded && !state.savedTaskViewsLoading) {
    void ensureSavedTaskViewsLoaded(personId, identityEpoch).then(() => {
      if (isCurrentSavedTaskViewsEditor(target, generation, identityEpoch)) {
        void updateSavedTaskViewsEditor();
      }
    });
  }
  if (!allowedCollections.length && !state.savedTaskViews.length && !state.savedTaskViewsReadError && !state.savedTaskViewsLoading) {
    target.replaceChildren();
    return;
  }
  let SettingsSavedTaskViews;
  try {
    ({ SettingsSavedTaskViews } = await import("./src/features/work/SettingsSavedTaskViews.tsx"));
  } catch {
    if (generation === savedTaskViewsRenderGeneration && identityEpoch === state.identityEpoch && app.contains(target)) {
      target.replaceChildren(noticeElement("Saved task view controls could not load. Reload Settings to try again.", "error"));
    }
    return;
  }
  if (generation !== savedTaskViewsRenderGeneration || identityEpoch !== state.identityEpoch || !app.contains(target)) return;
  mountReactIsland(target, SettingsSavedTaskViews, {
    views: state.savedTaskViews,
    availableCollections: allowedCollections,
    readStatus: state.savedTaskViewsLoading ? "loading" : state.savedTaskViewsReadError ? "error" : "ready",
    formatError: errorText,
    onFailure: (error, source) => recoverProtectedCommandFailure(error, captureCommandContext(source)),
    onRetry: () => refreshSavedTaskViewsFromSettings(target, generation, identityEpoch),
    onDelete: (view) => deleteSavedTaskViewFromSettings(view, target, generation, identityEpoch),
    onRename: (view) => renameSavedTaskViewFromSettings(view, target, generation, identityEpoch),
  });
}

async function renderAppearanceEditor() {
  const target = app.querySelector("#appearance-editor-root");
  if (!target) return;
  const renderGeneration = ++appearanceEditorRenderGeneration;
  let AppearanceEditor;
  try {
    ({ AppearanceEditor } = await import("./src/features/personalization/index.js"));
  } catch {
    if (renderGeneration === appearanceEditorRenderGeneration && target.isConnected) {
      target.replaceChildren(noticeElement("Appearance controls could not load. Reload Settings to try again.", "error"));
    }
    return;
  }
  if (renderGeneration !== appearanceEditorRenderGeneration || !target.isConnected) return;
  const conflict = state.uiPreferenceConflict
    ? {
        submittedRevision: state.uiPreferenceConflict.submittedRevision ?? Math.max(0, state.uiPreferenceRevision - 1),
        currentRevision: state.uiPreferenceConflict.revision,
      }
    : undefined;
  mountReactIsland(target, AppearanceEditor, {
    appearance: normalizeAppearance(state.uiPreferences.appearance),
    readStatus: state.uiPreferenceReadStatus,
    writable: state.uiPreferenceWritable,
    saveStatus: state.uiPreferenceSaveStatus,
    revision: Number.isSafeInteger(state.uiPreferenceRevision) ? state.uiPreferenceRevision : null,
    error: state.uiPreferenceSaveStatus === "error" && !state.uiPreferenceConflict && state.uiPreferenceReadStatus === "ready"
        ? "The current appearance preview is active, but NOVA could not save it."
        : undefined,
    conflict,
    onChange: setAppearance,
    onReset: () => setAppearance({ ...DEFAULT_APPEARANCE }),
    onRetry: () => {
      state.uiPreferenceSaveStatus = "pending";
      renderAppearanceEditor();
      void saveAppearancePreferences();
    },
    onReload: () => { void reloadUiPreferences(); },
    onResolveConflict: resolveAppearanceConflict,
  });
}

function resolveAppearanceConflict(resolution) {
  const conflict = state.uiPreferenceConflict;
  if (!conflict) return;
  if (resolution === "reload") {
    state.uiPreferences.appearance = normalizeAppearance(conflict.appearance);
    state.uiPreferences.workspace = normalizeWorkspace(conflict.workspace);
    state.uiPreferenceRevision = conflict.revision;
    state.uiPreferenceWritable = conflict.writable;
    state.uiPreferenceConflict = null;
    state.uiPreferenceSaveStatus = "saved";
    applyAppearanceTokens(state.uiPreferences.appearance);
    updateWorkspaceEditor();
    renderAppearanceEditor();
    return;
  }
  state.uiPreferenceRevision = conflict.revision;
  state.uiPreferenceWritable = conflict.writable;
  state.uiPreferenceConflict = null;
  setAppearance(state.uiPreferences.appearance);
}

function setAppearance(appearance) {
  state.uiPreferences.appearance = normalizeAppearance(appearance);
  applyAppearanceTokens(state.uiPreferences.appearance);
  renderAppearanceEditor();
  scheduleUiPreferenceSave();
}

function setWorkspace(workspace) {
  if (!canEditPersonalPreferenceDraft(state.uiPreferenceReadStatus, state.uiPreferenceWritable, false, Boolean(state.uiPreferenceConflict))) return;
  state.uiPreferences.workspace = normalizeWorkspace(workspace);
  scheduleUiPreferenceSave();
}

function orderedSavedTaskViews(views) {
  return Array.isArray(views)
    ? views.filter((view) => view && typeof view.id === "string" && typeof view.name === "string")
      .slice(0, 12)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    : [];
}

async function loadSavedTaskViews(expectedPersonId, identityEpoch = state.identityEpoch) {
  const pending = savedTaskViewsReadRequest;
  if (state.savedTaskViewsLoading && pending?.personId === expectedPersonId && pending.identityEpoch === identityEpoch) {
    return pending.promise;
  }
  const requestGeneration = ++state.savedTaskViewsRequestGeneration;
  const isCurrent = () => requestGeneration === state.savedTaskViewsRequestGeneration &&
    identityEpoch === state.identityEpoch && state.identityPersonId === expectedPersonId;
  state.savedTaskViewsLoading = true;
  const promise = (async () => {
    try {
      const result = await api("/api/me/task-views", requestOptions("GET"));
      if (!isCurrent()) return false;
      if (result.personId !== expectedPersonId || result.schemaVersion !== 1 || !Array.isArray(result.views)) {
        state.savedTaskViews = [];
        state.savedTaskViewsReadError = true;
        state.savedTaskViewsLoaded = true;
        return false;
      }
      state.savedTaskViews = orderedSavedTaskViews(result.views);
      state.savedTaskViewsReadError = false;
      state.savedTaskViewsLoaded = true;
      return true;
    } catch (error) {
      if (isCurrent()) {
        state.savedTaskViews = [];
        state.savedTaskViewsReadError = true;
        state.savedTaskViewsLoaded = true;
        if (error?.httpStatus === 401 || error?.httpStatus === 403) {
          state.savedTaskViewsLoading = false;
          recoverProtectedCommandFailure(error, { identityEpoch, actorPersonId: expectedPersonId });
        }
      }
      return false;
    } finally {
      if (isCurrent()) state.savedTaskViewsLoading = false;
    }
  })();
  savedTaskViewsReadRequest = { personId: expectedPersonId, identityEpoch, promise };
  return promise;
}

function ensureSavedTaskViewsLoaded(expectedPersonId, identityEpoch = state.identityEpoch) {
  if (state.savedTaskViewsLoaded && !state.savedTaskViewsLoading) {
    return Promise.resolve(!state.savedTaskViewsReadError);
  }
  return loadSavedTaskViews(expectedPersonId, identityEpoch);
}

function taskViewIdentityError() {
  const error = new Error("TASK_VIEW_IDENTITY_CHANGED");
  error.code = "TASK_VIEW_IDENTITY_CHANGED";
  return error;
}

async function saveTaskView(view, expectedRevision) {
  const identityEpoch = state.identityEpoch;
  const personId = state.identityPersonId || state.actorGrants?.actorPersonId;
  if (!personId) throw taskViewIdentityError();
  const result = await api("/api/me/task-views", requestOptions("POST", {
    schemaVersion: 1,
    expectedPersonId: personId,
    expectedRevision,
    view,
  }));
  if (identityEpoch !== state.identityEpoch || personId !== (state.identityPersonId || state.actorGrants?.actorPersonId)) return null;
  if (result.personId !== personId || !result.view?.id) throw taskViewIdentityError();
  state.savedTaskViews = orderedSavedTaskViews([
    ...state.savedTaskViews.filter((item) => item.id !== result.view.id),
    result.view,
  ]);
  state.savedTaskViewsReadError = false;
  return result.view;
}

async function deleteTaskView(view) {
  const identityEpoch = state.identityEpoch;
  const personId = state.identityPersonId || state.actorGrants?.actorPersonId;
  if (!personId) throw taskViewIdentityError();
  const result = await api("/api/me/task-views/" + encodeURIComponent(view.id), requestOptions("DELETE", {
    schemaVersion: 1,
    expectedPersonId: personId,
    expectedRevision: view.revision,
  }));
  if (identityEpoch !== state.identityEpoch || personId !== (state.identityPersonId || state.actorGrants?.actorPersonId)) return false;
  if (result.personId !== personId || result.deleted !== view.id) throw taskViewIdentityError();
  state.savedTaskViews = state.savedTaskViews.filter((item) => item.id !== view.id);
  state.savedTaskViewsReadError = false;
  return true;
}

function isCurrentSavedTaskViewsEditor(target, generation, identityEpoch) {
  return identityEpoch === state.identityEpoch && generation === savedTaskViewsRenderGeneration &&
    Boolean(target.isConnected && app.contains(target));
}

async function refreshSavedTaskViewsFromSettings(target, generation, identityEpoch) {
  if (!isCurrentSavedTaskViewsEditor(target, generation, identityEpoch)) return;
  const personId = state.identityPersonId || state.actorGrants?.actorPersonId;
  if (!personId) return;
  const refreshed = await loadSavedTaskViews(personId, identityEpoch);
  if (!isCurrentSavedTaskViewsEditor(target, generation, identityEpoch)) return;
  setMessage(refreshed ? "Saved task views refreshed." : "Saved task views are still unavailable.", refreshed ? "success" : "warning");
  updateSavedTaskViewsEditor();
}

async function deleteSavedTaskViewFromSettings(view, target, generation, identityEpoch) {
  if (!isCurrentSavedTaskViewsEditor(target, generation, identityEpoch)) return;
  const personId = state.identityPersonId || state.actorGrants?.actorPersonId;
  if (!personId) return;
  try {
    const deleted = await deleteTaskView(view);
    if (!deleted || !isCurrentSavedTaskViewsEditor(target, generation, identityEpoch)) return;
  } catch (error) {
    if (error?.code !== "TASK_VIEW_CONFLICT" && error?.code !== "TASK_VIEW_NOT_FOUND") throw error;
    await loadSavedTaskViews(personId, identityEpoch);
    if (!isCurrentSavedTaskViewsEditor(target, generation, identityEpoch)) return;
    setMessage(errorText(error), "warning");
    updateSavedTaskViewsEditor();
    return;
  }
  setMessage("Saved view deleted.");
  updateSavedTaskViewsEditor();
}

async function renameSavedTaskViewFromSettings(view, target, generation, identityEpoch) {
  if (!isCurrentSavedTaskViewsEditor(target, generation, identityEpoch)) return false;
  const personId = state.identityPersonId || state.actorGrants?.actorPersonId;
  if (!personId) return false;
  return renameSavedTaskViewCommand({
    view,
    name: view.name,
    personId,
    identityEpoch,
    isCurrent: () => isCurrentSavedTaskViewsEditor(target, generation, identityEpoch),
    getCurrentView: (viewId) => state.savedTaskViews.find((candidate) => candidate.id === viewId),
    saveTaskView,
    reloadTaskViews: loadSavedTaskViews,
    setMessage,
    updateEditor: updateSavedTaskViewsEditor,
    formatError: errorText,
  });
}

function reorderPreferenceList(order, visibleIds, id, direction) {
  const position = visibleIds.indexOf(id);
  const adjacent = position + (direction === "up" ? -1 : 1);
  if (position < 0 || adjacent < 0 || adjacent >= visibleIds.length) return order;
  const next = [...order];
  const first = next.indexOf(id);
  const second = next.indexOf(visibleIds[adjacent]);
  if (first < 0 || second < 0) return order;
  [next[first], next[second]] = [next[second], next[first]];
  return next;
}

function createSavedTaskViewsPanel(SavedTaskViewsPanel, collection, filters, navigate, lifetime) {
  const workPlan = planWorkReads(state.actorGrants);
  const availableCollections = [
    ...(workPlan.assignments ? ["mine"] : []),
    ...(workPlan.taskCollection ? ["visible"] : []),
  ];
  const reconcileConflict = async (error) => {
    if (!isCurrentPageRequest(lifetime)) return true;
    const personId = state.identityPersonId || state.actorGrants?.actorPersonId;
    const identityEpoch = state.identityEpoch;
    if (!personId) return true;
    await loadSavedTaskViews(personId, identityEpoch);
    if (!isCurrentPageRequest(lifetime)) return true;
    setMessage(errorText(error), "warning");
    renderWork();
    return true;
  };
  return createElement(SavedTaskViewsPanel, {
    views: state.savedTaskViews,
    collection,
    filters,
    readStatus: state.savedTaskViewsLoading ? "loading" : state.savedTaskViewsReadError ? "error" : "ready",
    availableCollections,
    atLimit: state.savedTaskViews.length >= 12,
    formatError: errorText,
    onFailure: (error, source) => recoverProtectedCommandFailure(error, captureCommandContext(source)),
    onOpen: (view) => navigate({ status: view.status, due: view.due, search: view.search, cursor: "" }),
    onUpdate: async (view) => {
      try {
        const saved = await saveTaskView({
          id: view.id,
          name: view.name,
          collection,
          status: filters.status,
          due: filters.due,
          search: filters.search.trim(),
        }, view.revision);
        if (!saved || !isCurrentPageRequest(lifetime)) return;
      } catch (error) {
        if (error?.code === "TASK_VIEW_CONFLICT") {
          await reconcileConflict(error);
          return;
        }
        throw error;
      }
      setMessage("Saved view updated.");
      renderWork();
    },
    onCreate: async (name) => {
      try {
        const saved = await saveTaskView({
          name,
          collection,
          status: filters.status,
          due: filters.due,
          search: filters.search.trim(),
        }, 0);
        if (!saved || !isCurrentPageRequest(lifetime)) return;
      } catch (error) {
        if (error?.code === "TASK_VIEW_CONFLICT" || error?.code === "TASK_VIEW_LIMIT_REACHED") {
          await reconcileConflict(error);
          return;
        }
        throw error;
      }
      setMessage("Saved view added to your personal workspace.");
      renderWork();
    },
    onRetry: async () => {
      if (!isCurrentPageRequest(lifetime)) return;
      const personId = state.identityPersonId || state.actorGrants?.actorPersonId;
      if (!personId) return;
      const refreshed = await loadSavedTaskViews(personId, state.identityEpoch);
      if (!isCurrentPageRequest(lifetime)) return;
      setMessage(refreshed ? "Saved views refreshed." : "Saved views are still unavailable.", refreshed ? "success" : "warning");
      renderWork();
    },
  });
}

function scheduleUiPreferenceSave() {
  const canPersist = canPersistPersonalPreferences(state.uiPreferenceReadStatus, state.uiPreferenceWritable, Boolean(state.uiPreferenceConflict));
  state.uiPreferenceSaveStatus = canPersist ? "pending" : "idle";
  renderAppearanceEditor();
  void updateWorkspaceEditor();
  if (appearanceSaveTimer) clearTimeout(appearanceSaveTimer);
  if (canPersist) {
    appearanceSaveTimer = setTimeout(() => {
      appearanceSaveTimer = null;
      saveAppearancePreferences();
    }, 450);
  }
}

async function reloadUiPreferences() {
  if (uiPreferenceReadRetry) return uiPreferenceReadRetry;
  const personId = state.uiPreferencePersonId;
  const identityEpoch = state.identityEpoch;
  if (!personId || !state.session) return false;

  const request = (async () => {
    const saved = await readOrError(api("/api/me/ui-preferences"), {
      schemaVersion: UI_PREFERENCE_SCHEMA_VERSION,
      revision: 0,
      appearance: { ...DEFAULT_APPEARANCE },
      workspace: normalizeWorkspace(DEFAULT_WORKSPACE),
      writable: false,
    });
    if (identityEpoch !== state.identityEpoch || personId !== state.uiPreferencePersonId) return false;
    if (saved.readError || saved.personId !== personId) {
      state.uiPreferenceWritable = false;
      state.uiPreferenceReadStatus = saved.readError
        ? personalPreferenceReadStatus(saved)
        : "access-lost";
      state.uiPreferenceSaveStatus = "idle";
      renderAppearanceEditor();
      void updateWorkspaceEditor();
      if (saved.readHttpStatus === 401 || saved.readHttpStatus === 403) {
        recoverProtectedCommandFailure(
          { code: saved.readError, httpStatus: saved.readHttpStatus },
          { identityEpoch, actorPersonId: personId },
          "Your personal settings access changed. Refresh to check current access.",
        );
      }
      return false;
    }

    state.uiPreferences = {
      appearance: normalizeAppearance(saved.appearance),
      workspace: normalizeWorkspace(saved.workspace),
    };
    state.uiPreferenceRevision = Number.isInteger(saved.revision) ? saved.revision : 0;
    state.uiPreferenceWritable = saved.writable === true;
    state.uiPreferenceReadStatus = personalPreferenceReadStatus(saved);
    state.uiPreferenceSaveStatus = state.uiPreferenceWritable ? "saved" : "idle";
    state.uiPreferenceConflict = null;
    applyAppearanceTokens(state.uiPreferences.appearance);
    renderAppearanceEditor();
    void updateWorkspaceEditor();
    return true;
  })();

  uiPreferenceReadRetry = request;
  try {
    return await request;
  } finally {
    if (uiPreferenceReadRetry === request) uiPreferenceReadRetry = null;
  }
}

async function saveAppearancePreferences() {
  if (appearanceSaveInFlight || !canPersistPersonalPreferences(state.uiPreferenceReadStatus, state.uiPreferenceWritable, Boolean(state.uiPreferenceConflict))) return;
  const appearance = normalizeAppearance(state.uiPreferences.appearance);
  const workspace = normalizeWorkspace(state.uiPreferences.workspace);
  const expectedRevision = state.uiPreferenceRevision;
  const identityEpoch = state.identityEpoch;
  const personId = state.uiPreferencePersonId;
  const identityContext = { identityEpoch, actorPersonId: personId };
  const saveGeneration = ++appearanceSaveGeneration;
  appearanceSaveInFlight = true;
  state.uiPreferenceSaveStatus = "saving";
  renderAppearanceEditor();
  void updateWorkspaceEditor();
  try {
    const saved = await api("/api/me/ui-preferences", requestOptions("PATCH", {
      schemaVersion: UI_PREFERENCE_SCHEMA_VERSION,
      expectedPersonId: personId,
      expectedRevision,
      appearance,
      workspace,
    }));
    if (identityEpoch !== state.identityEpoch || personId !== state.uiPreferencePersonId) return;
    state.uiPreferenceRevision = saved.revision;
    state.uiPreferenceWritable = saved.writable === true;
    state.uiPreferenceReadStatus = personalPreferenceReadStatus(saved);
    state.uiPreferenceSaveStatus = JSON.stringify(normalizeAppearance(state.uiPreferences.appearance)) === JSON.stringify(appearance) &&
      JSON.stringify(normalizeWorkspace(state.uiPreferences.workspace)) === JSON.stringify(workspace)
      ? "saved"
      : "pending";
  } catch (error) {
    if (identityEpoch !== state.identityEpoch || personId !== state.uiPreferencePersonId) return;
    if (error?.httpStatus === 401 || error?.httpStatus === 403) {
      if (error.httpStatus === 403) {
        state.uiPreferenceWritable = false;
        state.uiPreferenceReadStatus = "access-lost";
        state.uiPreferenceSaveStatus = "error";
      }
      if (recoverProtectedCommandFailure(error, identityContext, "Your personal settings access changed. Refresh to check current access.")) return;
    }
    if (error.code === "UI_PREFERENCE_IDENTITY_CHANGED") {
      state.uiPreferenceSaveStatus = "idle";
      state.uiPreferenceWritable = false;
      state.uiPreferenceReadStatus = "access-lost";
      await refreshSession();
      render();
      return;
    }
    if (error.code === "UI_PREFERENCE_SCHEMA_UNSUPPORTED") {
      state.uiPreferenceWritable = false;
      state.uiPreferenceReadStatus = "unsupported";
      state.uiPreferenceSaveStatus = "error";
    } else if (error.code === "UI_PREFERENCE_CONFLICT") {
      const current = error.payload?.current;
      if (current) {
        state.uiPreferenceConflict = {
          submittedRevision: expectedRevision,
          revision: current.revision,
          writable: current.writable === true,
          appearance: normalizeAppearance(current.appearance),
          workspace: normalizeWorkspace(current.workspace),
        };
      }
      state.uiPreferenceSaveStatus = "error";
    } else {
      state.uiPreferenceSaveStatus = "error";
    }
  } finally {
    if (saveGeneration === appearanceSaveGeneration) {
      appearanceSaveInFlight = false;
      renderAppearanceEditor();
      void updateWorkspaceEditor();
    }
    if (saveGeneration === appearanceSaveGeneration && state.uiPreferenceSaveStatus === "pending" && canPersistPersonalPreferences(state.uiPreferenceReadStatus, state.uiPreferenceWritable, Boolean(state.uiPreferenceConflict))) {
      if (appearanceSaveTimer) clearTimeout(appearanceSaveTimer);
      appearanceSaveTimer = setTimeout(() => {
        appearanceSaveTimer = null;
        saveAppearancePreferences();
      }, 0);
    }
  }
}

function clearIdentityScopedState() {
  clearAllReviewFeedbackDrafts();
  state.identityEpoch += 1;
  state.pendingAdminCommandFocus = false;
  pageRequestLifecycle.cancel();
  pageRequestLifetime = null;
  state.unreadNotificationGeneration += 1;
  state.unreadNotificationCount = null;
  appearanceSaveGeneration += 1;
  appearanceSaveInFlight = false;
  if (appearanceSaveTimer) clearTimeout(appearanceSaveTimer);
  appearanceSaveTimer = null;
  uiPreferenceReadRetry = null;
  state.adminData = null;
  state.taskCreateFingerprint = "";
  state.taskCreateRequestKey = "";
  state.uiPreferences = {
    appearance: { ...DEFAULT_APPEARANCE },
    workspace: normalizeWorkspace(DEFAULT_WORKSPACE),
  };
  state.savedTaskViews = [];
  state.savedTaskViewsLoading = false;
  state.savedTaskViewsReadError = false;
  state.savedTaskViewsLoaded = false;
  state.savedTaskViewsRequestGeneration += 1;
  savedTaskViewsReadRequest = null;
  state.uiPreferenceRevision = 0;
  state.uiPreferencePersonId = null;
  state.identityPersonId = null;
  state.uiPreferenceWritable = false;
  state.uiPreferenceReadStatus = "unavailable";
  state.uiPreferenceSaveStatus = "idle";
  state.uiPreferenceConflict = null;
  state.bootstrapToken = "";
  state.bootstrapFounderEmail = "";
  state.publicOriginConfigured = false;
  state.publicOrigin = "";
  state.emailOAuthResult = null;
}

async function renderSettings(lifetime) {
  lifetime = lifetime || beginPageRequestLifetime();
  const canManageEmail = state.actorGrants?.isSuperAdmin === true;
  if (!canManageEmail && state.emailOAuthResult) {
    setMessage(
      "Google returned to NOVA, but this account cannot verify the email connection. Ask a Super Admin to check Email delivery.",
      "warning",
    );
    state.emailOAuthResult = null;
  }
  const canManagePublicOrigin = Boolean(state.bootstrapToken) ||
    hasPermissionGrant(state.actorGrants, "organisation.public_origin.manage");
  const handoffAccess = getAuthHandoffAccess(state);
  const canShowAuthHandoffs = handoffAccess.bootstrap || (
    handoffAccess.canRead && canViewAuthHandoffs(state.actorGrants)
  );
  renderShell(createElement("div", { id: "settings-page-root" }), "settings");
  const settingsPageRoot = app.querySelector("#settings-page-root");
  const settingsIdentityEpoch = state.identityEpoch;
  const isCurrentSettings = () => isCurrentPageRequest(lifetime) && state.identityEpoch === settingsIdentityEpoch &&
    Boolean(settingsPageRoot && app.contains(settingsPageRoot));
  let settingsRoute;
  try {
    settingsRoute = await import("./app/settings-page-route.js");
  } catch {
    if (isCurrentSettings()) {
      settingsPageRoot.replaceChildren(noticeElement("Settings could not load. Reload the page to try again.", "error"));
    }
    return;
  }
  if (!isCurrentSettings()) return;
  await settingsRoute.mountSettingsPage({
    target: settingsPageRoot,
    capabilities: { canManagePublicOrigin, canManageEmail, canShowAuthHandoffs },
    isCurrentSettings,
    mountIsland: mountReactIsland,
    showFeedback,
    renderLoadError: (message) => settingsPageRoot.replaceChildren(noticeElement(message, "error")),
    sections: {
      mountAccountSecurity: mountSettingsAccountSecurity,
      mountNotificationPreferences: (target, isCurrent) => mountSettingsNotificationPreferences(target, isCurrent, lifetime),
      renderAppearance: renderAppearanceEditor,
      updateWorkspace: () => { void updateWorkspaceEditor(); },
      updateSavedTaskViews: updateSavedTaskViewsEditor,
      mountPublicOrigin: mountSettingsPublicOrigin,
      mountEmailDelivery: ({ target, isCurrentSettings: isCurrent, canReadOrigin, canActWithUnknownPublicOrigin, originBridge }) =>
        mountSettingsEmailDeliveryRoute({
          target,
          isCurrentSettings: isCurrent,
          canReadOrigin,
          canActWithUnknownPublicOrigin,
          originBridge,
          host: {
            state,
            api,
            requestOptions,
            captureCommandContext,
            isCurrentCommand,
            isCurrentCommandIdentity,
            recoverProtectedCommandFailure,
            mountReactIsland,
            noticeElement,
            errorText,
            setMessage,
            showFeedback,
            navigateToGoogleAuthorization: (url) => window.location.assign(url),
          },
        }),
      mountAuthHandoffs: mountSettingsAuthHandoffs,
    },
  });
}

async function mountSettingsNotificationPreferences(target, isCurrentSettings, lifetime) {
  const identityEpoch = state.identityEpoch;
  let feature;
  try {
    feature = await import("./src/features/notifications/preferences/index.ts");
  } catch {
    if (identityEpoch === state.identityEpoch && isCurrentSettings() && target.isConnected) {
      target.replaceChildren(noticeElement("Email preferences could not load. Reload Settings to try again.", "error"));
    }
    return;
  }

  const isCurrent = () => identityEpoch === state.identityEpoch && isCurrentSettings() && target.isConnected;
  const controller = feature.createNotificationPreferencesController({
    isCurrent,
    readPreferences: () => pageApi("/api/notification-preferences", lifetime),
    savePreference: (eventKey, enabled) => api("/api/notification-preferences", requestOptions("PATCH", {
      eventKey, channel: "email", enabled,
    })),
    runActionButton,
    isCurrentCommand,
    errorMessage: errorText,
    onStateChange: (state, pendingEventKeys) => {
      mountReactIsland(target, feature.NotificationPreferences, {
        state,
        pendingEventKeys,
        onRetry: () => controller.retry(),
        onSetEmailPreference: (eventKey, enabled, source) => controller.setEmailPreference(eventKey, enabled, source),
      });
    },
    onSaveConfirmed: () => {
      setMessage("Email preference saved.");
      showFeedback();
    },
  });
  controller.start();
}

async function mountSettingsAccountSecurity(target, isCurrentSettings) {
  const identityEpoch = state.identityEpoch;
  let feature;
  try {
    feature = await import("./src/features/settings/account-security/index.ts");
  } catch {
    if (identityEpoch === state.identityEpoch && isCurrentSettings() && target.isConnected) {
      target.replaceChildren(noticeElement("Account security could not load. Reload Settings to try again.", "error"));
    }
    return;
  }

  if (identityEpoch !== state.identityEpoch || !isCurrentSettings() || !target.isConnected) return;
  const accountEmail = state.session?.email;
  const identity = feature.projectAccountIdentity(state.session);
  const readState = identity
    ? { status: "ready", identity }
    : { status: "error", message: "NOVA could not confirm the current account details. Refresh Settings before continuing." };

  async function runAuthAction(request) {
    const context = captureCommandContext(target);
    const contextIsCurrent = () => identityEpoch === state.identityEpoch &&
      state.session?.email === accountEmail && isCurrentSettings() && target.isConnected && isCurrentCommand(context);
    if (!identity || typeof accountEmail !== "string" || !contextIsCurrent()) {
      throw new feature.AccountSecurityActionError("Your account or Settings page changed. Refresh before trying again.");
    }
    let result;
    try {
      result = await request();
    } catch (error) {
      if (error?.code === "SESSION_NOT_FRESH") {
        throw new feature.AccountSessionFreshnessError();
      }
      if (isCurrentCommandIdentity(context) && recoverProtectedCommandFailure(error, context)) {
        throw new feature.AccountSecurityActionError("Your session or access changed. Refresh Settings before continuing.");
      }
      if (!contextIsCurrent()) {
        throw new feature.AccountSecurityActionError("Your account or Settings page changed. Refresh before trying again.");
      }
      throw new feature.AccountSecurityActionError(errorText(error));
    }
    if (!contextIsCurrent()) {
      throw new feature.AccountSecurityActionError("Your account or Settings page changed. Refresh before trying again.");
    }
    return result;
  }

  const sessions = feature.createAccountSessionController((path, method, body) =>
    runAuthAction(() => api(path, requestOptions(method, body))));

  mountReactIsland(target, feature.AccountSecurity, {
    readState,
    onRequestVerification: () => runAuthAction(() => api("/api/auth/send-verification-email", requestOptions("POST", {
      email: accountEmail,
    }))),
    onChangePassword: (currentPassword, newPassword) => runAuthAction(() => api("/api/auth/change-password", requestOptions("POST", {
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    }))),
    onLoadSessions: () => sessions.load(),
    onRevokeSession: (sessionId) => sessions.revoke(sessionId),
    onRevokeOtherSessions: () => sessions.revokeOthers(),
    onReauthenticate: async () => {
      await signOut();
      go("login");
    },
  });
}

function mountSettingsPublicOrigin(target, isCurrentSettings, originBridge) {
  return mountSettingsPublicOriginRoute({
    target,
    isCurrentSettings,
    originBridge,
    host: {
      getIdentityEpoch: () => state.identityEpoch,
      readOrigin: () => api("/api/organisation/public-origin", state.bootstrapToken
        ? requestOptions("GET", undefined, { "x-nova-bootstrap-token": state.bootstrapToken })
        : undefined),
      saveOrigin: (origin) => api("/api/organisation/public-origin", requestOptions(
        "PATCH",
        { origin },
        state.bootstrapToken ? { "x-nova-bootstrap-token": state.bootstrapToken } : undefined,
      )),
      captureCommandContext,
      isCurrentCommand,
      isCurrentCommandIdentity,
      recoverProtectedCommandFailure,
      publishOriginSnapshot(snapshot) {
        state.publicOriginConfigured = Boolean(snapshot.configuredOrigin);
        state.publicOrigin = snapshot.configuredOrigin || snapshot.effectiveOrigin;
      },
      clearOriginSnapshot() {
        state.publicOriginConfigured = false;
        state.publicOrigin = "";
      },
      mountReactIsland,
      noticeElement,
      errorText,
    },
  });
}

function mountSettingsAuthHandoffs(target, isCurrentSettings) {
  return mountAuthHandoffsRoute(target, isCurrentSettings, {
    state,
    api,
    requestOptions,
    captureCommandContext,
    isCurrentCommand,
    isCurrentCommandIdentity,
    recoverProtectedCommandFailure,
    mountReactIsland,
    noticeElement,
  });
}

function adminReadFailure(result, resource) {
  const issue = adminReadIssue(result, resource);
  return issue ? noticeElement(issue.message, "warning") : null;
}

function hasAdminPermission(data, permissionKey, target = {}) {
  return hasPermissionGrant(data?.actorGrants, permissionKey, target);
}

function taskCreateIdempotencyHeaders(payload) {
  const fingerprint = JSON.stringify(payload);
  if (state.taskCreateFingerprint !== fingerprint || !state.taskCreateRequestKey) {
    state.taskCreateFingerprint = fingerprint;
    state.taskCreateRequestKey = crypto.randomUUID();
  }
  return { "idempotency-key": state.taskCreateRequestKey };
}

function clearTaskCreateIdempotency(payload) {
  if (state.taskCreateFingerprint !== JSON.stringify(payload)) return;
  state.taskCreateFingerprint = "";
  state.taskCreateRequestKey = "";
}

function taskBillingConfirmation(task) {
  const billingClass = task && task.billingClass;
  const classification = billingClass === "billable"
    ? "Billable"
    : billingClass === "non_billable" ? "Non-billable" : "classified automatically";
  const source = task && task.billingPolicySource === "client_workstream_task_definition"
    ? "predefined-task rule" : task && task.billingPolicySource === "client_workstream"
      ? "client workstream default" : task && task.billingPolicySource === "organisation_default"
        ? "organisation default" : task && task.billingPolicySource === "legacy_snapshot"
          ? "legacy classification snapshot" : "workstream policy";
  const revision = task && Number.isSafeInteger(task.billingPolicyRevision) && task.billingPolicyRevision > 0
    ? " · policy r" + task.billingPolicyRevision : "";
  return "NOVA automatically classified this task as " + classification + " · " + source + revision;
}

function taskCorrectionConfirmation(isCorrection) {
  return isCorrection ? " This is a separate correction work item; the original task remains unchanged." : "";
}

function taskDefinitionReference(task) {
  return task && task.taskDefinition
    ? task.taskDefinition.entryId + "@" + task.taskDefinition.revision
    : "one-off task path";
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function renderAdmin(lifetime, requestedView) {
  lifetime = lifetime || beginPageRequestLifetime();
  requestedView = requestedView || state.view || routeView() || "admin";
  const area = adminAreaForView(requestedView, state.actorGrants);
  if (!area) {
    renderUnavailableView(requestedView);
    return;
  }
  renderShell(createElement("div", { id: "admin-console" }), area.view);
  const target = app.querySelector("#admin-console");
  const pageReady = target
    ? mountAdminPage(target, lifetime, { state: { status: "loading" }, sections: [] })
    : Promise.resolve(false);
  showFeedback();
  void loadAdmin(lifetime, pageReady, area.id);
}

async function mountAdminPage(target, lifetime, props) {
  const identityEpoch = state.identityEpoch;
  let AdminPage;
  try {
    ({ AdminPage } = await import("./src/pages/admin/AdminPage.tsx"));
  } catch {
    if (target.isConnected && isCurrentPageRequest(lifetime) && identityEpoch === state.identityEpoch) {
      target.replaceChildren(noticeElement("Admin page could not load. Reload Admin to try again.", "error"));
    }
    return false;
  }
  if (!target.isConnected || !isCurrentPageRequest(lifetime) || identityEpoch !== state.identityEpoch) return false;
  mountReactIsland(target, AdminPage, props);
  if (props.state?.status !== "loading" && state.pendingAdminCommandFocus) {
    state.pendingAdminCommandFocus = false;
    window.requestAnimationFrame(() => {
      if (!target.isConnected || !isCurrentPageRequest(lifetime)) return;
      target.querySelector("#admin-page-title")?.focus({ preventScroll: true });
    });
  }
  showFeedback();
  return true;
}

async function loadAdmin(lifetime, pageReady, areaId) {
  let stage = "load-module";
  let preloadedFeatureModules;
  try {
    const { loadAdminPageData } = await import("./src/pages/admin/admin-page-loader.ts");
    stage = "load-authorized-data";
    const adminData = await loadAdminPageData(lifetime, pageReady, {
      pageApi,
      readOrError,
      skippedAdminRead,
      isCurrentPageRequest,
      areaId,
      onEffectiveGrantsResolved: (actorGrants) => {
        preloadedFeatureModules = preloadAdminPageFeatureModules({ actorGrants }, undefined, areaId);
        // The route still awaits this same promise after the read batch. Attach
        // a handler now so an early chunk failure cannot become unhandled.
        void preloadedFeatureModules.catch(() => {});
      },
    });
    if (!adminData || !isCurrentPageRequest(lifetime)) return;
    state.adminData = adminData;
    stage = "compose-page";
    await renderAdminContent(state.adminData, lifetime, preloadedFeatureModules, areaId);
  } catch (error) {
    if (!isCurrentPageRequest(lifetime)) return;
    const diagnostic = {
      stage,
      name: typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : "Error",
      ...(typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code) ? { code: error.code } : {}),
      ...(Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599
        ? { httpStatus: error.httpStatus }
        : {}),
    };
    console.error("[NOVA Admin] page load failed " + JSON.stringify(diagnostic));
    const target = app.querySelector("#admin-console");
    if (target) await mountAdminPage(target, lifetime, {
      state: { status: "error", message: errorText(error) },
      sections: [],
    });
  }
}

async function renderAdminContent(data, lifetime, preloadedFeatureModules, areaId) {
  return adminPageRoute(data, lifetime, preloadedFeatureModules, areaId);
}
function adminFeatureReadError(result, resource) {
  if (!result?.readError) return null;
  const issue = adminReadIssue(result, resource);
  const unavailable = ["PREREQUISITE_PERMISSION_REQUIRED", "PERMISSION_DENIED"].includes(result.readError);
  return { status: unavailable ? "unavailable" : "error", message: issue?.message || `Could not load ${resource}.` };
}

async function runAdminRequestReviewCommand(target, lifetime, data, path, payload, successMessage) {
  if (!target.isConnected || !isCurrentPageRequest(lifetime) || state.adminData !== data) {
    throw adminCommandUiError("The Admin page changed before this action could start. Refresh and try again.");
  }
  const context = captureCommandContext(target);
  if (!isCurrentCommand(context)) {
    throw adminCommandUiError("The Admin page changed before this action could start.");
  }
  try {
    await api(path, requestOptions("POST", payload));
  } catch (error) {
    if (!isCurrentCommandIdentity(context)) {
      throw adminCommandUiError("Your session changed. Sign in again before continuing.");
    }
    const accessChangedMessage = "Your review access changed. Available actions have been refreshed.";
    if (recoverProtectedCommandFailure(error, context, accessChangedMessage)) {
      throw adminCommandUiError(accessChangedMessage);
    }
    if (!isCurrentCommand(context)) {
      throw adminCommandUiError("The Admin page changed before the action completed.");
    }
    throw adminCommandUiError(errorText(error));
  }
  if (!isCurrentCommand(context)) {
    throw adminCommandUiError("The Admin page changed before the action completed.");
  }
  setMessage(successMessage);
  state.pendingAdminCommandFocus = true;
  render();
}

async function runAdminProtectedCommand(target, lifetime, permission, permissionTarget, method, path, payload, successMessage, afterSuccess, requestHeaders, unknownFailureMessage) {
  if (!target.isConnected || !isCurrentPageRequest(lifetime)) {
    throw adminCommandUiError("The Admin page changed before this action could start. Refresh and try again.");
  }
  const requiredPermissions = Array.isArray(permission) ? permission : [permission];
  const permitted = typeof permission === "function"
    ? permission(state.adminData)
    : requiredPermissions.every((key) => hasAdminPermission(state.adminData, key, permissionTarget));
  if (!permitted) {
    throw adminCommandUiError("Your current access no longer allows this action. Refresh Admin to check access.");
  }
  const context = captureCommandContext(target);
  if (!isCurrentCommand(context)) throw adminCommandUiError("The Admin page changed before this action could start.");

  let result;
  try {
    result = await api(path, requestOptions(method, payload, requestHeaders));
  } catch (error) {
    if (!isCurrentCommandIdentity(context)) throw adminCommandUiError("Your session changed. Sign in again before continuing.");
    const accessChangedMessage = "Your access changed while saving. Refresh Admin and check the current permissions.";
    if (recoverProtectedCommandFailure(error, context, accessChangedMessage)) {
      throw adminCommandUiError(accessChangedMessage);
    }
    if (!isCurrentCommand(context)) throw adminCommandUiError("The Admin page changed before the action completed.");
    const message = unknownFailureMessage && !errorMessages[error?.code]
      ? unknownFailureMessage
      : errorText(error);
    throw adminCommandUiError(message);
  }
  if (!isCurrentCommand(context)) throw adminCommandUiError("The Admin page changed before the action completed.");
  if (afterSuccess) afterSuccess(result);
  else setMessage(successMessage);
  state.pendingAdminCommandFocus = true;
  render();
  return result;
}

function adminCommandUiError(message) {
  const error = new Error(message);
  error.uiMessage = true;
  return error;
}

async function saveAdminRole(target, lifetime, currentData, action, roleId, payload) {
  if (!target.isConnected || !isCurrentPageRequest(lifetime)) return;
  if (state.adminData !== currentData) {
    throw new Error("The Admin data changed before this role update could start. Refresh Admin and try again.");
  }
  const permission = action === "create" ? "roles.create" : "roles.edit";
  if (!hasAdminPermission(state.adminData, permission)) {
    throw new Error("Your current access no longer allows this role change. Refresh Admin to check access.");
  }

  const context = captureCommandContext(target);
  const update = action === "update";
  const path = update ? "/api/roles/" + encodeURIComponent(roleId) : "/api/roles";
  try {
    await api(path, requestOptions(update ? "PATCH" : "POST", payload));
  } catch (error) {
    if (state.adminData !== currentData) return;
    if (!isCurrentCommandIdentity(context)) return;
    if (recoverProtectedCommandFailure(error, context) || !isCurrentCommand(context)) return;
    throw new Error(errorText(error));
  }
  if (state.adminData !== currentData || !isCurrentCommand(context)) return;
  setMessage(update ? "Role updated." : "Role created.");
  showFeedback();
  render();
}

function noticeElement(text, kind) {
  const element = document.createElement("p");
  element.className = "notice" + (kind === "error" ? " error" : kind === "warning" ? " warning" : "");
  element.setAttribute("role", "status");
  element.textContent = text;
  return element;
}

async function renderInvite(lifetime) {
  renderShell(createElement("div", { id: "invite-page-root" }), "invite");
  const root = app.querySelector("#invite-page-root");
  if (!root) return;

  let inviteUi;
  try {
    inviteUi = await import("./src/pages/invite/InvitePage.tsx");
  } catch {
    if (isCurrentPageRequest(lifetime) && root.isConnected) {
      root.replaceChildren(noticeElement("Invitations could not be displayed. Refresh the page to try again.", "error"));
    }
    return;
  }
  if (!isCurrentPageRequest(lifetime) || !root.isConnected) return;
  mountReactIsland(root, inviteUi.InvitePage, {
    canInvite: canShowInviteNavigation(state.actorGrants),
    onSubmit: (event) => { void submitInvite(event); },
  });
  showFeedback();
}

async function renderNotifications(lifetime) {
  lifetime = lifetime || beginPageRequestLifetime();
  renderShell(createElement("div", { id: "notifications-root" }), "notifications");
  const root = app.querySelector("#notifications-root");
  if (!root) return;
  let NotificationsPage;
  let createNotificationsRoute;
  let resolveNotificationDeepLink;
  try {
    const [pageUi, routeUi, notificationDestinations] = await Promise.all([
      import("./src/features/notifications/index.js"),
      import("./app/notifications-route.js"),
      import("./notification-destinations.js"),
    ]);
    NotificationsPage = pageUi.NotificationsPage;
    createNotificationsRoute = routeUi.createNotificationsRoute;
    resolveNotificationDeepLink = notificationDestinations.resolveNotificationDeepLink;
  } catch {
    if (isCurrentPageRequest(lifetime) && root.isConnected) {
      root.replaceChildren(noticeElement("Notifications could not load. Reload this page to try again.", "error"));
    }
    return;
  }
  if (!isCurrentPageRequest(lifetime) || !root.isConnected) return;

  let notificationsRoute;
  const mount = () => {
    if (!notificationsRoute || !isCurrentPageRequest(lifetime) || !root.isConnected) return;
    mountReactIsland(root, NotificationsPage, {
      notifications: notificationsRoute.getState(),
      resolveNotificationDeepLink: (rawDeepLink, eventKey) => resolveNotificationDeepLink(rawDeepLink, {
        origin: window.location.origin,
        grants: state.actorGrants,
        homeView: workspaceHomeView(),
        eventKey,
      }),
      onMarkRead: (id, source) => notificationsRoute.markRead(id, source),
      onMarkAllRead: (source) => notificationsRoute.markAllRead(source),
      onRetryNotifications: () => { void notificationsRoute.retry(); },
    });
  };
  notificationsRoute = createNotificationsRoute({
    readNotifications: () => pageApi("/api/notifications?limit=100", lifetime),
    markNotificationRead: (id) => api("/api/notifications/" + id + "/read", requestOptions("POST")),
    markAllNotificationsRead: () => api("/api/notifications/read-all", requestOptions("POST")),
    runCommand: (source, action) => runActionButton(source, action),
    isCurrent: () => isCurrentPageRequest(lifetime) && root.isConnected,
    isCommandCurrent: isCurrentCommand,
    isCommandIdentityCurrent: isCurrentCommandIdentity,
    errorMessage: errorText,
    refreshUnreadCount: () => { void refreshUnreadNotificationCount(); },
    onSuccess: (kind) => {
      setMessage(kind === "read" ? "Notification marked as read." : "Notifications marked as read.");
      showFeedback();
    },
    onChange: mount,
  });
  mount();
  showFeedback();
  void notificationsRoute.load();
}

async function renderAttendance(lifetime) {
  lifetime = lifetime || beginPageRequestLifetime();
  renderShell(createElement("div", { id: "my-day-page-root" }), "today");
  const pageRoot = app.querySelector("#my-day-page-root");
  await mountMyDayPageRoute({
    actorGrants: state.actorGrants,
    getActorGrants: () => state.actorGrants,
    workspace: normalizeWorkspace(state.uiPreferences.workspace),
    lifetime,
    pageRoot,
    findModuleTarget: (id) => app.querySelector(`[data-my-day-slot="${id}"]`),
    MyDayPage,
    requestRoute: myDayRequestRoute,
    isCurrentPageRequest,
    mountReactIsland,
    pageApi,
    api,
    requestOptions,
    isCurrentCommand,
    runActionButton,
    setMessage,
    render,
    showFeedback,
    go,
    noticeElement,
  });
}

function businessTimeLabel(value, timezone) {
  try {
    return new Date(value).toLocaleTimeString([], { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  } catch {
    return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

function workCollaborationReadState(result, resource, onRetry) {
  return projectWorkCollaborationReadState(result, resource, onRetry, adminReadIssue);
}

async function renderWork(date, lifetime) {
  clearReactIslands();
  lifetime = lifetime || beginPageRequestLifetime();
  const requestedActorId = state.identityPersonId || state.actorGrants?.actorPersonId || null;
  const requestIdentityEpoch = state.identityEpoch;
  const routeParams = new URLSearchParams(window.location.search);
  const focusedRouteInput = readFocusedCollaborationRequest(routeParams);
  const requestedFocus = focusedRouteInput.status === "focused"
    ? { kind: focusedRouteInput.kind, id: focusedRouteInput.id }
    : null;
  const readPlan = planWorkReads(state.actorGrants, {
    focusedCollaborationRequest: requestedFocus?.kind,
  });
  const taskCreateScopes = ["organisation", "client", "client_workstream", "group"];
  const canCreateTasks = hasAnyPermissionGrant(state.actorGrants, ["tasks.create"], taskCreateScopes);
  const taskScopes = ["organisation", "client", "client_workstream", "group", "assigned_work"];
  const canActOnTasks = hasAnyPermissionGrant(state.actorGrants, [
    "tasks.start", "tasks.edit", "tasks.submit", "tasks.reviewer_request", "tasks.handover_request",
  ], taskScopes);
  const workRouteContext = resolveWorkRouteContext({
    searchParams: routeParams,
    readPlan,
    canCreateTasks,
    canActOnTasks,
    focusedCollaboration: focusedRouteInput,
  });
  const {
    taskId,
    focusedCollaboration: focusedRequestRoute,
    focusRequest,
    hasFocusedCollaborationRoute,
    taskDetailRoute,
    reviewTarget,
    hasReviewRoute,
    validReviewTarget,
    workDescription,
    workPageTitle,
    featureImports,
  } = workRouteContext;
  const workPageUiPromise = Promise.all([
    import("./src/features/work/WorkPage.tsx"),
    import("./src/features/work/page-contracts.ts"),
  ]).then(([page, composition]) => ({ ...page, ...composition }), (error) => ({ error }));
  const workRouteFeaturesPromise = loadWorkRouteFeatures(featureImports);
  const savedTaskViewsRead = featureImports.savedTaskViews && requestedActorId
    ? ensureSavedTaskViewsLoaded(requestedActorId, requestIdentityEpoch)
    : Promise.resolve(false);
  renderShell(createElement("div", { id: "work-route-root" }), "work");
  const workRouteRoot = app.querySelector("#work-route-root");
  if (!workRouteRoot || !isCurrentPageRequest(lifetime)) return;
  const focusedRequestCanBeRead = focusRequest?.kind === "reviewer"
    ? readPlan.reviewerRequests
    : focusRequest?.kind === "handover"
      ? readPlan.handoverRequests
      : true;
  const workRouteUnavailableMessage = focusedRequestRoute.status === "invalid" || (focusRequest && !focusedRequestCanBeRead)
    ? "This collaboration request is not available to your current role or the link is invalid."
    : hasReviewRoute && (!readPlan.reviews || !validReviewTarget)
      ? "This review is not available to your current role or the link is invalid."
      : null;
  // The read plan and focused-route checks are already resolved from the
  // current server-issued grants. Start only those reads while the page UI
  // chunk loads; pageApi binds them to this route's abortable lifetime.
  const workReadDataPromise = !taskDetailRoute && !workRouteUnavailableMessage
    ? readWorkRouteData({
      readPlan,
      hasReviewRoute,
      focusRequest,
      reviewTarget: reviewTarget || {},
      date,
      searchParams: new URLSearchParams(window.location.search),
      lifetime,
      pageApi,
    })
    : null;
  const loadedWorkPageUi = await workPageUiPromise;
  if (loadedWorkPageUi.error) {
    if (!isCurrentPageRequest(lifetime) || !workRouteRoot.isConnected) return;
    workRouteRoot.append(noticeElement(errorText(loadedWorkPageUi.error), "error"));
    restorePendingRouteScroll();
    return;
  }
  if (!isCurrentPageRequest(lifetime) || !workRouteRoot.isConnected) return;
  const workPageUi = loadedWorkPageUi;
  const mountWorkPage = (sections, stateName = "ready", message, options = {}) => {
    mountReactIsland(workRouteRoot, workPageUi.WorkPage, {
      title: workPageTitle,
      description: taskDetailRoute || hasReviewRoute || hasFocusedCollaborationRoute ? undefined : workDescription,
      sections,
      sectionContent: options.sectionContent,
      state: stateName,
      message,
      notices: options.notices || [],
      timelineDate: options.timelineDate,
      showTimelineDate: options.showTimelineDate === true,
      timelineDateUnavailable: options.timelineDateUnavailable === true,
      onLoadTimelineDate: options.onLoadTimelineDate,
    });
  };
  const workSlot = (id) => workRouteRoot.querySelector(`[data-work-slot="${id}"]`);
  const showWorkFeatureMessage = (target, title, message) =>
    mountReactIsland(target, workPageUi.WorkFeatureMessage, { title, message });
  mountWorkPage([], "loading", taskDetailRoute
    ? "Loading task details..."
    : hasReviewRoute
      ? "Loading review..."
      : focusRequest
        ? "Loading collaboration request..."
        : "Loading work...");
  showFeedback();
  if (workRouteUnavailableMessage) {
    mountWorkPage([], "error", workRouteUnavailableMessage);
    restorePendingRouteScroll();
    return;
  }
  if (taskDetailRoute) {
    const workRouteFeatures = await workRouteFeaturesPromise;
    const taskDetailUi = workRouteFeatures.taskDetail;
    if (!isCurrentPageRequest(lifetime)) return;
    if (taskDetailUi.error) {
      mountWorkPage([], "error", errorText(taskDetailUi.error));
      restorePendingRouteScroll();
      return;
    }
    mountWorkPage(workPageUi.createWorkPageSections(readPlan, {
      canCreateTasks,
      hasReviewRoute,
      taskDetailRoute,
      focusedCollaborationRequest: hasFocusedCollaborationRoute,
    }));
    const taskDetailRoot = workSlot("task-detail");
    if (!taskDetailRoot) return;
    await workTaskDetailRoute({ taskId, board: taskDetailRoot, lifetime, Component: taskDetailUi.module.TaskDetail });
    if (!isCurrentPageRequest(lifetime)) return;
    restorePendingRouteScroll();
    return;
  }
  let stage = "read-work-data";
  try {
    const [workReadData] = await Promise.all([
      workReadDataPromise,
      savedTaskViewsRead,
    ]);
    if (!workReadData) return;
    const {
      assignmentsResult,
      sessionsResult,
      timeline,
      reviewsResult,
      reviewerRequestsResult,
      handoverRequestsResult,
      workContext,
      tasksResult,
      visibleTasksResult,
      taskCatalogResult,
      attendanceResult,
      reviewerManagementResult,
    } = workReadData;
    if (!isCurrentPageRequest(lifetime)) return;
    stage = "load-review-detail";
    const selectedReview = hasReviewRoute
      ? reviewTarget?.assignmentId
        ? (reviewsResult.reviews || []).find((item) => item.assignmentId === reviewTarget.assignmentId)
        : reviewTarget?.taskId
          ? (reviewsResult.reviews || []).find((item) => item.taskId === reviewTarget.taskId)
          : null
      : null;
    const reviewDetailResult = selectedReview && readPlan.reviews
      ? await readOrError(pageApi(
        "/api/task-assignments/" + encodeURIComponent(selectedReview.assignmentId) + "/review",
        lifetime,
      ), {})
      : undefined;
    if (!isCurrentPageRequest(lifetime)) return;
    reconcileReviewFeedbackDraftAccess(reviewsResult, reviewDetailResult, reviewTarget, hasReviewRoute, selectedReview);
    const loadedWorkRouteFeatures = await workRouteFeaturesPromise;
    if (!isCurrentPageRequest(lifetime)) return;
    const workContextUi = loadedWorkRouteFeatures.workContext?.module || null;
    const workContextDepartmentProjector = loadedWorkRouteFeatures.workContext?.projector || null;
    const workContextUiLoadError = loadedWorkRouteFeatures.workContext?.error || null;
    const reviewsUi = loadedWorkRouteFeatures.reviews?.module || null;
    const reviewsUiLoadError = loadedWorkRouteFeatures.reviews?.error || null;
    const workCollaborationUi = loadedWorkRouteFeatures.collaboration?.module || null;
    const workCollaborationUiLoadError = loadedWorkRouteFeatures.collaboration?.error || null;
    const reviewerManagementUi = loadedWorkRouteFeatures.reviewerManagement?.module || null;
    const reviewerManagementUiLoadError = loadedWorkRouteFeatures.reviewerManagement?.error || null;
    const taskComposerUi = loadedWorkRouteFeatures.taskComposer?.module || null;
    const taskComposerUiLoadError = loadedWorkRouteFeatures.taskComposer?.error || null;
    const sessionsUi = loadedWorkRouteFeatures.sessions?.module || null;
    const sessionsRoute = loadedWorkRouteFeatures.sessions?.route || null;
    const sessionsUiLoadError = loadedWorkRouteFeatures.sessions?.error || null;
    const timelineUi = loadedWorkRouteFeatures.timeline?.module || null;
    const timelineRoute = loadedWorkRouteFeatures.timeline?.route || null;
    const timelineUiLoadError = loadedWorkRouteFeatures.timeline?.error || null;
    const visibleTasksUi = loadedWorkRouteFeatures.visibleTasks?.module || null;
    const visibleTasksRoute = loadedWorkRouteFeatures.visibleTasks?.route || null;
    const visibleTasksUiLoadError = loadedWorkRouteFeatures.visibleTasks?.error || null;
    const loadedMyAssignmentsUi = loadedWorkRouteFeatures.assignments;
    const loadedSavedTaskViewsUi = loadedWorkRouteFeatures.savedTaskViews;
    const myAssignmentsUi = loadedMyAssignmentsUi?.module || null;
    const myAssignmentsUiLoadError = loadedMyAssignmentsUi?.error || null;
    const savedTaskViewsUi = loadedSavedTaskViewsUi?.module || null;
    const savedTaskViewsUiLoadError = loadedSavedTaskViewsUi?.error || null;
    if (!isCurrentPageRequest(lifetime)) return;
    const timelineReadFailure = adminReadFailure(timeline, "the daily timeline");
    const timelineDate = timeline.readError ? undefined : timeline.date;
    const workPageNotices = [];
    const attendanceReadFailure = readPlan.attendance && !hasReviewRoute && attendanceResult?.readError !== "OFFICE_ASSIGNMENT_REQUIRED"
      ? adminReadFailure(attendanceResult, "today’s attendance status")
      : undefined;
    if (attendanceReadFailure) {
      workPageNotices.push({ id: "attendance-read", kind: "warning", message: attendanceReadFailure.textContent || "Today’s attendance status could not be read." });
    }
    if (readPlan.attendance && !hasReviewRoute && !attendanceReadFailure && (attendanceResult?.wfhPending || attendanceResult?.provisionalAttendance?.status === "pending")) {
      workPageNotices.push({
        id: "wfh-pending",
        kind: "warning",
        message: attendanceResult.provisionalAttendance?.status === "pending"
          ? "WFH approval is pending. Task work is retained independently. A role that requires attendance may run a timer only while this provisional check-in is open; approval promotes attendance, rejection discards only attendance credit and pauses that timer."
          : "WFH approval is pending. Task work may continue. If your role requires attendance, record a provisional WFH check-in on Today before starting a timer.",
      });
    }

    const workContextReadFailure = readPlan.workContext && !hasReviewRoute ? adminReadFailure(workContext, "workstream options") : undefined;
    if (workContextReadFailure && !readPlan.workContextView) {
      workPageNotices.push({ id: "work-context-read", kind: "warning", message: workContextReadFailure.textContent || "Workstream options could not be read." });
    }
    stage = "compose-work-sections";
    const pageSections = workPageUi.createWorkPageSections(readPlan, {
      canCreateTasks,
      hasReviewRoute,
      taskDetailRoute,
      focusedCollaborationRequest: hasFocusedCollaborationRoute,
    });
    const pageSectionContent = {};
    const savedViewsFor = (collection, filters, navigate) => {
      if (savedTaskViewsUi?.WorkSavedTaskViews) {
        return createSavedTaskViewsPanel(savedTaskViewsUi.WorkSavedTaskViews, collection, filters, navigate, lifetime);
      }
      return savedTaskViewsUiLoadError
        ? createElement(workPageUi.WorkFeatureMessage, {
          title: "Saved views are unavailable",
          message: "Saved task view controls could not load. Refresh Work to try again.",
        })
        : null;
    };
    if (!hasReviewRoute && !hasFocusedCollaborationRoute && (readPlan.timeline || readPlan.attendance)) {
      if (!timelineUi || typeof timelineRoute?.projectWorkTimelineProps !== "function") {
        stage = "compose-timeline-unavailable";
        pageSectionContent.timeline = createElement(workPageUi.WorkFeatureMessage, {
          title: "Timeline and attendance are unavailable",
          message: timelineUiLoadError
            ? "Daily timeline and attendance could not load. Refresh Work to try again."
            : "Daily timeline is unavailable.",
        });
      } else {
        const timelineCorrectionScopes = ["organisation", "own_record", "office", "organisation_department"];
        const canAdjustTimeline = () => !state.actorGrants?.readError &&
          Array.isArray(state.actorGrants?.grants) && state.actorGrants.grants.some((grant) =>
            grant.permissionKey === "work.timeline_adjust_own" &&
            timelineCorrectionScopes.includes(grant.scope) && grant.selfApplicable === true);
        stage = "compose-timeline";
        const timelineProps = timelineRoute.projectWorkTimelineProps({
          readPlan,
          timelineResult: timeline,
          attendanceResult,
          onRetryTimeline: () => renderWork(timelineDate),
          onRetryAttendance: () => renderWork(timelineDate),
          onSearchCorrectionAssignments: canAdjustTimeline() ? createWorkTimelineCorrectionAssignmentSearch({
            target: workRouteRoot,
            canAdjustTimeline,
            captureCommandContext,
            isCurrentCommand,
            api,
            requestOptions,
            recoverProtectedCommandFailure,
            adminCommandUiError,
          }) : undefined,
          onCorrectGap: canAdjustTimeline() ? createWorkTimelineCorrectionAction({
            target: workRouteRoot,
            canAdjustTimeline,
            captureCommandContext,
            isCurrentCommand,
            api,
            requestOptions,
            recoverProtectedCommandFailure,
            adminCommandUiError,
            errorText,
            setMessage,
            refreshWork: () => renderWork(timelineDate),
          }) : undefined,
        });
        pageSectionContent.timeline = createElement(timelineUi.WorkTimeline, timelineProps);
      }
    }
    if (readPlan.sessions && pageSections.some((section) => section.id === "sessions")) {
      stage = "compose-sessions";
      if (!sessionsUi?.WorkSessions || !sessionsRoute?.projectWorkSessions || !sessionsRoute?.createWorkSessionActions) {
        pageSectionContent.sessions = createElement(workPageUi.WorkFeatureMessage, {
          title: "Work sessions are unavailable",
          message: sessionsUiLoadError ? "Work sessions could not load. Refresh Work to try again." : "Work sessions are unavailable.",
        });
      } else {
        const sessionProps = sessionsRoute.projectWorkSessions(
          readPlan,
          sessionsResult,
          {
            requestActorId: requestedActorId,
            currentActorId: state.identityPersonId || state.actorGrants?.actorPersonId || null,
            pageRequestCurrent: requestIdentityEpoch === state.identityEpoch && isCurrentPageRequest(lifetime),
          },
          () => renderWork(timelineDate),
        );
        const sessionActions = sessionsRoute.createWorkSessionActions({
          target: workRouteRoot,
          sessionProps,
          host: {
            api,
            requestOptions,
            captureCommandContext,
            isCurrentCommand,
            recoverProtectedCommandFailure,
            adminCommandUiError,
            errorText,
            setMessage,
            refreshWork: () => renderWork(timelineDate),
          },
        });
        pageSectionContent.sessions = createElement(sessionsUi.WorkSessions, {
          ...sessionProps,
          ...sessionActions,
        });
      }
    }
    if (readPlan.taskCollection && pageSections.some((section) => section.id === "tasks")) {
      stage = "compose-task-collection";
      const filters = readVisibleTaskFilters(new URLSearchParams(window.location.search));
      const visibleTasksRead = visibleTasksRoute?.projectVisibleTasksRead?.(
        visibleTasksResult,
        adminReadIssue,
        () => renderWork(timelineDate),
      ) || { status: "error", message: "Visible tasks are unavailable. Refresh Work to try again." };
      if (!visibleTasksUi?.VisibleTasks || !visibleTasksRoute?.projectVisibleTasksRead) {
        pageSectionContent.tasks = createElement(workPageUi.WorkFeatureMessage, {
          title: "Visible tasks are unavailable",
          message: visibleTasksUiLoadError
            ? "The visible tasks interface could not load. Refresh Work to try again."
            : "The visible tasks interface is unavailable.",
        });
      } else {
        const focusableReadStates = new Set(["ready", "partial", "denied", "error"]);
        const shouldFocus = state.pendingVisibleTaskFocus && focusableReadStates.has(visibleTasksRead.status)
          ? visibleTasksRead.status === "denied" || visibleTasksRead.status === "error"
            ? "heading"
            : state.pendingVisibleTaskFocus
          : null;
        if (shouldFocus) state.pendingVisibleTaskFocus = null;
        pageSectionContent.tasks = createElement(visibleTasksUi.VisibleTasks, {
          read: visibleTasksRead,
          filters,
          displayMode: visibleTasksRoute.readVisibleTaskDisplayMode(window.location.search),
          savedViews: savedViewsFor("visible", filters, (nextFilters) => navigateVisibleTasks(nextFilters, timelineDate)),
          focusTarget: shouldFocus,
          taskDetailHref: (id) => taskDetailUrl(id),
          onOpenTask: (id) => openTaskDetail(id, "visible"),
          onDisplayModeChange: (displayMode) => {
            const currentState = window.history.state && typeof window.history.state === "object"
              ? window.history.state
              : {};
            window.history.replaceState(
              { ...currentState, novaVisibleTaskDisplay: displayMode },
              "",
              visibleTasksRoute.visibleTaskDisplayHref(window.location.href, displayMode),
            );
          },
          onApplyFilters: (nextFilters, focusTarget) =>
            navigateVisibleTasks(nextFilters, timelineDate, focusTarget),
          onNewer: () => {
            if (window.history.state?.novaVisibleTaskPage && window.history.length > 1) {
              window.history.back();
            } else {
              navigateVisibleTasks({ ...filters, cursor: "" }, timelineDate);
            }
          },
          onOlder: (cursor) => navigateVisibleTasks({ ...filters, cursor }, timelineDate),
          onRetry: () => renderWork(timelineDate),
        });
      }
    }
    stage = "mount-work-page";
    mountWorkPage(pageSections, "ready", undefined, {
      notices: workPageNotices,
      sectionContent: pageSectionContent,
      timelineDate: timelineDate || timeline.date,
      showTimelineDate: readPlan.timeline,
      timelineDateUnavailable: Boolean(timelineReadFailure),
      onLoadTimelineDate: (value) => renderWork(value),
    });
    showFeedback();
    if (readPlan.workContextView && !hasReviewRoute && !hasFocusedCollaborationRoute) {
      stage = "mount-work-context";
      const workContextHost = workSlot("context");
      mountWorkContextRoute({
        target: workContextHost,
        result: workContext,
        ui: workContextUi,
        uiLoadError: workContextUiLoadError,
        actorGrants: state.actorGrants,
        projectDepartmentCreation: workContextDepartmentProjector,
        hasPermission: hasPermissionGrant,
        getReadIssue: adminReadIssue,
        mountIsland: mountReactIsland,
        searchWorkContext: async (query) => {
          try {
            return await pageApi("/api/work-context?q=" + encodeURIComponent(query), lifetime);
          } catch (error) {
            if (error?.httpStatus === 403) {
              recoverProtectedCommandFailure(error, captureCommandContext(workContextHost),
                "Your work-context access changed. NOVA is refreshing your permissions.");
            }
            throw new Error(errorText(error));
          }
        },
        showFeatureMessage: showWorkFeatureMessage,
        runCommand: createWorkContextDepartmentCommandAction({
          target: workContextHost,
          lifetime,
          getPermissionData: () => ({ actorGrants: state.actorGrants, workContext }),
          runWorkSetupCommand,
          api,
          requestOptions,
          permissionDeniedError: () => workSetupSafeError({ code: "PERMISSION_DENIED" }),
          setMessage,
        }),
      });
    }

    if (canCreateTasks && !hasReviewRoute && !hasFocusedCollaborationRoute) {
      stage = "mount-task-composer";
      const composerRoot = workSlot("create");
      mountWorkTaskComposerRoute(composerRoot, {
        feature: taskComposerUi,
        loadError: taskComposerUiLoadError,
        lifetime,
        canCreateTask: () => hasAnyPermissionGrant(state.actorGrants, ["tasks.create"], taskCreateScopes),
        workContextResult: workContext,
        catalogResult: taskCatalogResult,
        catalogRequested: readPlan.taskCatalog,
        correctionTasksResult: tasksResult,
        correctionsRequested: readPlan.tasks,
        isCurrentPageRequest,
        runCommand: runWorkSetupCommand,
        api,
        requestOptions,
        idempotencyHeaders: taskCreateIdempotencyHeaders,
        clearIdempotency: clearTaskCreateIdempotency,
        pageChangedError: () => adminCommandUiError("The Work page changed before this task could be created."),
        permissionDeniedError: () => workSetupSafeError({ code: "PERMISSION_DENIED" }),
        billingConfirmation: taskBillingConfirmation,
        correctionConfirmation: taskCorrectionConfirmation,
        setMessage,
        refreshWork: () => renderWork(timelineDate),
      }, {
        mountReactIsland,
        showFeatureMessage: showWorkFeatureMessage,
      });
    }
    let reviewReadFailed = false;
    if (readPlan.reviews && !hasFocusedCollaborationRoute) {
      stage = "mount-reviews";
      const reviewHost = workSlot("reviews");
      const reviewProjection = projectWorkReviews({
        reviewsResult,
        reviewDetailResult,
        hasReviewRoute,
        selectedReview,
        readIssue: adminReadIssue,
        canDecide: canRenderRequestReviewActions,
        readDraft: reviewFeedbackDraft,
      });
      const reviewActions = createWorkReviewActions({
        target: reviewHost,
        api,
        requestOptions,
        captureCommandContext,
        isCurrentCommand,
        isCurrentCommandIdentity,
        recoverProtectedCommandFailure,
        clearDraft: clearReviewFeedbackDraft,
        setMessage,
        errorText,
        refreshWork: () => renderWork(timelineDate),
        openReviewContext: (assignmentId) => openReviewAssignment(assignmentId),
        saveDraft: (assignmentId, draft) => {
          const taskId = (Array.isArray(reviewsResult?.reviews) ? reviewsResult.reviews : [])
            .find((review) => review?.assignmentId === assignmentId)?.taskId;
          saveReviewFeedbackDraft(assignmentId, draft, taskId);
        },
      });
      const reviewRoute = mountWorkReviewsRoute(reviewHost, {
        feature: reviewsUi,
        loadError: reviewsUiLoadError,
        projection: reviewProjection,
        actions: reviewActions,
      }, { mountReactIsland, showWorkFeatureMessage });
      reviewReadFailed = reviewRoute.reviewReadFailed;
    }

    if ((readPlan.reviewerRequests || readPlan.handoverRequests) && !taskDetailRoute && !hasReviewRoute) {
      stage = "mount-collaboration";
      const collaborationRoot = workSlot("collaboration");
      if (workCollaborationUi?.WorkCollaborationRequests) {
        const retry = () => renderWork(timelineDate);
        const onResolveCollaboration = createWorkCollaborationResolveAction({
          target: collaborationRoot,
          host: {
            getRequestForKind: (kind, requestId) => {
              const source = kind === "reviewer" ? reviewerRequestsResult : handoverRequestsResult;
              return (Array.isArray(source?.requests) ? source.requests : [])
                .find((candidate) => candidate.id === requestId);
            },
            api,
            requestOptions,
            captureCommandContext,
            isCurrentCommand,
            isCurrentCommandIdentity,
            recoverProtectedCommandFailure,
            setMessage,
            refreshWork: () => renderWork(timelineDate),
          },
        });
        mountReactIsland(collaborationRoot, workCollaborationUi.WorkCollaborationRequests, {
          focusRequest,
          ...(readPlan.reviewerRequests && (!hasFocusedCollaborationRoute || focusRequest?.kind === "reviewer") ? {
            reviewerRequests: workCollaborationReadState(reviewerRequestsResult, "reviewer requests", retry),
          } : {}),
          ...(readPlan.handoverRequests && (!hasFocusedCollaborationRoute || focusRequest?.kind === "handover") ? {
            handoverRequests: workCollaborationReadState(handoverRequestsResult, "handover requests", retry),
          } : {}),
          onResolve: onResolveCollaboration,
        });
      } else {
        showWorkFeatureMessage(collaborationRoot, "Collaboration requests are unavailable",
          workCollaborationUiLoadError
            ? "The collaboration request interface could not load. Refresh Work to try again."
            : "The collaboration request interface is unavailable.",
        );
      }
    }

    if (readPlan.reviewerManagement && !taskDetailRoute && !hasReviewRoute && !hasFocusedCollaborationRoute) {
      stage = "mount-reviewer-management";
      const reviewerManagementRoot = workSlot("reviewer-management");
      const reviewerManagementScopes = ["organisation", "client_workstream", "group", "assigned_work"];
      const onSaveReviewer = createWorkReviewerManagementSaveAction({
        target: reviewerManagementRoot,
        canManageReviewer: () => hasAnyPermissionGrant(state.actorGrants, ["tasks.reviewer_manage"], reviewerManagementScopes),
        captureCommandContext,
        isCurrentCommand,
        isCurrentCommandIdentity,
        recoverProtectedCommandFailure,
        api,
        requestOptions,
      });
      mountWorkReviewerManagementRoute(reviewerManagementRoot, {
        feature: reviewerManagementUi,
        loadError: reviewerManagementUiLoadError,
        initialRead: reviewerManagementResult,
        lifetime,
        onSaveReviewer,
      }, {
        isCurrentPageRequest,
        mountReactIsland,
        showWorkFeatureMessage,
        readPage: (path, requestLifetime, fallback) => readOrError(pageApi(path, requestLifetime), fallback),
      });
    }

    if (readPlan.assignments && pageSections.some((section) => section.id === "assignments")) {
      stage = "mount-assignments";
      const assignmentTarget = workSlot("assignments");
      if (!myAssignmentsUi?.MyAssignments) {
        if (assignmentTarget) {
          showWorkFeatureMessage(assignmentTarget, "Your assignments are unavailable",
            myAssignmentsUiLoadError
              ? "Your assignments interface could not load. Refresh Work to try again."
              : "Your assignments interface is unavailable.");
        }
      } else {
        const assignmentFilters = readWorkAssignmentFilters(new URLSearchParams(window.location.search));
        const assignmentIssue = adminReadIssue(assignmentsResult, "your assignments");
        const shouldFocusAssignmentHeading = state.pendingWorkAssignmentFocus && !assignmentIssue;
        if (shouldFocusAssignmentHeading) state.pendingWorkAssignmentFocus = false;
        const assignmentActionCallbacks = createMyAssignmentActionsRoute({
          api,
          requestOptions,
          runActionButton,
          withSubmit,
          isCurrentCommand,
          formValues,
          setMessage,
          refreshWork: () => renderWork(timelineDate),
        });
        myAssignmentsRoute({
          authorized: readPlan.assignments,
          target: assignmentTarget,
          lifetime,
          Component: myAssignmentsUi.MyAssignments,
          result: assignmentsResult,
          filters: assignmentFilters,
          savedViews: savedViewsFor("mine", assignmentFilters, (filters) => navigateWorkAssignments(filters, timelineDate)),
          focusHeading: Boolean(shouldFocusAssignmentHeading),
          taskDetailHref: (id) => taskDetailUrl(id),
          callbacks: {
            ...assignmentActionCallbacks,
            onApplyFilters: (filters) => navigateWorkAssignments(filters, timelineDate),
            onClearFilters: () => navigateWorkAssignments({ status: "all", due: "any", search: "", cursor: "" }, timelineDate),
            onOpenTask: (id) => openTaskDetail(id, "assignment"),
            onOlder: (cursor) => navigateWorkAssignments({ ...assignmentFilters, cursor }, timelineDate),
            onNewer: () => {
              if (window.history.state?.novaWorkAssignmentPage && window.history.length > 1) {
                window.history.back();
              } else {
                navigateWorkAssignments({ ...assignmentFilters, cursor: "" }, timelineDate);
              }
            },
            onRetry: () => renderWork(timelineDate),
          },
        });
      }
    }
    restorePendingRouteScroll();
  } catch (error) {
    if (!isCurrentPageRequest(lifetime)) return;
    const diagnostic = {
      stage,
      name: typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : "Error",
      ...(typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code) ? { code: error.code } : {}),
      ...(Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599
        ? { httpStatus: error.httpStatus }
        : {}),
    };
    console.error("[NOVA Work] page load failed " + JSON.stringify(diagnostic));
    mountWorkPage([], "error", errorText(error));
    showFeedback();
    restorePendingRouteScroll();
  }
}

function workSetupPermission(actorGrants, permissionKey, target) {
  return actorGrants?.isSuperAdmin === true || hasPermissionGrant(actorGrants, permissionKey, target);
}

function workSetupSafeError(error) {
  const safe = new Error("NOVA could not complete this work-setup action.");
  if (typeof error?.code === "string") safe.code = error.code;
  return safe;
}

async function runWorkSetupCommand(source, lifetime, work, resource = "Work setup") {
  if (!source.isConnected || !isCurrentPageRequest(lifetime)) {
    throw adminCommandUiError(`The ${resource} page changed before this action could start.`);
  }
  const context = captureCommandContext(source);
  if (!isCurrentCommand(context)) throw adminCommandUiError(`The ${resource} page changed before this action could start.`);
  let result;
  try {
    result = await work();
  } catch (error) {
    if (!isCurrentCommandIdentity(context)) throw adminCommandUiError("Your session changed. Sign in again before continuing.");
    if (recoverProtectedCommandFailure(error, context, `Your ${resource.toLocaleLowerCase()} access changed. Available controls are being refreshed.`)) {
      throw adminCommandUiError("Your access changed. Refresh this section to confirm the available actions.");
    }
    if (!isCurrentCommand(context)) throw adminCommandUiError(`The ${resource} page changed before the action completed.`);
    throw workSetupSafeError(error);
  }
  if (!isCurrentCommand(context)) throw adminCommandUiError(`The ${resource} page changed before the action completed.`);
  return result;
}

async function renderWorkSetup(lifetime) {
  lifetime = lifetime || beginPageRequestLifetime();
  const readPlan = planWorkSetupReads(state.actorGrants);
  renderShell(createElement("div", { id: "work-setup-page-root" }), "work-setup");
  const pageRoot = app.querySelector("#work-setup-page-root");
  let WorkSetupPage;
  try {
    ({ WorkSetupPage } = await import("./src/pages/work-setup/WorkSetupPage.tsx"));
  } catch {
    if (isCurrentPageRequest(lifetime) && pageRoot?.isConnected) {
      pageRoot.replaceChildren(noticeElement("Work setup could not load. Refresh the page to try again.", "error"));
    }
    return;
  }
  if (!isCurrentPageRequest(lifetime) || !pageRoot || !app.contains(pageRoot)) return;
  mountReactIsland(pageRoot, WorkSetupPage, {
    showTaskCatalog: readPlan.taskCatalog,
    showBillingPolicy: readPlan.billingPolicy,
  });
  showFeedback();
  const fallbackCatalog = { entries: [], proposals: [], permissions: { view: false, propose: false, manage: false, review: false } };
  const fallbackContext = { clients: [], clientWorkstreams: [], organisationWorkstreams: [], taskCreationTargets: [], groups: [] };
  const [taskCatalog, workContext] = await Promise.all([
    readPlan.taskCatalog
      ? readOrError(pageApi("/api/task-catalog", lifetime), fallbackCatalog)
      : Promise.resolve(fallbackCatalog),
    readPlan.billingPolicy
      ? readOrError(pageApi("/api/work-context", lifetime), fallbackContext)
      : Promise.resolve(fallbackContext),
  ]);
  if (!isCurrentPageRequest(lifetime)) return;

  const content = app.querySelector("#work-setup-content");
  if (!content) return;
  if (!readPlan.hasAny) {
    content.replaceChildren(noticeElement("Your current role has no work-setup features available.", "warning"));
    return;
  }
  const actorGrants = state.actorGrants;
  const serverCatalogPermissions = taskCatalog?.permissions || {};
  const permissions = {
    view: serverCatalogPermissions.view === true && workSetupPermission(actorGrants, "tasks.catalog.view"),
    propose: serverCatalogPermissions.propose === true && workSetupPermission(actorGrants, "tasks.catalog.propose"),
    manage: serverCatalogPermissions.manage === true && workSetupPermission(actorGrants, "tasks.catalog.manage"),
    review: serverCatalogPermissions.review === true && workSetupPermission(actorGrants, "tasks.catalog.review"),
  };

  await workSetupRoute({
    content,
    lifetime,
    readPlan,
    taskCatalog,
    workContext,
    permissions,
    onRetry: () => render(),
    createCatalogActions: (catalogRoot) => workSetupActionsRoute.createCatalogActions({
      source: catalogRoot,
      lifetime,
      permissions,
    }),
    createBillingActions: (billingRoot) => workSetupActionsRoute.createBillingActions({
      source: billingRoot,
      lifetime,
      workContext,
    }),
  });
}

function navigatePersonHistory(personId) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("view", "people");
  if (personId) url.searchParams.set("person", personId);
  window.history.pushState({}, "", url);
  state.view = "people";
  render();
  window.requestAnimationFrame(focusPageHeading);
}

async function renderPeople(lifetime) {
  const personId = new URLSearchParams(window.location.search).get("person");
  const directoryContext = isPeopleDirectoryContext(personId, window.history.state, peopleWorkspaceSessionId);
  renderShell(createElement("div", { id: "people-page-root" }), "people");
  const pageRoot = app.querySelector("#people-page-root");
  if (!pageRoot || !isCurrentPageRequest(lifetime)) return;

  activePeopleWorkspace = await peoplePageRoute({ pageRoot, lifetime, personId, directoryContext });
}
async function renderAvailability(lifetime) {
  renderShell(
    createElement("div", { id: "availability-content" },
      createElement("p", { className: "small", role: "status" }, "Loading Availability agenda…")),
    "availability",
  );
  const target = app.querySelector("#availability-content");
  if (!target || !isCurrentPageRequest(lifetime)) return;

  try {
    const route = await import("./app/availability-page-route.js");
    if (!isCurrentPageRequest(lifetime) || !target.isConnected) return;
    await route.mountAvailabilityPage({
      target,
      actorGrants: state.actorGrants,
      location: window.location,
      history: window.history,
      isCurrentPageRequest: () => isCurrentPageRequest(lifetime),
      pageApi: (path) => pageApi(path, lifetime),
      refreshPermissions: () => {
        const actorPersonId = state.identityPersonId || state.actorGrants?.actorPersonId;
        if (actorPersonId) return refreshActorPermissions(state.identityEpoch, actorPersonId);
      },
      mountIsland: mountReactIsland,
      getReadIssue: adminReadIssue,
      businessTimeLabel,
      showFeedback,
      restorePendingRouteScroll,
    });
  } catch (error) {
    if (!isCurrentPageRequest(lifetime) || !target.isConnected) return;
    target.replaceChildren(noticeElement(errorText(error), "error"));
    restorePendingRouteScroll();
  }
}

async function renderAttendanceRecovery(target, lifetime, initialResult) {
  return mountAttendanceRecovery(target, lifetime, initialResult, {
    loadCandidates: async (cursor) => {
      const search = new URLSearchParams({ limit: "50" });
      if (cursor) search.set("cursor", cursor);
      return readOrError(pageApi("/api/attendance/recovery-candidates?" + search.toString(), lifetime), { candidates: [] });
    },
    isCurrentPageRequest,
    makeReadError: (response) => adminReadFailure(response, "attendance recovery candidates"),
    businessTimeLabel,
    onCorrect: (event, candidate, values) => withSubmit(event, async (context) => {
      await api("/api/attendance/recover", requestOptions("POST", {
        personId: candidate.personId,
        businessDate: candidate.businessDate,
        ...values,
      }));
      if (!isCurrentCommand(context)) return;
      setMessage("Attendance correction recorded and audit logged.");
      render();
    }),
  });
}

async function renderOperations(lifetime) {
  lifetime = lifetime || beginPageRequestLifetime();
  renderShell(
    createElement("div", { id: "operations-board" },
      createElement("p", { className: "small", role: "status" }, "Loading Operations reports…")),
    "operations",
  );
  const board = app.querySelector("#operations-board");
  if (!board || !isCurrentPageRequest(lifetime)) return;

  let operationsRoute;
  try {
    operationsRoute = await import("./app/operations-route.js");
  } catch (error) {
    if (!board.isConnected || !isCurrentPageRequest(lifetime)) return;
    board.replaceChildren(noticeElement(errorText(error), "error"));
    restorePendingRouteScroll();
    return;
  }
  if (!board.isConnected || !isCurrentPageRequest(lifetime)) return;

  const readPlan = planOperationsReads(state.actorGrants);
  const historyHref = (personId) => {
    const url = new URL("/", window.location.origin);
    url.searchParams.set("view", "people");
    if (personId) url.searchParams.set("person", personId);
    return url.pathname + url.search;
  };
  await operationsRoute.mountOperationsRoute({
    board,
    readPlan,
    readApi: (path) => pageApi(path, lifetime),
    readOrError,
    isCurrent: () => isCurrentPageRequest(lifetime) && board.isConnected,
    getReadIssue: adminReadIssue,
    getAvailabilitySources: () => planOperationsAvailabilitySources(state.actorGrants),
    createRecoverySlot: () => document.createElement("div"),
    renderRecovery: (target, initialResult) => renderAttendanceRecovery(target, lifetime, initialResult),
    mountIsland: mountReactIsland,
    onLoadError: (error) => board.replaceChildren(noticeElement(errorText(error), "error")),
    onRetry: () => render(),
    onRestoreScroll: restorePendingRouteScroll,
    onShowFeedback: showFeedback,
    personHistoryHref: historyHref,
    onViewPersonHistory: navigatePersonHistory,
    taskDetailHref: taskDetailUrl,
    onOpenTask: (taskId) => openTaskDetail(taskId, "operations"),
    taskDefinitionReference,
    downloadCsv,
    getErrorText: errorText,
  });
}
function renderAccept(lifetime) {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  window.history.replaceState({}, "", "/accept-invite");
  const notice = state.message ? { kind: state.messageKind, message: state.message } : null;
  app.innerHTML = '<div id="public-invitation-root"><p class="loading" role="status">Loading invitation…</p></div>';
  const target = app.querySelector("#public-invitation-root");
  void mountPublicInvitationAcceptanceRoute(target, lifetime, token, {
    isCurrentPageRequest,
    isTargetMounted: (candidate) => app.contains(candidate),
    mountReactIsland,
    notice,
    consumeNotice: (shownNotice) => {
      if (shownNotice && state.message === shownNotice.message) state.message = "";
    },
    api,
    requestOptions,
    publicOrigin: () => window.location.origin,
    noticeElement,
    navigateToSignIn: () => go("login"),
    navigateToNOVA: () => go(null),
  });
}

function renderForgot(lifetime) {
  app.innerHTML = '<div id="password-recovery-root"><p class="loading" role="status">Loading password recovery…</p></div>';
  const target = app.querySelector("#password-recovery-root");
  void mountPublicPasswordRecoveryRoute(target, lifetime, {
    isCurrentPageRequest,
    isTargetMounted: (candidate) => app.contains(candidate),
    mountReactIsland,
    api,
    requestOptions,
    publicOrigin: () => window.location.origin,
    noticeElement,
    navigateToSignIn: () => go("login"),
  });
}

function renderReset(lifetime) {
  const query = new URLSearchParams(window.location.search);
  const token = query.get("token");
  const linkRejected = query.has("error");
  // The reset token is kept only in this short-lived page closure, not in the
  // address bar, local storage, or a later referrer.
  window.history.replaceState({}, "", "/reset-password");
  app.innerHTML = '<div id="password-reset-root"><p class="loading" role="status">Loading password reset…</p></div>';
  const target = app.querySelector("#password-reset-root");
  void mountPublicPasswordResetRoute(target, lifetime, token, linkRejected, {
    isCurrentPageRequest,
    isTargetMounted: (candidate) => app.contains(candidate),
    mountReactIsland,
    api,
    requestOptions,
    noticeElement,
    navigateToPasswordRecovery: () => go("forgot"),
    navigateToSignIn: () => go("login"),
    completePasswordReset: () => {
      setMessage("Your password has been reset. Sign in with the new password.");
      window.history.replaceState({}, "", "/?view=login");
      state.view = "login";
      render();
    },
  });
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function currentReviewDraftActorId() {
  return state.identityPersonId || state.actorGrants?.actorPersonId || null;
}

function reviewAccessKey(read) {
  if (read?.readError || !Array.isArray(read?.grants)) return "unavailable";
  const grants = read.grants
    .filter((grant) => grant?.permissionKey === "tasks.review")
    .map((grant) => ({
      scope: grant.scope || null,
      officeId: grant.officeId || null,
      organisationDepartmentId: grant.organisationDepartmentId || null,
      clientId: grant.clientId || null,
      clientWorkstreamId: grant.clientWorkstreamId || null,
      groupId: grant.groupId || null,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify(grants);
}

function prepareReviewFeedbackDraftsForActor(grants) {
  if (!grants?.actorPersonId) return;
  reviewFeedbackDrafts.prepare(grants.actorPersonId, reviewAccessKey(grants));
}

function reviewFeedbackDraft(assignmentId) {
  return reviewFeedbackDrafts.read(currentReviewDraftActorId(), assignmentId);
}

function saveReviewFeedbackDraft(assignmentId, draft, taskId) {
  const actorId = currentReviewDraftActorId();
  if (!actorId) return;
  reviewFeedbackDrafts.save(actorId, assignmentId, draft, taskId);
}

function clearReviewFeedbackDraft(assignmentId) {
  reviewFeedbackDrafts.clear(currentReviewDraftActorId(), assignmentId);
}

function clearAllReviewFeedbackDrafts() {
  reviewFeedbackDrafts.clear();
}

let lastReviewAccessRefreshKey = null;
function refreshReviewPermissionsAfterDeniedRead() {
  const actorPersonId = currentReviewDraftActorId();
  if (!actorPersonId) return;
  const identityEpoch = state.identityEpoch;
  const key = `${identityEpoch}:${actorPersonId}:${reviewAccessKey(state.actorGrants)}`;
  if (lastReviewAccessRefreshKey === key) return;
  lastReviewAccessRefreshKey = key;
  void refreshActorPermissions(identityEpoch, actorPersonId);
}

function reconcileReviewFeedbackDraftAccess(reviewsResult, reviewDetailResult, reviewTarget, hasReviewRoute, selectedReview) {
  const actorId = currentReviewDraftActorId();
  const result = reconcileReviewDraftAccess(reviewFeedbackDrafts, actorId, {
    reviewsResult, reviewDetailResult, reviewTarget, hasReviewRoute, selectedReview,
  });
  if (result.refreshPermissions) refreshReviewPermissionsAfterDeniedRead();
}

function captureCommandContext(source) {
  return {
    identityEpoch: state.identityEpoch,
    actorPersonId: state.identityPersonId || state.actorGrants?.actorPersonId || null,
    lifetime: pageRequestLifetime,
    source,
  };
}

function isCurrentCommandIdentity(context) {
  return isCommandIdentityCurrent(context, {
    identityEpoch: state.identityEpoch,
    actorPersonId: state.identityPersonId || state.actorGrants?.actorPersonId || null,
  });
}

function isCurrentCommand(context) {
  return isCommandContextCurrent(context, {
    identityEpoch: state.identityEpoch,
    actorPersonId: state.identityPersonId || state.actorGrants?.actorPersonId || null,
    pageLifetimeCurrent: Boolean(context.lifetime && isCurrentPageRequest(context.lifetime)),
    sourceConnected: Boolean(context.source?.isConnected && app.contains(context.source)),
  });
}

async function runActionButton(button, handler) {
  const context = captureCommandContext(button);
  button.disabled = true;
  try {
    await handler(context);
  } catch (error) {
    if (!isCurrentCommandIdentity(context)) return;
    if (recoverProtectedCommandFailure(error, context)) return;
    if (!isCurrentCommand(context)) return;
    setMessage(errorText(error), "error");
    showFeedback();
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function refreshActorPermissions(identityEpoch, actorPersonId, recoveryFeedback) {
  try {
    const grants = await api("/api/me/permission-grants");
    if (state.identityEpoch !== identityEpoch || state.identityPersonId !== actorPersonId || !state.session) return;
    if (grants.actorPersonId !== actorPersonId) {
      state.session = null;
      state.actorGrants = null;
      state.view = null;
      clearIdentityScopedState();
      render();
      return;
    }
    state.actorGrants = grants;
    prepareReviewFeedbackDraftsForActor(grants);
  } catch (error) {
    if (state.identityEpoch !== identityEpoch || state.identityPersonId !== actorPersonId) return;
    if (error?.httpStatus === 401 || error?.httpStatus === 403) {
      state.session = null;
      state.actorGrants = null;
      state.view = null;
      clearIdentityScopedState();
    } else {
      state.actorGrants = {
        actorPersonId,
        grants: [],
        isSuperAdmin: false,
        readError: error?.code || "PERMISSION_REFRESH_FAILED",
      };
      prepareReviewFeedbackDraftsForActor(state.actorGrants);
    }
  }
  if (state.identityEpoch === identityEpoch && state.identityPersonId === actorPersonId) {
    if (recoveryFeedback && state.session) setMessage(recoveryFeedback, "error");
    render();
  }
  else if (!state.session) render();
}

function recoverProtectedCommandFailure(error, context, feedbackMessage) {
  if (!state.session || (error?.httpStatus !== 401 && error?.httpStatus !== 403)) return false;
  if (context && !isCurrentCommandIdentity(context)) return false;
  const identityEpoch = state.identityEpoch;
  const actorPersonId = state.identityPersonId || state.actorGrants?.actorPersonId || null;
  if (error.httpStatus === 401) {
    state.session = null;
    state.actorGrants = null;
    state.view = null;
    clearIdentityScopedState();
  } else {
    if (feedbackMessage) setMessage(feedbackMessage, "error");
    state.actorGrants = null;
    state.adminData = null;
  }
  render();
  if (error.httpStatus === 403 && actorPersonId) void refreshActorPermissions(identityEpoch, actorPersonId, feedbackMessage);
  return true;
}

async function withSubmit(event, work) {
  event.preventDefault();
  return withSubmitForm(event.currentTarget, work);
}

async function withSubmitForm(form, work) {
  const context = captureCommandContext(form);
  const inlineFeedback = form.querySelector("[data-submit-feedback]");
  if (inlineFeedback) {
    inlineFeedback.hidden = true;
    inlineFeedback.textContent = "";
  }
  const button = form.querySelector("[type=submit]");
  if (button) button.disabled = true;
  try {
    await work(context);
  } catch (error) {
    if (!isCurrentCommandIdentity(context)) return;
    if (error?.httpStatus === 403 && context.source?.dataset.reviewAssignmentId) {
      clearReviewFeedbackDraft(context.source.dataset.reviewAssignmentId);
    }
    if (recoverProtectedCommandFailure(error, context)) return;
    if (!isCurrentCommand(context)) return;
    if (inlineFeedback?.isConnected) {
      inlineFeedback.className = "notice error";
      inlineFeedback.textContent = errorText(error);
      inlineFeedback.hidden = false;
    } else {
      setMessage(errorText(error), "error");
      showFeedback();
    }
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function submitInvite(event) {
  const form = event.currentTarget;
  return withSubmit(event, async (context) => {
    const values = formValues(form);
    const result = await api("/api/people/invitations", requestOptions("POST", values));
    if (!isCurrentCommand(context)) return;
    form.reset();
    reflectInvitationDelivery(result);
    render();
  });
}

function reflectInvitationDelivery(result, action = "create") {
  const feedback = describeInvitationFeedback(result, action);
  setMessage(feedback.message, feedback.kind);
  if (feedback.navigateToSettings) state.view = "settings";
  return feedback.delivery;
}

async function signOut() {
  try {
    await api("/api/auth/sign-out", requestOptions("POST"));
  } catch {
    // A stale cookie should still leave this browser in the signed-out state.
  }
  state.session = null;
  state.actorGrants = null;
  state.view = null;
  clearAllReviewFeedbackDrafts();
  clearIdentityScopedState();
  setMessage("You have signed out.");
  go(null);
}

async function refreshSession() {
  const previousPersonId = state.identityPersonId || state.uiPreferencePersonId || state.actorGrants?.actorPersonId;
  state.actorGrants = null;
  try {
    const response = await fetch("/api/auth/get-session", requestOptions("GET"));
    if (!response.ok) {
      state.session = null;
      clearIdentityScopedState();
      return;
    }
    const result = await response.json().catch(() => null);
    state.session = result && result.user ? result.user : null;
    if (!state.session) {
      clearIdentityScopedState();
      return;
    }
    const [grants, saved] = await Promise.all([
      readOrError(api("/api/me/permission-grants"), {
        actorPersonId: null,
        grants: [],
        isSuperAdmin: false,
      }),
      readOrError(api("/api/me/ui-preferences"), {
        schemaVersion: UI_PREFERENCE_SCHEMA_VERSION,
        revision: 0,
        appearance: { ...DEFAULT_APPEARANCE },
        workspace: normalizeWorkspace(DEFAULT_WORKSPACE),
        writable: false,
      }),
    ]);
    if (previousPersonId && grants.actorPersonId !== previousPersonId) {
      clearIdentityScopedState();
    }
    state.actorGrants = grants;
    prepareReviewFeedbackDraftsForActor(grants);
    if (grants.readError || !grants.actorPersonId) {
      const setupToken = state.bootstrapToken;
      const founderSetupStillActive = state.session?.emailVerified === false &&
        grants.readError === "ACCOUNT_NOT_OPERATIONAL" && Boolean(setupToken) &&
        String(state.session?.email || "").trim().toLowerCase() === state.bootstrapFounderEmail;
      clearIdentityScopedState();
      if (founderSetupStillActive) {
        state.bootstrapToken = setupToken;
        state.bootstrapFounderEmail = String(state.session?.email || "").trim().toLowerCase();
      }
      state.actorGrants = grants;
      state.uiPreferences = {
        appearance: { ...DEFAULT_APPEARANCE },
        workspace: normalizeWorkspace(DEFAULT_WORKSPACE),
      };
      state.uiPreferenceRevision = 0;
      state.uiPreferencePersonId = null;
      state.uiPreferenceWritable = false;
      state.uiPreferenceReadStatus = "access-lost";
      state.uiPreferenceSaveStatus = "idle";
      state.uiPreferenceConflict = null;
      return;
    }
    state.bootstrapToken = "";
    state.bootstrapFounderEmail = "";
    state.identityPersonId = grants.actorPersonId;
    state.uiPreferencePersonId = grants.actorPersonId;
    const preferenceEpoch = state.identityEpoch;
    if (preferenceEpoch !== state.identityEpoch || state.uiPreferencePersonId !== grants.actorPersonId) return;
    if (saved.readError) {
      state.uiPreferences = {
        appearance: normalizeAppearance(saved.appearance),
        workspace: normalizeWorkspace(saved.workspace),
      };
      state.uiPreferenceRevision = 0;
      state.uiPreferenceWritable = false;
      state.uiPreferenceReadStatus = personalPreferenceReadStatus(saved);
      state.uiPreferenceSaveStatus = "idle";
      if (saved.readHttpStatus === 401 || saved.readHttpStatus === 403) {
        recoverProtectedCommandFailure(
          { code: saved.readError, httpStatus: saved.readHttpStatus },
          { identityEpoch: preferenceEpoch, actorPersonId: grants.actorPersonId },
          "Your personal settings access changed. Refresh to check current access.",
        );
        if (preferenceEpoch !== state.identityEpoch) return;
      }
    } else if (saved.personId !== grants.actorPersonId) {
      state.uiPreferenceWritable = false;
      state.uiPreferenceReadStatus = "access-lost";
      state.uiPreferenceSaveStatus = "idle";
      return;
    } else {
      state.uiPreferences = {
        appearance: normalizeAppearance(saved.appearance),
        workspace: normalizeWorkspace(saved.workspace),
      };
      state.uiPreferenceRevision = Number.isInteger(saved.revision) ? saved.revision : 0;
      state.uiPreferenceWritable = saved.writable === true;
      state.uiPreferenceReadStatus = personalPreferenceReadStatus(saved);
      state.uiPreferenceSaveStatus = state.uiPreferenceWritable ? "saved" : "idle";
    }
    state.uiPreferenceConflict = null;
    if (preferenceEpoch !== state.identityEpoch || state.uiPreferencePersonId !== grants.actorPersonId) return;
  } catch {
    state.session = null;
    state.actorGrants = null;
    clearIdentityScopedState();
  }
}

function canOpenView(view) {
  return canAccessWorkspaceDestination(view, state.actorGrants, new URLSearchParams(window.location.search));
}

function renderUnavailableView(view) {
  const label = ({ today: "Today", work: "Work", "work-setup": "Work setup", operations: "Operations", admin: "Administration", invite: "Invitations" })[view] || "This feature";
  const accessUnresolved = Boolean(state.actorGrants?.readError || !state.actorGrants?.actorPersonId);
  renderShell(createElement("div", { id: "unavailable-page-root" }), "");
  const target = app.querySelector("#unavailable-page-root");
  if (target) {
    mountReactIsland(target, RouteUnavailablePage, {
      label,
      accessUnresolved,
      onReturnToWorkspace: () => go(workspaceHomeView()),
    });
  }
  showFeedback();
  restorePendingRouteScroll();
}

function workspaceHomeView() {
  const selected = normalizeWorkspace(state.uiPreferences.workspace).homeView;
  return selected !== "auto" && canAccessWorkspaceDestination(selected, state.actorGrants)
    ? selected
    : resolveWorkspaceHome(state.actorGrants);
}

function render() {
  activePeopleWorkspace = null;
  clearReactIslands();
  applyAppearanceTokens(normalizeAppearance(state.uiPreferences.appearance));
  document.body?.classList.remove("workspace-mode");
  app.setAttribute("role", "main");
  const lifetime = beginPageRequestLifetime();
  const publicNavigation = document.querySelector(".site-nav");
  if (publicNavigation) publicNavigation.hidden = Boolean(state.session);
  const query = new URLSearchParams(window.location.search);
  if (query.get("gmail") === "connected") {
    state.emailOAuthResult = {
      status: "pending",
      message: "NOVA returned from Google. This return status is not independent proof of authorization; refresh connections and send a test email before activating a sender.",
    };
    window.history.replaceState({}, "", "/?view=settings");
    state.view = "settings";
  } else if (query.get("gmail") === "failed") {
    state.emailOAuthResult = {
      status: "error",
      message: errorMessages[query.get("error")] || "Google connection did not complete. Try connecting again.",
    };
    window.history.replaceState({}, "", "/?view=settings");
    state.view = "settings";
  }
  const requestedView = state.view || routeView();
  const view = requestedView || (state.session ? workspaceHomeView() : null);
  if (view !== "deploy") invalidateDeploymentProbe();
  if (!state.session || view !== "admin") state.pendingAdminCommandFocus = false;
  if (view !== "settings") state.emailOAuthResult = null;
  if (view === "accept") return renderAccept(lifetime);
  if (view === "forgot") return renderForgot(lifetime);
  if (view === "reset") return renderReset(lifetime);
  if (view === "deploy") return renderDeployment(lifetime);
  if (view === "setup") return renderSetup(lifetime);
  if (view === "login") return renderLogin(lifetime);
  if (!state.session) {
    state.emailOAuthResult = null;
    state.pendingRouteScrollY = null;
    state.pendingRouteFocusTaskId = null;
    return renderLanding(lifetime);
  }
  if (!canOpenView(view)) {
    state.pendingAdminCommandFocus = false;
    state.emailOAuthResult = null;
    return renderUnavailableView(view);
  }
  if (view === "today") return renderAttendance(lifetime);
  if (view === "work") return renderWork(undefined, lifetime);
  if (view === "work-setup") return renderWorkSetup(lifetime);
  if (view === "operations") return renderOperations(lifetime);
  if (view === "availability") return renderAvailability(lifetime);
  if (view === "people") return renderPeople(lifetime);
  if (view === "notifications") return renderNotifications(lifetime);
  if (view === "invite") return renderInvite(lifetime);
  if (view === "admin" || adminAreaForView(view, state.actorGrants)) return renderAdmin(lifetime, view);
  return renderSettings(lifetime);
}

window.addEventListener("popstate", (event) => {
  if (activePeopleWorkspace?.handlePopState(event)) {
    window.requestAnimationFrame(focusPageHeading);
    return;
  }
  state.view = null;
  state.pendingRouteScrollY = Number.isFinite(event.state?.novaReturnScrollY)
    ? event.state.novaReturnScrollY
    : null;
  state.pendingRouteFocusTaskId = typeof event.state?.novaReturnFocusTaskId === "string"
    ? event.state.novaReturnFocusTaskId
    : null;
  state.pendingRouteFocusTaskSource = typeof event.state?.novaReturnFocusTaskSource === "string"
    ? event.state.novaReturnFocusTaskSource
    : null;
  render();
  window.requestAnimationFrame(focusPageHeading);
});

installPermissionRefreshOnResume({
  documentRef: document,
  windowRef: window,
  readIdentity: () => state.session && state.identityPersonId
    ? { identityEpoch: state.identityEpoch, actorPersonId: state.identityPersonId }
    : null,
  refresh: ({ identityEpoch, actorPersonId }) => refreshActorPermissions(identityEpoch, actorPersonId),
});

refreshSession().then(render);
