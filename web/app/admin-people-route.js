const onboardingPermissions = Object.freeze(["people.edit", "people.activate", "roles.assign"]);
const manageableStatuses = Object.freeze(["active", "notice"]);
const freezableStatuses = Object.freeze(["active", "notice", "onboarding"]);

/**
 * Host adapter for the Admin People feature. It projects the legacy roster into
 * the feature's bounded contract and keeps every command tied to the exact
 * Admin snapshot that produced its controls.
 */
export function createAdminPeopleRoute({
  state,
  target,
  lifetime,
  identityEpoch,
  isCurrentPageRequest,
  canInviteAdminPeople,
  canViewAdminPeople,
  hasPermissionGrant,
  adminReadIssue,
  adminCommandUiError,
  runProtectedCommand,
  describeInvitationFeedback,
  reflectInvitationDelivery,
  errorText,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    canInviteAdminPeople,
    canViewAdminPeople,
    hasPermissionGrant,
    adminReadIssue,
    adminCommandUiError,
    runProtectedCommand,
    describeInvitationFeedback,
    reflectInvitationDelivery,
    errorText,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  const mountedIdentityEpoch = identityEpoch ?? state.identityEpoch;

  function isCurrent(data, current = state.adminData) {
    return target.isConnected === true &&
      isCurrentPageRequest(lifetime) &&
      state.identityEpoch === mountedIdentityEpoch &&
      current === data &&
      state.adminData === data;
  }

  function requireCurrent(data, message = "The Admin page changed before this action could start. Refresh and try again.") {
    if (!isCurrent(data)) throw adminCommandUiError(message);
  }

  function requirePeopleRow(data, personId, allowedStatuses, permission) {
    requireCurrent(data, "The Admin page changed before this People action could start. Refresh and try again.");
    const current = state.adminData;
    const person = Array.isArray(current?.people?.people) && !current.people.readError
      ? current.people.people.find((row) => row?.id === personId)
      : null;
    const actorPersonId = current?.actorGrants?.actorPersonId;
    if (!canViewAdminPeople(current?.actorGrants) || !person ||
        (allowedStatuses && !allowedStatuses.includes(person.status)) ||
        (permission !== "people.invite" && (!actorPersonId || person.id === actorPersonId)) ||
        !hasPermissionGrant(current.actorGrants, permission, adminPersonPermissionTarget(person))) {
      throw adminCommandUiError("This person or action is no longer available in your current access. Refresh Admin and try again.");
    }
    return person;
  }

  function runMutation(data, permissionCheck, path, payload, successMessage, afterSuccess) {
    requireCurrent(data);
    return runProtectedCommand(
      (current) => isCurrent(data, current) && permissionCheck(current),
      {},
      path,
      payload,
      successMessage,
      afterSuccess,
    );
  }

  function projectPeopleRead(data, canViewPeople) {
    if (!canViewPeople) {
      return {
        status: "unavailable",
        message: "The Admin directory requires organization-scoped people.view access.",
      };
    }
    if (data.people?.readState === "not-requested") {
      return {
        status: "unavailable",
        message: "The authorized organization people list was not requested for this view.",
      };
    }
    const issue = adminReadIssue(data.people, "people");
    if (issue) {
      return ["PREREQUISITE_PERMISSION_REQUIRED", "PERMISSION_DENIED"].includes(data.people?.readError)
        ? { status: "unavailable", message: issue.message }
        : { status: "error", message: issue.message };
    }
    if (!Array.isArray(data.people?.people)) {
      return { status: "error", message: "The people response could not be read. Refresh Admin to try again." };
    }
    return { status: "ready" };
  }

  function projectOnboardingRead(person, data, peopleRead, canCompleteOnboarding) {
    if (!canCompleteOnboarding) {
      return { status: "denied", message: "You do not have all permissions required to complete onboarding." };
    }
    if (!hasPermissionGrant(data.actorGrants, "organisation.settings.manage")) {
      return { status: "denied", message: "Organization settings access is required to load office and department options." };
    }
    if (!hasPermissionGrant(data.actorGrants, "roles.view")) {
      return { status: "denied", message: "roles.view access is required to load onboarding role options." };
    }
    const reads = [
      [data.offices, "offices needed to complete onboarding"],
      [data.departments, "departments needed to complete onboarding"],
      [data.roles, "roles needed to complete onboarding"],
    ];
    const failed = reads.map(([result, resource]) => ({ result, issue: adminReadIssue(result, resource) }))
      .find((entry) => entry.issue);
    if (failed) {
      const denied = ["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"].includes(failed.result?.readError);
      return { status: denied ? "denied" : "unavailable", message: failed.issue.message };
    }
    if (peopleRead.status !== "ready") {
      return { status: "unavailable", message: "The authorized people list is needed to load manager choices." };
    }
    const offices = data.offices?.offices;
    const departments = data.departments?.departments;
    const roles = data.roles?.roles;
    const managers = data.people?.people;
    if (![offices, departments, roles, managers].every(Array.isArray)) {
      return { status: "unavailable", message: "Required office, department, role, or manager options could not be read." };
    }
    return {
      status: "ready",
      offices: offices.flatMap((office) =>
        validIdName(office) && typeof office.timezone === "string"
          ? [{ id: office.id, name: office.name, timezone: office.timezone }]
          : [],
      ),
      departments: departments.flatMap((department) => validIdName(department)
        ? [{ id: department.id, name: department.name }]
        : []),
      roles: roles.flatMap((role) => validIdName(role) && role.isProtected !== true && !role.archivedAt
        ? [{ id: role.id, name: role.name }]
        : []),
      managers: managers.flatMap((manager) =>
        validId(manager) && manager.id !== person.id && ["active", "notice"].includes(manager.status)
          ? [{ id: manager.id, name: text(manager.displayName) || text(manager.email) }]
          : [],
      ),
    };
  }

  function projectPerson(person, data, peopleRead) {
    if (!person || typeof person !== "object" || typeof person.id !== "string" || !person.id.trim()) return null;
    const status = typeof person.status === "string" && person.status.trim() ? person.status : "unknown";
    const targetPermission = adminPersonPermissionTarget(person);
    const actorPersonId = data.actorGrants?.actorPersonId;
    const isOtherPerson = typeof actorPersonId === "string" && actorPersonId !== person.id;
    const canOffboard = isOtherPerson && hasPermissionGrant(data.actorGrants, "people.offboard", targetPermission);
    const canCompleteOnboarding = status === "onboarding" && onboardingPermissions.every((permission) =>
      hasPermissionGrant(data.actorGrants, permission),
    );
    const projected = {
      id: person.id,
      displayName: text(person.displayName),
      email: text(person.email),
      status,
      office: projectRelation(person.office),
      department: projectRelation(person.department),
      role: projectRelation(person.role),
      actions: {
        resendInvitation: status === "invited" && canInviteAdminPeople(data.actorGrants),
        freeze: isOtherPerson && freezableStatuses.includes(status) &&
          hasPermissionGrant(data.actorGrants, "people.freeze", targetPermission),
        startOffboarding: manageableStatuses.includes(status) && canOffboard,
        completeExit: status === "offboarding" && canOffboard,
        completeOnboarding: canCompleteOnboarding,
      },
    };
    if (status === "onboarding") {
      projected.onboarding = projectOnboardingRead(person, data, peopleRead, canCompleteOnboarding);
    }
    return projected;
  }

  function currentOnboardingTarget(data, personId, input) {
    requirePeopleRow(data, personId, ["onboarding"], "people.edit");
    const current = state.adminData;
    if (!hasPermissionGrant(current.actorGrants, "organisation.settings.manage") ||
        !hasPermissionGrant(current.actorGrants, "roles.view") ||
        !canViewAdminPeople(current.actorGrants) ||
        !input || typeof input !== "object" ||
        !Array.isArray(current.offices?.offices) || !current.offices.offices.some((row) => row?.id === input.officeId) ||
        !Array.isArray(current.departments?.departments) || !current.departments.departments.some((row) => row?.id === input.organisationDepartmentId) ||
        !Array.isArray(current.roles?.roles) || !current.roles.roles.some((row) =>
          row?.id === input.roleId && row.isProtected !== true && !row.archivedAt,
        ) ||
        (input.managerPersonId && !current.people.people.some((row) =>
          row?.id === input.managerPersonId && row.id !== personId && ["active", "notice"].includes(row.status),
        ))) {
      throw adminCommandUiError("Choose current office, department, role, and manager options before completing onboarding.");
    }
  }

  function createProps(data) {
    requireCurrent(data, "Admin changed while People was loading. Refresh Admin and try again.");
    const canInvite = canInviteAdminPeople(data.actorGrants);
    const canViewPeople = canViewAdminPeople(data.actorGrants);
    const peopleRead = projectPeopleRead(data, canViewPeople);
    const people = canViewPeople && peopleRead.status === "ready"
      ? data.people.people.map((person) => projectPerson(person, data, peopleRead)).filter(Boolean)
      : [];

    return {
      canInvite,
      canViewPeople,
      peopleRead,
      people,
      formatError: (error) => error?.uiMessage === true && typeof error.message === "string"
        ? error.message
        : errorText(error),
      onInvite: async (input) => {
        const permissionCheck = (current) => canInviteAdminPeople(current?.actorGrants);
        const result = await runMutation(
          data,
          permissionCheck,
          "/api/people/invitations",
          input,
          "",
          reflectInvitationDelivery,
        );
        const feedback = describeInvitationFeedback(result);
        return { delivery: feedback.delivery, kind: feedback.kind, message: feedback.message };
      },
      onResendInvitation: (personId) => {
        requirePeopleRow(data, personId, ["invited"], "people.invite");
        return runMutation(
          data,
          (current) => canInviteAdminPeople(current?.actorGrants) && Boolean(
            current?.people?.people?.some((person) => person.id === personId && person.status === "invited"),
          ),
          "/api/people/" + encodeURIComponent(personId) + "/invitations/resend",
          undefined,
          "Invitation resent.",
          (result) => reflectInvitationDelivery(result, "resend"),
        );
      },
      onFreeze: (personId) => {
        const person = requirePeopleRow(data, personId, freezableStatuses, "people.freeze");
        return runMutation(
          data,
          (current) => {
            const row = current?.people?.people?.find((candidate) => candidate.id === person.id);
            return Boolean(row && freezableStatuses.includes(row.status) &&
              current.actorGrants?.actorPersonId !== row.id &&
              hasPermissionGrant(current.actorGrants, "people.freeze", adminPersonPermissionTarget(row)));
          },
          "/api/people/" + encodeURIComponent(personId) + "/freeze",
          { reason: "Frozen by administrator" },
          "Person frozen and existing sessions revoked.",
        );
      },
      onStartOffboarding: (personId, reason) => {
        const person = requirePeopleRow(data, personId, manageableStatuses, "people.offboard");
        return runMutation(
          data,
          (current) => {
            const row = current?.people?.people?.find((candidate) => candidate.id === person.id);
            return Boolean(row && manageableStatuses.includes(row.status) &&
              current.actorGrants?.actorPersonId !== row.id &&
              hasPermissionGrant(current.actorGrants, "people.offboard", adminPersonPermissionTarget(row)));
          },
          "/api/people/" + encodeURIComponent(personId) + "/offboard",
          { reason },
          "Offboarding started. Reassignments and review handover remain audited.",
        );
      },
      onCompleteExit: (personId, reason) => {
        const person = requirePeopleRow(data, personId, ["offboarding"], "people.offboard");
        return runMutation(
          data,
          (current) => {
            const row = current?.people?.people?.find((candidate) => candidate.id === person.id);
            return Boolean(row && row.status === "offboarding" &&
              current.actorGrants?.actorPersonId !== row.id &&
              hasPermissionGrant(current.actorGrants, "people.offboard", adminPersonPermissionTarget(row)));
          },
          "/api/people/" + encodeURIComponent(personId) + "/offboard",
          { final: true, reason },
          "Exit completed; history was preserved.",
        );
      },
      onCompleteOnboarding: (personId, input) => {
        currentOnboardingTarget(data, personId, input);
        return runMutation(
          data,
          (current) => {
            const row = current?.people?.people?.find((candidate) => candidate.id === personId);
            return Boolean(row && row.status === "onboarding" &&
              onboardingPermissions.every((permission) => hasPermissionGrant(current.actorGrants, permission)) &&
              hasPermissionGrant(current.actorGrants, "organisation.settings.manage") &&
              hasPermissionGrant(current.actorGrants, "roles.view") &&
              canViewAdminPeople(current.actorGrants) &&
              currentOnboardingInputExists(current, personId, input));
          },
          "/api/people/" + encodeURIComponent(personId) + "/complete-onboarding",
          { ...input, managerPersonId: input.managerPersonId || null },
          "Onboarding completed.",
        );
      },
    };
  }

  return { createProps };
}

function currentOnboardingInputExists(current, personId, input) {
  return Array.isArray(current.offices?.offices) && current.offices.offices.some((row) => row?.id === input.officeId) &&
    Array.isArray(current.departments?.departments) && current.departments.departments.some((row) => row?.id === input.organisationDepartmentId) &&
    Array.isArray(current.roles?.roles) && current.roles.roles.some((row) =>
      row?.id === input.roleId && row.isProtected !== true && !row.archivedAt,
    ) && (!input.managerPersonId || (Array.isArray(current.people?.people) && current.people.people.some((row) =>
      row?.id === input.managerPersonId && row.id !== personId && ["active", "notice"].includes(row.status),
    )));
}

function adminPersonPermissionTarget(person) {
  return {
    personId: person?.id,
    officeId: person?.office?.id,
    organisationDepartmentId: person?.department?.id,
  };
}

function projectRelation(value) {
  return value && typeof value === "object" && typeof value.id === "string" && typeof value.name === "string"
    ? { id: value.id, name: value.name }
    : null;
}

function validIdName(value) {
  return value && typeof value === "object" && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.name === "string" && value.name.length > 0;
}

function validId(value) {
  return value && typeof value === "object" && typeof value.id === "string" && value.id.length > 0;
}

function text(value) {
  return typeof value === "string" ? value : "";
}
