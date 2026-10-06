const onboardingPermissions = Object.freeze(["people.edit", "people.activate", "roles.assign"]);
const manageableStatuses = Object.freeze(["active", "notice"]);
const freezableStatuses = Object.freeze(["active", "notice", "onboarding"]);
const peopleDirectoryPageLimit = 25;
const peopleDirectoryCaches = new WeakMap();

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
  pageApi,
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
    pageApi,
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

  function directoryCache(data) {
    let cache = peopleDirectoryCaches.get(data);
    if (cache) return cache;
    const initial = data?.peopleDirectory;
    const initialRows = isDirectoryPage(initial) ? initial.people : [];
    cache = {
      query: "",
      epoch: 0,
      requestSequence: 0,
      allowedCursors: new Set([null]),
      nextCursor: isDirectoryPage(initial) ? initial.nextCursor : null,
      peopleById: new Map(initialRows.map((person) => [person.id, person])),
      managerIdsByTarget: new Map(),
    };
    if (cache.nextCursor) cache.allowedCursors.add(cache.nextCursor);
    peopleDirectoryCaches.set(data, cache);
    return cache;
  }

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

  function currentDirectoryPerson(current, personId) {
    return current === state.adminData ? directoryCache(current).peopleById.get(personId) : undefined;
  }

  function requirePeopleRow(data, personId, allowedStatuses, permission) {
    requireCurrent(data, "The Admin page changed before this People action could start. Refresh and try again.");
    const current = state.adminData;
    const person = directoryCache(current).peopleById.get(personId);
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
    if (data.peopleDirectory?.readState === "not-requested") {
      return {
        status: "unavailable",
        message: "The authorized organization people list was not requested for this view.",
      };
    }
    const issue = adminReadIssue(data.peopleDirectory, "people");
    if (issue) {
      return ["PREREQUISITE_PERMISSION_REQUIRED", "PERMISSION_DENIED"].includes(data.peopleDirectory?.readError)
        ? { status: "unavailable", message: issue.message }
        : { status: "error", message: issue.message };
    }
    if (!isDirectoryPage(data.peopleDirectory) || data.peopleDirectory.limit !== peopleDirectoryPageLimit) {
      return { status: "error", message: "The people response could not be read. Refresh Admin to try again." };
    }
    return { status: "ready" };
  }

  function projectOnboardingRead(data, canCompleteOnboarding) {
    if (!canCompleteOnboarding) {
      return { status: "denied", message: "You do not have all permissions required to complete onboarding." };
    }
    if (!hasPermissionGrant(data.actorGrants, "organisation.settings.manage")) {
      return { status: "denied", message: "Organization settings access is required to load office and department options." };
    }
    if (!hasPermissionGrant(data.actorGrants, "roles.view")) {
      return { status: "denied", message: "roles.view access is required to load onboarding role options." };
    }
    return { status: "ready" };
  }

  function projectPerson(person, data) {
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
      projected.onboarding = projectOnboardingRead(data, canCompleteOnboarding);
    }
    return projected;
  }

  function currentOnboardingTarget(data, personId, input) {
    requirePeopleRow(data, personId, ["onboarding"], "people.edit");
    const current = state.adminData;
    const managers = directoryCache(current).managerIdsByTarget.get(personId);
    if (!hasPermissionGrant(current.actorGrants, "organisation.settings.manage") ||
        !hasPermissionGrant(current.actorGrants, "roles.view") ||
        !canViewAdminPeople(current.actorGrants) ||
        !input || typeof input !== "object" ||
        !Array.isArray(current.offices?.offices) || !current.offices.offices.some((row) => row?.id === input.officeId) ||
        !Array.isArray(current.departments?.departments) || !current.departments.departments.some((row) => row?.id === input.organisationDepartmentId) ||
        !Array.isArray(current.roles?.roles) || !current.roles.roles.some((row) =>
          row?.id === input.roleId && row.isProtected !== true && !row.archivedAt,
        ) ||
        (input.managerPersonId && !managers?.has(input.managerPersonId))) {
      throw adminCommandUiError("Choose current office, department, role, and manager options before completing onboarding.");
    }
  }

  async function searchPeopleDirectory(data, query, cursor) {
    requireCurrent(data, "The Admin page changed before People search could start. Refresh and try again.");
    const current = state.adminData;
    if (!canViewAdminPeople(current?.actorGrants)) {
      throw adminCommandUiError("People access is no longer available. Refresh Admin and check your current permissions.");
    }
    if (typeof query !== "string" || query.length > 100 ||
        (cursor !== null && (typeof cursor !== "string" || cursor.length > 8192))) {
      throw adminCommandUiError("The People search is invalid. Edit the search and try again.");
    }
    const normalizedQuery = query.normalize("NFC").trim().toLowerCase();
    const cache = directoryCache(data);
    if (cursor === null) {
      cache.epoch += 1;
      cache.query = normalizedQuery;
      cache.allowedCursors = new Set([null]);
      cache.nextCursor = null;
      cache.peopleById.clear();
    } else if (cache.query !== normalizedQuery || !cache.allowedCursors.has(cursor)) {
      throw adminCommandUiError("This People page is stale. Search again to refresh the directory.");
    } else {
      cache.peopleById.clear();
    }
    const epoch = cache.epoch;
    const requestSequence = ++cache.requestSequence;
    const params = new URLSearchParams({ q: normalizedQuery, limit: String(peopleDirectoryPageLimit) });
    if (cursor !== null) params.set("cursor", cursor);
    const result = await pageApi("/api/people/directory?" + params.toString(), lifetime);
    requireCurrent(data, "The Admin page changed while People search was loading. Refresh and try again.");
    if (!canViewAdminPeople(state.adminData?.actorGrants)) {
      throw adminCommandUiError("People access changed while the directory was loading. Refresh Admin and check your permissions.");
    }
    if (cache.epoch !== epoch || cache.requestSequence !== requestSequence || cache.query !== normalizedQuery) {
      throw adminCommandUiError("This People page is stale. Search again to refresh the directory.");
    }
    if (!isDirectoryPage(result) || result.limit !== peopleDirectoryPageLimit) {
      throw adminCommandUiError("The People directory response could not be read. Try the search again.");
    }
    cache.peopleById = new Map(result.people.map((person) => [person.id, person]));
    cache.nextCursor = result.nextCursor;
    if (result.nextCursor) cache.allowedCursors.add(result.nextCursor);
    return projectDirectoryPage(result, data, projectPerson);
  }

  async function searchOnboardingOptions(data, personId, kind, query) {
    requirePeopleRow(data, personId, ["onboarding"], "people.edit");
    if (typeof query !== "string" || query.length > 100 ||
        !["office", "department", "role", "manager"].includes(kind)) {
      throw adminCommandUiError("The onboarding search could not be completed. Edit the search and try again.");
    }
    const current = state.adminData;
    const canCompleteOnboarding = onboardingPermissions.every((permission) =>
      hasPermissionGrant(current.actorGrants, permission),
    );
    const allowed = canCompleteOnboarding && hasPermissionGrant(current.actorGrants, "organisation.settings.manage") &&
      hasPermissionGrant(current.actorGrants, "roles.view") && canViewAdminPeople(current.actorGrants);
    if (!allowed) {
      throw adminCommandUiError("Onboarding search access is no longer available. Refresh Admin and try again.");
    }
    const params = new URLSearchParams({ kind, q: query });
    if (kind === "manager") params.set("personId", personId);
    const result = await pageApi("/api/people/onboarding-options?" + params.toString(), lifetime);
    requireCurrent(data, "Admin changed while onboarding options were loading. Refresh Admin and try again.");
    if (!result || !Array.isArray(result.options) || result.options.length > 50 || !result.options.every((option) =>
      validIdName(option) && (kind !== "office" || typeof option.timezone === "string"),
    )) {
      throw adminCommandUiError("The onboarding search response could not be read. Edit the search to try again.");
    }
    if (kind === "manager") {
      const cache = directoryCache(data);
      const managerIds = cache.managerIdsByTarget.get(personId) || new Set();
      for (const option of result.options) managerIds.add(option.id);
      cache.managerIdsByTarget.set(personId, managerIds);
    }
    return result.options.map(({ id, name, timezone }) => ({
      id,
      name,
      ...(kind === "office" ? { timezone } : {}),
    }));
  }

  function createProps(data) {
    requireCurrent(data, "Admin changed while People was loading. Refresh Admin and try again.");
    const canInvite = canInviteAdminPeople(data.actorGrants);
    const canViewPeople = canViewAdminPeople(data.actorGrants);
    const peopleRead = projectPeopleRead(data, canViewPeople);
    const peoplePage = canViewPeople && peopleRead.status === "ready"
      ? projectDirectoryPage(data.peopleDirectory, data, projectPerson)
      : emptyDirectoryPage();
    if (canViewPeople && peopleRead.status === "ready") directoryCache(data);

    return {
      canInvite,
      canViewPeople,
      peopleRead,
      peoplePage,
      searchPeopleDirectory: (query, cursor) => searchPeopleDirectory(data, query, cursor),
      searchOnboardingOptions: (personId, kind, query) => searchOnboardingOptions(data, personId, kind, query),
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
            currentDirectoryPerson(current, personId)?.status === "invited",
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
            const row = currentDirectoryPerson(current, person.id);
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
            const row = currentDirectoryPerson(current, person.id);
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
            const row = currentDirectoryPerson(current, person.id);
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
            const row = currentDirectoryPerson(current, personId);
            return Boolean(row && row.status === "onboarding" &&
              onboardingPermissions.every((permission) => hasPermissionGrant(current.actorGrants, permission)) &&
              hasPermissionGrant(current.actorGrants, "organisation.settings.manage") &&
              hasPermissionGrant(current.actorGrants, "roles.view") &&
              canViewAdminPeople(current.actorGrants) &&
              currentOnboardingInputExists(
                current,
                personId,
                input,
                directoryCache(current).managerIdsByTarget.get(personId),
              ));
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

function currentOnboardingInputExists(current, personId, input, managerIds) {
  return Array.isArray(current.offices?.offices) && current.offices.offices.some((row) => row?.id === input.officeId) &&
    Array.isArray(current.departments?.departments) && current.departments.departments.some((row) => row?.id === input.organisationDepartmentId) &&
    Array.isArray(current.roles?.roles) && current.roles.roles.some((row) =>
      row?.id === input.roleId && row.isProtected !== true && !row.archivedAt,
    ) && (!input.managerPersonId || managerIds?.has(input.managerPersonId));
}

function isDirectoryPerson(value) {
  const relation = (candidate) => candidate === null || (
    candidate && typeof candidate === "object" && typeof candidate.id === "string" &&
    candidate.id.length > 0 && typeof candidate.name === "string"
  );
  return value && typeof value === "object" && typeof value.id === "string" && value.id.length > 0 &&
    (value.displayName === null || typeof value.displayName === "string") && typeof value.email === "string" &&
    (value.status === null || typeof value.status === "string") && relation(value.office) &&
    relation(value.department) && relation(value.role);
}

function isDirectoryPage(value) {
  return value && typeof value === "object" && Array.isArray(value.people) &&
    value.people.length <= peopleDirectoryPageLimit && Number.isSafeInteger(value.limit) &&
    value.limit >= 1 && value.limit <= 50 && typeof value.hasMore === "boolean" &&
    (value.nextCursor === null || (typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 8192)) &&
    value.hasMore === Boolean(value.nextCursor) && value.people.every(isDirectoryPerson);
}

function projectDirectoryPage(page, data, projectPerson) {
  return {
    people: page.people.map((person) => projectPerson(person, data)).filter(Boolean),
    limit: page.limit,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

function emptyDirectoryPage() {
  return { people: [], limit: peopleDirectoryPageLimit, hasMore: false, nextCursor: null };
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

function text(value) {
  return typeof value === "string" ? value : "";
}
