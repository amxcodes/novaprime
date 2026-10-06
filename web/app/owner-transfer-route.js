/**
 * Project only owner-transfer capability state. The roster comes from the
 * dedicated permission-checked search endpoint, never from a browser-side
 * people snapshot.
 */
export function projectOwnerTransferRead({ actorGrants, onTransfer } = {}) {
  if (actorGrants?.isSuperAdmin !== true || typeof onTransfer !== "function") return null;
  return { status: "ready", choices: [] };
}
