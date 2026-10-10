/** Browser-safe, presentation-only projections for the Work timeline feature. */
export interface WorkTimelineEvent {
  type: string;
  at: string;
  sourceId?: string;
  mode?: "office" | "wfh";
  title?: string;
  scheduledAt?: string;
  minutesLate?: number;
  minutesEarly?: number;
  minutesAfter?: number;
}

export interface WorkTimelineException {
  type: string;
  startedAt?: string;
  endedAt?: string;
  /** Server-derived permission hint. The server still authorizes each write. */
  actionable?: boolean;
}

export interface WorkTimelineProjection {
  /** Date selected for GET /api/work/timeline, in the subject's business calendar. */
  date: string;
  attendanceSummary: {
    durationMinutes: number;
    requiredMinutes: number;
    requirementSatisfied: boolean;
  };
  attendancePolicy: {
    mode: "hour_based" | "scheduled";
    timezone: string;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    isHoliday: boolean;
  } | null;
  events: ReadonlyArray<WorkTimelineEvent>;
  exceptions: ReadonlyArray<WorkTimelineException>;
}

export interface AttendanceTodayProjection {
  availability: {
    attendanceMode: "hour_based" | "scheduled";
    businessDate: string;
    isHoliday: boolean;
    isWorkingDay: boolean;
    officeName: string;
    timezone: string;
  };
  onApprovedLeave: boolean;
  wfhPending: boolean;
  attendanceSummary: {
    durationMinutes: number;
    requiredMinutes: number;
    requirementSatisfied: boolean;
  };
  attendance: {
    mode: "office" | "wfh";
    checkedInAt: string;
    checkedOutAt: string | null;
  } | null;
  provisionalAttendance: {
    status: string;
    checkedInAt: string;
    checkedOutAt: string | null;
    creditable?: boolean;
  } | null;
}

export type TimelineReadState =
  | { status: "not-requested" }
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string; onRetry?: () => void }
  | { status: "ready"; data: WorkTimelineProjection };

export type AttendanceTodayReadState =
  | { status: "not-requested" }
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "setup-required"; message: string }
  | { status: "error"; message: string; onRetry?: () => void }
  | { status: "ready"; data: AttendanceTodayProjection };

export interface TimelineCorrectionAssignment {
  assignmentId: string;
  title: string;
}

export interface TimelineGapCorrection {
  startedAt: string;
  endedAt: string;
  assignmentId: string;
  reason: string;
}

export interface WorkTimelineProps {
  timeline: TimelineReadState;
  /** Separate /api/attendance/today source; never inferred from timeline access. */
  attendanceToday: AttendanceTodayReadState;
  /** Server-searches only the actor's eligible assignments; never sourced from the current Work page. */
  onSearchCorrectionAssignments?: (query: string) => Promise<ReadonlyArray<TimelineCorrectionAssignment>>;
  /** Route adapter owns transport, identity/page guards, and post-write recovery. */
  onCorrectGap?: (correction: TimelineGapCorrection) => void | Promise<void>;
}
