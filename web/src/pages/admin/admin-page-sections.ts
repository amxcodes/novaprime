import type { EffectivePermissionRead } from "../../app-shell/permission-grants.ts";
import type { ReactElement } from "react";
import { RolePermissionsLoadFailureSection } from "../../features/admin/roles/RolePermissionsLoadFailureSection";
import { OrganizationStructureLoadFailureSection } from "../../features/admin/organization/OrganizationStructureFallback";
import { AvailabilityConfigurationLoadFailureSection } from "../../features/availability/AvailabilityConfigurationFallback";
import { LeaveRequestsLoadFailureSection } from "../../features/admin/leave-requests/LeaveRequestsFallback";
import { WfhRequestsReviewLoadFailureSection } from "../../features/admin/wfh-requests/WfhRequestsReviewFallback";
import { WfhPolicyOverridesLoadFailureSection } from "../../features/admin/WfhPolicyOverridesFallback";
import { OwnerTransferLoadFailureSection } from "../../features/admin/owner-transfer/OwnerTransferFallback";
import { PeopleAdministrationLoadFailureSection } from "../../features/admin/PeopleAdministrationFallback";
import { AdminWorkLoadFailureSection } from "../../features/admin/work/AdminWorkFallback";
import {
  canInviteAdminPeople,
  canShowAdminFeature,
  canShowOwnerTransfer,
  canViewAdminPeople,
} from "../../features/admin/capabilities";
import type { AdminPageSectionId, AuthorizedAdminPageSection } from "./AdminPage";

export {
  AvailabilityConfigurationLoadFailureSection,
  LeaveRequestsLoadFailureSection,
  OrganizationStructureLoadFailureSection,
  RolePermissionsLoadFailureSection,
  OwnerTransferLoadFailureSection,
  PeopleAdministrationLoadFailureSection,
  AdminWorkLoadFailureSection,
  WfhRequestsReviewLoadFailureSection,
  WfhPolicyOverridesLoadFailureSection,
};

export type AdminPageSectionDefinitions = Readonly<Record<AdminPageSectionId, ReactElement>>;

type AdminPagePermissionRead = EffectivePermissionRead & { isSuperAdmin?: boolean };

/**
 * Compose only the Admin sections supported by the actor's effective grants.
 * This is client-side discovery; each backing API and mutation still checks
 * authorization on the server.
 */
export function buildAuthorizedAdminPageSections(
  read: AdminPagePermissionRead | null | undefined,
  definitions: AdminPageSectionDefinitions,
): AuthorizedAdminPageSection[] {
  const allowed: ReadonlyArray<readonly [AdminPageSectionId, boolean]> = [
    ["organization-structure", canShowAdminFeature(read, "organisationStructure")],
    ["geofence", canShowAdminFeature(read, "geofence")],
    ["attendance-policy", canShowAdminFeature(read, "attendancePolicy")],
    ["availability-configuration", canShowAdminFeature(read, "availabilityConfiguration")],
    ["wfh-overrides", canShowAdminFeature(read, "wfhOverrides")],
    ["roles", canShowAdminFeature(read, "roles")],
    ["work", canShowAdminFeature(read, "work")],
    ["people", canInviteAdminPeople(read) || canViewAdminPeople(read)],
    ["owner-transfer", canShowOwnerTransfer(read)],
    ["leave-review", canShowAdminFeature(read, "leaveReview")],
    ["wfh-review", canShowAdminFeature(read, "wfhReview")],
    ["historical-exceptions", canShowAdminFeature(read, "historicalExceptions")],
    ["audit", canShowAdminFeature(read, "audit")],
    ["notification-delivery", canShowAdminFeature(read, "notificationDelivery")],
  ];

  return allowed.flatMap<AuthorizedAdminPageSection>(([id, isAllowed]) => {
    if (!isAllowed) return [];
    return [{ id, content: definitions[id] }];
  });
}
