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
  pageApi,
  runAdminProtectedCommand,
  renderAdmin,
  adminCommandUiError,
} = {}) {
  const callbacks = {
    isCurrentPageRequest,
    canViewAdminPeople,
    pageApi,
    runAdminProtectedCommand,
    renderAdmin,
    adminCommandUiError,
  };
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }
  if (!state || !target || !lifetime) throw new TypeError("state, target, and lifetime are required");

  const targetsByToken = new Map();
  let nextChoiceToken = 0;

  function isCurrentOwnerTransferData(data) {
    const current = state.adminData;
    return target.isConnected && isCurrentPageRequest(lifetime) && current === data &&
      current?.actorGrants?.isSuperAdmin === true && !current.actorGrants.readError &&
      Array.isArray(current.actorGrants.grants);
  }

  function transfer(data, choiceToken) {
    const current = state.adminData;
    if (!isCurrentOwnerTransferData(data)) {
      throw adminCommandUiError("The Admin page or Super Admin access changed. Refresh Admin before trying again.");
    }
    if (!canViewAdminPeople(current.actorGrants)) {
      throw adminCommandUiError("Your current grants no longer include the people list needed to choose a new owner.");
    }
    const personId = targetsByToken.get(choiceToken);
    if (typeof personId !== "string" || personId === current.actorGrants.actorPersonId) {
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

  async function searchEligiblePeople(data, query) {
    if (!isCurrentOwnerTransferData(data)) {
      throw adminCommandUiError("The Admin page or Super Admin access changed. Refresh Admin before searching.");
    }
    if (!canViewAdminPeople(state.adminData.actorGrants)) {
      throw adminCommandUiError("Your current grants no longer include the people list needed to choose a new owner.");
    }
    if (typeof query !== "string" || query.length > 100) {
      throw adminCommandUiError("The owner search is too long. Edit the search and try again.");
    }
    const result = await pageApi("/api/organisation/owner-transfer/eligible-people?q=" + encodeURIComponent(query), lifetime);
    if (!isCurrentOwnerTransferData(data) || state.adminData !== data) {
      throw adminCommandUiError("Admin changed while eligible people were loading. Refresh and try again.");
    }
    if (!Array.isArray(result?.people) || result.people.length > 50 || !result.people.every((person) =>
      typeof person?.id === "string" && person.id.length > 0 && typeof person.label === "string" && person.label.trim(),
    )) {
      throw adminCommandUiError("The eligible people response could not be read. Edit the search to try again.");
    }

    targetsByToken.clear();
    return result.people.map((person) => {
      const value = "owner-choice-" + (++nextChoiceToken);
      targetsByToken.set(value, person.id);
      return { value, label: person.label.trim(), transfer: () => transfer(data, value) };
    });
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
      onSearchEligiblePeople: (query) => searchEligiblePeople(data, query),
    };
  }

  return { createProps };
}
