import type { PoolClient } from "pg";
import { withDatabaseRequest } from "../db.js";
import { requestIdempotencyKey, idempotent, isIdempotencyReplay } from "../idempotency.js";
import { body, hasPermission, normalActor } from "./work-context.js";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const priorities = ["low", "normal", "high", "urgent"] as const;

type CatalogInput = Readonly<{
  title: string;
  description: string | null;
  priority: typeof priorities[number];
  reason: string;
}>;

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maximum ? text : undefined;
}

function catalogInput(value: Record<string, unknown>): CatalogInput | undefined {
  const title = boundedText(value.title, 320);
  const reason = boundedText(value.reason, 2000);
  const priority = value.priority === undefined ? "normal" : value.priority;
  const description = value.description === undefined || value.description === null
    ? null
    : typeof value.description === "string"
      ? value.description.trim() || null
      : undefined;
  if (!title || !reason || description === undefined || (description?.length ?? 0) > 10000 ||
      Object.hasOwn(value, "billingClass") || Object.hasOwn(value, "billing_class") ||
      !priorities.includes(priority as typeof priorities[number])) return undefined;
  return { title, description, priority: priority as typeof priorities[number], reason };
}

function positiveRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function audit(
  transaction: PoolClient,
  organisationId: string,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await transaction.query(
    `INSERT INTO nova.audit_events (
       organisation_id, actor_person_id, action, target_type, target_id, details
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [organisationId, actorId, action, targetType, targetId, JSON.stringify(details)],
  );
}

type CatalogEntry = Readonly<{
  id: string;
  title: string;
  description: string | null;
  priority: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
  created_by_name: string | null;
}>;

type Proposal = Readonly<{
  id: string;
  catalog_entry_id: string | null;
  proposed_by_person_id: string;
  action: string;
  expected_revision: number | null;
  title: string;
  description: string | null;
  priority: string;
  reason: string;
  status: string;
  created_at: Date;
  reviewed_at: Date | null;
  review_note: string | null;
  proposer_name: string | null;
  reviewer_name: string | null;
}>;

export async function readTaskCatalog(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const permissions = {
        view: await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.view"),
        propose: await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.propose"),
        manage: await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.manage"),
        review: await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.review"),
      };
      let entries: CatalogEntry[] = [];
      if (permissions.view || permissions.manage) {
        entries = (await transaction.query<CatalogEntry>(
          `SELECT entries.id, entries.title, entries.description, entries.priority,
                  entries.revision, entries.created_at, entries.updated_at,
                  people.display_name AS created_by_name
           FROM nova.task_catalog_entries entries
           LEFT JOIN nova.people people ON people.id = entries.created_by_person_id
           WHERE entries.organisation_id = $1 AND entries.archived_at IS NULL
           ORDER BY lower(entries.title), entries.id
           LIMIT 500`,
          [actor.context.organisationId],
        )).rows;
      }
      let proposals: Proposal[] = [];
      if (permissions.review || permissions.propose) {
        proposals = (await transaction.query<Proposal>(
          `SELECT proposals.id, proposals.catalog_entry_id, proposals.proposed_by_person_id, proposals.action,
                  proposals.expected_revision, proposals.title, proposals.description,
                  proposals.priority, proposals.reason, proposals.status,
                  proposals.created_at, proposals.reviewed_at, proposals.review_note,
                  proposer.display_name AS proposer_name,
                  reviewer.display_name AS reviewer_name
           FROM nova.task_catalog_proposals proposals
           LEFT JOIN nova.people proposer ON proposer.id = proposals.proposed_by_person_id
           LEFT JOIN nova.people reviewer ON reviewer.id = proposals.reviewed_by_person_id
           WHERE proposals.organisation_id = $1
             AND ($2::boolean OR proposals.proposed_by_person_id = $3)
             AND ($2::boolean = false OR proposals.status = 'pending')
           ORDER BY proposals.created_at DESC
           LIMIT 100`,
          [actor.context.organisationId, permissions.review, actor.context.userId],
        )).rows;
      }
      return {
        entries: entries.map((entry) => ({
          id: entry.id, title: entry.title, description: entry.description,
          priority: entry.priority, revision: entry.revision,
          createdAt: entry.created_at.toISOString(), updatedAt: entry.updated_at.toISOString(),
          createdByName: entry.created_by_name,
        })),
        proposals: proposals.map((proposal) => ({
          id: proposal.id, catalogEntryId: proposal.catalog_entry_id,
          action: proposal.action, expectedRevision: proposal.expected_revision,
          title: proposal.title, description: proposal.description,
          priority: proposal.priority, reason: proposal.reason, status: proposal.status,
          createdAt: proposal.created_at.toISOString(),
          reviewedAt: proposal.reviewed_at?.toISOString() ?? null,
          reviewNote: proposal.review_note, proposerName: proposal.proposer_name,
          reviewerName: proposal.reviewer_name,
        })),
        permissions,
      };
    });
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function createTaskCatalogEntry(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = await body(request);
  const value = catalogInput(input);
  if (!value) return json({ error: "TASK_CATALOG_INPUT_INVALID" }, 400);
  const requestKey = requestIdempotencyKey(request);
  if (requestKey === "INVALID") return json({ error: "IDEMPOTENCY_KEY_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) =>
      idempotent(transaction, actor.context, "task_catalog.create", requestKey, input, async () => {
        if (await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.manage")) {
          const created = await transaction.query<{ id: string; revision: number }>(
            `INSERT INTO nova.task_catalog_entries (
               organisation_id, title, description, priority, created_by_person_id
             ) VALUES ($1, $2, $3, $4, $5) RETURNING id, revision`,
            [actor.context.organisationId, value.title, value.description, value.priority, actor.context.userId],
          );
          const entry = created.rows[0];
          if (!entry) throw new Error("TASK_CATALOG_CREATE_RESULT_MISSING");
          await audit(transaction, actor.context.organisationId, actor.context.userId,
            "task_catalog.created", "task_catalog_entry", entry.id,
            { title: value.title, priority: value.priority, reason: value.reason });
          return { status: 201, body: { entryId: entry.id, revision: entry.revision, status: "active" } };
        }
        if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.propose")) {
          return "PERMISSION_DENIED" as const;
        }
        const created = await transaction.query<{ id: string }>(
          `INSERT INTO nova.task_catalog_proposals (
             organisation_id, action, title, description, priority, reason, proposed_by_person_id
           ) VALUES ($1, 'create', $2, $3, $4, $5, $6) RETURNING id`,
          [actor.context.organisationId, value.title, value.description, value.priority, value.reason, actor.context.userId],
        );
        const proposalId = created.rows[0]?.id;
        if (!proposalId) throw new Error("TASK_CATALOG_PROPOSAL_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId,
          "task_catalog.proposed", "task_catalog_proposal", proposalId,
          { action: "create", title: value.title, priority: value.priority });
        return { status: 201, body: { proposalId, status: "pending" } };
      }),
    );
    if (isIdempotencyReplay(result)) return json(result.body, result.status);
    if (result === "IDEMPOTENCY_KEY_REUSED") return json({ error: result }, 409);
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json(result.body, result.status);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "TASK_CATALOG_TITLE_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateTaskCatalogEntry(request: Request, entryId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(entryId)) return json({ error: "TASK_CATALOG_ENTRY_NOT_FOUND" }, 404);
  const input = await body(request);
  const value = catalogInput(input);
  const expectedRevision = positiveRevision(input.expectedRevision);
  if (!value || !expectedRevision) return json({ error: "TASK_CATALOG_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const canManage = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.manage");
      const canPropose = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.propose");
      if (!canManage && !canPropose) return "PERMISSION_DENIED" as const;
      const current = await transaction.query<{
        title: string; description: string | null; priority: string; revision: number; archived_at: Date | null;
      }>(
        `SELECT title, description, priority, revision, archived_at
         FROM nova.task_catalog_entries
         WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [entryId, actor.context.organisationId],
      );
      const entry = current.rows[0];
      if (!entry) return "TASK_CATALOG_ENTRY_NOT_FOUND" as const;
      if (entry.archived_at) return "TASK_CATALOG_ENTRY_ARCHIVED" as const;
      if (entry.revision !== expectedRevision) return "TASK_CATALOG_VERSION_CONFLICT" as const;
      if (canManage) {
        const updated = await transaction.query<{ revision: number }>(
           `UPDATE nova.task_catalog_entries
           SET title = $2, description = $3, priority = $4
           WHERE id = $1 AND organisation_id = $5
           RETURNING revision`,
          [entryId, value.title, value.description, value.priority, actor.context.organisationId],
        );
        const revision = updated.rows[0]?.revision;
        if (!revision) throw new Error("TASK_CATALOG_UPDATE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId,
          "task_catalog.updated", "task_catalog_entry", entryId,
          { fromRevision: entry.revision, revision, title: value.title, priority: value.priority, reason: value.reason });
        return { status: 200, body: { entryId, revision, status: "active" } };
      }
      if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.propose")) {
        return "PERMISSION_DENIED" as const;
      }
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.task_catalog_proposals (
           organisation_id, catalog_entry_id, action, expected_revision,
           title, description, priority, reason, proposed_by_person_id
         ) VALUES ($1, $2, 'update', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [actor.context.organisationId, entryId, expectedRevision, value.title, value.description,
          value.priority, value.reason, actor.context.userId],
      );
      const proposalId = created.rows[0]?.id;
      if (!proposalId) throw new Error("TASK_CATALOG_PROPOSAL_RESULT_MISSING");
      await audit(transaction, actor.context.organisationId, actor.context.userId,
        "task_catalog.proposed", "task_catalog_proposal", proposalId,
        { action: "update", entryId, expectedRevision, title: value.title, priority: value.priority });
      return { status: 201, body: { proposalId, status: "pending" } };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (typeof result === "string") return json({ error: result }, result === "TASK_CATALOG_ENTRY_NOT_FOUND" ? 404 : 409);
    return json(result.body, result.status);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "TASK_CATALOG_TITLE_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function archiveTaskCatalogEntry(request: Request, entryId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(entryId)) return json({ error: "TASK_CATALOG_ENTRY_NOT_FOUND" }, 404);
  const input = await body(request);
  const expectedRevision = positiveRevision(input.expectedRevision);
  const reason = boundedText(input.reason, 2000);
  if (!expectedRevision || !reason) return json({ error: "TASK_CATALOG_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const canManage = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.manage");
      const canPropose = await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.propose");
      if (!canManage && !canPropose) return "PERMISSION_DENIED" as const;
      const current = await transaction.query<{ title: string; description: string | null; priority: string; revision: number; archived_at: Date | null }>(
        `SELECT title, description, priority, revision, archived_at
         FROM nova.task_catalog_entries
         WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [entryId, actor.context.organisationId],
      );
      const entry = current.rows[0];
      if (!entry) return "TASK_CATALOG_ENTRY_NOT_FOUND" as const;
      if (entry.archived_at) return "TASK_CATALOG_ENTRY_ARCHIVED" as const;
      if (entry.revision !== expectedRevision) return "TASK_CATALOG_VERSION_CONFLICT" as const;
      if (canManage) {
        const updated = await transaction.query<{ revision: number }>(
          `UPDATE nova.task_catalog_entries SET archived_at = clock_timestamp()
           WHERE id = $1 AND organisation_id = $2 RETURNING revision`,
          [entryId, actor.context.organisationId],
        );
        const revision = updated.rows[0]?.revision;
        if (!revision) throw new Error("TASK_CATALOG_ARCHIVE_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId,
          "task_catalog.archived", "task_catalog_entry", entryId,
          { fromRevision: entry.revision, revision, reason });
        return { status: 200, body: { entryId, revision, status: "archived" } };
      }
      if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.propose")) {
        return "PERMISSION_DENIED" as const;
      }
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.task_catalog_proposals (
           organisation_id, catalog_entry_id, action, expected_revision,
           title, description, priority, reason, proposed_by_person_id
         ) VALUES ($1, $2, 'archive', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [actor.context.organisationId, entryId, expectedRevision, entry.title, entry.description,
          entry.priority, reason, actor.context.userId],
      );
      const proposalId = created.rows[0]?.id;
      if (!proposalId) throw new Error("TASK_CATALOG_PROPOSAL_RESULT_MISSING");
      await audit(transaction, actor.context.organisationId, actor.context.userId,
        "task_catalog.proposed", "task_catalog_proposal", proposalId,
        { action: "archive", entryId, expectedRevision });
      return { status: 201, body: { proposalId, status: "pending" } };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (typeof result === "string") return json({ error: result }, result === "TASK_CATALOG_ENTRY_NOT_FOUND" ? 404 : 409);
    return json(result.body, result.status);
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}

export async function reviewTaskCatalogProposal(request: Request, proposalId: string): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  if (!uuidPattern.test(proposalId)) return json({ error: "TASK_CATALOG_PROPOSAL_NOT_FOUND" }, 404);
  const input = await body(request);
  const decision = input.decision;
  const reviewNote = input.reviewNote === undefined || input.reviewNote === null
    ? null
    : boundedText(input.reviewNote, 2000);
  if ((decision !== "approved" && decision !== "rejected") ||
      (input.reviewNote !== undefined && input.reviewNote !== null && !reviewNote) ||
      (decision === "rejected" && !reviewNote)) {
    return json({ error: "TASK_CATALOG_REVIEW_INPUT_INVALID" }, 400);
  }
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasPermission(transaction, actor.context.userId, actor.context.organisationId, "tasks.catalog.review")) {
        return "PERMISSION_DENIED" as const;
      }
      const selected = await transaction.query<Proposal>(
        `SELECT id, catalog_entry_id, proposed_by_person_id, action, expected_revision, title, description,
                priority, reason, status, created_at, reviewed_at, review_note,
                NULL::text AS proposer_name, NULL::text AS reviewer_name
         FROM nova.task_catalog_proposals
         WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [proposalId, actor.context.organisationId],
      );
      const proposal = selected.rows[0];
      if (!proposal) return "TASK_CATALOG_PROPOSAL_NOT_FOUND" as const;
      if (proposal.status !== "pending") return "TASK_CATALOG_PROPOSAL_ALREADY_RESOLVED" as const;
      if (proposal.proposed_by_person_id === actor.context.userId) return "TASK_CATALOG_SELF_REVIEW" as const;
      if (decision === "rejected") {
        await transaction.query(
          `UPDATE nova.task_catalog_proposals
           SET status = 'rejected', reviewed_by_person_id = $2, reviewed_at = clock_timestamp(), review_note = $3
           WHERE id = $1`,
          [proposalId, actor.context.userId, reviewNote],
        );
        await audit(transaction, actor.context.organisationId, actor.context.userId,
          "task_catalog.proposal_rejected", "task_catalog_proposal", proposalId,
          { action: proposal.action, reviewNote });
        return { status: 200, body: { proposalId, status: "rejected" } };
      }

      if (proposal.action === "create") {
        const entry = await transaction.query<{ id: string; revision: number }>(
          `INSERT INTO nova.task_catalog_entries (
             organisation_id, title, description, priority, created_by_person_id
           ) VALUES ($1, $2, $3, $4, $5) RETURNING id, revision`,
          [actor.context.organisationId, proposal.title, proposal.description,
            proposal.priority, proposal.proposed_by_person_id],
        );
        const created = entry.rows[0];
        if (!created) throw new Error("TASK_CATALOG_APPROVAL_RESULT_MISSING");
        await audit(transaction, actor.context.organisationId, actor.context.userId,
          "task_catalog.proposal_approved", "task_catalog_entry", created.id,
          { proposalId, action: "create", revision: created.revision });
        await transaction.query(
          `UPDATE nova.task_catalog_proposals
           SET status = 'approved', reviewed_by_person_id = $2, reviewed_at = clock_timestamp(), review_note = $3
           WHERE id = $1`,
          [proposalId, actor.context.userId, reviewNote],
        );
        return { status: 200, body: { proposalId, entryId: created.id, revision: created.revision, status: "approved" } };
      }

      const current = await transaction.query<{
        revision: number; archived_at: Date | null;
      }>(
        `SELECT revision, archived_at FROM nova.task_catalog_entries
         WHERE id = $1 AND organisation_id = $2 FOR UPDATE`,
        [proposal.catalog_entry_id, actor.context.organisationId],
      );
      const entry = current.rows[0];
      if (!entry || entry.archived_at || entry.revision !== proposal.expected_revision) {
        const staleNote = reviewNote ?? "The catalogue item changed after this proposal was submitted.";
        await transaction.query(
          `UPDATE nova.task_catalog_proposals
           SET status = 'stale', reviewed_by_person_id = $2, reviewed_at = clock_timestamp(), review_note = $3
           WHERE id = $1`,
          [proposalId, actor.context.userId, staleNote],
        );
        await audit(transaction, actor.context.organisationId, actor.context.userId,
          "task_catalog.proposal_stale", "task_catalog_proposal", proposalId,
          { action: proposal.action, entryId: proposal.catalog_entry_id, expectedRevision: proposal.expected_revision });
        return "TASK_CATALOG_VERSION_CONFLICT" as const;
      }

      let revision = entry.revision;
      if (proposal.action === "update") {
        const updated = await transaction.query<{ revision: number }>(
          `UPDATE nova.task_catalog_entries
           SET title = $2, description = $3, priority = $4
           WHERE id = $1 AND organisation_id = $5
           RETURNING revision`,
          [proposal.catalog_entry_id, proposal.title, proposal.description,
            proposal.priority, actor.context.organisationId],
        );
        revision = updated.rows[0]?.revision ?? 0;
      } else {
        const archived = await transaction.query<{ revision: number }>(
          `UPDATE nova.task_catalog_entries
           SET archived_at = clock_timestamp()
           WHERE id = $1 AND organisation_id = $2
           RETURNING revision`,
          [proposal.catalog_entry_id, actor.context.organisationId],
        );
        revision = archived.rows[0]?.revision ?? 0;
      }
      if (!revision) throw new Error("TASK_CATALOG_APPROVAL_RESULT_MISSING");
      await transaction.query(
        `UPDATE nova.task_catalog_proposals
         SET status = 'approved', reviewed_by_person_id = $2, reviewed_at = clock_timestamp(), review_note = $3
         WHERE id = $1`,
        [proposalId, actor.context.userId, reviewNote],
      );
      await audit(transaction, actor.context.organisationId, actor.context.userId,
        "task_catalog.proposal_approved", "task_catalog_entry", proposal.catalog_entry_id!,
        { proposalId, action: proposal.action, revision });
      return { status: 200, body: { proposalId, entryId: proposal.catalog_entry_id, revision, status: "approved" } };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "TASK_CATALOG_SELF_REVIEW") return json({ error: result }, 403);
    if (typeof result === "string") return json({ error: result }, result === "TASK_CATALOG_PROPOSAL_NOT_FOUND" ? 404 : 409);
    return json(result.body, result.status);
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) return json({ error: "TASK_CATALOG_TITLE_EXISTS" }, 409);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
