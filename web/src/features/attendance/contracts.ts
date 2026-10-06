/**
 * Browser representations of the current attendance and work-timeline JSON
 * projections. Dates are ISO strings after Response.json serialization.
 * These types describe reads only; API commands remain owned by the route host.
 */

export type AttendanceMode = "office" | "wfh";

export interface AttendanceAvailability {
  attendanceMode: "hour_based" | "scheduled";
  requiredAttendanceMinutes: number;
  businessDate: string;
  calendarId: string | null;
  isHoliday: boolean;
  isWorkingDay: boolean;
  officeId: string;
  officeName: string;
  shiftId: string | null;
  timezone: string;
  wfhAllowed: boolean;
}

export interface AttendanceActionAvailability {
  attendanceMode: "hour_based" | "scheduled";
  businessDate: string;
  calendarId: string | null;
  isHoliday: boolean;
  isWorkingDay: boolean;
  officeName: string;
  shiftId: string | null;
  timezone: string;
  wfhAllowed: boolean;
}

export interface AttendanceRecord {
  id?: string;
  mode: AttendanceMode;
  checkedInAt: string;
  checkedOutAt: string | null;
  modeChangedAt?: string | null;
  closureReason?: string | null;
}

export interface ProvisionalAttendance {
  id?: string;
  status: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  resolvedAt?: string | null;
  resolutionReason?: string | null;
  creditable?: boolean;
}

export interface AttendanceSummary {
  durationMinutes: number;
  requiredMinutes: number;
  requirementSatisfied: boolean;
}

export interface AttendanceTodayProjection {
  actionContext?: false;
  availability: AttendanceAvailability;
  onApprovedLeave: boolean;
  wfhApproved: boolean;
  wfhPending: boolean;
  provisionalAttendance: ProvisionalAttendance | null;
  attendanceSummary: AttendanceSummary;
  attendance: AttendanceRecord | null;
}

/** `/attendance/action-context` is intentionally a narrower read projection. */
export interface AttendanceActionContextProjection {
  actionContext: true;
  availability: AttendanceActionAvailability;
  onApprovedLeave: boolean;
  wfhApproved: boolean;
  wfhPending: boolean;
  provisionalAttendance: ProvisionalAttendance | null;
  attendance: AttendanceRecord | null;
}

export type AttendanceProjection =
  | AttendanceTodayProjection
  | AttendanceActionContextProjection;

export type AttendanceAction =
  | "check-in-office"
  | "check-in-wfh"
  | "check-out"
  | "change-to-wfh"
  | "change-to-office";

export interface AttendanceActionCapabilities {
  /** Parent-derived presentation hints; the server rechecks every command. */
  checkIn: boolean;
  checkOut: boolean;
  changeMode: boolean;
}

export type FeatureReadState<T> =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string; onRetry?: () => void }
  | { status: "empty"; data: T; message?: string }
  | { status: "ready"; data: T }
  | { status: "partial"; data: T; message: string; onRetry?: () => void };

export interface TimelineEvent {
  type: string;
  at: string;
  sourceId?: string;
  mode?: AttendanceMode;
  title?: string;
  state?: string;
  closureReason?: string | null;
  scheduledAt?: string;
  minutesLate?: number;
  minutesEarly?: number;
  minutesAfter?: number;
  reason?: string;
}

export interface TimelineException {
  type: string;
  startedAt?: string;
  endedAt?: string;
  actionable?: boolean;
}

export interface WorkdayTimelineProjection {
  date: string;
  personId: string;
  attendance: {
    id: string;
    business_date: string;
    mode: AttendanceMode;
    checked_in_at: string;
    checked_out_at: string | null;
    closure_reason: string | null;
  } | null;
  attendanceSummary: AttendanceSummary;
  attendancePolicy: {
    mode: "hour_based" | "scheduled";
    requiredAttendanceMinutes: number;
    timezone: string;
    shiftId: string | null;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    graceMinutes: number;
    isHoliday: boolean;
  } | null;
  sessions: ReadonlyArray<{
    id: string;
    assignment_id: string;
    task_id: string;
    title: string;
    started_at: string;
    ended_at: string | null;
    state: string;
    closure_reason: string | null;
  }>;
  adjustments: ReadonlyArray<{
    id: string;
    assignment_id: string | null;
    started_at: string;
    ended_at: string;
    reason: string;
  }>;
  exceptions: ReadonlyArray<TimelineException>;
  events: ReadonlyArray<TimelineEvent>;
}
