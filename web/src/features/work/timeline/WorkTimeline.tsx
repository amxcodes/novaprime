import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Badge, Button, EmptyState, Field, Input, SearchableSelect, StateMessage } from "../../../design-system";
import type {
  AttendanceTodayReadState,
  TimelineCorrectionAssignment,
  TimelineGapCorrection,
  TimelineReadState,
  WorkTimelineEvent,
  WorkTimelineException,
  WorkTimelineProps,
} from "./contracts";
import styles from "./WorkTimeline.module.css";

const eventLabels: Record<string, string> = {
  "attendance.check_in": "Checked in",
  "attendance.check_out": "Checked out",
  "attendance.late": "Late arrival recorded",
  "attendance.early_departure": "Early departure recorded",
  "attendance.after_hours": "After scheduled hours",
  "work.started": "Work session started",
  "work.ended": "Work session ended",
  "work.adjustment.started": "Time correction started",
  "work.adjustment.ended": "Time correction ended",
};

const exceptionLabels: Record<string, string> = {
  "work.untracked_gap": "Untracked work time",
  "work.outside_attendance": "Work outside attendance",
  "work.without_attendance": "Work without attendance",
};

/** Presentational timeline. The route host owns grants, reads, writes, and navigation. */
export function WorkTimeline({
  timeline,
  attendanceToday,
  onSearchCorrectionAssignments,
  onCorrectGap,
}: WorkTimelineProps) {
  const titleId = useId();
  if (timeline.status === "not-requested") {
    return attendanceToday.status === "not-requested" ? null : (
      <TimelineFrame>
        <AttendanceToday read={attendanceToday} />
      </TimelineFrame>
    );
  }

  if (timeline.status === "loading") {
    return (
      <TimelineFrame>
        <section className={styles.timeline} aria-labelledby={titleId} aria-busy="true">
          <TimelineHeader titleId={titleId} />
          <StateMessage kind="loading" title="Loading the selected business date">Reading the daily timeline.</StateMessage>
          <AttendanceToday read={attendanceToday} />
        </section>
      </TimelineFrame>
    );
  }

  if (timeline.status === "denied" || timeline.status === "error") {
    const denied = timeline.status === "denied";
    return (
      <TimelineFrame>
        <section className={styles.timeline} aria-labelledby={titleId}>
          <TimelineHeader titleId={titleId} />
          <div className={styles.sourceState}>
            <StateMessage kind={denied ? "warning" : "error"} title={denied ? "Timeline unavailable" : "Timeline could not load"}>
              {timeline.message ?? "Your current access does not include this timeline."}
            </StateMessage>
            {!denied && timeline.onRetry ? <Button variant="secondary" onClick={timeline.onRetry}>Retry timeline</Button> : null}
          </div>
          <AttendanceToday read={attendanceToday} />
        </section>
      </TimelineFrame>
    );
  }

  const data = timeline.data;
  const policy = data.attendancePolicy;
  const timezone = policy?.timezone;
  const events = [...data.events].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const durationMinutes = safeMinutes(data.attendanceSummary.durationMinutes);
  const requirementSatisfied = policy?.mode === "hour_based" && data.attendanceSummary.requirementSatisfied;

  return (
    <TimelineFrame>
      <section className={styles.timeline} aria-labelledby={titleId}>
        <TimelineHeader titleId={titleId} />

        <dl className={styles.facts}>
          <Fact label="Selected business date">{formatBusinessDate(data.date)}</Fact>
          <Fact label={timezone ? "Office time zone" : "Displayed time zone"}>{timezone ?? "Your device time"}</Fact>
          <Fact label="Recorded attendance">{formatDuration(durationMinutes)}</Fact>
          {policy?.mode === "hour_based" ? (
            <Fact label="Required attendance">{formatDuration(data.attendanceSummary.requiredMinutes)}</Fact>
          ) : policy?.mode === "scheduled" ? (
            <Fact label="Attendance policy">Schedule based</Fact>
          ) : null}
          {policy?.mode === "scheduled" && policy.scheduledStart && policy.scheduledEnd ? (
            <Fact label="Scheduled hours">
              <time dateTime={policy.scheduledStart}>{formatBusinessTime(policy.scheduledStart, timezone)}</time>
              {" – "}
              <time dateTime={policy.scheduledEnd}>{formatBusinessTime(policy.scheduledEnd, timezone)}</time>
            </Fact>
          ) : null}
        </dl>

        {policy?.isHoliday ? (
          <StateMessage kind="info" title="Office holiday">This office calendar marks the selected business date as a holiday.</StateMessage>
        ) : null}
        {requirementSatisfied ? (
          <StateMessage kind="success" title="Attendance requirement met">
            {formatDuration(data.attendanceSummary.durationMinutes)} of the required {formatDuration(data.attendanceSummary.requiredMinutes)} is recorded for this business date.
          </StateMessage>
        ) : null}

        <section className={styles.eventsSection} aria-labelledby={`${titleId}-events`}>
          <div className={styles.subheading}>
            <h3 id={`${titleId}-events`}>Recorded events</h3>
            <span>{events.length} {events.length === 1 ? "event" : "events"}</span>
          </div>
          {events.length ? (
            <ol className={styles.eventList} aria-label={`Recorded events for ${formatBusinessDate(data.date)}`}>
              {events.map((event, index) => (
                <EventRow key={`${event.sourceId ?? "event"}-${event.type}-${event.at}-${index}`} event={event} timezone={timezone} />
              ))}
            </ol>
          ) : (
            <EmptyState
              className={styles.empty}
              title="No timeline events"
              description={`No attendance, work, or time-correction events are recorded for ${formatBusinessDate(data.date)}.`}
            />
          )}
        </section>

        <TimelineExceptions
          titleId={titleId}
          exceptions={data.exceptions}
          timezone={timezone}
          onSearchCorrectionAssignments={onSearchCorrectionAssignments}
          onCorrectGap={onCorrectGap}
        />

        <AttendanceToday read={attendanceToday} />
      </section>
    </TimelineFrame>
  );
}

function TimelineFrame({ children }: { children: ReactNode }) {
  return <div className={styles.frame}>{children}</div>;
}

function TimelineHeader({ titleId }: { titleId: string }) {
  return (
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Work</p>
        <h2 className={styles.title} id={titleId}>Daily timeline</h2>
      </div>
      <p className={styles.description}>Attendance, recorded work sessions, and visible time exceptions for one business date.</p>
    </header>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EventRow({ event, timezone }: { event: WorkTimelineEvent; timezone?: string }) {
  const title = eventLabels[event.type] ?? "Recorded event";
  return (
    <li className={styles.event}>
      <time className={styles.eventTime} dateTime={event.at}>{formatBusinessTime(event.at, timezone)}</time>
      <span className={styles.marker} aria-hidden="true" />
      <div className={styles.eventBody}>
        <strong>{title}</strong>
        <span>{eventDescription(event, timezone)}</span>
      </div>
    </li>
  );
}

function eventDescription(event: WorkTimelineEvent, timezone?: string): string {
  if (event.type === "attendance.check_in" || event.type === "attendance.check_out") {
    return event.mode ? `Attendance · ${event.mode === "wfh" ? "working from home" : "office"}` : "Attendance record";
  }
  if (event.type === "work.started" || event.type === "work.ended") {
    return event.title ? `Work session · ${event.title}` : "Work session";
  }
  if (event.type === "attendance.late" && typeof event.minutesLate === "number") {
    return `${event.minutesLate} minutes beyond the grace period${event.scheduledAt ? ` · scheduled ${formatBusinessTime(event.scheduledAt, timezone)}` : ""}`;
  }
  if (event.type === "attendance.early_departure" && typeof event.minutesEarly === "number") {
    return `${event.minutesEarly} minutes before scheduled end${event.scheduledAt ? ` · scheduled ${formatBusinessTime(event.scheduledAt, timezone)}` : ""}`;
  }
  if (event.type === "attendance.after_hours" && typeof event.minutesAfter === "number") {
    return `${event.minutesAfter} minutes after scheduled end${event.scheduledAt ? ` · scheduled ${formatBusinessTime(event.scheduledAt, timezone)}` : ""}`;
  }
  if (event.type === "work.adjustment.started" || event.type === "work.adjustment.ended") return "Recorded time correction";
  return "Recorded for this business date";
}

function TimelineExceptions({
  titleId,
  exceptions,
  timezone,
  onSearchCorrectionAssignments,
  onCorrectGap,
}: {
  titleId: string;
  exceptions: ReadonlyArray<WorkTimelineException>;
  timezone?: string;
  onSearchCorrectionAssignments?: (query: string) => Promise<ReadonlyArray<TimelineCorrectionAssignment>>;
  onCorrectGap?: (correction: TimelineGapCorrection) => void | Promise<void>;
}) {
  if (!exceptions.length) return null;
  return (
    <section className={styles.exceptions} aria-labelledby={`${titleId}-exceptions`}>
      <div className={styles.subheading}>
        <h3 id={`${titleId}-exceptions`}>Time exceptions</h3>
        <span>{exceptions.length} {exceptions.length === 1 ? "exception" : "exceptions"}</span>
      </div>
      <ul className={styles.exceptionList}>
        {exceptions.map((exception, index) => (
          <ExceptionRow
            key={`${exception.type}-${exception.startedAt ?? index}`}
            exception={exception}
            timezone={timezone}
            onSearchCorrectionAssignments={onSearchCorrectionAssignments}
            onCorrectGap={onCorrectGap}
          />
        ))}
      </ul>
    </section>
  );
}

function ExceptionRow({
  exception,
  timezone,
  onSearchCorrectionAssignments,
  onCorrectGap,
}: {
  exception: WorkTimelineException;
  timezone?: string;
  onSearchCorrectionAssignments?: (query: string) => Promise<ReadonlyArray<TimelineCorrectionAssignment>>;
  onCorrectGap?: (correction: TimelineGapCorrection) => void | Promise<void>;
}) {
  const label = exceptionLabels[exception.type] ?? "Time exception";
  const hasInterval = Boolean(exception.startedAt && exception.endedAt);
  const canSubmitCorrection = exception.type === "work.untracked_gap" && exception.actionable === true &&
    hasInterval && Boolean(onSearchCorrectionAssignments) && Boolean(onCorrectGap);
  return (
    <li className={styles.exception}>
      <div className={styles.exceptionSummary}>
        <div className={styles.exceptionHeading}>
          <strong>{label}</strong>
          {canSubmitCorrection ? <Badge tone="info">Correction available</Badge> : null}
        </div>
        {hasInterval ? (
          <p>
            <time dateTime={exception.startedAt}>{formatBusinessTime(exception.startedAt!, timezone)}</time>
            {" – "}
            <time dateTime={exception.endedAt}>{formatBusinessTime(exception.endedAt!, timezone)}</time>
          </p>
        ) : null}
      </div>
      {canSubmitCorrection ? (
        <GapCorrectionForm
          startedAt={exception.startedAt!}
          endedAt={exception.endedAt!}
          onSearchCorrectionAssignments={onSearchCorrectionAssignments!}
          onSubmit={onCorrectGap!}
        />
      ) : null}
    </li>
  );
}

function GapCorrectionForm({
  startedAt,
  endedAt,
  onSearchCorrectionAssignments,
  onSubmit,
}: {
  startedAt: string;
  endedAt: string;
  onSearchCorrectionAssignments: (query: string) => Promise<ReadonlyArray<TimelineCorrectionAssignment>>;
  onSubmit: (correction: TimelineGapCorrection) => void | Promise<void>;
}) {
  const formId = useId();
  const [assignmentId, setAssignmentId] = useState("");
  const [searchResults, setSearchResults] = useState<ReadonlyArray<TimelineCorrectionAssignment>>([]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const assignmentId = String(values.get("assignmentId") ?? "");
    const reason = String(values.get("reason") ?? "").trim();
    if (!searchResults.some((assignment) => assignment.assignmentId === assignmentId) || !reason || reason.length > 2000) {
      setFailed(true);
      setFeedback("Choose an assignment and enter a reason of 2,000 characters or fewer.");
      return;
    }

    setPending(true);
    setFailed(false);
    setFeedback("");
    try {
      await onSubmit({ startedAt, endedAt, assignmentId, reason });
      setFeedback("Time correction submitted. The timeline will refresh after the server confirms it.");
      setAssignmentId("");
      form.reset();
    } catch {
      setFailed(true);
      setFeedback("The correction could not be submitted. Refresh the timeline and check the interval before trying again.");
    } finally {
      setPending(false);
    }
  }

  async function searchAssignments(query: string) {
    const results = await onSearchCorrectionAssignments(query);
    if (!Array.isArray(results) || results.length > 30 || results.some((assignment) =>
      !assignment || typeof assignment.assignmentId !== "string" || !assignment.assignmentId.trim() ||
      typeof assignment.title !== "string" || !assignment.title.trim())) {
      throw new Error("TIMELINE_CORRECTION_ASSIGNMENT_SEARCH_INVALID");
    }
    setSearchResults((current) => {
      const byId = new Map(current.map((assignment) => [assignment.assignmentId, assignment]));
      for (const assignment of results) {
        byId.delete(assignment.assignmentId);
        byId.set(assignment.assignmentId, assignment);
      }
      return [...byId.values()].slice(-120);
    });
    return results.map((assignment) => ({ value: assignment.assignmentId, label: assignment.title }));
  }

  const selectedAssignment = searchResults.find((assignment) => assignment.assignmentId === assignmentId);

  return (
    <form className={styles.correctionForm} onSubmit={(event) => void submit(event)} aria-labelledby={`${formId}-title`} noValidate>
      <h4 id={`${formId}-title`}>Record missing work time</h4>
      <SearchableSelect
        label="Assignment"
        hint="Search assignments assigned to you. Results are limited to 30."
        name="assignmentId"
        required
        value={assignmentId}
        options={[]}
        searchMode="remote"
        onSearch={searchAssignments}
        selectedOption={selectedAssignment ? { value: selectedAssignment.assignmentId, label: selectedAssignment.title } : null}
        loadingMessage="Searching eligible assignments…"
        searchErrorMessage="Eligible assignments could not be loaded. Edit the search to retry."
        placeholder="Search your assignments"
        emptyMessage="No eligible assignments match this search."
        clearLabel="Clear assignment selection"
        disabled={pending}
        onChange={(value) => { setAssignmentId(value); setFeedback(""); setFailed(false); }}
      />
      <Field label="Reason" hint="This explanation is included with the audited time correction." required>
        {(control) => (
          <Input {...control} name="reason" type="text" maxLength={2000} required disabled={pending} placeholder="Why was this work time not recorded?" />
        )}
      </Field>
      <Button type="submit" variant="secondary" loading={pending} loadingLabel="Submitting time correction" disabled={pending}>
        Record correction
      </Button>
      {feedback ? <StateMessage kind={failed ? "error" : "success"}>{feedback}</StateMessage> : null}
    </form>
  );
}

function AttendanceToday({ read }: { read: AttendanceTodayReadState }) {
  const titleId = useId();
  if (read.status === "not-requested") return null;
  if (read.status === "loading") {
    return <section className={styles.attendance} aria-labelledby={titleId} aria-busy="true">
      <h3 id={titleId}>Attendance today</h3>
      <StateMessage kind="loading">Loading today’s attendance summary.</StateMessage>
    </section>;
  }
  if (read.status === "setup-required") {
    return <section className={styles.attendance} aria-labelledby={titleId}>
      <h3 id={titleId}>Attendance today</h3>
      <StateMessage kind="info" title="Attendance setup required">{read.message}</StateMessage>
    </section>;
  }
  if (read.status === "denied" || read.status === "error") {
    const denied = read.status === "denied";
    return <section className={styles.attendance} aria-labelledby={titleId}>
      <h3 id={titleId}>Attendance today</h3>
      <div className={styles.sourceState}>
        <StateMessage kind={denied ? "warning" : "error"} title={denied ? "Attendance summary unavailable" : "Attendance summary could not load"}>
          {read.message ?? "Your current access does not include the attendance summary. The selected-date timeline remains separate."}
        </StateMessage>
        {!denied && read.onRetry ? <Button variant="secondary" onClick={read.onRetry}>Retry attendance</Button> : null}
      </div>
    </section>;
  }

  const { data } = read;
  const record = data.attendance;
  const provisional = data.provisionalAttendance;
  const attendanceStatus = record
    ? record.checkedOutAt ? "Checked out" : "Checked in"
    : provisional?.status === "pending"
      ? "Provisional pending"
      : data.onApprovedLeave
        ? "Approved leave"
        : data.availability.isHoliday
          ? "Office holiday"
          : !data.availability.isWorkingDay
            ? "Non-working day"
            : "No credited check-in";
  const attendanceTone = record ? "success" : provisional?.status === "pending" ? "warning" : "neutral";
  return (
    <section className={styles.attendance} aria-labelledby={titleId}>
      <div className={styles.subheading}>
        <div>
          <p className={styles.eyebrow}>Separate current-day source</p>
          <h3 id={titleId}>Attendance today</h3>
        </div>
        <Badge tone={attendanceTone}>{attendanceStatus}</Badge>
      </div>
      <dl className={styles.facts}>
        <Fact label="Business date">{formatBusinessDate(data.availability.businessDate)}</Fact>
        <Fact label="Office">{data.availability.officeName}</Fact>
        <Fact label="Recorded attendance">{formatDuration(data.attendanceSummary.durationMinutes)}</Fact>
        {data.availability.attendanceMode === "hour_based" ? (
          <Fact label="Required attendance">{formatDuration(data.attendanceSummary.requiredMinutes)}</Fact>
        ) : <Fact label="Attendance policy">Schedule based</Fact>}
      </dl>
      {record ? (
        <p className={styles.attendanceDetail}>
          {record.mode === "wfh" ? "Working from home" : "Office attendance"} · checked in{" "}
          <time dateTime={record.checkedInAt}>{formatBusinessTime(record.checkedInAt, data.availability.timezone)}</time>
          {record.checkedOutAt ? <> · checked out <time dateTime={record.checkedOutAt}>{formatBusinessTime(record.checkedOutAt, data.availability.timezone)}</time></> : " · attendance is open"}
        </p>
      ) : provisional ? (
        <p className={styles.attendanceDetail}>
          Provisional WFH check-in · <time dateTime={provisional.checkedInAt}>{formatBusinessTime(provisional.checkedInAt, data.availability.timezone)}</time>
          {provisional.status === "pending"
            ? " · pending approval and not credited as attendance"
            : provisional.creditable
              ? " · credited as attendance"
              : ` · ${provisional.status.replaceAll("_", " ")}`}
        </p>
      ) : (
        <p className={styles.attendanceDetail}>
          {data.onApprovedLeave
            ? "Approved leave applies to this business date."
            : data.availability.isHoliday
              ? "This office calendar marks today as a holiday."
              : !data.availability.isWorkingDay
                ? "Today is a non-working date in the office calendar."
                : "No credited attendance record is available for this business date."}
        </p>
      )}
      {data.wfhPending ? (
        <StateMessage kind="warning" title="WFH approval pending">
          {provisional
            ? "The provisional WFH check-in remains separate from credited attendance until approval resolves it."
            : "The pending request does not change the credited attendance record shown above."}
        </StateMessage>
      ) : null}
    </section>
  );
}

export function formatBusinessDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "Date unavailable";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatBusinessTime(value: string, timezone?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...(timezone ? { timeZone: timezone } : {}),
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  }
}

function safeMinutes(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function formatDuration(minutes: number): string {
  const value = safeMinutes(minutes);
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return hours > 0 ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
}
