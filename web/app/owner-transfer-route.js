const unavailableReadCodes = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);

/**
 * Project the Admin people read into the minimal owner-transfer presentation contract.
 * Target IDs stay inside host-provided action closures; this is discovery only,
 * and the server rechecks operational status and ownership on every transfer.
 */
export function projectOwnerTransferRead({ actorGrants, peopleRead, onTransfer } = {}) {
  if (actorGrants?.isSuperAdmin !== true || typeof onTransfer !== "function") return null;

  if (peopleRead?.readState === "not-requested") {
    return {
      status: "unavailable",
      message: "Your current grants do not include the people list needed to choose a new owner.",
    };
  }

  if (peopleRead?.readError) {
    return unavailableReadCodes.has(peopleRead.readError)
      ? { status: "unavailable", message: "Your role cannot load people needed for ownership transfer." }
      : { status: "error", message: "The authorized people list could not load. Refresh Admin to try again." };
  }

  if (!Array.isArray(peopleRead?.people)) {
    return { status: "error", message: "The authorized people list could not be read. Refresh Admin to try again." };
  }

  const choices = peopleRead.people.flatMap((person) => {
    if (!person || typeof person.id !== "string" || !person.id ||
        person.id === actorGrants.actorPersonId || !["active", "notice"].includes(person.status)) return [];
    const label = typeof person.displayName === "string" && person.displayName.trim()
      ? person.displayName.trim()
      : typeof person.email === "string" && person.email.trim()
        ? person.email.trim()
        : "Eligible person";
    return [{ label, transfer: () => onTransfer(person.id) }];
  });

  return { status: "ready", choices };
}
