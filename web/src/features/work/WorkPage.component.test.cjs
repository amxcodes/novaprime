const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { WorkPage } = require("./WorkPage.tsx");
const { createWorkPageSections } = require("./page-contracts.ts");

const allReads = {
  assignments: true,
  sessions: true,
  timeline: true,
  reviews: true,
  reviewerRequests: true,
  handoverRequests: true,
  workContext: true,
  workContextView: true,
  taskDetail: true,
  tasks: true,
  taskCollection: true,
  taskCatalog: true,
  attendance: true,
  reviewerManagement: true,
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(WorkPage, {
    title: "Work",
    description: "Work available under your access.",
    sections: createWorkPageSections(allReads, { canCreateTasks: true, hasReviewRoute: false, taskDetailRoute: false }),
    showTimelineDate: true,
    timelineDate: "2026-10-03",
    onLoadTimelineDate: () => {},
    ...overrides,
  }));
}

test("renders authorized Work features in route-owned stable slots and preserves the established order", () => {
  const markup = render();
  const order = ["assignments", "tasks", "reviews", "collaboration", "reviewer-management", "create", "sessions", "timeline", "context"]
    .map((id) => markup.indexOf(`data-section="${id}"`));

  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual([...order].sort((left, right) => left - right), order);
  for (const id of ["assignments", "tasks", "reviews", "collaboration", "reviewer-management", "create", "sessions", "timeline", "context"]) {
    assert.match(markup, new RegExp(`data-work-slot="${id}"`));
  }
  assert.match(markup, /<h1 id="work-page-title">Work<\/h1>/);
  assert.match(markup, /Recorded work sessions/);
  assert.match(markup, /id="feedback"/);
  assert.match(markup, /id="work-timeline-date"[^>]*value="2026-10-03"/);
});

test("route planning excludes unauthorized modules and narrows direct review/task-detail routes", () => {
  const assignedOnly = createWorkPageSections({
    ...allReads,
    taskCollection: false,
    reviews: false,
    reviewerRequests: false,
    handoverRequests: false,
    reviewerManagement: false,
    workContextView: false,
    sessions: false,
    timeline: false,
    attendance: false,
  }, { canCreateTasks: false, hasReviewRoute: false, taskDetailRoute: false });
  assert.deepEqual(assignedOnly.map(({ id }) => id), ["assignments"]);
  assert.deepEqual(
    createWorkPageSections(allReads, { canCreateTasks: true, hasReviewRoute: true, taskDetailRoute: false }).map(({ id }) => id),
    ["reviews"],
  );
  assert.deepEqual(
    createWorkPageSections(allReads, {
      canCreateTasks: true,
      hasReviewRoute: false,
      taskDetailRoute: false,
      focusedCollaborationRequest: true,
    }).map(({ id }) => id),
    ["collaboration"],
  );
  assert.deepEqual(
    createWorkPageSections(allReads, { canCreateTasks: true, hasReviewRoute: true, taskDetailRoute: true }).map(({ id }) => id),
    ["task-detail"],
  );
});

test("renders supplied section content in its authorized section and keeps fallback slots for unconverted sections", () => {
  const content = React.createElement("article", { "data-work-feature": "timeline" }, "Timeline feature");
  const markup = render({
    sections: [
      { id: "timeline" },
      { id: "sessions", heading: "Recorded work sessions" },
    ],
    sectionContent: { timeline: content },
  });

  assert.match(markup, /data-section="timeline"><article data-work-feature="timeline">Timeline feature<\/article><\/div>/);
  assert.doesNotMatch(markup, /data-work-slot="timeline"/);
  assert.match(markup, /data-work-slot="sessions"/);
});

test("does not render supplied content for a section omitted by the host plan", () => {
  const markup = render({
    sections: [{ id: "assignments" }],
    sectionContent: {
      timeline: React.createElement("article", { "data-work-feature": "timeline" }, "Timeline feature"),
    },
  });

  assert.match(markup, /data-work-slot="assignments"/);
  assert.doesNotMatch(markup, /data-section="timeline"|data-work-feature="timeline"|data-work-slot="timeline"/);
});

test("owns the route header, timeline action and feature fallback presentation in React", () => {
  const markup = render({
    title: "Pending review",
    description: undefined,
    sections: [{ id: "reviews" }],
    notices: [{ id: "attendance-read", kind: "warning", message: "Attendance is unavailable." }],
  });
  assert.match(markup, /<h1 id="work-page-title">Pending review<\/h1>/);
  assert.match(markup, /Attendance is unavailable\./);
  assert.match(markup, /data-work-slot="reviews"/);
  assert.match(markup, /<button[^>]*type="submit"[^>]*><span>Load day<\/span><\/button>/);
  assert.doesNotMatch(markup, /data-work-slot="context"|data-work-slot="create"/);
});

test("the route host keeps API and capability orchestration while React owns timeline and session sections", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8");
  const readsRoute = fs.readFileSync(path.join(__dirname, "../../../app/work-read-route.js"), "utf8");
  const featureLoader = fs.readFileSync(path.join(__dirname, "../../../app/work-route-features.js"), "utf8");
  const assignmentsRoute = fs.readFileSync(path.join(__dirname, "../../../app/my-assignments-route.js"), "utf8");
  const sessionsRoute = fs.readFileSync(path.join(__dirname, "../../../app/work-sessions-route.js"), "utf8");
  const routeContext = fs.readFileSync(path.join(__dirname, "../../../app/work-route.js"), "utf8");
  const timelineActionsRoute = fs.readFileSync(path.join(__dirname, "../../../app/work-timeline-actions-route.ts"), "utf8");
  const visibleTasksRoute = fs.readFileSync(path.join(__dirname, "../../../app/visible-tasks-route.js"), "utf8");
  const reviewerManagementRoute = fs.readFileSync(path.join(__dirname, "../../../app/work-reviewer-management-route.js"), "utf8");
  const reviewerManagementActionsRoute = fs.readFileSync(path.join(__dirname, "../../../app/work-reviewer-management-actions-route.ts"), "utf8");
  const workContextActionsRoute = fs.readFileSync(path.join(__dirname, "../../../app/work-context-actions-route.ts"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "../../app-shell/LegacyRouteShell.tsx"), "utf8");
  const page = fs.readFileSync(path.join(__dirname, "./WorkPage.tsx"), "utf8");
  const featureIndex = fs.readFileSync(path.join(__dirname, "./index.ts"), "utf8");
  const start = app.indexOf("async function renderWork(");
  const end = app.indexOf("function workSetupPermission(", start);
  const route = app.slice(start, end);

  assert.match(route, /renderShell\(createElement\("div", \{ id: "work-route-root" \}\), "work"\);/);
  assert.match(route, /const workSlot = \(id\) => workRouteRoot\.querySelector\(\`\[data-work-slot=/);
  assert.match(route, /sectionContent: options\.sectionContent/);
  assert.match(route, /if \(!hasReviewRoute && !hasFocusedCollaborationRoute && \(readPlan\.timeline \|\| readPlan\.attendance\)\) \{\s*if \(!timelineUi \|\| typeof timelineRoute\?\.projectWorkTimelineProps !== "function"\)/,
    "the timeline UI and projector are composed only when the host read plan permits it and the route exposes that section");
  assert.match(route, /timelineRoute\.projectWorkTimelineProps\(\{\s*readPlan,\s*timelineResult: timeline/,
    "the feature receives a host-projected allowlisted state rather than raw API responses");
  assert.match(route, /pageSectionContent\.timeline = createElement\(timelineUi\.WorkTimeline, timelineProps\)/,
    "the host passes the authorized timeline into the typed WorkPage composition");
  assert.match(route, /pageSectionContent\.timeline = createElement\(workPageUi\.WorkFeatureMessage/,
    "timeline load failures stay within the same feature-owned section");
  assert.match(routeContext, /timeline:\s*canLoadFeature\(\(readPlan\.timeline \|\| readPlan\.attendance\) && standardFeatureRoute\)/,
    "task-detail and review routes do not request the timeline feature chunk");
  assert.match(featureLoader, /timeline: \(\) => Promise\.all\(\[\s*import\("\.\.\/src\/features\/work\/timeline\/WorkTimeline\.tsx"\),\s*import\("\.\/work-timeline-route\.js"\),\s*\]\)/,
    "the visible timeline loads its feature component and projector together");
  assert.match(route, /const timelineRoute = loadedWorkRouteFeatures\.timeline\?\.route \|\| null;/,
    "the authorized lazy result supplies the projector to the existing host composition");
  const appImports = fs.readFileSync(path.join(__dirname, "../../../app.js"), "utf8").split("async function renderWork(")[0];
  assert.doesNotMatch(appImports, /from ["']\.\/app\/work-timeline-route\.js["']/,
    "the timeline projector is absent from the eager application entry imports");
  assert.doesNotMatch(route, /const timelineRoot = workSlot\("timeline"\)|mountReactIsland\(timelineRoot, timelineUi\.WorkTimeline/,
    "the timeline no longer needs a nested React root inside a page-owned slot");
  assert.match(route, /createWorkTimelineCorrectionAction\(\{\s*target: workRouteRoot,[\s\S]*?canAdjustTimeline,[\s\S]*?captureCommandContext,[\s\S]*?isCurrentCommand,/,
    "the host binds timeline correction to its live route, capability, and identity guards");
  assert.match(route, /const canAdjustTimeline = \(\) => hasAnyPermissionGrant\([\s\S]*?\["work\.timeline_adjust_own"\],[\s\S]*?timelineCorrectionScopes/,
    "time correction remains protected by the effective permission grant");
  assert.match(timelineActionsRoute, /api\("\/api\/work\/timeline-adjustments", requestOptions\("POST", correction\)\)/,
    "the feature-owned action adapter retains the existing time-correction endpoint and payload");
  assert.match(route, /if \(readPlan\.sessions && pageSections\.some\(\(section\) => section\.id === "sessions"\)\)/,
    "session content is prepared only when the route plan and visible section both allow it");
  assert.match(route, /pageSectionContent\.sessions = createElement\(workPageUi\.WorkFeatureMessage, \{[\s\S]*?title: "Work sessions are unavailable"/,
    "a failed lazy import remains visible inside the page-owned sessions section");
  assert.match(route, /const sessionProps = sessionsRoute\.projectWorkSessions\([\s\S]*?pageSectionContent\.sessions = createElement\(sessionsUi\.WorkSessions, \{\s*\.\.\.sessionProps,/,
    "sessions use the existing identity-bound presentation projection as page content");
  assert.match(route, /requestActorId: requestedActorId,\s*currentActorId: state\.identityPersonId \|\| state\.actorGrants\?\.actorPersonId \|\| null,\s*pageRequestCurrent: requestIdentityEpoch === state\.identityEpoch && isCurrentPageRequest\(lifetime\)/,
    "the projection still rejects stale page and actor reads");
  assert.doesNotMatch(route, /const sessionsRoot = workSlot\("sessions"\)|mountReactIsland\(sessionsRoot, sessionsUi\.WorkSessions/,
    "sessions no longer mount as a nested React root");
  assert.match(route, /sessionsRoute\.createWorkSessionActions\(\{\s*target: workRouteRoot,\s*sessionProps,\s*host:/,
    "the host binds the session feature to its live route and projected read");
  assert.match(sessionsRoute, /sessionProps\.eligibility\?\.\[capability\] !== true/,
    "pause and stop recheck the projected capability in the route adapter");
  assert.match(sessionsRoute, /api\(`\/api\/work-sessions\/\$\{encodeURIComponent\(sessionId\)\}\/\$\{action\}`/,
    "pause and stop keep the existing guarded POST command contract");
  assert.match(sessionsRoute, /recoverProtectedCommandFailure\(error, context, "Your work-session access changed\./,
    "session permission failures retain the existing 401/403 recovery context");
  assert.match(sessionsRoute, /if \(!isCurrentCommand\(context\)\) throw adminCommandUiError\("The Work page changed before this action completed\."\)/,
    "pause and stop reject results after route or identity changes");
  assert.match(route, /const workPageUiPromise = Promise\.all\(\[\s*import\("\.\/src\/features\/work\/WorkPage\.tsx"\),\s*import\("\.\/src\/features\/work\/page-contracts\.ts"\),/,
    "the Work shell loads without pulling feature components through the aggregate barrel");
  assert.doesNotMatch(route, /src\/features\/work\/index\.ts/,
    "the route avoids importing the broad Work feature barrel");
  assert.match(routeContext, /assignments:\s*canLoadFeature\(readPlan\.assignments && standardFeatureRoute\)/,
    "My Assignments loads only for its planned, visible collection route");
  assert.match(routeContext, /savedTaskViews:\s*canLoadFeature\(\(readPlan\.assignments \|\| readPlan\.taskCollection\) && standardFeatureRoute\)/,
    "Work saved-view controls load only when a supported collection is visible");
  assert.match(routeContext, /workContext:\s*canLoadFeature\(readPlan\.workContextView && standardFeatureRoute\)/,
    "Work Context UI is not loaded behind an unrelated direct-review route");
  assert.match(routeContext, /taskComposer:\s*canLoadFeature\(canCreateTasks && standardFeatureRoute\)/,
    "the task composer is not loaded when a direct-review route hides its section");
  assert.match(routeContext, /sessions:\s*canLoadFeature\(readPlan\.sessions && standardFeatureRoute\)/,
    "session UI is not loaded when a direct-review route hides its section");
  assert.match(routeContext, /timeline:\s*canLoadFeature\(\(readPlan\.timeline \|\| readPlan\.attendance\) && standardFeatureRoute\)/,
    "timeline UI is not loaded when a direct-review route hides its section");
  assert.match(routeContext, /collaboration:\s*canLoadFeature\(\(readPlan\.reviewerRequests \|\| readPlan\.handoverRequests\) && collaborationSectionRoute\)/,
    "collaboration UI is not loaded when a direct-review route hides its section");
  assert.match(routeContext, /visibleTasks:\s*canLoadFeature\(readPlan\.taskCollection && standardFeatureRoute\)/,
    "VisibleTasks and its allowlist projector are dynamically imported only for a planned task collection");
  assert.match(featureLoader, /visibleTasks: \(\) => Promise\.all\(\[\s*import\("\.\.\/src\/features\/work\/VisibleTasks\.tsx"\),\s*import\("\.\/visible-tasks-route\.js"\),/,
    "VisibleTasks and its allowlist projector stay in the same lazy feature bundle");
  assert.doesNotMatch(featureLoader, /readPlan|hasAnyPermissionGrant|hasPermissionGrant|actorGrants/,
    "the import boundary does not duplicate the host's permission evaluator");
  assert.doesNotMatch(app, /import\("\.\/src\/features\/work\/index\.ts"\)/,
    "no host path imports all Work UI modules through the aggregate barrel");
  assert.match(app, /await import\("\.\/src\/features\/work\/SettingsSavedTaskViews\.tsx"\)/,
    "Settings loads its saved-view component directly when its editor is needed");
  assert.match(readsRoute, /read\(nonFocusedFeatureReads && readPlan\.assignments,[\s\S]*?workAssignmentReadUrl\(assignmentFilter\)/,
    "direct review routes do not fetch the hidden My Assignments collection");
  assert.match(readsRoute, /read\(nonFocusedFeatureReads && readPlan\.sessions,[\s\S]*?"\/api\/work-sessions\/mine"/,
    "direct review routes do not fetch hidden session data");
  assert.match(readsRoute, /read\(nonFocusedFeatureReads && readPlan\.taskCollection,[\s\S]*?visibleTaskReadUrl\(visibleTaskFilter\)/,
    "direct review routes do not fetch hidden visible-task data");
  assert.match(readsRoute, /read\(nonFocusedFeatureReads && readPlan\.workContext,[\s\S]*?"\/api\/work-context"/,
    "direct review routes do not fetch hidden Work Context data");
  assert.doesNotMatch(featureIndex, /export\s*\{\s*VisibleTasks\s*\}\s*from/,
    "the Work feature barrel does not eagerly pull VisibleTasks into the route chunk");
  assert.match(route, /if \(readPlan\.taskCollection && pageSections\.some\(\(section\) => section\.id === "tasks"\)\)/,
    "task content is passed only when the host plan includes the tasks section");
  assert.match(route, /if \(!visibleTasksUi\?\.VisibleTasks \|\| !visibleTasksRoute\?\.projectVisibleTasksRead\) \{\s*pageSectionContent\.tasks = createElement\(workPageUi\.WorkFeatureMessage/,
    "an import or missing-export failure renders inside the planned tasks section");
  assert.match(route, /pageSectionContent\.tasks = createElement\(visibleTasksUi\.VisibleTasks, \{/,
    "the authorized component is composed as page section content");
  assert.doesNotMatch(route, /workPageUi\.VisibleTasks|const visibleTasksHost = workSlot\("tasks"\)|mountReactIsland\(visibleTasksHost/,
    "VisibleTasks no longer mounts as a nested React root");
  assert.match(route, /savedViews: savedViewsFor\("visible", filters,/,
    "the section retains its existing saved-view composition");
  assert.match(route, /visibleTasksRoute\?\.projectVisibleTasksRead\?\.\(\s*visibleTasksResult,\s*adminReadIssue,/,
    "the host projects the bounded authorized API page before passing it to React");
  assert.match(route, /focusableReadStates\.has\(visibleTasksRead\.status\)[\s\S]*?visibleTasksRead\.status === "denied" \|\| visibleTasksRead\.status === "error"[\s\S]*?:\s*state\.pendingVisibleTaskFocus/,
    "route changes retain pending focus and send read failures to the visible feature heading");
  assert.match(visibleTasksRoute, /function projectTask\(value\)/,
    "the collection adapter allowlists task summaries at the feature boundary");
  assert.match(route, /onOpenTask: \(id\) => openTaskDetail\(id, "visible"\)/);
  assert.match(route, /onApplyFilters: \(nextFilters, focusTarget\) =>\s*navigateVisibleTasks\(nextFilters, timelineDate, focusTarget\)/);
  assert.match(route, /onOlder: \(cursor\) => navigateVisibleTasks\(\{ \.\.\.filters, cursor \}, timelineDate\)/,
    "visible-task paging continues through the existing host history adapter");
  assert.match(route, /onNewer: \(\) => \{\s*if \(window\.history\.state\?\.novaVisibleTaskPage && window\.history\.length > 1\) \{\s*window\.history\.back\(\)/,
    "the prior-page browser-history behavior remains unchanged");
  assert.match(route, /await readWorkRouteData\(\{[\s\S]*?lifetime,[\s\S]*?pageApi,/,
    "the app route host supplies its authenticated page reader and request lifetime to the Work read adapter");
  assert.match(route, /if \(readPlan\.workContextView && !hasReviewRoute && !hasFocusedCollaborationRoute\) \{\s*const workContextHost = workSlot\("context"\);\s*mountWorkContextRoute\(\{\s*target: workContextHost,\s*result: workContext,\s*ui: workContextUi,\s*uiLoadError: workContextUiLoadError,\s*actorGrants: state\.actorGrants,[\s\S]*?runCommand: createWorkContextDepartmentCommandAction\(\{/,
    "the visible feature receives the host read and current-grant action boundary");
  assert.match(route, /getPermissionData: \(\) => \(\{ actorGrants: state\.actorGrants, workContext \}\)/,
    "Work Context commands read the latest host grants and current projected context");
  assert.match(workContextActionsRoute, /runWorkSetupCommand\(\s*target,\s*lifetime,[\s\S]*?if \(!permission\(getPermissionData\(\)\)\) throw permissionDeniedError\(\)/,
    "the action adapter applies the shared Work page guard before its live permission check");
  assert.match(workContextActionsRoute, /return api\(path, requestOptions\(method, payload\)\)/,
    "the action adapter preserves the host API transport and request payload");
  assert.match(route, /if \(readPlan\.assignments && pageSections\.some\(\(section\) => section\.id === "assignments"\)\) \{[\s\S]*?myAssignmentsRoute\(\{\s*authorized: readPlan\.assignments/,
    "the Work host invokes the assignment adapter only after the existing plan and route both expose it");
  assert.match(route, /if \(!myAssignmentsUi\?\.MyAssignments\) \{[\s\S]*?showWorkFeatureMessage\(assignmentTarget, "Your assignments are unavailable"/,
    "a failed My Assignments chunk stays local to the already-authorized assignment section");
  assert.match(app, /readAssignmentCandidates: \(assignmentId, lifetime\) => readOrError\([\s\S]*?pageApi\("\/api\/task-assignments\/" \+ encodeURIComponent\(assignmentId\) \+ "\/candidates", lifetime\)/,
    "candidate endpoint transport stays in the application host");
  assert.match(assignmentsRoute, /projectMyAssignmentsRead\(result, readIssue\)/);
  assert.match(assignmentsRoute, /if \(authorized !== true \|\| !target \|\| !Component \|\| !isCurrentPageRequest\(lifetime\)\) return false/);
  assert.match(assignmentsRoute, /mountReactIsland\(target, Component, \{/);
  assert.doesNotMatch(route, /mountReactIsland\(assignmentHost|candidateReadCache|projectAssignmentCandidateRead/,
    "assignment projection and mount wiring live at their feature route boundary");
  assert.match(route, /if \(readPlan\.reviewerManagement && !taskDetailRoute && !hasReviewRoute && !hasFocusedCollaborationRoute\) \{[\s\S]*?mountWorkReviewerManagementRoute\(reviewerManagementRoot, \{/,
    "the host preserves the planned reviewer section gate before mounting its route adapter");
  assert.match(reviewerManagementRoute, /\/api\/task-assignments\/reviewer-management\?/);
  assert.match(reviewerManagementRoute, /host\.mountReactIsland\(target, Component, \{/);
  assert.match(reviewerManagementRoute, /readError: "STALE_PAGE_REQUEST"/);
  assert.match(route, /createWorkReviewerManagementSaveAction\(\{\s*target: reviewerManagementRoot,\s*canManageReviewer: \(\) => hasAnyPermissionGrant\(state\.actorGrants, \["tasks\.reviewer_manage"\], reviewerManagementScopes\),/,
    "the host injects the active reviewer grant and route target into the action boundary");
  assert.match(reviewerManagementActionsRoute, /requestOptions\("PATCH", \{ reviewerPersonId \}\)/);
  assert.match(reviewerManagementActionsRoute, /result as Record<string, unknown>\)\.assignmentId !== assignmentId/);
  assert.doesNotMatch(reviewerManagementRoute, /\/api\/people\?/);
  assert.doesNotMatch(route, /board\.append\(|Array\.from\(board\.children\)|target\.append\(node\)/);
  assert.doesNotMatch(route, /id="work-route-shell"|id="work-board"|adminSection\("Recorded work sessions"/);
  assert.doesNotMatch(shell, /id="feedback"/);
  assert.equal((page.match(/id="feedback"/g) || []).length, 1, "the React page owns a single route feedback slot");
});
