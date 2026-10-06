export type AttendancePolicyMode = "hour_based" | "scheduled";

export interface AttendancePolicyRecord {
  mode: AttendancePolicyMode;
  requiredAttendanceMinutes: number;
  effectiveOn: string;
}

export type AttendancePolicyReadState =
  | { status: "loading"; message?: string }
  | { status: "unavailable"; message?: string }
  | { status: "error"; message: string }
  | { status: "ready"; policy: AttendancePolicyRecord | null };

export type AttendancePolicyAccess =
  | { status: "hidden" }
  | { status: "visible"; manage: "allowed" | "denied" };

export interface AttendancePolicyRequest {
  mode: AttendancePolicyMode;
  effectiveOn: string;
  requiredAttendanceMinutes: number;
}

export interface AttendancePolicySettingsProps {
  access: AttendancePolicyAccess;
  read: AttendancePolicyReadState;
  onSchedule: (request: AttendancePolicyRequest) => void | Promise<void>;
}
