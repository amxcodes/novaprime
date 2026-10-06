import type { PoolClient } from "pg";
import { authenticationConfiguration } from "../auth-configuration.js";
import { withDatabaseRequest, type DatabaseRequestContext } from "../db.js";
import { isNormalOperationalActor, requestActor } from "../request-actor.js";
import {
  availabilityOfficePickerSql,
  availabilityPickerPermissionsSql,
  availabilityShiftPickerSql,
  parseAvailabilityConfigurationPicker,
  parseWfhPolicyPicker,
  wfhDepartmentPickerSql,
  wfhOfficePickerSql,
  wfhPersonPickerSql,
  wfhPersonViewAccessSql,
} from "./availability-picker-search-model.js";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

type PickerOptionRow = { id: string; label: string };

async function pickerActor(request: Request): Promise<{ context: DatabaseRequestContext } | { response: Response }> {
  try {
    authenticationConfiguration();
  } catch {
    return { response: json({ error: "AUTHENTICATION_CONFIGURATION_REQUIRED" }, 503) };
  }
  const actor = await requestActor(request);
  if (!actor) return { response: json({ error: "AUTHENTICATION_REQUIRED" }, 401) };
  if (!isNormalOperationalActor(actor)) return { response: json({ error: "ACCOUNT_NOT_OPERATIONAL" }, 403) };
  return { context: actor.context };
}

async function hasOrganisationPermissions(
  transaction: PoolClient,
  actorId: string,
  organisationId: string,
  permissionKeys: readonly string[],
): Promise<boolean> {
  const result = await transaction.query<{ permission_count: number }>(
    availabilityPickerPermissionsSql,
    [actorId, organisationId, permissionKeys],
  );
  return Number(result.rows[0]?.permission_count) === new Set(permissionKeys).size;
}

export async function searchAvailabilityConfigurationTargets(request: Request): Promise<Response> {
  const picker = parseAvailabilityConfigurationPicker(request);
  if (!picker) return json({ error: "AVAILABILITY_PICKER_QUERY_INVALID" }, 400);
  const actor = await pickerActor(request);
  if ("response" in actor) return actor.response;

  const permissionKeys = picker.kind === "shift"
    ? ["availability.calendar.manage"]
    : picker.purpose === "calendar"
      ? ["organisation.settings.manage", "availability.calendar.manage"]
      : ["organisation.settings.manage", "availability.holiday.manage"];

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction: PoolClient) => {
      if (!await hasOrganisationPermissions(
        transaction,
        actor.context.userId,
        actor.context.organisationId,
        permissionKeys,
      )) return "PERMISSION_DENIED" as const;
      const rows = await transaction.query<PickerOptionRow>(
        picker.kind === "office" ? availabilityOfficePickerSql : availabilityShiftPickerSql,
        [actor.context.organisationId, picker.query, picker.limit],
      );
      return { options: rows.rows.map(({ id, label }) => ({ id, label })) };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function searchWfhPolicyTargets(request: Request): Promise<Response> {
  const picker = parseWfhPolicyPicker(request);
  if (!picker) return json({ error: "WFH_POLICY_PICKER_QUERY_INVALID" }, 400);
  const actor = await pickerActor(request);
  if ("response" in actor) return actor.response;

  const permissionKeys = picker.kind === "person"
    ? ["availability.wfh_policy.manage"]
    : ["availability.wfh_policy.manage", "organisation.settings.manage"];

  try {
    const result = await withDatabaseRequest(actor.context, async (transaction: PoolClient) => {
      if (!await hasOrganisationPermissions(
        transaction,
        actor.context.userId,
        actor.context.organisationId,
        permissionKeys,
      )) return "PERMISSION_DENIED" as const;

      if (picker.kind === "person") {
        const peopleView = await transaction.query<{ permitted: boolean }>(
          wfhPersonViewAccessSql,
          [actor.context.userId, actor.context.organisationId],
        );
        if (peopleView.rows[0]?.permitted !== true) return "PERMISSION_DENIED" as const;
      }

      const sql = picker.kind === "office"
        ? wfhOfficePickerSql
        : picker.kind === "organisation_department"
          ? wfhDepartmentPickerSql
          : wfhPersonPickerSql;
      const parameters = picker.kind === "person"
        ? [actor.context.organisationId, actor.context.userId, picker.query, picker.limit]
        : [actor.context.organisationId, picker.query, picker.limit];
      const rows = await transaction.query<PickerOptionRow>(sql, parameters);
      return { options: rows.rows.map(({ id, label }) => ({ id, label })) };
    });
    if (result === "PERMISSION_DENIED") return json({ error: result }, 403);
    return json(result);
  } catch {
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
}
