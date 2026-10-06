import {
  canInviteAdminPeople,
  canShowAdminFeature,
  canShowOwnerTransfer,
  canViewAdminPeople,
  planAdminReads,
  type AdminReadPlan,
} from "../../features/admin/capabilities";
import type { EffectivePermissionRead } from "../../app-shell/permission-grants";
import type { AdminPageSectionId } from "./AdminPage";

export type AdminAreaId = "organisation" | "availability" | "access" | "work" | "requests" | "audit";

export interface AdminAreaDefinition {
  id: AdminAreaId;
  view: string;
  label: string;
  title: string;
  description: string;
  sections: readonly AdminPageSectionId[];
  reads: readonly AdminPageReadKey[];
}

export type AdminPageReadKey = keyof AdminReadPlan | "peopleDirectory";

/** Stable focused pages over existing Admin feature contracts and endpoints. */
export const ADMIN_AREAS = [
  {
    id: "organisation", view: "admin-organisation", label: "Organisation", title: "Organisation settings",
    description: "Office structure, attendance policy, and geofence controls.",
    sections: ["organization-structure", "geofence", "attendance-policy"],
    reads: ["organisation", "offices", "departments", "geofenceOptions"],
  },
  {
    id: "availability", view: "admin-availability", label: "Availability", title: "Availability",
    description: "Working calendars, shifts, holidays, and WFH policy.",
    sections: ["availability-configuration", "wfh-overrides"],
    reads: ["availability", "wfhPolicies", "offices", "departments"],
  },
  {
    id: "access", view: "admin-access", label: "People and access", title: "People and access",
    description: "People administration, role permissions, and ownership controls.",
    sections: ["roles", "people", "owner-transfer"],
    reads: ["permissions", "roles", "people", "peopleDirectory", "workContext", "offices", "departments"],
  },
  {
    id: "work", view: "admin-work", label: "Work administration", title: "Work administration",
    description: "Client context, task operations, and assignment controls.",
    sections: ["work"],
    reads: ["workContext", "tasks", "taskCatalog"],
  },
  {
    id: "requests", view: "admin-requests", label: "Requests and exceptions", title: "Requests and exceptions",
    description: "Review leave and WFH requests and resolve eligible exceptions.",
    sections: ["leave-review", "wfh-review", "historical-exceptions"],
    reads: ["leavePending", "wfhPending", "exceptions"],
  },
  {
    id: "audit", view: "admin-audit", label: "Audit and delivery", title: "Audit and delivery",
    description: "Search authorized audit events and inspect notification delivery.",
    sections: ["audit", "notification-delivery"],
    reads: ["audit", "notificationDelivery"],
  },
] as const satisfies readonly AdminAreaDefinition[];

const areaById = new Map<string, AdminAreaDefinition>(ADMIN_AREAS.map((area) => [area.id, area]));
const areaByView = new Map<string, AdminAreaDefinition>(ADMIN_AREAS.map((area) => [area.view, area]));
const sectionFeatures: Readonly<Partial<Record<AdminPageSectionId, string>>> = {
  "organization-structure": "organisationStructure",
  geofence: "geofence",
  "attendance-policy": "attendancePolicy",
  "availability-configuration": "availabilityConfiguration",
  "wfh-overrides": "wfhOverrides",
  roles: "roles",
  work: "work",
  "leave-review": "leaveReview",
  "wfh-review": "wfhReview",
  "historical-exceptions": "historicalExceptions",
  audit: "audit",
  "notification-delivery": "notificationDelivery",
};

type AdminPermissionRead = EffectivePermissionRead & { isSuperAdmin?: boolean };

function canShowSection(read: AdminPermissionRead | null | undefined, section: AdminPageSectionId): boolean {
  if (section === "people") return canViewAdminPeople(read) || canInviteAdminPeople(read);
  if (section === "owner-transfer") return canShowOwnerTransfer(read);
  const feature = sectionFeatures[section];
  return feature ? canShowAdminFeature(read, feature) : false;
}

export function canShowAdminArea(read: AdminPermissionRead | null | undefined, areaId: AdminAreaId): boolean {
  const area = areaById.get(areaId);
  if (!area) return false;
  if (areaId === "access") {
    return canShowAdminFeature(read, "roles") || canViewAdminPeople(read) || canShowOwnerTransfer(read);
  }
  return area.sections.some((section) => canShowSection(read, section));
}

/** Resolve the legacy Admin URL to the first area this actor can actually use. */
export function resolveDefaultAdminArea(read: AdminPermissionRead | null | undefined): AdminAreaDefinition | null {
  return ADMIN_AREAS.find(({ id }) => canShowAdminArea(read, id)) ?? null;
}

export function adminAreaForView(view: string, read?: AdminPermissionRead | null): AdminAreaDefinition | null {
  if (view === "admin") return resolveDefaultAdminArea(read);
  const area = areaByView.get(view);
  return area && canShowAdminArea(read, area.id) ? area : null;
}

/** Keep the old planner as the source of grant logic, then scope its requests to one active page. */
export function planAdminAreaReads(
  read: AdminPermissionRead | null | undefined,
  areaId: AdminAreaId,
): Readonly<AdminReadPlan> {
  const completePlan = planAdminReads(read);
  const allowed = new Set<AdminPageReadKey>(areaById.get(areaId)?.reads ?? []);
  return Object.freeze(Object.fromEntries(
    Object.keys(completePlan).map((key) => [key, allowed.has(key as keyof AdminReadPlan) && completePlan[key as keyof AdminReadPlan]]),
  ) as unknown as AdminReadPlan);
}

export function sectionBelongsToAdminArea(areaId: AdminAreaId, sectionId: AdminPageSectionId): boolean {
  return areaById.get(areaId)?.sections.some((candidate) => candidate === sectionId) === true;
}
