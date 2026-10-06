import type { OfficeGeofenceInput } from "./office-geofence-model";

export interface OfficeGeofenceOption {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusMeters: number;
}

export type OfficeGeofenceReadState =
  | { status: "loading" | "unavailable"; offices: ReadonlyArray<OfficeGeofenceOption>; message?: string }
  | { status: "error"; offices: ReadonlyArray<OfficeGeofenceOption>; message: string }
  | { status: "ready"; offices: ReadonlyArray<OfficeGeofenceOption> };

export interface OfficeGeofenceSettingsProps {
  canManage: boolean;
  read: OfficeGeofenceReadState;
  onSave: (officeId: string, input: OfficeGeofenceInput) => void | Promise<void>;
}
