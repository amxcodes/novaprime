import { projectOwnerTransferRead } from "./owner-transfer-route.js";

/**
 * Host adapter for the protected Owner Transfer feature. API access, live
 * authorization, people-list prerequisites, and page lifetime stay with Admin.
 */
export function createOwnerTransferRoute({
  state,
  target,
  lifetime,
  isCurrentPageRequest,
  canViewAdminPeople,
  runAdminProtectedCommand,
  renderAdmin,
  adminCommandUiError,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    canViewAdminPeople,
    runAdminProtectedCommand,
    renderAdmin,
    adminCommandUiError,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  function isCurrentOwnerTransferData(data) {
    const current = state.adminData;
    return target.isConnected && isCurrentPageRequest(lifetime) && current === data &&
      current?.actorGrants?.isSuperAdmin === true && !current.actorGrants.readError &&
      Array.isArray(current.actorGrants.grants);
  }

  function transfer(data, personId) {
    const current = state.adminData;
    if (!isCurrentOwnerTransferData(data)) {
      throw adminCommandUiError("The Admin page or Super Admin access changed. Refresh Admin before trying again.");
    }
    if (!canViewAdminPeople(current.actorGrants)) {
      throw adminCommandUiError("Your current grants no longer include the people list needed to choose a new owner.");
    }
    const eligibleTarget = Array.isArray(data.people?.people) && data.people.people.some((person) =>
      person?.id === personId && personId !== current.actorGrants.actorPersonId &&
      ["active", "notice"].includes(person.status));
    if (!eligibleTarget) {
      throw adminCommandUiError("This person is no longer an eligible owner. Refresh Admin and choose again.");
    }

    return runAdminProtectedCommand(
      target,
      lifetime,
      (currentData) => currentData === data && currentData?.actorGrants?.isSuperAdmin === true &&
        !currentData.actorGrants.readError && Array.isArray(currentData.actorGrants.grants),
      {},
      "POST",
      "/api/organisation/owner-transfer",
      { targetPersonId: personId, confirmation: "TRANSFER SUPER ADMIN" },
      "Ownership transferred. Your current sessions may now be revoked.",
      undefined,
      undefined,
      "NOVA could not confirm whether ownership transferred. Your session may have been revoked. Refresh and verify the current Super Admin before retrying.",
    );
  }

  function createProps(data) {
    const canTransfer = isCurrentOwnerTransferData(data) && canViewAdminPeople(state.adminData?.actorGrants);
    const actorGrants = canTransfer ? state.adminData.actorGrants : null;
    // /api/people is a separate organization-scoped read. Super Admin status
    // never substitutes for people.view and cannot expose an unrelated roster.
    const peopleRead = actorGrants && canViewAdminPeople(actorGrants)
      ? data.people
      : { readState: "not-requested" };
    const read = actorGrants
      ? projectOwnerTransferRead({
        actorGrants,
        peopleRead,
        onTransfer: (personId) => transfer(data, personId),
      })
      : null;

    return {
      canTransfer,
      read: read || { status: "unavailable", message: "Super Admin access is no longer available." },
      onRetry: () => renderAdmin(lifetime),
    };
  }

  return { createProps };
}
