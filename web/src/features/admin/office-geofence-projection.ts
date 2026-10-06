import type { OfficeGeofenceOption, OfficeGeofenceSettingsProps } from "./office-geofence-contracts";

export interface OfficeGeofenceReadIssue {
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectOfficeOption(value: unknown): OfficeGeofenceOption | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() ||
      typeof value.name !== "string" || !value.name.trim()) return null;

  return {
    id: value.id,
    name: value.name,
    latitude: typeof value.latitude === "number" && Number.isFinite(value.latitude) ? value.latitude : null,
    longitude: typeof value.longitude === "number" && Number.isFinite(value.longitude) ? value.longitude : null,
    geofenceRadiusMeters: typeof value.geofenceRadiusMeters === "number" && Number.isFinite(value.geofenceRadiusMeters)
      ? value.geofenceRadiusMeters
      : 150,
  };
}

/** Project only the purpose-limited fields needed to edit an office geofence. */
export function projectOfficeGeofenceSettingsProps(input: {
  result: unknown;
  issue?: OfficeGeofenceReadIssue | null;
  canManage: boolean;
  onSave: OfficeGeofenceSettingsProps["onSave"];
}): OfficeGeofenceSettingsProps {
  const result = isRecord(input.result) ? input.result : null;
  const read = input.issue
    ? { status: "error" as const, offices: [], message: input.issue.message }
    : {
      status: "ready" as const,
      offices: (Array.isArray(result?.offices) ? result.offices : [])
        .map(projectOfficeOption)
        .filter((office): office is OfficeGeofenceOption => office !== null),
    };

  return { canManage: input.canManage, read, onSave: input.onSave };
}
