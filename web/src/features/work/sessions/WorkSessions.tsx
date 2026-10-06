import { useEffect, useId, useState } from "react";
import { Badge, Button, EmptyState, StateMessage } from "../../../design-system";
import styles from "./WorkSessions.module.css";
import type { WorkSessionSummary, WorkSessionsProps } from "./contracts";

const isRunning = (session: WorkSessionSummary) =>
  session.state === "running" && session.endedAt === null;

export function getWorkSessionStatus(session: WorkSessionSummary) {
  if (isRunning(session)) return { label: "Running", tone: "success" as const };
  if (session.state === "cancelled") return { label: "Cancelled", tone: "danger" as const };
  if (session.state === "auto_closed") return { label: "Closed automatically", tone: "warning" as const };
  if (session.closureReason === "PAUSED") return { label: "Paused", tone: "info" as const };
  if (session.closureReason === "STOPPED") return { label: "Stopped", tone: "neutral" as const };
  return { label: "Completed", tone: "neutral" as const };
}

export function getElapsedMilliseconds(session: WorkSessionSummary, now: number, readAt: number) {
  const base = Number.isFinite(session.durationMilliseconds)
    ? Math.max(0, session.durationMilliseconds)
    : 0;
  if (!isRunning(session)) return base;
  const elapsedAfterRead = Number.isFinite(readAt) ? Math.max(0, now - readAt) : 0;
  return base + elapsedAfterRead;
}

export function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Start time unavailable"
    : new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
}

function elapsedAccessibleLabel(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `Elapsed ${hours} hours, ${minutes} minutes, ${remainingSeconds} seconds`;
}

const SESSION_WINDOW_MILLISECONDS = 2 * 60 * 60 * 1000;
const SESSION_TICK_MILLISECONDS = 15 * 60 * 1000;

function formatClockTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestamp));
}

export function projectSessionTimeline(session: WorkSessionSummary, elapsedMilliseconds: number) {
  const startedAt = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAt)) return null;

  const currentAt = startedAt + Math.max(0, elapsedMilliseconds);
  const windowStart = Math.floor(currentAt / SESSION_WINDOW_MILLISECONDS) * SESSION_WINDOW_MILLISECONDS;
  const currentPosition = Math.min(100, Math.max(0, ((currentAt - windowStart) / SESSION_WINDOW_MILLISECONDS) * 100));
  const startedInWindow = startedAt >= windowStart;
  const startPosition = startedInWindow
    ? Math.min(currentPosition, ((startedAt - windowStart) / SESSION_WINDOW_MILLISECONDS) * 100)
    : 0;
  const ticks = Array.from({ length: 9 }, (_, index) => ({
    label: index % 2 === 0 ? formatClockTime(windowStart + index * SESSION_TICK_MILLISECONDS) : null,
    major: index % 2 === 0,
  }));

  return {
    currentAt,
    currentPosition,
    startPosition,
    startedInWindow,
    ticks,
    intervalWidth: Math.max(0, currentPosition - startPosition),
  };
}

function ActiveSessionTimeline({ session, elapsedMilliseconds }: {
  session: WorkSessionSummary;
  elapsedMilliseconds: number;
}) {
  const timeline = projectSessionTimeline(session, elapsedMilliseconds);
  if (!timeline) return null;

  const accessibleStart = formatTimestamp(session.startedAt);
  const accessibleCurrent = formatClockTime(timeline.currentAt);

  return (
    <figure
      className={styles.timeline}
      role="img"
      aria-label={`Two-hour session window. This session started ${accessibleStart} and is active at ${accessibleCurrent}.`}
    >
      <figcaption className={styles.timelineTitle}>SESSION WINDOW</figcaption>
      <div className={styles.timelineLabels} aria-hidden="true">
        {timeline.ticks.map((tick, index) => tick.label ? (
          <time key={`${tick.label}-${index}`} style={{ left: `${index * 12.5}%` }}>{tick.label}</time>
        ) : null)}
      </div>
      <div className={styles.timelinePlot} aria-hidden="true">
        {timeline.ticks.map((tick, index) => (
          <span
            className={tick.major ? styles.majorTick : styles.minorTick}
            key={index}
            style={{ left: `${index * 12.5}%` }}
          />
        ))}
        <span
          className={styles.liveInterval}
          style={{ left: `${timeline.startPosition}%`, width: `${timeline.intervalWidth}%` }}
        >
          {timeline.intervalWidth >= 16 ? <span>●&nbsp; LIVE SESSION</span> : null}
        </span>
        {timeline.startedInWindow ? (
          <span className={styles.startMarker} style={{ left: `${timeline.startPosition}%` }} />
        ) : null}
        <span className={styles.currentMarker} style={{ left: `${timeline.currentPosition}%` }} />
      </div>
      <div className={styles.timelineCaptions} aria-hidden="true">
        <time>{formatClockTime(Date.parse(session.startedAt))} START</time>
        <time>NOW&nbsp; {formatClockTime(timeline.currentAt)}</time>
      </div>
    </figure>
  );
}

export function WorkSessions({ canRead, eligibility, read, onPause, onStop }: WorkSessionsProps) {
  const [now, setNow] = useState(0);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ sessionId: string; message: string } | null>(null);
  const componentId = useId();
  const sessions = read.status === "ready" ? read.sessions : [];
  const hasRunningSession = sessions.some(isRunning);

  useEffect(() => {
    if (!hasRunningSession) return;
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningSession]);

  if (!canRead) return null;

  if (read.status === "loading") {
    return <StateMessage className={styles.state} kind="loading" title="Loading work sessions">Reading your recent recorded work.</StateMessage>;
  }

  if (read.status === "denied") {
    return (
      <StateMessage className={styles.state} kind="warning" title="Work sessions are unavailable">
        {read.message ?? "Your current access does not allow this session list."}
      </StateMessage>
    );
  }

  if (read.status === "error") {
    return (
      <div className={styles.state}>
        <StateMessage kind="error" title="Work sessions could not load">{read.message}</StateMessage>
        {read.onRetry ? <Button className={styles.retry} variant="secondary" onClick={read.onRetry}>Try again</Button> : null}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.state}>
        <EmptyState title="No work sessions in the last 31 days." description="Recorded time appears here when you start work on an assignment." />
      </div>
    );
  }

  const referenceNow = now || read.readAt;

  async function runAction(sessionId: string, action: "pause" | "stop") {
    if (busySessionId || !(action === "pause" ? eligibility.canPause : eligibility.canStop)) return;
    setActionError(null);
    setBusySessionId(sessionId);
    try {
      await (action === "pause" ? onPause : onStop)(sessionId);
    } catch {
      setActionError({
        sessionId,
        message: `Could not ${action} this session. It may have already closed or your access changed. Refresh Work and try again.`,
      });
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <div className={styles.content}>
      <ul className={styles.list} aria-label="Recorded work sessions">
        {sessions.map((session, index) => {
          const active = isRunning(session);
          const status = getWorkSessionStatus(session);
          const elapsed = getElapsedMilliseconds(session, referenceNow, read.readAt);
          const startedAt = formatTimestamp(session.startedAt);
          const titleId = `${componentId}-session-title-${index}`;
          const canAct = active && (eligibility.canPause || eligibility.canStop);
          const busy = busySessionId === session.id;
          const error = actionError?.sessionId === session.id ? actionError.message : null;
          const sessionCardClass = active
            ? `${styles.session} ${styles.activeSession}`
            : styles.session;
          return (
            <li className={sessionCardClass} data-active={active || undefined} key={session.id}>
              {active ? (
                <p className={styles.eyebrow}>ACTIVE TASK&nbsp; / &nbsp;FOCUSED SESSION</p>
              ) : null}
              {active ? (
                <Badge className={styles.activeStatus} tone={status.tone}>●  RUNNING</Badge>
              ) : null}
              <div className={styles.summary}>
                <div className={styles.heading}>
                  <h3 className={styles.title} id={titleId}>{session.title || "Untitled assignment"}</h3>
                  {!active ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                </div>
                <div className={styles.metadata}>
                  <span>Started <time dateTime={session.startedAt}>{startedAt}</time></span>
                  {session.endedAt ? <span>Ended <time dateTime={session.endedAt}>{formatTimestamp(session.endedAt)}</time></span> : null}
                </div>
              </div>
              <p className={`${styles.elapsed} ${active ? styles.activeElapsed : ""}`}>
                <time className={styles.timer} aria-label={elapsedAccessibleLabel(elapsed)}>
                  {formatElapsed(elapsed)}
                </time>
                <span className={styles.elapsedLabel}>{active ? "ELAPSED THIS TASK" : "Elapsed"}</span>
              </p>
              {active ? <ActiveSessionTimeline session={session} elapsedMilliseconds={elapsed} /> : null}
              {active ? <div className={styles.divider} aria-hidden="true" /> : null}
              {active ? <p className={styles.saveNote}>Finish closes and records this session.</p> : null}
              {canAct ? (
                <div className={styles.actions} role="group" aria-labelledby={titleId}>
                  {eligibility.canPause ? (
                    <Button variant="secondary" loading={busy} loadingLabel="Pausing session" disabled={Boolean(busySessionId)} onClick={() => void runAction(session.id, "pause")}>
                      Pause timer
                    </Button>
                  ) : null}
                  {eligibility.canStop ? (
                    <Button variant="primary" loading={busy} loadingLabel="Finishing session" disabled={Boolean(busySessionId)} onClick={() => void runAction(session.id, "stop")}>
                      Finish &amp; save
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {error ? <StateMessage className={styles.actionError} kind="error">{error}</StateMessage> : null}
            </li>
          );
        })}
      </ul>
      {hasRunningSession && !eligibility.canPause && !eligibility.canStop ? (
        <StateMessage kind="info" className={styles.accessNote}>The active timer remains visible; session controls are unavailable for your current access.</StateMessage>
      ) : null}
    </div>
  );
}
