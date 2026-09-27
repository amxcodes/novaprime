const targetFieldByScope = {
  office: "officeId",
  organisation_department: "organisationDepartmentId",
  client: "clientId",
  client_workstream: "clientWorkstreamId",
  group: "groupId",
};

const workerPolicy = Object.freeze({
  workEnabled: true,
  canReceiveAssignments: true,
  attendanceRequired: true,
  wfhAllowed: true,
  canWorkWithoutAttendance: false,
  payrollApplicable: false,
  payrollAttendanceContributes: false,
  payrollOvertimeApplicable: false,
});

const workerGrants = [
  ["attendance.view", "own_record"],
  ["attendance.check_in", "own_record"],
  ["attendance.check_out", "own_record"],
  ["attendance.recover", "own_record"],
  ["attendance.change_mode", "own_record"],
  ["availability.wfh.request", "own_record"],
  ["leave.request", "own_record"],
  ["tasks.view", "assigned_work"],
  ["tasks.start", "assigned_work"],
  ["tasks.submit", "assigned_work"],
  ["tasks.reviewer_request", "assigned_work"],
  ["tasks.handover_request", "assigned_work"],
  ["tasks.handover_accept", "assigned_work"],
  ["work.timeline.view", "assigned_work"],
  ["work.timeline_adjust_own", "own_record"],
];

const hrGrants = [
  ["people.view", "organisation_department"],
  ["people.create", "organisation"],
  ["people.edit", "organisation_department"],
  ["people.invite", "organisation"],
  ["people.activate", "organisation"],
  ["people.freeze", "organisation_department"],
  ["people.offboard", "organisation_department"],
  ["attendance.view", "organisation_department"],
  ["attendance.recover", "organisation_department"],
  ["leave.review", "organisation_department"],
  ["availability.wfh.review", "organisation_department"],
  ["work.timeline.view", "organisation_department"],
];

const supervisorGrants = [
  ["workstreams.view", "client_workstream"],
  ["groups.view", "client_workstream"],
  ["tasks.view", "client_workstream"],
  ["tasks.create", "client_workstream"],
  ["tasks.edit", "client_workstream"],
  ["tasks.assign", "client_workstream"],
  ["tasks.reassign", "client_workstream"],
  ["tasks.review", "client_workstream"],
  ["tasks.reviewer_manage", "client_workstream"],
];

const coordinatorGrants = [
  ["clients.view", "client"],
  ["workstreams.view", "client_workstream"],
  ["workstreams.edit", "client_workstream"],
  ["groups.view", "client_workstream"],
  ["groups.create", "client_workstream"],
  ["groups.edit", "client_workstream"],
  ["tasks.view", "client_workstream"],
  ["tasks.create", "client_workstream"],
  ["tasks.edit", "client_workstream"],
  ["tasks.assign", "client_workstream"],
  ["tasks.reassign", "client_workstream"],
  ["tasks.review", "client_workstream"],
  ["tasks.reviewer_manage", "client_workstream"],
];

const adminGrants = [
  ["roles.view", "organisation"],
  ["roles.create", "organisation"],
  ["roles.edit", "organisation"],
  ["roles.assign", "organisation"],
  ["organisation.settings.manage", "organisation"],
  ["people.view", "organisation"],
  ["people.create", "organisation"],
  ["people.edit", "organisation"],
  ["people.invite", "organisation"],
  ["people.activate", "organisation"],
  ["people.freeze", "organisation"],
  ["people.offboard", "organisation"],
  ["clients.view", "organisation"],
  ["clients.create", "organisation"],
  ["clients.edit", "organisation"],
  ["clients.departments.manage", "organisation"],
  ["clients.members.manage", "organisation"],
  ["workstreams.view", "organisation"],
  ["workstreams.create", "organisation"],
  ["workstreams.edit", "organisation"],
  ["groups.view", "organisation"],
  ["groups.create", "organisation"],
  ["groups.edit", "organisation"],
  ["tasks.view", "organisation"],
  ["tasks.create", "organisation"],
  ["tasks.edit", "organisation"],
  ["tasks.assign", "organisation"],
  ["tasks.reassign", "organisation"],
  ["tasks.start", "organisation"],
  ["tasks.submit", "organisation"],
  ["tasks.review", "organisation"],
  ["tasks.reviewer_manage", "organisation"],
  ["tasks.reviewer_request", "organisation"],
  ["tasks.handover_request", "organisation"],
  ["tasks.handover_accept", "organisation"],
  ["tasks.catalog.view", "organisation"],
  ["tasks.catalog.propose", "organisation"],
  ["attendance.view", "organisation"],
  ["attendance.check_in", "organisation"],
  ["attendance.check_out", "organisation"],
  ["attendance.recover", "organisation"],
  ["attendance.change_mode", "organisation"],
  ["availability.office_geofence.manage", "organisation"],
  ["availability.calendar.view", "organisation"],
  ["availability.calendar.manage", "organisation"],
  ["availability.shift.view", "organisation"],
  ["availability.shift.manage", "organisation"],
  ["availability.holiday.view", "organisation"],
  ["availability.holiday.manage", "organisation"],
  ["availability.wfh_policy.view", "organisation"],
  ["availability.wfh_policy.manage", "organisation"],
  ["availability.wfh.request", "organisation"],
  ["availability.wfh.review", "organisation"],
  ["availability.exception.view", "organisation"],
  ["availability.exception.resolve", "organisation"],
  ["leave.request", "organisation"],
  ["leave.review", "organisation"],
  ["work.timeline.view", "organisation"],
  ["work.timeline_adjust_own", "organisation"],
  ["work.timeline_adjust_others", "organisation"],
  ["notifications.manage", "organisation"],
  ["notifications.delivery.view", "organisation"],
];

const rolePresetDefinitions = [
  {
    id: "employee",
    key: "employee",
    name: "Employee",
    description: "Own attendance and leave, assigned work, and normal reviewer/handover requests. Does not grant task creation outside an explicitly scoped editor role.",
    grants: workerGrants,
    operationalPolicy: workerPolicy,
  },
  {
    id: "hr",
    key: "hr",
    name: "HR",
    description: "Employee basics plus department-scoped people lifecycle, attendance recovery, leave/WFH review and timeline visibility.",
    grants: [...workerGrants, ...hrGrants],
    operationalPolicy: workerPolicy,
  },
  {
    id: "supervisor",
    key: "supervisor",
    name: "Supervisor",
    description: "Employee basics plus workstream-targeted task creation, assignment and review. Choose the exact workstream for each grant.",
    grants: [...workerGrants, ...supervisorGrants],
    operationalPolicy: workerPolicy,
  },
  {
    id: "client_coordinator",
    key: "client_coordinator",
    name: "Client Coordinator",
    description: "Client/workstream-targeted collaboration and task management. Exact client and workstream targets must be selected.",
    grants: [...workerGrants, ...coordinatorGrants],
    operationalPolicy: workerPolicy,
  },
  {
    id: "admin",
    key: "admin",
    name: "Admin",
    description: "Broad organisation operations and role administration; deliberately excludes payroll, manual auth recovery, deployment-origin control, billable-task action permission and catalogue management.",
    grants: adminGrants,
    operationalPolicy: workerPolicy,
  },
];

export const rolePresets = Object.freeze(rolePresetDefinitions.map((preset) => Object.freeze({
  ...preset,
  grants: Object.freeze(preset.grants.map(([permissionKey, scope]) => Object.freeze({ permissionKey, scope }))),
  operationalPolicy: Object.freeze({ ...preset.operationalPolicy }),
})));

const scopesRequiringTarget = new Set(Object.keys(targetFieldByScope));

export function rolePresetDraft(presetId, permissions) {
  const preset = rolePresets.find((candidate) => candidate.id === presetId);
  if (!preset) return undefined;
  const permissionByKey = new Map((permissions || []).map((permission) => [permission.key, permission]));
  const grants = [];
  const omitted = [];
  for (const grant of preset.grants) {
    const permission = permissionByKey.get(grant.permissionKey);
    if (!permission) {
      omitted.push({ permissionKey: grant.permissionKey, reason: "permission_unavailable" });
      continue;
    }
    if (!Array.isArray(permission.allowedScopes) || !permission.allowedScopes.includes(grant.scope)) {
      omitted.push({ permissionKey: grant.permissionKey, reason: "preset_scope_unavailable" });
      continue;
    }
    grants.push({ ...grant });
  }
  return {
    id: preset.id,
    key: preset.key,
    name: preset.name,
    description: preset.description,
    grants,
    operationalPolicy: { ...preset.operationalPolicy },
    omitted,
    targetGrantCount: grants.filter((grant) => scopesRequiringTarget.has(grant.scope)).length,
  };
}

export function uniqueRoleKey(baseKey, roles) {
  const used = new Set((roles || []).map((role) => role && role.key).filter((key) => typeof key === "string"));
  if (!used.has(baseKey)) return baseKey;
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const ending = `_${suffix}`;
    const candidate = baseKey.slice(0, 63 - ending.length) + ending;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("ROLE_KEY_SPACE_EXHAUSTED");
}

export function groupRolePermissionGrants(grants) {
  const grouped = new Map();
  for (const grant of grants || []) {
    if (!grouped.has(grant.permissionKey)) grouped.set(grant.permissionKey, []);
    grouped.get(grant.permissionKey).push(grant);
  }
  return grouped;
}

export function leastPrivilegedRoleScope(allowedScopes) {
  const preference = [
    "own_record", "assigned_work", "group", "client_workstream", "client",
    "organisation_department", "office", "organisation",
  ];
  return preference.find((scope) => allowedScopes.includes(scope)) || allowedScopes[0];
}

export function collectRolePermissionGrants(rows) {
  const grants = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row.enabled) continue;
    if (!row.grants.length) return { error: "ROLE_GRANT_REQUIRED" };
    for (const editor of row.grants) {
      const field = targetFieldByScope[editor.scope];
      const targetId = typeof editor.targetId === "string" ? editor.targetId.trim() : "";
      if (field && !targetId) return { error: "ROLE_GRANT_TARGET_REQUIRED" };
      const signature = [row.permissionKey, editor.scope, targetId].join("\u0000");
      if (seen.has(signature)) return { error: "ROLE_GRANT_DUPLICATE" };
      seen.add(signature);
      grants.push({
        permissionKey: row.permissionKey,
        scope: editor.scope,
        ...(field ? { [field]: targetId } : {}),
      });
    }
  }
  return { grants };
}
