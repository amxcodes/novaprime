import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";
import {
  wfhOrganisationTargetWriteSql,
  wfhPersonTargetWritePermissionSql,
  wfhPersonViewAccessSql,
} from "./availability-picker-search-model.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const targetTypes = ["office", "organisation_department", "person"] as const;
type WfhTargetType = typeof targetTypes[number];
export type WfhPolicyInput = Readonly<{
  allowed: boolean;
  effectiveOn: string;
  effectiveUntil?: string;
  reason?: string;
  targetId: string;
  targetType: WfhTargetType;
}>;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

function nonEmptyString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= maximum ? result : undefined;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

export function wfhPolicyInput(body: unknown): WfhPolicyInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  const targetType = candidate.targetType;
  const targetId = candidate.targetId;
  const effectiveOn = candidate.effectiveOn;
  const effectiveUntil = candidate.effectiveUntil;
  const reason = candidate.reason === undefined || candidate.reason === null
    ? undefined : nonEmptyString(candidate.reason, 2000);
  if (!targetTypes.includes(targetType as WfhTargetType) ||
      typeof targetId !== "string" || !uuidPattern.test(targetId) ||
      typeof candidate.allowed !== "boolean" || !validDate(effectiveOn) ||
      (effectiveUntil !== undefined && effectiveUntil !== null && !validDate(effectiveUntil)) ||
      (typeof effectiveUntil === "string" && effectiveUntil < effectiveOn) ||
      (candidate.reason !== undefined && candidate.reason !== null && reason === undefined)) return undefined;
  return Object.freeze({
    targetType: targetType as WfhTargetType,
    targetId,
    allowed: candidate.allowed,
    effectiveOn,
    ...(typeof effectiveUntil === "string" ? { effectiveUntil } : {}),
    ...(reason ? { reason } : {}),
  });
}

async function normalActor(
  request: Request,
): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try { authenticationConfiguration(); }
  catch { return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) }; }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

async function requestBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return {}; }
}

async function hasOrganisationPermission(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  permissionKey: string,
): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1
        AND roles.organisation_id = $3
         AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL
         AND grants.permission_key = $2
         AND grants.scope = 'organisation'
     ) AS permitted`,
    [actorId, permissionKey, organisationId],
  );
  return result.rows[0]?.permitted === true;
}

function duplicateError(error: unknown): boolean {
  return error instanceof Error && /duplicate key|unique|exclusion/i.test(error.message);
}

export async function createWfhPolicy(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  const input = wfhPolicyInput(await requestBody(request));
  if (!input) return json({ error: "WFH_POLICY_INPUT_INVALID" }, 400);
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, actor.context.organisationId, "availability.wfh_policy.manage")) {
        return "PERMISSION_DENIED" as const;
      }
      if (input.targetType === "person") {
        const peopleView = await transaction.query<{ permitted: boolean }>(
          wfhPersonViewAccessSql,
          [actor.context.userId, actor.context.organisationId],
        );
        if (peopleView.rows[0]?.permitted !== true) return "PERMISSION_DENIED" as const;
        const targetPermission = await transaction.query<{ permitted: boolean }>(
          wfhPersonTargetWritePermissionSql,
          [actor.context.userId, actor.context.organisationId, input.targetId],
        );
        if (targetPermission.rows[0]?.permitted !== true) return "WFH_POLICY_TARGET_NOT_FOUND" as const;
      } else {
        if (!await hasOrganisationPermission(transaction, actor.context.userId, actor.context.organisationId, "organisation.settings.manage")) {
          return "PERMISSION_DENIED" as const;
        }
        const target = await transaction.query(
          wfhOrganisationTargetWriteSql(input.targetType),
          [input.targetId, actor.context.organisationId],
        );
        if (target.rows.length !== 1) return "WFH_POLICY_TARGET_NOT_FOUND" as const;
      }
      const created = await transaction.query<{ id: string }>(
        `INSERT INTO nova.wfh_policy_overrides (
          organisation_id, target_type, target_id, allowed, effective_on,
          effective_until, reason, created_by_person_id
        ) VALUES ($1, $2::nova.wfh_policy_target, $3, $4, $5::date, $6::date, $7, $8)
        RETURNING id`,
        [actor.context.organisationId, input.targetType, input.targetId, input.allowed,
          input.effectiveOn, input.effectiveUntil ?? null, input.reason ?? null, actor.context.userId],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error("WFH_POLICY_CREATE_RESULT_MISSING");
      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'availability.wfh_policy.created', 'wfh_policy_override', $3, $4)`,
        [actor.context.organisationId, actor.context.userId, id,
          JSON.stringify({ target_type: input.targetType, target_id: input.targetId, allowed: input.allowed })],
      );
      const affectedPeople = await transaction.query<{ person_id: string }>(
        `SELECT DISTINCT people.id AS person_id
         FROM nova.people people
         JOIN nova.person_status_periods statuses
           ON statuses.person_id = people.id AND statuses.ended_at IS NULL
         WHERE people.organisation_id = $1
           AND statuses.status IN ('active', 'notice')
           AND (
             ($2::text = 'person' AND people.id = $3::uuid)
             OR ($2::text = 'office' AND EXISTS (
               SELECT 1 FROM nova.person_office_assignments assignments
               WHERE assignments.person_id = people.id
                 AND assignments.office_id = $3::uuid
                 AND assignments.effective_on <= $4::date
                 AND (assignments.effective_until IS NULL OR assignments.effective_until >= $4::date)
             ))
             OR ($2::text = 'organisation_department' AND EXISTS (
               SELECT 1 FROM nova.person_department_assignments assignments
               WHERE assignments.person_id = people.id
                 AND assignments.organisation_department_id = $3::uuid
                 AND assignments.effective_on <= $4::date
                 AND (assignments.effective_until IS NULL OR assignments.effective_until >= $4::date)
             ))
           )`,
        [actor.context.organisationId, input.targetType, input.targetId, input.effectiveOn],
      );
      for (const person of affectedPeople.rows) {
        await enqueueNotification(transaction, {
          organisationId: actor.context.organisationId,
          recipientPersonId: person.person_id,
          eventKey: "availability.policy_changed",
          title: "WFH policy changed",
          body: `Your WFH eligibility changes to ${input.allowed ? "allowed" : "not allowed"} from ${input.effectiveOn}.`,
          aggregateType: "wfh_policy_override",
          aggregateId: id,
          deepLink: "/?view=today",
          idempotencyKey: `availability.wfh_policy:${id}:${person.person_id}`,
        });
      }
      return id;
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    if (result === "WFH_POLICY_TARGET_NOT_FOUND") return json({ error: result }, 409);
    return json({ policyId: result }, 201);
  } catch (error) {
    if (duplicateError(error)) return json({ error: "WFH_POLICY_ALREADY_EXISTS" }, 409);
    if (error instanceof Error && /WFH_POLICY_ORGANISATION_MISMATCH/.test(error.message)) {
      return json({ error: "WFH_POLICY_TARGET_NOT_FOUND" }, 409);
    }
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readWfhPolicies(request: Request): Promise<Response> {
  const actor = await normalActor(request);
  if ("response" in actor) return actor.response;
  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!await hasOrganisationPermission(transaction, actor.context.userId, actor.context.organisationId, "availability.wfh_policy.view")) {
        return "PERMISSION_DENIED" as const;
      }
      const rows = await transaction.query<{
        id: string; target_type: WfhTargetType; target_id: string; target_name: string | null;
        allowed: boolean; effective_on: string; effective_until: string | null; reason: string | null;
      }>(
        `SELECT overrides.id, overrides.target_type, overrides.target_id,
                CASE overrides.target_type
                  WHEN 'office' THEN offices.name
                  WHEN 'organisation_department' THEN departments.name
                  WHEN 'person' THEN people.display_name
                END AS target_name,
                overrides.allowed, overrides.effective_on, overrides.effective_until,
                overrides.reason
         FROM nova.wfh_policy_overrides overrides
         LEFT JOIN nova.offices offices
           ON overrides.target_type = 'office' AND offices.id = overrides.target_id
         LEFT JOIN nova.organisation_departments departments
           ON overrides.target_type = 'organisation_department' AND departments.id = overrides.target_id
         LEFT JOIN nova.people people
           ON overrides.target_type = 'person' AND people.id = overrides.target_id
         WHERE overrides.organisation_id = $1
         ORDER BY overrides.effective_on DESC, overrides.target_type, target_name`,
        [actor.context.organisationId],
      );
      return rows.rows.map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: row.target_name,
        allowed: row.allowed,
        effectiveOn: row.effective_on,
        effectiveUntil: row.effective_until,
        reason: row.reason,
      }));
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json({ policies: result });
  } catch { return json({ error: "INTERNAL_ERROR" }, 500); }
}
