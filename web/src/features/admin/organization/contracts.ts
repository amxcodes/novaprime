export interface OrganizationOfficeSummary {
  id: string;
  name: string;
  location: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusMeters: number;
}

export interface OrganizationDepartmentSummary {
  id: string;
  name: string;
}

export type OrganizationReadState<T> =
  | { status: "loading" | "unavailable" | "error"; items: ReadonlyArray<T>; message?: string }
  | { status: "ready"; items: ReadonlyArray<T> };

/** Matches POST /api/offices. The server remains authoritative for validation and grants. */
export interface CreateOrganizationOfficeInput {
  name: string;
  location: string;
  timezone: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
}

/** Matches POST /api/organisation-departments. */
export interface CreateOrganizationDepartmentInput {
  name: string;
}

export interface OrganizationStructureProps {
  /** Host projection of organisation structure visibility; false renders no organization data. */
  canView: boolean;
  /** Host projections from effective, organization-scoped grants. */
  canManageOrganization: boolean;
  canManageOfficeGeofence: boolean;
  offices: OrganizationReadState<OrganizationOfficeSummary>;
  departments: OrganizationReadState<OrganizationDepartmentSummary>;
  onCreateOffice: (input: CreateOrganizationOfficeInput) => void | Promise<void>;
  onCreateDepartment: (input: CreateOrganizationDepartmentInput) => void | Promise<void>;
}
