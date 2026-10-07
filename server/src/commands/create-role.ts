import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import { enqueueNotification } from "./notifications.js";
import { customerRolePermissionGrantsAreValid } from "./role-permission-policy.js";

type PermissionScope =
  | "organisation"
  | "own_record"
  | "office"
  | "organisation_department"
  | "client"
  | "client_workstream"
  | "group"
  | "assigned_work";

export type PermissionGrantInput = Readonly<{
  permissionKey: string;
  scope: PermissionScope;
  officeId?: string;
  organisationDepartmentId?: string;
  clientId?: string;
  clientWorkstreamId?: string;
  groupId?: string;
}>;

type OperationalPolicyInput = Readonly<{
  workEnabled: boolean;
  canReceiveAssignments: boolean;
  attendanceRequired: boolean;
  wfhAllowed: boolean;
  canWorkWithoutAttendance: boolean;
  payrollApplicable: boolean;
  payrollAttendanceContributes: boolean;
  payrollOvertimeApplicable: boolean;
}>;

export type CreateRoleInput = Readonly<{
  key: string;
  name: string;
  permissionGrants: readonly PermissionGrantInput[];
  operationalPolicy: OperationalPolicyInput;
}>;

type UpdateRoleInput = CreateRoleInput & Readonly<{ expectedRevision: number }>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleKeyPattern = /^[a-z][a-z0-9_]{1,62}$/;
const policyKeys = [
  "workEnabled",
  "canReceiveAssignments",
  "attendanceRequired",
  "wfhAllowed",
  "canWorkWithoutAttendance",
  "payrollApplicable",
  "payrollAttendanceContributes",
  "payrollOvertimeApplicable",
] as const;
const scopes = new Set<PermissionScope>([
  "organisation",
  "own_record",
  "office",
  "organisation_department",
  "client",
  "client_workstream",
  "group",
  "assigned_work",
]);

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

function policyFrom(value: unknown): OperationalPolicyInput | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (!policyKeys.every((key) => typeof candidate[key] === "boolean")) {
    return undefined;
  }

  return Object.freeze({
    workEnabled: candidate.workEnabled as boolean,
    canReceiveAssignments: candidate.canReceiveAssignments as boolean,
    attendanceRequired: candidate.attendanceRequired as boolean,
    wfhAllowed: candidate.wfhAllowed as boolean,
    canWorkWithoutAttendance: candidate.canWorkWithoutAttendance as boolean,
    payrollApplicable: candidate.payrollApplicable as boolean,
    payrollAttendanceContributes: candidate.payrollAttendanceContributes as boolean,
    payrollOvertimeApplicable: candidate.payrollOvertimeApplicable as boolean,
  });
}

function grantFrom(value: unknown): PermissionGrantInput | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.permissionKey !== "string" ||
    !candidate.permissionKey ||
    typeof candidate.scope !== "string" ||
    !scopes.has(candidate.scope as PermissionScope)
  ) {
    return undefined;
  }

  const scope = candidate.scope as PermissionScope;
  const officeId = candidate.officeId;
  const organisationDepartmentId = candidate.organisationDepartmentId;
  const clientId = candidate.clientId;
  const clientWorkstreamId = candidate.clientWorkstreamId;
  const groupId = candidate.groupId;
  const hasOffice = typeof officeId === "string" && uuidPattern.test(officeId);
  const hasDepartment = typeof organisationDepartmentId === "string" &&
    uuidPattern.test(organisationDepartmentId);
  const hasClient = typeof clientId === "string" && uuidPattern.test(clientId);
  const hasClientWorkstream = typeof clientWorkstreamId === "string" && uuidPattern.test(clientWorkstreamId);
  const hasGroup = typeof groupId === "string" && uuidPattern.test(groupId);

  if (
    (scope === "office" && (!hasOffice || organisationDepartmentId !== undefined || clientId !== undefined || clientWorkstreamId !== undefined || groupId !== undefined)) ||
    (scope === "organisation_department" && (!hasDepartment || officeId !== undefined || clientId !== undefined || clientWorkstreamId !== undefined || groupId !== undefined)) ||
    (scope === "client" && (!hasClient || officeId !== undefined || organisationDepartmentId !== undefined || clientWorkstreamId !== undefined || groupId !== undefined)) ||
    (scope === "client_workstream" && (!hasClientWorkstream || officeId !== undefined || organisationDepartmentId !== undefined || clientId !== undefined || groupId !== undefined)) ||
    (scope === "group" && (!hasGroup || officeId !== undefined || organisationDepartmentId !== undefined || clientId !== undefined || clientWorkstreamId !== undefined)) ||
    ((scope === "organisation" || scope === "own_record" || scope === "assigned_work") &&
      (officeId !== undefined || organisationDepartmentId !== undefined || clientId !== undefined || clientWorkstreamId !== undefined || groupId !== undefined))
  ) {
    return undefined;
  }

  return Object.freeze({
    permissionKey: candidate.permissionKey,
    scope,
    ...(hasOffice ? { officeId } : {}),
    ...(hasDepartment ? { organisationDepartmentId } : {}),
    ...(hasClient ? { clientId } : {}),
    ...(hasClientWorkstream ? { clientWorkstreamId } : {}),
    ...(hasGroup ? { groupId } : {}),
  });
}

export function createRoleInput(body: unknown): CreateRoleInput | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.key !== "string" ||
    !roleKeyPattern.test(candidate.key) ||
    candidate.key === "super_admin" ||
    typeof candidate.name !== "string" ||
    !candidate.name.trim() ||
    !Array.isArray(candidate.permissionGrants)
  ) {
    return undefined;
  }

  const permissionGrants = candidate.permissionGrants.map(grantFrom);
  const operationalPolicy = policyFrom(candidate.operationalPolicy);
  if (permissionGrants.some((grant) => !grant) || !operationalPolicy) {
    return undefined;
  }

  const grants = permissionGrants as PermissionGrantInput[];
  const uniqueGrants = new Set(
    grants.map((grant) =>
      [grant.permissionKey, grant.scope, grant.officeId ?? "", grant.organisationDepartmentId ?? "", grant.clientId ?? "", grant.clientWorkstreamId ?? "", grant.groupId ?? ""].join(":")),
  );
  if (uniqueGrants.size !== grants.length) {
    return undefined;
  }

  return Object.freeze({
    key: candidate.key,
    name: candidate.name.trim(),
    permissionGrants: Object.freeze(grants),
    operationalPolicy,
  });
}

export function updateRoleInput(body: unknown): UpdateRoleInput | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = body as Record<string, unknown>;
  const input = createRoleInput(body);
  if (!input || !Number.isSafeInteger(candidate.expectedRevision) ||
    (candidate.expectedRevision as number) < 1) return undefined;
  return Object.freeze({ ...input, expectedRevision: candidate.expectedRevision as number });
}

async function canCreateRole(transaction: PoolClient, actorId: string): Promise<boolean> {
  const result = await transaction.query<{ permitted: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM nova.person_role_assignments assignments
      JOIN nova.roles roles ON roles.id = assignments.role_id
      JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
      WHERE assignments.person_id = $1
        AND assignments.effective_on <= nova.person_business_date($1)
        AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
        AND roles.archived_at IS NULL
        AND grants.permission_key = 'roles.create'
        AND grants.scope = 'organisation'
    ) AS permitted`,
    [actorId],
  );

  return result.rows[0]?.permitted === true;
}

async function canGrantPermissions(
  transaction: PoolClient,
  actorId: string,
  permissionKeys: readonly string[],
): Promise<boolean> {
  if (permissionKeys.length === 0) return true;
  const result = await transaction.query<{ is_super_admin: boolean; permitted_count: string }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       WHERE assignments.person_id = $1
         AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND roles.key = 'super_admin'
         AND roles.is_protected
         AND roles.archived_at IS NULL
     ) AS is_super_admin,
     (
       SELECT count(DISTINCT grants.permission_key)::text
       FROM nova.person_role_assignments assignments
       JOIN nova.roles roles ON roles.id = assignments.role_id
       JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE assignments.person_id = $1
         AND assignments.effective_on <= nova.person_business_date($1)
         AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
         AND roles.archived_at IS NULL
         AND grants.scope = 'organisation'
         AND grants.permission_key = ANY($2::text[])
     ) AS permitted_count`,
    [actorId, permissionKeys],
  );
  const row = result.rows[0];
  return row?.is_super_admin === true || Number(row?.permitted_count ?? 0) === permissionKeys.length;
}

async function grantTargetExists(
  transaction: PoolClient,
  context: DatabaseRequestContext,
  grant: PermissionGrantInput,
): Promise<boolean> {
  const target = grant.officeId
    ? await transaction.query("SELECT id FROM nova.offices WHERE id = $1 AND organisation_id = $2", [grant.officeId, context.organisationId])
    : grant.organisationDepartmentId
    ? await transaction.query("SELECT id FROM nova.organisation_departments WHERE id = $1 AND organisation_id = $2", [grant.organisationDepartmentId, context.organisationId])
    : grant.clientId
    ? await transaction.query("SELECT id FROM nova.clients WHERE id = $1 AND organisation_id = $2", [grant.clientId, context.organisationId])
    : grant.clientWorkstreamId
    ? await transaction.query("SELECT id FROM nova.client_workstreams WHERE id = $1 AND organisation_id = $2", [grant.clientWorkstreamId, context.organisationId])
    : grant.groupId
    ? await transaction.query("SELECT id FROM nova.work_groups WHERE id = $1 AND organisation_id = $2", [grant.groupId, context.organisationId])
    : undefined;
  return !target || target.rows.length === 1;
}

async function createRole(
  context: DatabaseRequestContext,
  input: CreateRoleInput,
): Promise<string | "PERMISSION_DENIED" | "ROLE_ALREADY_EXISTS" | "ROLE_INPUT_INVALID"> {
  try {
    return await withDatabaseRequest(context, async (transaction) => {
      if (!await canCreateRole(transaction, context.userId)) {
        return "PERMISSION_DENIED";
      }

      const permissionKeys = [...new Set(input.permissionGrants.map((grant) => grant.permissionKey))];
      const knownPermissions = await transaction.query<{
        key: string;
        allowed_scopes: string[];
        customer_role_assignable: boolean;
      }>(
        `SELECT key, allowed_scopes::text[], customer_role_assignable
         FROM nova.permissions WHERE key = ANY($1::text[])`,
        [permissionKeys],
      );
      if (knownPermissions.rows.length !== permissionKeys.length) {
        return "ROLE_INPUT_INVALID";
      }
      const assignability = new Map(knownPermissions.rows.map((permission) => [permission.key, permission.customer_role_assignable]));
      if (!customerRolePermissionGrantsAreValid([], input.permissionGrants, knownPermissions.rows)) {
        return "ROLE_INPUT_INVALID";
      }
      if (!await canGrantPermissions(transaction, context.userId, permissionKeys)) {
        return "PERMISSION_DENIED";
      }

      for (const grant of input.permissionGrants) {
        if (!await grantTargetExists(transaction, context, grant)) {
          return "ROLE_INPUT_INVALID";
        }
      }

      const role = await transaction.query<{ id: string }>(
        "INSERT INTO nova.roles (organisation_id, key, name) VALUES ($1, $2, $3) RETURNING id",
        [context.organisationId, input.key, input.name],
      );
      const roleId = role.rows[0]?.id;
      if (!roleId) {
        throw new Error("ROLE_CREATE_RESULT_MISSING");
      }

      const policy = input.operationalPolicy;
      await transaction.query(
        `INSERT INTO nova.role_operational_policies (
          role_id, work_enabled, can_receive_assignments, attendance_required,
          wfh_allowed, can_work_without_attendance, payroll_applicable,
          payroll_attendance_contributes, payroll_overtime_applicable
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          roleId,
          policy.workEnabled,
          policy.canReceiveAssignments,
          policy.attendanceRequired,
          policy.wfhAllowed,
          policy.canWorkWithoutAttendance,
          policy.payrollApplicable,
          policy.payrollAttendanceContributes,
          policy.payrollOvertimeApplicable,
        ],
      );

      for (const grant of input.permissionGrants) {
        await transaction.query(
          `INSERT INTO nova.role_permission_grants (
            role_id, permission_key, scope, office_id, organisation_department_id,
            client_id, client_workstream_id, group_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            roleId,
            grant.permissionKey,
            grant.scope,
            grant.officeId ?? null,
            grant.organisationDepartmentId ?? null,
            grant.clientId ?? null,
            grant.clientWorkstreamId ?? null,
            grant.groupId ?? null,
          ],
        );
      }

      await transaction.query(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'roles.create', 'role', $3, $4)`,
        [
          context.organisationId,
          context.userId,
          roleId,
          JSON.stringify({ key: input.key, permission_grant_count: input.permissionGrants.length }),
        ],
      );

      return roleId;
    });
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return "ROLE_ALREADY_EXISTS";
    }

    throw error;
  }
}

async function editRole(
  context: DatabaseRequestContext,
  roleId: string,
  input: UpdateRoleInput,
): Promise<{ roleId: string; revision: number } | "PERMISSION_DENIED" | "ROLE_NOT_FOUND" | "ROLE_ALREADY_EXISTS" | "ROLE_INPUT_INVALID" | "ROLE_VERSION_CONFLICT"> {
  try {
    return await withDatabaseRequest(context, async (transaction) => {
      const permitted = await transaction.query<{ permitted: boolean }>(
        `SELECT EXISTS (
          SELECT 1
          FROM nova.person_role_assignments assignments
          JOIN nova.roles roles ON roles.id = assignments.role_id
          JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
          WHERE assignments.person_id = $1
            AND assignments.effective_on <= nova.person_business_date($1)
            AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date($1))
            AND roles.archived_at IS NULL
            AND grants.permission_key = 'roles.edit'
            AND grants.scope = 'organisation'
        ) AS permitted`,
        [context.userId],
      );
      if (permitted.rows[0]?.permitted !== true) {
        return "PERMISSION_DENIED";
      }

      const target = await transaction.query<{
        is_protected: boolean;
        revision: number;
        key: string;
        name: string;
        work_enabled: boolean;
        can_receive_assignments: boolean;
        attendance_required: boolean;
        wfh_allowed: boolean;
        can_work_without_attendance: boolean;
        payroll_applicable: boolean;
        payroll_attendance_contributes: boolean;
        payroll_overtime_applicable: boolean;
        permission_grants: PermissionGrantInput[];
      }>(
        `SELECT roles.is_protected, roles.revision, roles.key, roles.name,
                policies.work_enabled, policies.can_receive_assignments,
                policies.attendance_required, policies.wfh_allowed,
                policies.can_work_without_attendance, policies.payroll_applicable,
                policies.payroll_attendance_contributes, policies.payroll_overtime_applicable,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'permissionKey', grants.permission_key,
                    'scope', grants.scope::text,
                    'officeId', grants.office_id,
                    'organisationDepartmentId', grants.organisation_department_id,
                    'clientId', grants.client_id,
                    'clientWorkstreamId', grants.client_workstream_id,
                    'groupId', grants.group_id
                  ) ORDER BY grants.permission_key, grants.scope,
                    grants.office_id, grants.organisation_department_id,
                    grants.client_id, grants.client_workstream_id, grants.group_id)
                  FROM nova.role_permission_grants grants
                  WHERE grants.role_id = roles.id
                ), '[]'::jsonb) AS permission_grants
         FROM nova.roles roles
         JOIN nova.role_operational_policies policies ON policies.role_id = roles.id
         WHERE roles.id = $1 AND roles.organisation_id = $2 AND roles.archived_at IS NULL
         FOR UPDATE OF roles`,
        [roleId, context.organisationId],
      );
      if (target.rows.length !== 1 || target.rows[0]?.is_protected) {
        return "ROLE_NOT_FOUND";
      }
      const previous = target.rows[0]!;
      if (previous.revision !== input.expectedRevision) return "ROLE_VERSION_CONFLICT" as const;

      const permissionKeys = [...new Set(input.permissionGrants.map((grant) => grant.permissionKey))];
      const catalogueKeys = [...new Set([
        ...permissionKeys,
        ...previous.permission_grants.map((grant) => grant.permissionKey),
      ])];
      const knownPermissions = await transaction.query<{
        key: string;
        allowed_scopes: string[];
        customer_role_assignable: boolean;
      }>(
        `SELECT key, allowed_scopes::text[], customer_role_assignable
         FROM nova.permissions WHERE key = ANY($1::text[])`,
        [catalogueKeys],
      );
      if (knownPermissions.rows.length !== catalogueKeys.length) {
        return "ROLE_INPUT_INVALID";
      }
      const assignability = new Map(knownPermissions.rows.map((permission) => [permission.key, permission.customer_role_assignable]));
      if (!customerRolePermissionGrantsAreValid(
        previous.permission_grants,
        input.permissionGrants,
        knownPermissions.rows,
      )) {
        return "ROLE_INPUT_INVALID";
      }
      const grantablePermissionKeys = permissionKeys.filter((permissionKey) => assignability.get(permissionKey) === true);
      if (!await canGrantPermissions(transaction, context.userId, grantablePermissionKeys)) {
        return "PERMISSION_DENIED";
      }

      for (const grant of input.permissionGrants) {
        if (!await grantTargetExists(transaction, context, grant)) {
          return "ROLE_INPUT_INVALID";
        }
      }

      const updatedRole = await transaction.query<{ revision: number }>(
        `UPDATE nova.roles
         SET key = $2, name = $3, revision = revision + 1
         WHERE id = $1 AND revision = $4
         RETURNING revision`,
        [roleId, input.key, input.name, input.expectedRevision],
      );
      const revision = updatedRole.rows[0]?.revision;
      if (revision === undefined) return "ROLE_VERSION_CONFLICT" as const;
      const policy = input.operationalPolicy;
      await transaction.query(
        `UPDATE nova.role_operational_policies
         SET work_enabled = $2,
             can_receive_assignments = $3,
             attendance_required = $4,
             wfh_allowed = $5,
             can_work_without_attendance = $6,
             payroll_applicable = $7,
             payroll_attendance_contributes = $8,
             payroll_overtime_applicable = $9
         WHERE role_id = $1`,
        [
          roleId,
          policy.workEnabled,
          policy.canReceiveAssignments,
          policy.attendanceRequired,
          policy.wfhAllowed,
          policy.canWorkWithoutAttendance,
          policy.payrollApplicable,
          policy.payrollAttendanceContributes,
          policy.payrollOvertimeApplicable,
        ],
      );
      await transaction.query("DELETE FROM nova.role_permission_grants WHERE role_id = $1", [roleId]);
      for (const grant of input.permissionGrants) {
        await transaction.query(
          `INSERT INTO nova.role_permission_grants (
            role_id, permission_key, scope, office_id, organisation_department_id,
            client_id, client_workstream_id, group_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            roleId,
            grant.permissionKey,
            grant.scope,
            grant.officeId ?? null,
            grant.organisationDepartmentId ?? null,
            grant.clientId ?? null,
            grant.clientWorkstreamId ?? null,
            grant.groupId ?? null,
          ],
        );
      }
      const audit = await transaction.query<{ id: string }>(
        `INSERT INTO nova.audit_events (
          organisation_id, actor_person_id, action, target_type, target_id, details
        ) VALUES ($1, $2, 'roles.update', 'role', $3, $4)
        RETURNING id`,
        [
          context.organisationId,
          context.userId,
          roleId,
          JSON.stringify({
            before: {
              revision: previous.revision,
              key: previous.key,
              name: previous.name,
              permissionGrants: previous.permission_grants,
              operationalPolicy: {
                workEnabled: previous.work_enabled,
                canReceiveAssignments: previous.can_receive_assignments,
                attendanceRequired: previous.attendance_required,
                wfhAllowed: previous.wfh_allowed,
                canWorkWithoutAttendance: previous.can_work_without_attendance,
                payrollApplicable: previous.payroll_applicable,
                payrollAttendanceContributes: previous.payroll_attendance_contributes,
                payrollOvertimeApplicable: previous.payroll_overtime_applicable,
              },
            },
            after: {
              revision,
              key: input.key,
              name: input.name,
              permissionGrants: input.permissionGrants,
              operationalPolicy: input.operationalPolicy,
            },
          }),
        ],
      );
      const auditId = audit.rows[0]?.id ?? roleId;
      const members = await transaction.query<{ person_id: string }>(
        `SELECT DISTINCT assignments.person_id
         FROM nova.person_role_assignments assignments
         JOIN nova.person_status_periods statuses
           ON statuses.person_id = assignments.person_id AND statuses.ended_at IS NULL
         WHERE assignments.role_id = $1
           AND statuses.status IN ('active', 'notice')
           AND assignments.effective_on <= nova.person_business_date(assignments.person_id)
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(assignments.person_id))`,
        [roleId],
      );
      for (const member of members.rows) {
        await enqueueNotification(transaction, {
          organisationId: context.organisationId,
          recipientPersonId: member.person_id,
          eventKey: "people.role_changed",
          title: "Your role permissions changed",
          body: `The ${input.name} role configuration was updated.`,
          aggregateType: "role",
          aggregateId: roleId,
          deepLink: "/?view=admin",
          idempotencyKey: `people.role_changed:${auditId}:${member.person_id}`,
        });
      }
      return { roleId, revision };
    });
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return "ROLE_ALREADY_EXISTS";
    }
    throw error;
  }
}

export async function createCustomRole(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "ROLE_INPUT_INVALID" }, 400);
  }

  const input = createRoleInput(body);
  if (!input) {
    return json({ error: "ROLE_INPUT_INVALID" }, 400);
  }

  const actor = await requestActor(request);
  if (!actor) {
    return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  }
  if (!isNormalOperationalActor(actor)) {
    return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  }

  try {
    const result = await createRole(actor.context, input);
    if (result === "PERMISSION_DENIED") {
      return json({ error: result }, 403);
    }
    if (result === "ROLE_INPUT_INVALID") {
      return json({ error: result }, 400);
    }
    if (result === "ROLE_ALREADY_EXISTS") {
      return json({ error: result }, 409);
    }

    return json({ roleId: result, revision: 1 }, 201);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateCustomRole(request: Request, roleId: string): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "ROLE_INPUT_INVALID" }, 400);
  }
  const input = updateRoleInput(body);
  if (!input) {
    return json({ error: "ROLE_INPUT_INVALID" }, 400);
  }
  const actor = await requestActor(request);
  if (!actor) {
    return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  }
  if (!isNormalOperationalActor(actor)) {
    return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  }

  try {
    const result = await editRole(actor.context, roleId, input);
    if (result === "PERMISSION_DENIED") {
      return json({ error: result }, 403);
    }
    if (result === "ROLE_NOT_FOUND") {
      return json({ error: result }, 404);
    }
    if (result === "ROLE_INPUT_INVALID") {
      return json({ error: result }, 400);
    }
    if (result === "ROLE_ALREADY_EXISTS") {
      return json({ error: result }, 409);
    }
    if (result === "ROLE_VERSION_CONFLICT") {
      return json({ error: result }, 409);
    }
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
