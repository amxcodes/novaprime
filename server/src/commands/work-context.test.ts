import { describe, expect, test } from "bun:test";
import {
  ownAssignmentActionCapabilities,
  ownAssignmentActionPermissionSql,
  parseMyAssignmentFilters,
  myAssignmentsReadSql,
  parseVisibleTaskFilters,
  visibleTasksReadSql,
  readTaskPermissionHints,
  projectMyAssignmentSummary,
  resolveTaskAssignmentOptions,
  taskCorrectionInput,
  validTaskDueDate,
  hasPermission,
  exactReviewerManagementTarget,
  reviewerExceptionTargetEligible,
  reviewerExceptionGrantTargetSql,
} from "./work-context.js";

const originalTaskId = "9f7fda96-7352-4e96-9ce0-71c0de51f761";

function pageCursor(status: string, due: string, search: string, timestamp = "2026-10-01 13:45:21.123456+00"): string {
  const binding = Array.from(new TextEncoder().encode(JSON.stringify([status, due, search])),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${timestamp}~${originalTaskId}~${binding}`;
}

function assignmentRow(overrides: Partial<import("./work-context.js").MyAssignmentReadRow> = {}) {
  return {
    id: originalTaskId,
    task_id: "8f7fda96-7352-4e96-9ce0-71c0de51f760",
    title: "Access review",
    description: "Private detail text",
    status: "assigned",
    task_status: "ready",
    review_required: true,
    reviewer_person_id: "7f7fda96-7352-4e96-9ce0-71c0de51f761",
    review_blocked_reason: "Private reviewer context",
    review_blocked_at: null,
    resolution_source: null,
    due_date: "2026-10-07",
    due_date_revision: 3,
    billing_class: "billable",
    billing_policy_source: "client_workstream",
    billing_policy_revision: 2,
    correction_of_task_id: "6f7fda96-7352-4e96-9ce0-71c0de51f761",
    task_catalog_entry_id: null,
    task_catalog_revision: null,
    correction_reason: "Private correction detail",
    correction_title: "Original work",
    correction_client_id: null,
    correction_client_workstream_id: null,
    correction_group_id: null,
    client_id: null,
    client_workstream_id: null,
    work_group_id: null,
    assigned_at: new Date("2026-09-30T12:00:00Z"),
    cursor_assigned_at: "2026-09-30 12:00:00.000000+00",
    can_view: false,
    can_edit_due_date: false,
    can_start: true,
    can_submit: false,
    can_request_reviewer: false,
    can_request_handover: false,
    has_pending_reviewer_request: false,
    has_pending_handover_request: false,
    correction_source_visible: false,
    ...overrides,
  } satisfies import("./work-context.js").MyAssignmentReadRow;
}

describe("my assignment collection query", () => {
  test("bounds page size and normalizes allowed status, due, and title filters", () => {
    const parsed = parseMyAssignmentFilters(new Request(
      "https://nova.test/api/work/assignments/mine?limit=60&status=awaiting_review&due=upcoming&q=fix%25_%5E",
    ));
    expect(parsed).toEqual({
      limit: 60,
      cursorAssignedAt: null,
      cursorAssignmentId: null,
      status: "awaiting_review",
      due: "upcoming",
      searchPattern: "%fix^%^_^^%",
    });
    expect(parseMyAssignmentFilters(new Request("https://nova.test/api/work/assignments/mine?limit=101"))).toBeUndefined();
    expect(parseMyAssignmentFilters(new Request("https://nova.test/api/work/assignments/mine?status=made_up"))).toBeUndefined();
    expect(parseMyAssignmentFilters(new Request("https://nova.test/api/work/assignments/mine?due=tomorrow"))).toBeUndefined();
    expect(parseMyAssignmentFilters(new Request("https://nova.test/api/work/assignments/mine?q=" + "x".repeat(101)))).toBeUndefined();
  });

  test("validates a microsecond-stable assigned-at cursor and rejects malformed IDs", () => {
    const cursor = pageCursor("all", "any", "");
    const valid = parseMyAssignmentFilters(new Request(
      "https://nova.test/api/work/assignments/mine?cursor=" +
        encodeURIComponent(cursor),
    ));
    expect(valid?.cursorAssignedAt).toBe("2026-10-01 13:45:21.123456+00");
    expect(valid?.cursorAssignmentId).toBe(originalTaskId);
    expect(parseMyAssignmentFilters(new Request(
      "https://nova.test/api/work/assignments/mine?cursor=" +
        encodeURIComponent(pageCursor("all", "any", "", "2026-02-31 13:45:21.123456+00")),
    ))).toBeUndefined();
    expect(parseMyAssignmentFilters(new Request(
      "https://nova.test/api/work/assignments/mine?cursor=2026-10-01T13%3A45%3A21Z~bad",
    ))).toBeUndefined();
  });

  test("binds assignment cursors to normalized filters while allowing page-size changes", () => {
    const cursor = encodeURIComponent(pageCursor("awaiting_review", "upcoming", "design review"));
    expect(parseMyAssignmentFilters(new Request(
      `https://nova.test/api/work/assignments/mine?status=awaiting_review&due=upcoming&q=design%20review&limit=80&cursor=${cursor}`,
    ))?.cursorAssignmentId).toBe(originalTaskId);
    for (const changed of [
      `status=assigned&due=upcoming&q=design%20review`,
      `status=awaiting_review&due=today&q=design%20review`,
      `status=awaiting_review&due=upcoming&q=other`,
    ]) {
      expect(parseMyAssignmentFilters(new Request(
        `https://nova.test/api/work/assignments/mine?${changed}&cursor=${cursor}`,
      ))).toBeUndefined();
    }
  });

  test("applies actor scope and supported filters before the keyset limit", () => {
    const sql = myAssignmentsReadSql().toUpperCase();
    const candidates = sql.indexOf("CANDIDATE_ASSIGNMENTS AS MATERIALIZED");
    const actorScope = sql.indexOf("ASSIGNMENTS.PERSON_ID = $2", candidates);
    const targetPermission = sql.indexOf("GRANTS.PERMISSION_KEY = 'TASKS.VIEW'", candidates);
    const cursor = sql.indexOf("(ASSIGNMENTS.ASSIGNED_AT, ASSIGNMENTS.ID) < ($3::TIMESTAMPTZ, $4::UUID)", candidates);
    const filters = sql.indexOf("TASKS.TITLE ILIKE $7 ESCAPE '^'", candidates);
    const order = sql.indexOf("ORDER BY ASSIGNMENTS.ASSIGNED_AT DESC, ASSIGNMENTS.ID DESC", candidates);
    const limit = sql.indexOf("LIMIT $8", candidates);

    expect(candidates).toBeGreaterThan(-1);
    expect(actorScope).toBeGreaterThan(candidates);
    expect(targetPermission).toBeGreaterThan(actorScope);
    expect(cursor).toBeGreaterThan(actorScope);
    expect(filters).toBeGreaterThan(actorScope);
    expect(order).toBeGreaterThan(targetPermission);
    expect(limit).toBeGreaterThan(order);
    expect(sql).toContain("ASSIGNMENTS.EFFECTIVE_ON <= ACTOR_DATE.BUSINESS_DATE");
    expect(sql).toContain("ROLES.ARCHIVED_AT IS NULL");
    expect(sql).not.toContain("PEOPLE.EMAIL");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  test("permits assignment actions without tasks.view but keeps the summary minimal", () => {
    const sql = myAssignmentsReadSql().toUpperCase();
    const candidates = sql.indexOf("CANDIDATE_ASSIGNMENTS AS MATERIALIZED");
    const viewOrAction = sql.indexOf("TASKS.START", candidates);
    const limit = sql.indexOf("LIMIT $8", candidates);
    expect(viewOrAction).toBeGreaterThan(candidates);
    expect(limit).toBeGreaterThan(viewOrAction);

    const projected = projectMyAssignmentSummary(assignmentRow());
    expect(projected).toMatchObject({
      assignmentId: originalTaskId,
      taskId: "8f7fda96-7352-4e96-9ce0-71c0de51f760",
      title: "Access review",
      canViewTask: false,
      status: "assigned",
      dueDate: "2026-10-07",
      canStart: true,
    });
    expect(projected).not.toHaveProperty("description");
    expect(projected).not.toHaveProperty("billingClass");
    expect(projected).not.toHaveProperty("correctionReason");
    expect(projected).not.toHaveProperty("reviewerPersonId");
    expect(projectMyAssignmentSummary(assignmentRow({ can_start: false }))).toBeNull();
    expect(projectMyAssignmentSummary(assignmentRow({
      can_start: false,
      can_edit_due_date: true,
      task_status: "done",
    }))).toBeNull();
    expect(sql).toContain("TASKS.STATUS::TEXT NOT IN ('APPROVED', 'DONE', 'CANCELLED')");
  });
});

describe("permission-filtered visible task collection", () => {
  test("allowlists task status and due filters, bounds search and validates stable cursors", () => {
    const parsed = parseVisibleTaskFilters(new Request(
      "https://nova.test/api/work/tasks/visible?limit=45&status=blocked&due=upcoming&q=policy%25_%5E",
    ));
    expect(parsed).toEqual({
      limit: 45,
      cursorCreatedAt: null,
      cursorTaskId: null,
      status: "blocked",
      due: "upcoming",
      searchPattern: "%policy^%^_^^%",
    });
    expect(parseVisibleTaskFilters(new Request("https://nova.test/api/work/tasks/visible"))?.status).toBe("open");
    expect(parseVisibleTaskFilters(new Request("https://nova.test/api/work/tasks/visible?status=made_up"))).toBeUndefined();
    expect(parseVisibleTaskFilters(new Request("https://nova.test/api/work/tasks/visible?limit=101"))).toBeUndefined();
    expect(parseVisibleTaskFilters(new Request("https://nova.test/api/work/tasks/visible?q=" + "x".repeat(101)))).toBeUndefined();

    const taskId = originalTaskId;
    const cursor = parseVisibleTaskFilters(new Request(
      "https://nova.test/api/work/tasks/visible?cursor=" +
        encodeURIComponent(pageCursor("open", "any", "")),
    ));
    expect(cursor?.cursorCreatedAt).toBe("2026-10-01 13:45:21.123456+00");
    expect(cursor?.cursorTaskId).toBe(taskId);
    expect(parseVisibleTaskFilters(new Request(
      "https://nova.test/api/work/tasks/visible?cursor=" +
        encodeURIComponent(pageCursor("open", "any", "", "2026-02-31 13:45:21.123456+00")),
    ))).toBeUndefined();
  });

  test("binds visible-task cursors to status, due, and title search", () => {
    const cursor = encodeURIComponent(pageCursor("blocked", "today", "policy review"));
    expect(parseVisibleTaskFilters(new Request(
      `https://nova.test/api/work/tasks/visible?status=blocked&due=today&q=policy%20review&limit=90&cursor=${cursor}`,
    ))?.cursorTaskId).toBe(originalTaskId);
    for (const changed of [
      `status=open&due=today&q=policy%20review`,
      `status=blocked&due=upcoming&q=policy%20review`,
      `status=blocked&due=today&q=other`,
    ]) {
      expect(parseVisibleTaskFilters(new Request(
        `https://nova.test/api/work/tasks/visible?${changed}&cursor=${cursor}`,
      ))).toBeUndefined();
    }
  });

  test("applies exact effective tasks.view scope, filters and keyset before page limit", () => {
    const sql = visibleTasksReadSql().toUpperCase();
    const candidates = sql.indexOf("CANDIDATE_TASKS AS MATERIALIZED");
    const cursor = sql.indexOf("(TASKS.CREATED_AT, TASKS.ID) < ($3::TIMESTAMPTZ, $4::UUID)", candidates);
    const scope = sql.indexOf("GRANTS.PERMISSION_KEY = 'TASKS.VIEW'", candidates);
    const title = sql.indexOf("TASKS.TITLE ILIKE $7 ESCAPE '^'", candidates);
    const sort = sql.indexOf("ORDER BY TASKS.CREATED_AT DESC, TASKS.ID DESC", candidates);
    const limit = sql.indexOf("LIMIT $8", candidates);
    expect(candidates).toBeGreaterThan(-1);
    expect(cursor).toBeGreaterThan(candidates);
    expect(scope).toBeGreaterThan(candidates);
    expect(title).toBeGreaterThan(candidates);
    expect(sort).toBeGreaterThan(scope);
    expect(limit).toBeGreaterThan(sort);
    expect(sql).toContain("ROLE_ASSIGNMENTS.EFFECTIVE_ON <= ACTOR_DATE.BUSINESS_DATE");
    expect(sql).toContain("ROLES.ARCHIVED_AT IS NULL");
    expect(sql).toContain("GRANTS.SCOPE = ANY(ARRAY['ORGANISATION', 'CLIENT', 'CLIENT_WORKSTREAM', 'GROUP']::NOVA.PERMISSION_SCOPE[])");
    expect(sql).toContain("WHEN 'OPEN' THEN TASKS.STATUS NOT IN ('APPROVED', 'DONE', 'CANCELLED')");
    expect(sql).toContain("ASSIGNMENTS.STATUS <> 'CANCELLED'");
    expect(sql).not.toContain("PEOPLE.EMAIL");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});

describe("correction-task input", () => {
  test("keeps correction purpose separate from billing classification", () => {
    expect(taskCorrectionInput({ title: "Task" })).toEqual({
      correctionOfTaskId: null,
      correctionReason: null,
    });
    expect(taskCorrectionInput({
      correctionOfTaskId: originalTaskId,
      correctionReason: "Fix the approved deliverable.",
    })).toEqual({
      correctionOfTaskId: originalTaskId,
      correctionReason: "Fix the approved deliverable.",
    });
  });

  test("rejects malformed source IDs", () => {
    expect(taskCorrectionInput({ correctionOfTaskId: "not-a-uuid", correctionReason: "Fix it" })).toBeUndefined();
  });

  test("requires one bounded reason exactly when a source task is selected", () => {
    expect(taskCorrectionInput({ correctionOfTaskId: originalTaskId })).toBeUndefined();
    expect(taskCorrectionInput({ correctionReason: "Not linked" })).toBeUndefined();
    expect(taskCorrectionInput({
      correctionOfTaskId: originalTaskId,
      correctionReason: "   ",
    })).toBeUndefined();
    expect(taskCorrectionInput({
      correctionOfTaskId: originalTaskId,
      correctionReason: "x".repeat(2001),
    })).toBeUndefined();
    expect(taskCorrectionInput({
      correctionOfTaskId: originalTaskId,
      correctionReason: "  Adjusted scope.  ",
    })?.correctionReason).toBe("Adjusted scope.");
  });
});

describe("task due dates", () => {
  test("accepts real local calendar dates and rejects impossible or zero-year dates", () => {
    expect(validTaskDueDate("2024-02-29")).toBe(true);
    expect(validTaskDueDate("2025-02-29")).toBe(false);
    expect(validTaskDueDate("2026-04-31")).toBe(false);
    expect(validTaskDueDate("0000-01-01")).toBe(false);
    expect(validTaskDueDate("2026-09-24T00:00:00Z")).toBe(false);
  });
});

describe("task permission projections", () => {
  test("binds organisation, client, workstream, and group targets to the shared scope predicate", async () => {
    const cases = [
      { target: { taskId: "task-org" }, bound: [null, null, null, "task-org"] },
      { target: { clientId: "client-1", taskId: "task-client" }, bound: ["client-1", null, null, "task-client"] },
      { target: { clientId: "client-1", clientWorkstreamId: "stream-1", taskId: "task-stream" }, bound: ["client-1", "stream-1", null, "task-stream"] },
      { target: { clientId: "client-1", clientWorkstreamId: "stream-1", groupId: "group-1", taskId: "task-group" }, bound: ["client-1", "stream-1", "group-1", "task-group"] },
    ];

    for (const entry of cases) {
      let queryText = "";
      let queryValues: unknown[] = [];
      const transaction = {
        query: async (text: string, values: unknown[]) => {
          queryText = text;
          queryValues = values;
          return { rows: [{
            can_view: true,
            can_view_broad: true,
            can_edit_due_date: false,
            can_assign: true,
            can_cancel: false,
            can_reassign: true,
          }] };
        },
      } as unknown as Parameters<typeof readTaskPermissionHints>[0];

      const projected = await readTaskPermissionHints(
        transaction, "actor-1", "org-1", entry.target,
      );

      expect(queryValues).toEqual(["actor-1", "org-1", ...entry.bound.slice(0, 3), entry.bound[3]]);
      expect(queryText).toContain("grants.scope = 'organisation'");
      expect(queryText).toContain("grants.scope = 'client' AND grants.client_id = $3");
      expect(queryText).toContain("grants.scope = 'client_workstream' AND grants.client_workstream_id = $4");
      expect(queryText).toContain("grants.scope = 'group' AND grants.group_id = $5");
      expect(queryText).toContain("grants.scope = 'assigned_work' AND EXISTS");
      expect(queryText).toContain("actor_assignments.task_id = $6");
      expect(queryText).toContain("grants.permission_key = 'tasks.assign'");
      expect(queryText).toContain("grants.permission_key = 'tasks.reassign'");
      expect(queryText).toContain("grants.scope = ANY(ARRAY['organisation', 'client', 'client_workstream', 'group']::nova.permission_scope[])");
      expect(queryText).toContain("assignments.effective_on <= actor_date.business_date");
      expect(queryText).toContain("roles.archived_at IS NULL");
      expect(projected).toEqual({
        canView: true,
        canViewBroad: true,
        canEditDueDate: false,
        canAssign: true,
        canCancel: false,
        canReassign: true,
      });
    }
  });

  test("fails closed when the database projection has no row", async () => {
    const transaction = {
      query: async () => ({ rows: [] }),
    } as unknown as Parameters<typeof readTaskPermissionHints>[0];

    await expect(readTaskPermissionHints(transaction, "actor-1", "org-1", { taskId: "task-1" })).resolves.toEqual({
      canView: false,
      canViewBroad: false,
      canEditDueDate: false,
      canAssign: false,
      canCancel: false,
      canReassign: false,
    });
  });

  test("separates assigned-work visibility from the broad roster permission", async () => {
    let queryText = "";
    const transaction = {
      query: async (text: string) => {
        queryText = text;
        return { rows: [{
          can_view: true,
          can_view_broad: false,
          can_edit_due_date: false,
          can_assign: false,
          can_cancel: false,
          can_reassign: false,
        }] };
      },
    } as unknown as Parameters<typeof readTaskPermissionHints>[0];

    const projected = await readTaskPermissionHints(transaction, "actor-1", "org-1", {
      taskId: "task-assigned-only",
    });

    expect(projected.canView).toBe(true);
    expect(projected.canViewBroad).toBe(false);
    expect(queryText).toContain("AS can_view_broad");
    expect(queryText).toContain("grants.scope = ANY(ARRAY['organisation', 'client', 'client_workstream', 'group']::nova.permission_scope[])");
  });
});

describe("exact assignment reviewer-management authorization", () => {
  test("builds the reviewer-management target from the locked assignment ID", () => {
    expect(exactReviewerManagementTarget("assignment-1", "task-1", {
      clientId: "client-1", clientWorkstreamId: "workstream-1", groupId: "group-1",
    })).toEqual({
      clientId: "client-1", clientWorkstreamId: "workstream-1", groupId: "group-1",
      taskId: "task-1", assignmentId: "assignment-1",
    });
  });

  test("narrows assigned_work to the explicit assignment ID and leaves other target checks unchanged", async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const transaction = {
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return { rows: [{ permitted: true }] };
      },
    } as unknown as Parameters<typeof hasPermission>[0];

    await hasPermission(transaction, "actor-1", "org-1", "tasks.reviewer_manage", {
      taskId: "task-1", assignmentId: "assignment-1",
    });
    expect(queries[0]?.text).toContain("actor_assignments.id = $8");
    expect(queries[0]?.values).toEqual([
      "actor-1", "org-1", "tasks.reviewer_manage", null, null, null, "task-1", "assignment-1",
    ]);

    await hasPermission(transaction, "actor-1", "org-1", "tasks.view", { taskId: "task-1" });
    expect(queries[1]?.text).not.toContain("actor_assignments.id = $8");
    expect(queries[1]?.values).toHaveLength(7);
  });
});

describe("reviewer exception eligibility", () => {
  test("requires a review-required, nonterminal assignment", () => {
    expect(reviewerExceptionTargetEligible("awaiting_review", true)).toBe(true);
    expect(reviewerExceptionTargetEligible("assigned", false)).toBe(false);
    expect(reviewerExceptionTargetEligible("approved", true)).toBe(false);
    expect(reviewerExceptionTargetEligible("cancelled", true)).toBe(false);
  });

  test("the grant command locks and reads review_required before applying the eligibility gate", () => {
    expect(reviewerExceptionGrantTargetSql).toContain("assignments.review_required");
    expect(reviewerExceptionGrantTargetSql).toContain("FOR UPDATE OF assignments, tasks");
  });
});

describe("task assignment option read", () => {
  const task = {
    id: "task-1",
    client_id: "client-1",
    client_workstream_id: "workstream-1",
    work_group_id: "group-1",
  };
  const people = [
    { id: "person-1", display_name: "Avery Active" },
    { id: "person-2", display_name: "Casey Ineligible" },
    { id: "person-3", display_name: "Morgan Reviewer Only" },
  ];

  function transaction(options: {
    task?: typeof task | null;
    grants?: ReadonlySet<string>;
    assignees?: ReadonlySet<string>;
    operational?: ReadonlySet<string>;
    reviewers?: ReadonlySet<string>;
  } = {}) {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const selected = {
      task: options.task === undefined ? task : options.task,
      grants: options.grants ?? new Set(["tasks.assign"]),
      assignees: options.assignees ?? new Set(["person-1"]),
      operational: options.operational ?? new Set(["person-1", "person-2", "person-3"]),
      reviewers: options.reviewers ?? new Set(["person-1", "person-3"]),
    };
    const client = {
      query: async (text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        if (text.includes("ORDER BY people.display_name, people.id")) return { rows: people };
        if (text.includes("FROM nova.tasks tasks") && text.includes("WHERE tasks.id = $1 AND tasks.organisation_id = $2")) {
          return { rows: selected.task ? [selected.task] : [] };
        }
        if (text.includes("AS permitted")) {
          const permission = String(values[2]);
          if (permission === "tasks.assign" || permission === "tasks.reassign") {
            return { rows: [{ permitted: selected.grants.has(permission) }] };
          }
          if (permission === "tasks.review") {
            return { rows: [{ permitted: selected.reviewers.has(String(values[0])) }] };
          }
        }
        if (text.includes("AS eligible")) {
          return { rows: [{ eligible: selected.assignees.has(String(values[0])) }] };
        }
        if (text.includes("AS operational")) {
          return { rows: [{ operational: selected.operational.has(String(values[0])) }] };
        }
        throw new Error(`Unexpected assignment-option query: ${text}`);
      },
    };
    return { client: client as unknown as Parameters<typeof resolveTaskAssignmentOptions>[0], queries };
  }

  test("returns no candidate data and does not query people when neither task-scoped grant exists", async () => {
    const db = transaction({ grants: new Set() });
    await expect(resolveTaskAssignmentOptions(db.client, "actor-1", "org-1", "task-1"))
      .resolves.toBe("PERMISSION_DENIED");
    expect(db.queries.filter((query) => query.text.includes("ORDER BY people.display_name, people.id"))).toHaveLength(0);
    expect(db.queries.filter((query) => query.text.includes("AS permitted")).map((query) => query.values))
      .toEqual([
        ["actor-1", "org-1", "tasks.assign", "client-1", "workstream-1", "group-1", "task-1"],
        ["actor-1", "org-1", "tasks.reassign", "client-1", "workstream-1", "group-1", "task-1"],
      ]);
  });

  test.each(["tasks.assign", "tasks.reassign"])(
    "allows only the task-scoped %s grant to open the candidate read",
    async (permission) => {
      const db = transaction({ grants: new Set([permission]) });
      await expect(resolveTaskAssignmentOptions(db.client, "actor-1", "org-1", "task-1"))
        .resolves.toEqual({
          assignees: [{ id: "person-1", name: "Avery Active" }],
          reviewers: [
            { id: "person-1", name: "Avery Active" },
            { id: "person-3", name: "Morgan Reviewer Only" },
          ],
        });
      const taskReviewQueries = db.queries.filter((query) =>
        query.text.includes("AS permitted") && query.values[2] === "tasks.review",
      );
      expect(taskReviewQueries.every((query) => query.values.slice(3).join("|") === "client-1|workstream-1|group-1|task-1"))
        .toBe(true);
    },
  );

  test("returns task-not-found before checking permissions or reading candidates", async () => {
    const db = transaction({ task: null });
    await expect(resolveTaskAssignmentOptions(db.client, "actor-1", "org-1", "missing-task"))
      .resolves.toBe("TASK_NOT_FOUND");
    expect(db.queries).toHaveLength(1);
  });
});

describe("own assignment action capabilities", () => {
  test("projects only the granted actions that are valid for the current assignment state", () => {
    expect(ownAssignmentActionCapabilities({
      status: "assigned",
      taskStatus: "ready",
      canStartPermission: true,
      canSubmitPermission: true,
      canRequestReviewerPermission: true,
      canRequestHandoverPermission: false,
      hasPendingReviewerRequest: false,
      hasPendingHandoverRequest: false,
    })).toEqual({
      canStart: true,
      canSubmit: false,
      canRequestReviewer: true,
      canRequestHandover: false,
    });

    expect(ownAssignmentActionCapabilities({
      status: "in_progress",
      taskStatus: "in_progress",
      canStartPermission: false,
      canSubmitPermission: true,
      canRequestReviewerPermission: true,
      canRequestHandoverPermission: true,
      hasPendingReviewerRequest: true,
      hasPendingHandoverRequest: false,
    })).toEqual({
      canStart: false,
      canSubmit: true,
      canRequestReviewer: false,
      canRequestHandover: true,
    });
  });

  test("hides actions for terminal or incompatible workflow states even when grants exist", () => {
    const grants = {
      canStartPermission: true,
      canSubmitPermission: true,
      canRequestReviewerPermission: true,
      canRequestHandoverPermission: true,
      hasPendingReviewerRequest: false,
      hasPendingHandoverRequest: false,
    };
    expect(ownAssignmentActionCapabilities({ ...grants, status: "approved", taskStatus: "done" })).toEqual({
      canStart: false,
      canSubmit: false,
      canRequestReviewer: false,
      canRequestHandover: false,
    });
    expect(ownAssignmentActionCapabilities({ ...grants, status: "assigned", taskStatus: "done" })).toEqual({
      canStart: false,
      canSubmit: false,
      canRequestReviewer: true,
      canRequestHandover: true,
    });
  });

  test("uses each action's own effective target-scoped permission predicate", () => {
    const predicates = ownAssignmentActionPermissionSql();
    const permissions = [
      [predicates.canStart, "tasks.start"],
      [predicates.canSubmit, "tasks.submit"],
      [predicates.canRequestReviewer, "tasks.reviewer_request"],
      [predicates.canRequestHandover, "tasks.handover_request"],
    ] as const;

    for (const [sql, permission] of permissions) {
      expect(sql).toContain(`grants.permission_key = '${permission}'`);
      expect(sql).toContain("grants.scope = 'organisation'");
      expect(sql).toContain("grants.scope = 'client' AND grants.client_id = candidate_assignments.client_id");
      expect(sql).toContain("grants.scope = 'client_workstream' AND grants.client_workstream_id = candidate_assignments.client_workstream_id");
      expect(sql).toContain("grants.scope = 'group' AND grants.group_id = candidate_assignments.work_group_id");
      expect(sql).toContain("grants.scope = 'assigned_work' AND EXISTS");
      expect(sql).toContain("actor_assignments.task_id = candidate_assignments.task_id");
      expect(sql).toContain("actor_assignments.person_id = $2");
    }
  });
});
