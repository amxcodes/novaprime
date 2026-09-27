import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

async function hasOrganisationPermission(
  transaction: PoolClient,
  personId: string,
  permissionKey: string,
): Promise<boolean> {
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
        AND grants.permission_key = $2
        AND grants.scope = 'organisation'
    ) AS permitted`,
    [personId, permissionKey],
  );
  return result.rows[0]?.permitted === true;
}

async function hasAnyPermission(
  transaction: PoolClient,
  personId: string,
  permissionKey: string,
): Promise<boolean> {
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
         AND grants.permission_key = $2
     ) AS permitted`,
    [personId, permissionKey],
  );
  return result.rows[0]?.permitted === true;
}

async function readWithPermission<T>(
  request: Request,
  permissionKey: string,
  operation: (transaction: PoolClient, organisationId: string, actorId: string) => Promise<T>,
  scopeAware = false,
): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  const actor = await requestActor(request);
  if (!actor) {
    return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  }
  if (!isNormalOperationalActor(actor)) {
    return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);
  }

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      if (!(scopeAware
        ? await hasAnyPermission(transaction, actor.context.userId, permissionKey)
        : await hasOrganisationPermission(transaction, actor.context.userId, permissionKey))) {
        return undefined;
      }
      return operation(transaction, actor.context.organisationId, actor.context.userId);
    });
    if (result === undefined) {
      return json({ error: "PERMISSION_DENIED" }, 403);
    }
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readOrganisation(request: Request): Promise<Response> {
  return readWithPermission(request, "organisation.settings.manage", async (transaction, organisationId) => {
    const result = await transaction.query<{
      id: string;
      name: string;
      created_at: Date;
      attendance_mode: string | null;
      required_attendance_minutes: number | null;
      attendance_policy_effective_on: string | null;
    }>(
      `SELECT organisations.id, organisations.name, organisations.created_at,
              policies.mode AS attendance_mode,
              policies.required_attendance_minutes,
              policies.effective_on::text AS attendance_policy_effective_on
       FROM nova.organisations organisations
       LEFT JOIN LATERAL (
         SELECT mode, required_attendance_minutes, effective_on
         FROM nova.organisation_attendance_policies
         WHERE organisation_id = organisations.id
           AND effective_on <= current_date
           AND (effective_until IS NULL OR effective_until >= current_date)
         ORDER BY effective_on DESC
         LIMIT 1
       ) policies ON true
       WHERE organisations.id = $1`,
      [organisationId],
    );
    const organisation = result.rows[0];
    return organisation
      ? {
        organisation: {
          id: organisation.id,
          name: organisation.name,
          createdAt: organisation.created_at,
          attendancePolicy: organisation.attendance_mode
            ? {
              mode: organisation.attendance_mode,
              requiredAttendanceMinutes: organisation.required_attendance_minutes,
              effectiveOn: organisation.attendance_policy_effective_on,
            }
            : null,
        },
      }
      : { organisation: null };
  });
}

export async function readActorPermissionGrants(request: Request): Promise<Response> {
  try {
    authenticationConfiguration();
  } catch {
    return json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503);
  }

  const actor = await requestActor(request);
  if (!actor) return json({ error: "AUTHENTICATION_REQUIRED" }, 401);
  if (!isNormalOperationalActor(actor)) return json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403);

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction) => {
      const grants = await transaction.query<{
        permission_key: string;
        scope: string;
        office_id: string | null;
        organisation_department_id: string | null;
        client_id: string | null;
        client_workstream_id: string | null;
        group_id: string | null;
      }>(
        `WITH actor_business_date AS MATERIALIZED (
           SELECT nova.person_business_date($1) AS business_date
         )
         SELECT DISTINCT grants.permission_key, grants.scope::text AS scope,
                grants.office_id, grants.organisation_department_id,
                grants.client_id, grants.client_workstream_id, grants.group_id
         FROM nova.person_role_assignments assignments
         CROSS JOIN actor_business_date actor_date
         JOIN nova.roles roles ON roles.id = assignments.role_id
         JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
         WHERE assignments.person_id = $1
           AND roles.organisation_id = $2
           AND assignments.effective_on <= actor_date.business_date
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= actor_date.business_date)
           AND roles.archived_at IS NULL
         ORDER BY grants.permission_key, grants.scope::text,
                  grants.office_id, grants.organisation_department_id,
                  grants.client_id, grants.client_workstream_id, grants.group_id`,
        [actor.context.userId, actor.context.organisationId],
      );
      const owner = await transaction.query<{ is_super_admin: boolean }>(
        "SELECT nova.request_actor_is_super_admin() AS is_super_admin",
      );
      return {
        actorPersonId: actor.context.userId,
        isSuperAdmin: owner.rows[0]?.is_super_admin === true,
        grants: grants.rows.map((grant) => ({
          permissionKey: grant.permission_key,
          scope: grant.scope,
          officeId: grant.office_id,
          organisationDepartmentId: grant.organisation_department_id,
          clientId: grant.client_id,
          clientWorkstreamId: grant.client_workstream_id,
          groupId: grant.group_id,
        })),
      };
    });
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function readOffices(request: Request): Promise<Response> {
  return readWithPermission(request, "organisation.settings.manage", async (transaction, organisationId) => {
    const result = await transaction.query<{
      id: string;
      name: string;
      location: string | null;
      timezone: string;
      latitude: string | null;
      longitude: string | null;
      attendance_geofence_radius_meters: number;
    }>(
      `SELECT id, name, location, timezone, latitude, longitude, attendance_geofence_radius_meters
       FROM nova.offices
       WHERE organisation_id = $1
       ORDER BY name`,
      [organisationId],
    );
    return {
      offices: result.rows.map((office) => ({
        id: office.id,
        name: office.name,
        location: office.location,
        timezone: office.timezone,
        latitude: office.latitude === null ? null : Number(office.latitude),
        longitude: office.longitude === null ? null : Number(office.longitude),
        geofenceRadiusMeters: office.attendance_geofence_radius_meters,
      })),
    };
  });
}

export async function readDepartments(request: Request): Promise<Response> {
  return readWithPermission(request, "organisation.settings.manage", async (transaction, organisationId) => {
    const result = await transaction.query<{
      id: string;
      name: string;
    }>(
      `SELECT id, name
       FROM nova.organisation_departments
       WHERE organisation_id = $1
       ORDER BY name`,
      [organisationId],
    );
    return { departments: result.rows };
  });
}

export async function readPermissions(request: Request): Promise<Response> {
  return readWithPermission(request, "roles.view", async (transaction) => {
    const result = await transaction.query<{
      key: string;
      module: string;
      description: string;
      allowed_scopes: string[];
    }>(
      "SELECT key, module, description, allowed_scopes::text[] FROM nova.permissions ORDER BY module, key",
    );
    return {
      permissions: result.rows.map((permission) => ({
        key: permission.key,
        module: permission.module,
        description: permission.description,
        allowedScopes: permission.allowed_scopes,
      })),
    };
  });
}

export async function readRoles(request: Request): Promise<Response> {
  return readWithPermission(request, "roles.view", async (transaction, organisationId) => {
    const result = await transaction.query<{
      id: string;
      key: string;
      name: string;
      revision: number;
      is_protected: boolean;
      archived_at: Date | null;
      created_at: Date;
      work_enabled: boolean;
      can_receive_assignments: boolean;
      attendance_required: boolean;
      wfh_allowed: boolean;
      can_work_without_attendance: boolean;
      payroll_applicable: boolean;
      payroll_attendance_contributes: boolean;
      payroll_overtime_applicable: boolean;
      permission_grants: unknown;
    }>(
      `SELECT
         roles.id,
         roles.key,
         roles.name,
         roles.revision,
         roles.is_protected,
         roles.archived_at,
         roles.created_at,
         policies.work_enabled,
         policies.can_receive_assignments,
         policies.attendance_required,
         policies.wfh_allowed,
         policies.can_work_without_attendance,
         policies.payroll_applicable,
         policies.payroll_attendance_contributes,
         policies.payroll_overtime_applicable,
         COALESCE(
           json_agg(
             json_build_object(
               'permissionKey', grants.permission_key,
               'scope', grants.scope,
               'officeId', grants.office_id,
               'organisationDepartmentId', grants.organisation_department_id,
               'clientId', grants.client_id,
               'clientWorkstreamId', grants.client_workstream_id,
               'groupId', grants.group_id
             )
             ORDER BY grants.permission_key, grants.scope
           ) FILTER (WHERE grants.id IS NOT NULL),
           '[]'::json
         ) AS permission_grants
       FROM nova.roles roles
       LEFT JOIN nova.role_operational_policies policies ON policies.role_id = roles.id
       LEFT JOIN nova.role_permission_grants grants ON grants.role_id = roles.id
       WHERE roles.organisation_id = $1
       GROUP BY roles.id, policies.role_id
       ORDER BY roles.is_protected DESC, roles.archived_at NULLS FIRST, roles.name`,
      [organisationId],
    );
    return {
      roles: result.rows.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        revision: role.revision,
        isProtected: role.is_protected,
        archivedAt: role.archived_at,
        createdAt: role.created_at,
        operationalPolicy: {
          workEnabled: role.work_enabled,
          canReceiveAssignments: role.can_receive_assignments,
          attendanceRequired: role.attendance_required,
          wfhAllowed: role.wfh_allowed,
          canWorkWithoutAttendance: role.can_work_without_attendance,
          payrollApplicable: role.payroll_applicable,
          payrollAttendanceContributes: role.payroll_attendance_contributes,
          payrollOvertimeApplicable: role.payroll_overtime_applicable,
        },
        permissionGrants: role.permission_grants,
      })),
    };
  });
}

export async function readPeople(request: Request): Promise<Response> {
  return readWithPermission(request, "people.view", async (transaction, organisationId, actorId) => {
    const result = await transaction.query<{
      id: string;
      display_name: string;
      email: string;
      status: string | null;
      designation: string | null;
      employment_starts_on: string | null;
      manager_name: string | null;
      office_id: string | null;
      office_name: string | null;
      department_id: string | null;
      department_name: string | null;
      role_id: string | null;
      role_name: string | null;
      role_archived_at: Date | null;
      role_can_receive_assignments: boolean | null;
      invitation_email: string | null;
      invitation_expires_at: Date | null;
      invitation_accepted_at: Date | null;
      invitation_revoked_at: Date | null;
    }>(
      `SELECT
         people.id,
         people.display_name,
         people.email,
         status_period.status,
         employment.designation,
         employment.employment_starts_on,
         manager.display_name AS manager_name,
         office.id AS office_id,
         office.name AS office_name,
         department.id AS department_id,
         department.name AS department_name,
         role.id AS role_id,
         role.name AS role_name,
         role.archived_at AS role_archived_at,
         role_policy.can_receive_assignments AS role_can_receive_assignments,
         invitation.invitee_email AS invitation_email,
         invitation.expires_at AS invitation_expires_at,
         invitation.accepted_at AS invitation_accepted_at,
         invitation.revoked_at AS invitation_revoked_at
       FROM nova.people people
       LEFT JOIN LATERAL (
         SELECT status
         FROM nova.person_status_periods periods
         WHERE periods.person_id = people.id AND periods.ended_at IS NULL
         ORDER BY periods.effective_at DESC
         LIMIT 1
       ) status_period ON true
       LEFT JOIN LATERAL (
         SELECT designation, employment_starts_on, manager_person_id
         FROM nova.employment_terms terms
         WHERE terms.person_id = people.id AND terms.employment_ends_on IS NULL
         ORDER BY terms.employment_starts_on DESC
         LIMIT 1
       ) employment ON true
       LEFT JOIN nova.people manager ON manager.id = employment.manager_person_id
       LEFT JOIN LATERAL (
         SELECT offices.id, offices.name
         FROM nova.person_office_assignments assignments
         JOIN nova.offices offices ON offices.id = assignments.office_id
         WHERE assignments.person_id = people.id
           AND assignments.effective_on <= nova.person_business_date(people.id)
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
         ORDER BY assignments.effective_on DESC
         LIMIT 1
       ) office ON true
       LEFT JOIN LATERAL (
         SELECT departments.id, departments.name
         FROM nova.person_department_assignments assignments
         JOIN nova.organisation_departments departments
           ON departments.id = assignments.organisation_department_id
         WHERE assignments.person_id = people.id
           AND assignments.effective_on <= nova.person_business_date(people.id)
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
         ORDER BY assignments.effective_on DESC
         LIMIT 1
       ) department ON true
       LEFT JOIN LATERAL (
         SELECT roles.id, roles.name, roles.archived_at
         FROM nova.person_role_assignments assignments
         JOIN nova.roles roles ON roles.id = assignments.role_id
         WHERE assignments.person_id = people.id
           AND assignments.effective_on <= nova.person_business_date(people.id)
           AND (assignments.effective_until IS NULL OR assignments.effective_until >= nova.person_business_date(people.id))
         ORDER BY assignments.effective_on DESC
         LIMIT 1
       ) role ON true
       LEFT JOIN nova.role_operational_policies role_policy ON role_policy.role_id = role.id
       LEFT JOIN LATERAL (
         SELECT invitee_email, expires_at, accepted_at, revoked_at
         FROM nova.person_invitations invitations
         WHERE invitations.person_id = people.id
         ORDER BY invitations.invited_at DESC
         LIMIT 1
       ) invitation ON true
        WHERE people.organisation_id = $1
          AND EXISTS (
            SELECT 1
            FROM nova.person_role_assignments actor_assignments
            JOIN nova.roles actor_roles ON actor_roles.id = actor_assignments.role_id
            JOIN nova.role_permission_grants actor_grants ON actor_grants.role_id = actor_roles.id
            WHERE actor_assignments.person_id = $2
              AND actor_assignments.effective_on <= nova.person_business_date($2)
              AND (actor_assignments.effective_until IS NULL OR actor_assignments.effective_until >= nova.person_business_date($2))
              AND actor_roles.archived_at IS NULL
              AND actor_grants.permission_key = 'people.view'
              AND (
                actor_grants.scope = 'organisation'
                OR (actor_grants.scope = 'own_record' AND people.id = $2)
                OR (actor_grants.scope = 'office' AND actor_grants.office_id = office.id)
                OR (actor_grants.scope = 'organisation_department' AND actor_grants.organisation_department_id = department.id)
              )
          )
        ORDER BY people.display_name, people.email`,
       [organisationId, actorId],
    );
    return {
      people: result.rows.map((person) => ({
        id: person.id,
        displayName: person.display_name,
        email: person.email,
        status: person.status,
        designation: person.designation,
        employmentStartsOn: person.employment_starts_on,
        managerName: person.manager_name,
        office: person.office_id ? { id: person.office_id, name: person.office_name } : null,
        department: person.department_id
          ? { id: person.department_id, name: person.department_name }
          : null,
        role: person.role_id ? { id: person.role_id, name: person.role_name } : null,
        canReceiveAssignments: ["active", "notice"].includes(person.status ?? "") &&
          person.role_archived_at === null && person.role_can_receive_assignments === true,
        invitation: person.invitation_email
          ? {
            email: person.invitation_email,
            expiresAt: person.invitation_expires_at,
            acceptedAt: person.invitation_accepted_at,
            revokedAt: person.invitation_revoked_at,
          }
          : null,
      })),
    };
  }, true);
}

export async function readAuditEvents(request: Request): Promise<Response> {
  return readWithPermission(request, "people.view", async (transaction, organisationId) => {
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 50;
    const result = await transaction.query<{
      id: string;
      action: string;
      target_type: string;
      target_id: string;
      occurred_at: Date;
      details: unknown;
      actor_name: string | null;
    }>(
      `SELECT events.id, events.action, events.target_type, events.target_id,
              events.occurred_at, events.details,
              people.display_name AS actor_name
       FROM nova.audit_events events
       LEFT JOIN nova.people people ON people.id = events.actor_person_id
       WHERE events.organisation_id = $1
       ORDER BY events.occurred_at DESC
       LIMIT $2`,
      [organisationId, limit],
    );
    return {
      events: result.rows.map((event) => ({
        id: event.id,
        action: event.action,
        targetType: event.target_type,
        targetId: event.target_id,
        occurredAt: event.occurred_at,
        details: event.details,
        actorName: event.actor_name,
      })),
    };
  });
}
