import type {
  OrganizationDepartmentSummary,
  OrganizationOfficeSummary,
  OrganizationReadState,
  OrganizationStructureProps,
} from "./contracts";

interface ReadIssue {
  message: string;
}

interface CollectionReadInput {
  result: unknown;
  issue?: ReadIssue | null;
}

/** Raw host reads are accepted only at this boundary; UI receives allowlisted summaries. */
export interface OrganizationStructureProjectionInput extends Omit<
  OrganizationStructureProps,
  "offices" | "departments"
> {
  offices: CollectionReadInput;
  departments: CollectionReadInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function readError(result: unknown): string | null {
  return isRecord(result) && typeof result.readError === "string" ? result.readError : null;
}

function projectCollection<T>(
  input: CollectionReadInput,
  key: string,
  resource: string,
  project: (row: unknown) => T | null,
): OrganizationReadState<T> {
  if (isRecord(input.result) && input.result.readState === "loading") {
    return { status: "loading", items: [] };
  }

  const failureCode = readError(input.result);
  if (failureCode || input.issue) {
    const status = failureCode === "PERMISSION_DENIED" || failureCode === "PREREQUISITE_PERMISSION_REQUIRED"
      ? "unavailable"
      : "error";
    return {
      status,
      items: [],
      message: input.issue?.message || `Could not load ${resource}. Refresh Admin to try again.`,
    };
  }

  if (!isRecord(input.result) || !Array.isArray(input.result[key])) {
    return {
      status: "error",
      items: [],
      message: `The ${resource} response could not be read. Refresh Admin to try again.`,
    };
  }

  const items = input.result[key].map(project);
  if (items.some((item) => item === null)) {
    return {
      status: "error",
      items: [],
      message: `The ${resource} response could not be read. Refresh Admin to try again.`,
    };
  }
  return { status: "ready", items: items as T[] };
}

function projectOffice(value: unknown): OrganizationOfficeSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.name !== "string" || !value.name ||
      !(value.location === null || typeof value.location === "string") ||
      typeof value.timezone !== "string" || !value.timezone ||
      !nullableFiniteNumber(value.latitude) || !nullableFiniteNumber(value.longitude) ||
      typeof value.geofenceRadiusMeters !== "number" || !Number.isFinite(value.geofenceRadiusMeters)) return null;

  return {
    id: value.id,
    name: value.name,
    location: value.location,
    timezone: value.timezone,
    latitude: value.latitude,
    longitude: value.longitude,
    geofenceRadiusMeters: value.geofenceRadiusMeters,
  };
}

function projectDepartment(value: unknown): OrganizationDepartmentSummary | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id ||
      typeof value.name !== "string" || !value.name) return null;
  return { id: value.id, name: value.name };
}

/** Project independent Admin reads into the Organization Structure feature contract. */
export function projectOrganizationStructureProps(
  input: OrganizationStructureProjectionInput,
): OrganizationStructureProps {
  if (!input.canView) {
    const unavailable = (resource: string) => ({
      status: "unavailable" as const,
      items: [],
      message: `The ${resource} list is not available for this access.`,
    });
    return {
      canView: false,
      canManageOrganization: false,
      canManageOfficeGeofence: false,
      offices: unavailable("office"),
      departments: unavailable("department"),
      onCreateOffice: input.onCreateOffice,
      onCreateDepartment: input.onCreateDepartment,
    };
  }

  return {
    canView: true,
    canManageOrganization: input.canManageOrganization,
    canManageOfficeGeofence: input.canManageOfficeGeofence,
    offices: projectCollection(input.offices, "offices", "office list", projectOffice),
    departments: projectCollection(input.departments, "departments", "department list", projectDepartment),
    onCreateOffice: input.onCreateOffice,
    onCreateDepartment: input.onCreateDepartment,
  };
}
