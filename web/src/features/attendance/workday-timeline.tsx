import { useId } from "react";
import { Button } from "../../design-system";
import styles from "./workday-timeline.module.css";
import type { FeatureReadState, TimelineEvent, WorkdayTimelineProjection } from "./contracts";

export interface WorkdayTimelineProps {
  read: FeatureReadState<WorkdayTimelineProjection>;
  onOpenWork?: () => void;
}

const eventLabels: Record<string, string> = {
  "attendance.check_in": "Checked in",
  "attendance.check_out": "Checked out",
  "attendance.late": "Late arrival",
  "attendance.early_departure": "Early departure",
  "attendance.after_hours": "After scheduled hours",
  "work.started": "Work started",
  "work.ended": "Work ended",
  "work.adjustment.started": "Time correction started",
  "work.adjustment.ended": "Time correction ended",
};

/** Responsive, chronological view of the exact events returned by /work/timeline. */
export function WorkdayTimeline({ read, onOpenWork }: WorkdayTimelineProps) {
  const titleId = useId();
  if (read.status === "loading") {
    return (
      <div className={styles.frame}>
        <section className={styles.timeline} aria-labelledby={titleId} aria-busy="true">
          <TimelineHeading titleId={titleId} />
          <p className={styles.stateMessage} role="status">Loading workday timeline…</p>
        </section>
      </div>
    );
  }

  if (read.status === "denied") {
    return <TimelineMessage titleId={titleId} title="Timeline unavailable" message={read.message ?? "Workday timeline information is unavailable for this view."} />;
  }

  if (read.status === "error") {
    return <TimelineMessage titleId={titleId} title="Timeline could not load" message={read.message} onRetry={read.onRetry} />;
  }

  const data = read.data;
  const timezone = data.attendancePolicy?.timezone;
  const events = [...data.events].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const exceptions = data.exceptions;
  const isPartial = read.status === "partial";

  return (
    <div className={styles.frame}>
      <section className={styles.timeline} aria-labelledby={titleId}>
        <TimelineHeading titleId={titleId} />
      <div className={styles.context}>
        <p><span>Business date</span><strong>{data.date}</strong></p>
        {timezone ? <p><span>Office time zone</span><strong>{timezone}</strong></p> : null}
        <p><span>Attendance duration</span><strong>{formatDuration(data.attendanceSummary.durationMinutes)}</strong></p>
        {data.attendancePolicy?.mode === "hour_based" ? (
          <p><span>Required duration</span><strong>{formatDuration(data.attendanceSummary.requiredMinutes)}</strong></p>
        ) : null}
      </div>

      {data.attendancePolicy?.isHoliday ? (
        <p className={styles.notice}>Office holiday · no scheduled attendance events are expected.</p>
      ) : null}

      {isPartial ? (
        <div className={styles.partialState}>
          <p className={styles.partial} role="status">{read.message}</p>
          {read.onRetry ? <Button variant="secondary" onClick={read.onRetry}>Refresh timeline</Button> : null}
        </div>
      ) : null}

      {events.length ? (
        <ol className={styles.eventList} aria-label={`Workday events for ${data.date}`}>
          {events.map((event, index) => (
            <TimelineEventRow key={`${event.type}-${event.at}-${event.sourceId ?? index}`} event={event} timezone={timezone} />
          ))}
        </ol>
      ) : (
        <p className={styles.empty} role="status">
          {read.status === "empty" && read.message ? read.message : "No attendance or work events are recorded for this business date."}
        </p>
      )}

      {exceptions.length ? (
        <section className={styles.exceptions} aria-labelledby={`${titleId}-exceptions`}>
          <h3 id={`${titleId}-exceptions`}>Time exceptions</h3>
          <ul>
            {exceptions.map((exception, index) => (
              <li key={`${exception.type}-${exception.startedAt ?? index}`}>
                <strong>{exceptionLabel(exception.type)}</strong>
                {exception.startedAt && exception.endedAt ? (
                  <span>{formatTime(exception.startedAt, timezone)}–{formatTime(exception.endedAt, timezone)}</span>
                ) : null}
                {exception.actionable === true ? <span className={styles.actionable}>Time correction available in Work</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.attendanceSummary.requirementSatisfied ? (
        <p className={styles.completion} role="status">Required hour-based attendance duration is met.</p>
      ) : null}

      {onOpenWork ? <Button className={styles.openWork} variant="secondary" onClick={onOpenWork}>Open Work timeline</Button> : null}
      </section>
    </div>
  );
}

function TimelineHeading({ titleId }: { titleId: string }) {
  return (
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Your day</p>
        <h2 id={titleId} className={styles.title}>Workday timeline</h2>
      </div>
      <p className={styles.description}>Attendance, productive sessions, and recorded time corrections.</p>
    </header>
  );
}

function TimelineMessage({ titleId, title, message, onRetry }: { titleId: string; title: string; message: string; onRetry?: () => void }) {
  return (
    <div className={styles.frame}>
      <section className={styles.timeline} aria-labelledby={titleId}>
        <p className={styles.eyebrow}>Your day</p>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <p className={styles.stateMessage} role={onRetry ? "alert" : "status"}>{message}</p>
        {onRetry ? <Button variant="secondary" onClick={onRetry}>Retry timeline</Button> : null}
      </section>
    </div>
  );
}

function TimelineEventRow({ event, timezone }: { event: TimelineEvent; timezone?: string }) {
  const description = eventDescription(event, timezone);
  return (
    <li className={styles.event}>
      <time className={styles.time} dateTime={event.at}>{formatTime(event.at, timezone)}</time>
      <span className={styles.marker} aria-hidden="true" />
      <div className={styles.eventBody}>
        <strong>{eventLabels[event.type] ?? "Workday event"}</strong>
        <span>{description}</span>
      </div>
    </li>
  );
}

function eventDescription(event: TimelineEvent, timezone?: string): string {
  if (event.type === "work.started" || event.type === "work.ended") {
    return event.title ? `Work session · ${event.title}` : "Work session";
  }
  if (event.type === "attendance.check_in" || event.type === "attendance.check_out") {
    return event.mode ? `Attendance · ${event.mode === "wfh" ? "working from home" : "office"}` : "Attendance record";
  }
  if (event.type === "attendance.late" && typeof event.minutesLate === "number") {
    return `${event.minutesLate} minutes beyond the start grace period${event.scheduledAt ? ` · scheduled ${formatTime(event.scheduledAt, timezone)}` : ""}`;
  }
  if (event.type === "attendance.early_departure" && typeof event.minutesEarly === "number") {
    return `${event.minutesEarly} minutes before the scheduled end${event.scheduledAt ? ` · scheduled ${formatTime(event.scheduledAt, timezone)}` : ""}`;
  }
  if (event.type === "attendance.after_hours" && typeof event.minutesAfter === "number") {
    return `${event.minutesAfter} minutes after the scheduled end${event.scheduledAt ? ` · scheduled ${formatTime(event.scheduledAt, timezone)}` : ""}`;
  }
  if (event.type.startsWith("work.adjustment.")) return "Recorded time correction";
  return "Recorded for this business date";
}

function exceptionLabel(type: string): string {
  if (type === "work.untracked_gap") return "Untracked work time";
  if (type === "work.outside_attendance") return "Work outside attendance";
  if (type === "work.without_attendance") return "Work without attendance";
  return "Time exception";
}

function formatTime(value: string, timezone?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...(timezone ? { timeZone: timezone } : {}),
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
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
