import { useId } from "react";
import { getAttendanceActions, isAttendanceActionDisabled } from "./attendance-actions";
import styles from "./attendance-pulse.module.css";
import type {
  AttendanceAction,
  AttendanceActionCapabilities,
  AttendanceProjection,
  FeatureReadState,
} from "./contracts";

export interface AttendancePulseProps {
  read: FeatureReadState<AttendanceProjection>;
  /** Derived by the route/page from the actor's current effective grants. */
  capabilities: AttendanceActionCapabilities;
  onAction: (action: AttendanceAction, source: HTMLButtonElement) => void | Promise<void>;
  pendingAction?: AttendanceAction | null;
}

const actionLabels: Record<AttendanceAction, string> = {
  "check-in-office": "Check in at office",
  "check-in-wfh": "Check in from home",
  "check-out": "Check out",
  "change-to-wfh": "Switch to working from home",
  "change-to-office": "Switch to office",
};

/**
 * Attendance presentation only. Permission hints come from the parent and
 * business rules remain server-owned; this component only avoids offering
 * actions contradicted by the current read projection.
 */
export function AttendancePulse({
  read,
  capabilities,
  onAction,
  pendingAction = null,
}: AttendancePulseProps) {
  const titleId = useId();
  if (read.status === "loading") {
    return (
      <div className={styles.frame}>
        <section className={styles.pulse} aria-labelledby={titleId} aria-busy="true">
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Today</p>
              <h2 id={titleId} className={styles.title}>Attendance</h2>
            </div>
          </header>
          <p className={styles.stateMessage} role="status">Loading attendance…</p>
        </section>
      </div>
    );
  }

  if (read.status === "denied") {
    return <MessageState titleId={titleId} title="Attendance unavailable" message={read.message ?? "Attendance information is unavailable for this view."} />;
  }

  if (read.status === "error") {
    return <MessageState titleId={titleId} title="Attendance could not load" message={read.message} onRetry={read.onRetry} />;
  }

  const projection = read.data;
  const availability = projection.availability;
  const isPartial = read.status === "partial";
  const summary = "attendanceSummary" in projection ? projection.attendanceSummary : undefined;
  const workingDay = availability.isWorkingDay && !availability.isHoliday;
  const checkInPrerequisites = workingDay && Boolean(availability.calendarId) &&
    (availability.attendanceMode !== "scheduled" || Boolean(availability.shiftId)) &&
    !projection.onApprovedLeave;
  const record = projection.attendance;
  const provisional = projection.provisionalAttendance;
  const anyPending = pendingAction !== null;
  const provisionalOpen = !record && provisional?.status === "pending" && !provisional.checkedOutAt;
  const actions = getAttendanceActions(projection, capabilities);

  const status = attendanceStatus(projection);
  const checkInBlockedMessage = !record && !provisionalOpen
    ? attendanceBlockMessage(projection)
    : undefined;

  return (
    <div className={styles.frame}>
      <section className={styles.pulse} aria-labelledby={titleId} aria-busy={anyPending}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Attendance pulse</p>
            <h2 id={titleId} className={styles.title}>{status}</h2>
          </div>
          <span className={styles.mode}>
            {record ? modeLabel(record.mode) : provisional ? "Provisional WFH" : "Not started"}
          </span>
        </header>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Business date</dt>
          <dd>{availability.businessDate}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Office</dt>
          <dd>{availability.officeName}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Local time zone</dt>
          <dd>{availability.timezone}</dd>
        </div>
      </dl>

      {projection.onApprovedLeave ? (
        <p className={styles.notice} role="status">Approved leave applies for this business date. New check-ins and mode changes are unavailable.</p>
      ) : availability.isHoliday ? (
        <p className={styles.notice} role="status">This date is an office holiday. A new attendance check-in is unavailable.</p>
      ) : !availability.isWorkingDay ? (
        <p className={styles.notice} role="status">This is a non-working date in the office calendar.</p>
      ) : null}

      {record ? (
        <div className={styles.record}>
          <p className={styles.recordLine}>
            Checked in <time dateTime={record.checkedInAt}>{formatTime(record.checkedInAt, availability.timezone)}</time>
          </p>
          {record.checkedOutAt ? (
            <p className={styles.secondaryLine}>
              Checked out <time dateTime={record.checkedOutAt}>{formatTime(record.checkedOutAt, availability.timezone)}</time>
            </p>
          ) : (
            <p className={styles.secondaryLine}>Attendance is open.</p>
          )}
          {summary && availability.attendanceMode === "hour_based" ? (
            <AttendanceDuration
              duration={summary.durationMinutes}
              required={summary.requiredMinutes}
              satisfied={summary.requirementSatisfied}
            />
          ) : availability.attendanceMode === "scheduled" ? (
            <p className={styles.secondaryLine}>Schedule-relative timing appears in the workday timeline.</p>
          ) : null}
        </div>
      ) : provisional ? (
        <div className={styles.record}>
          <p className={provisional.status === "pending" ? styles.notice : styles.recordLine} role={provisional.status === "pending" ? "status" : undefined}>
            {provisionalMessage(provisional.status, provisional.resolutionReason, provisional.creditable)}
          </p>
          <p className={styles.secondaryLine}>
            Started <time dateTime={provisional.checkedInAt}>{formatTime(provisional.checkedInAt, availability.timezone)}</time>
            {provisional.checkedOutAt ? <> · ended <time dateTime={provisional.checkedOutAt}>{formatTime(provisional.checkedOutAt, availability.timezone)}</time></> : null}
          </p>
          {provisional.status === "pending" ? (
            <p className={styles.secondaryLine}>This WFH evidence is separate from credited attendance while it is pending.</p>
          ) : null}
        </div>
      ) : (
        <div className={styles.record}>
          <p className={styles.recordLine}>No credited attendance has started today.</p>
          {projection.actionContext ? (
            <p className={styles.secondaryLine}>Showing the current-day context needed by the actions available to you.</p>
          ) : null}
          {projection.wfhPending && !projection.wfhApproved ? (
            <p className={styles.notice} role="status">A WFH request is pending. A WFH check-in remains provisional until the request is approved.</p>
          ) : null}
          {checkInBlockedMessage ? <p className={styles.secondaryLine}>{checkInBlockedMessage}</p> : null}
        </div>
      )}

      {isPartial ? (
        <div className={styles.partialState}>
          <p className={styles.partial} role="status">{read.message}</p>
          {read.onRetry ? <button className={styles.retryAction} type="button" onClick={read.onRetry}>Refresh attendance</button> : null}
        </div>
      ) : null}

      {actions.length > 0 ? (
        <div className={styles.actions} role="group" aria-label="Attendance actions">
          {actions.map((action) => (
            <button
              className={action === "check-in-office" || action === "check-out" ? styles.primaryAction : styles.secondaryAction}
              type="button"
              key={action}
              disabled={isAttendanceActionDisabled(action, projection, anyPending)}
              aria-busy={pendingAction === action}
              onClick={(event) => onAction(action, event.currentTarget)}
            >
              {pendingAction === action ? `${getActionLabel(action, projection)}…` : getActionLabel(action, projection)}
            </button>
          ))}
          {projection.wfhPending && !projection.wfhApproved && actions.includes("check-in-office") ? (
            <p className={styles.secondaryLine}>Cancel the pending WFH request before checking in at the office.</p>
          ) : null}
        </div>
      ) : null}
      </section>
    </div>
  );
}

function MessageState({ titleId, title, message, onRetry }: { titleId: string; title: string; message: string; onRetry?: () => void }) {
  return (
    <div className={styles.frame}>
      <section className={styles.pulse} aria-labelledby={titleId}>
        <p className={styles.eyebrow}>Attendance pulse</p>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <p className={styles.stateMessage} role={onRetry ? "alert" : "status"}>{message}</p>
        {onRetry ? <button className={styles.secondaryAction} type="button" onClick={onRetry}>Retry attendance</button> : null}
      </section>
    </div>
  );
}

function AttendanceDuration({ duration, required, satisfied }: { duration: number; required: number; satisfied: boolean }) {
  const clampedDuration = Math.max(0, Math.min(duration, required));
  const safeRequired = Math.max(1, required);
  return (
    <div className={styles.duration}>
      <div className={styles.durationHeading}>
        <span>Recorded duration</span>
        <strong>{formatDuration(duration)} <span className={styles.secondaryText}>of {formatDuration(required)} required</span></strong>
      </div>
      <progress
        className={styles.progress}
        max={safeRequired}
        value={clampedDuration}
        aria-label={`Attendance duration ${formatDuration(duration)} of ${formatDuration(required)} required`}
      />
      <span className={styles.secondaryText}>{satisfied ? "Required duration met" : "Required duration not yet met"}</span>
    </div>
  );
}

function attendanceStatus(projection: AttendanceProjection): string {
  if (projection.attendance) return projection.attendance.checkedOutAt ? "Attendance closed" : "Attendance in progress";
  if (projection.provisionalAttendance?.status === "pending") return "WFH check-in pending";
  if (projection.onApprovedLeave) return "Approved leave";
  return "Not started";
}

function attendanceBlockMessage(projection: AttendanceProjection): string | undefined {
  const { availability } = projection;
  if (projection.onApprovedLeave) return "Attendance actions are unavailable while approved leave applies.";
  if (availability.isHoliday) return "Check-in is unavailable on an office holiday.";
  if (!availability.isWorkingDay) return "Check-in is unavailable on a non-working day.";
  if (!availability.calendarId) return "Check-in is unavailable until an office calendar is configured.";
  if (availability.attendanceMode === "scheduled" && !availability.shiftId) return "Check-in is unavailable until a scheduled shift is configured.";
  return undefined;
}

function provisionalMessage(status: string, resolutionReason?: string | null, creditable?: boolean): string {
  if (status === "pending") return "WFH check-in is provisional and has not been credited as attendance.";
  if (status === "discarded") {
    const reason = resolutionReason?.replaceAll("_", " ").toLowerCase();
    return `This provisional WFH interval was not credited${reason ? ` (${reason})` : ""}.`;
  }
  if (creditable === true || status === "promoted") return "This WFH interval was approved and added to the attendance record.";
  return "The provisional WFH interval is resolved.";
}

function modeLabel(mode: "office" | "wfh"): string {
  return mode === "office" ? "Office" : "Working from home";
}

function getActionLabel(action: AttendanceAction, projection: AttendanceProjection): string {
  if (action === "check-in-wfh" && projection.wfhPending && !projection.wfhApproved) {
    return "Provisional WFH check-in";
  }
  return actionLabels[action];
}

function formatTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
}

function formatDuration(minutes: number): string {
  const value = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return hours > 0 ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
}
