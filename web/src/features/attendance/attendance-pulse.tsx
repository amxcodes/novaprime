import { useId, useState } from "react";
import { Badge, Button, SegmentedControl } from "../../design-system";
import { getAttendanceActions, isAttendanceActionDisabled } from "./attendance-actions";
import styles from "./attendance-pulse.module.css";
import type {
  AttendanceAction,
  AttendanceActionCapabilities,
  AttendanceProjection,
  FeatureReadState,
} from "./contracts";

export interface AttendancePulseProps {
  read: FeatureReadState<AttendanceProjection> | { status: "setup-required"; message: string };
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
  const [preferredMode, setPreferredMode] = useState<"office" | "wfh">("office");
  if (read.status === "loading") {
    return (
      <div className={styles.frame}>
        <section className={styles.pulse} aria-labelledby={titleId} aria-busy="true">
          <header className={styles.header}>
            <h2 id={titleId} className={styles.eyebrow}>Today’s attendance</h2>
          </header>
          <p className={styles.stateMessage} role="status">Loading attendance…</p>
        </section>
      </div>
    );
  }

  if (read.status === "denied") {
    return <MessageState titleId={titleId} title="Attendance unavailable" message={read.message ?? "Attendance information is unavailable for this view."} />;
  }

  if (read.status === "setup-required") {
    return <MessageState titleId={titleId} title="Attendance setup needed" message={read.message} />;
  }

  if (read.status === "error") {
    return <MessageState titleId={titleId} title="Attendance could not load" message={read.message} onRetry={read.onRetry} />;
  }

  const projection = read.data;
  const availability = projection.availability;
  const isPartial = read.status === "partial";
  const summary = "attendanceSummary" in projection ? projection.attendanceSummary : undefined;
  const record = projection.attendance;
  const provisional = projection.provisionalAttendance;
  const anyPending = pendingAction !== null;
  const provisionalOpen = !record && provisional?.status === "pending" && !provisional.checkedOutAt;
  const actions = getAttendanceActions(projection, capabilities);
  const checkInActions = actions.filter((action) => action === "check-in-office" || action === "check-in-wfh");
  const canChooseCheckInMode = checkInActions.includes("check-in-office") && checkInActions.includes("check-in-wfh");
  const selectedCheckIn = checkInActions.find((action) => action === (preferredMode === "office" ? "check-in-office" : "check-in-wfh"))
    ?? checkInActions[0];
  const selectedMode = selectedCheckIn === "check-in-wfh" ? "wfh" : "office";
  const displayedActions: AttendanceAction[] = canChooseCheckInMode
    ? [...actions.filter((action) => action !== "check-in-office" && action !== "check-in-wfh"), ...(selectedCheckIn ? [selectedCheckIn] : [])]
    : actions;

  const checkInBlockedMessage = !record && !provisionalOpen
    ? attendanceBlockMessage(projection)
    : undefined;

  return (
    <div className={styles.frame}>
      <section className={styles.pulse} aria-labelledby={titleId} aria-busy={anyPending}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.eyebrow}>Today’s attendance</h2>
          <span className={styles.date}>{formatBusinessDate(availability.businessDate)}</span>
        </header>

      {canChooseCheckInMode ? (
        <SegmentedControl
          className={styles.modeSelector}
          appearance="quiet"
          aria-label="Choose check-in mode"
          options={[{ value: "office", label: "Office" }, { value: "wfh", label: "Work from home" }]}
          value={selectedMode}
          onValueChange={(value) => setPreferredMode(value as "office" | "wfh")}
        />
      ) : null}

      <div className={styles.location}>
        <Badge className={styles.readiness} tone="success">Office assigned</Badge>
        <p className={styles.locationName}>{availability.officeName}</p>
        <p className={styles.locationDetail}>Local time zone · {availability.timezone}</p>
        {record || provisional ? (
          <Badge className={styles.attendanceState} tone={provisional ? "warning" : "info"}>
            {record ? `${modeLabel(record.mode)} · ${record.checkedOutAt ? "Closed" : "In progress"}` : "Provisional WFH"}
          </Badge>
        ) : null}
      </div>

      {projection.onApprovedLeave ? (
        <p className={styles.notice} role="status">Approved leave applies for this business date. New check-ins and mode changes are unavailable.</p>
      ) : availability.isHoliday ? (
        <p className={styles.notice} role="status">This date is an office holiday. A new attendance check-in is unavailable.</p>
      ) : !availability.isWorkingDay ? (
        <p className={styles.notice} role="status">This is a non-working date in the office calendar.</p>
      ) : null}

      {displayedActions.length > 0 ? (
        <div className={styles.actions} role="group" aria-label="Attendance actions">
          {displayedActions.map((action) => (
            <Button
              className={styles.action}
              variant={action === "check-in-office" || action === "check-in-wfh" || action === "check-out" ? "primary" : "secondary"}
              type="button"
              key={action}
              disabled={isAttendanceActionDisabled(action, projection, anyPending)}
              loading={pendingAction === action}
              loadingLabel={`${getActionLabel(action, projection)} in progress`}
              onClick={(event) => onAction(action, event.currentTarget)}
            >
              {action === "check-in-office" ? `Check in at ${availability.officeName}` : getActionLabel(action, projection)}
            </Button>
          ))}
          {projection.wfhPending && !projection.wfhApproved && actions.includes("check-in-office") ? (
            <p className={styles.secondaryLine}>Cancel the pending WFH request before checking in at the office.</p>
          ) : null}
        </div>
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

      {canChooseCheckInMode && selectedMode === "office" ? (
        <div className={styles.wfhOption}>
          <span className={styles.wfhMark} aria-hidden="true">WFH</span>
          <div className={styles.wfhCopy}>
            <p className={styles.wfhTitle}>Working from home today?</p>
            <p className={styles.wfhDetail}>{projection.wfhPending ? "WFH request pending · this check-in will remain provisional." : "WFH request approved."}</p>
          </div>
          <Button
            className={styles.wfhSelect}
            variant="secondary"
            size="compact"
            type="button"
            aria-pressed="false"
            onClick={() => setPreferredMode("wfh")}
          >Use WFH</Button>
        </div>
      ) : null}

      {isPartial ? (
        <div className={styles.partialState}>
          <p className={styles.partial} role="status">{read.message}</p>
          {read.onRetry ? <Button variant="secondary" onClick={read.onRetry}>Refresh attendance</Button> : null}
        </div>
      ) : null}

      </section>
    </div>
  );
}

function formatBusinessDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("weekday")} · ${part("month")} ${part("day")}`.toLocaleUpperCase();
}

function MessageState({ titleId, title, message, onRetry }: { titleId: string; title: string; message: string; onRetry?: () => void }) {
  return (
    <div className={styles.frame}>
      <section className={styles.pulse} aria-labelledby={titleId}>
        <p className={styles.eyebrow}>Today’s attendance</p>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <p className={styles.stateMessage} role={onRetry ? "alert" : "status"}>{message}</p>
        {onRetry ? <Button variant="secondary" onClick={onRetry}>Retry attendance</Button> : null}
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
