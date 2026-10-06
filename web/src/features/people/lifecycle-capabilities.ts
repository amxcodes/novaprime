import { hasPermissionGrant, type EffectivePermissionRead } from "../../app-shell/permission-grants";
import type { PersonDirectoryRecord } from "./contracts";

export interface PersonLifecycleCapabilities {
  canFreeze: boolean;
  canStartOffboarding: boolean;
  canCompleteOffboarding: boolean;
}

const NONE: PersonLifecycleCapabilities = Object.freeze({
  canFreeze: false,
  canStartOffboarding: false,
  canCompleteOffboarding: false,
});

/**
 * Expose only lifecycle commands whose current effective grant matches the
 * readable record's target. The API remains authoritative for every command.
 */
export function planPersonLifecycleCapabilities(
  grants: EffectivePermissionRead | null | undefined,
  person: PersonDirectoryRecord | null | undefined,
): PersonLifecycleCapabilities {
  if (!person || typeof person.id !== "string" || !person.id) return NONE;

  const target = {
    personId: person.id,
    officeId: person.office?.id,
    organisationDepartmentId: person.department?.id,
  };
  // Lifecycle controls are offered only alongside the same target-scoped read
  // that made this record available. An action grant is not a target locator.
  if (!hasPermissionGrant(grants, "people.view", target)) return NONE;
  const status = typeof person.status === "string" ? person.status.toLowerCase() : "";
  const canOffboard = hasPermissionGrant(grants, "people.offboard", target);

  return Object.freeze({
    canFreeze: ["active", "notice", "onboarding"].includes(status) &&
      hasPermissionGrant(grants, "people.freeze", target),
    canStartOffboarding: ["active", "notice"].includes(status) && canOffboard,
    canCompleteOffboarding: status === "offboarding" && canOffboard,
  });
}
