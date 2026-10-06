import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Badge, Button, EmptyState, StateMessage } from "../../../design-system";
import type {
  HistoricalExceptionOutcome,
  HistoricalExceptionSummary,
  HistoricalExceptionsProps,
} from "./contracts";
import styles from "./HistoricalExceptions.module.css";

const MAX_NOTE_LENGTH = 2000;
const LEAVE_ATTENDANCE_CONFLICT = "availability.leave_attendance_conflict";

/** Validate a submitted note and direct the user to the associated error field. */
export function validateHistoricalExceptionAuditNote(
  note: string,
  noteRef: { current: Pick<HTMLTextAreaElement, "focus"> | null },
  setError: (message: string) => void,
  scheduleFocus: (callback: FrameRequestCallback) => number,
): string | null {
  const trimmed = note.trim();
  if (!trimmed || trimmed.length > MAX_NOTE_LENGTH) {
    setError(`Enter an audit note from 1 to ${MAX_NOTE_LENGTH.toLocaleString()} characters.`);
    scheduleFocus(() => noteRef.current?.focus());
    return null;
  }
  return trimmed;
}

export function HistoricalExceptions(props: HistoricalExceptionsProps) {
  const id = useId();

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Availability</p>
          <h2 className={styles.title} id={`${id}-title`}>Historical exceptions</h2>
          <p className={styles.description}>
            Availability changes preserve attendance history. Review and close each exception with an audit note.
          </p>
        </div>
      </header>

      {!props.capabilities.view ? (
        <StateMessage kind="warning" title="Historical exceptions are unavailable">
          You do not have access to view this organisation list.
        </StateMessage>
      ) : <ReadContent read={props.read}>
        {(exceptions) => exceptions.length ? (
          <ul className={styles.list} aria-label="Historical exceptions">
            {exceptions.map((exception) => (
              <ExceptionCard
                key={exception.id}
                exception={exception}
                canResolve={props.capabilities.resolve}
                onResolve={props.onResolve}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No historical exceptions"
            description="There are no preserved availability exceptions in the authorized organisation list."
          />
        )}
      </ReadContent>}
    </section>
  );
}

function ReadContent({
  read,
  children,
}: {
  read: HistoricalExceptionsProps["read"];
  children: (exceptions: readonly HistoricalExceptionSummary[]) => ReactNode;
}) {
  switch (read.status) {
    case "loading":
      return <StateMessage kind="loading" title="Loading historical exceptions">Reading the exceptions available to this organisation view.</StateMessage>;
    case "denied":
      return <StateMessage kind="warning" title="Historical exceptions are unavailable">
        {read.message || "The server did not allow this exception list to be read."}
      </StateMessage>;
    case "error":
      return <StateMessage kind="error" title="Historical exceptions could not load">{read.message}</StateMessage>;
    case "empty":
      return children([]);
    case "ready":
      return children(read.exceptions);
  }
}

function ExceptionCard({
  exception,
  canResolve,
  onResolve,
}: {
  exception: HistoricalExceptionSummary;
  canResolve: boolean;
  onResolve: HistoricalExceptionsProps["onResolve"];
}) {
  const id = useId();
  const [outcome, setOutcome] = useState<HistoricalExceptionOutcome>("resolved");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [noteError, setNoteError] = useState("");
  const actionLock = useRef(false);
  const mountedRef = useRef(false);
  const isLeaveConflict = exception.code === LEAVE_ATTENDANCE_CONFLICT;
  const needsLeaveDecision = isLeaveConflict && exception.status === "open";
  const statusTone = exception.status === "open" ? "warning" : "neutral";
  const noteId = `${id}-note`;
  const noteErrorId = `${id}-note-error`;
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLock.current || pending) return;
    const trimmed = validateHistoricalExceptionAuditNote(note, noteRef, setNoteError, requestAnimationFrame);
    if (!trimmed) return;

    setNoteError("");
    setFeedback(null);
    actionLock.current = true;
    setPending(true);
    try {
      await onResolve(exception.id, outcome, trimmed);
      if (!mountedRef.current) return;
      setFeedback({ kind: "success", message: "The exception resolution was submitted." });
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error instanceof Error ? error.message.trim() : "";
      setFeedback({
        kind: "error",
        message: message || "The exception could not be closed. Refresh the list and try again.",
      });
    } finally {
      if (mountedRef.current) {
        actionLock.current = false;
        setPending(false);
      }
    }
  }

  return (
    <li className={styles.listItem}>
      <article className={styles.card} aria-labelledby={`${id}-title`}>
        <header className={styles.cardHeader}>
          <div className={styles.cardHeading}>
            <h3 className={styles.cardTitle} id={`${id}-title`}>{exception.code}</h3>
            <Badge tone={statusTone} showDot>{statusLabel(exception.status)}</Badge>
          </div>
          <p className={styles.date}>{exception.businessDate || "Undated"}</p>
        </header>

        <dl className={styles.metadata}>
          <div><dt>Source</dt><dd>{exception.sourceType}</dd></div>
          <div><dt>Reference</dt><dd>{exception.sourceId}</dd></div>
        </dl>

        {needsLeaveDecision ? (
          <StateMessage kind="warning" title="Resolve from the linked leave request">
            This attendance conflict must be resolved by approving or rejecting its linked leave request. It cannot be dismissed as a generic exception.
          </StateMessage>
        ) : exception.status === "open" && canResolve ? (
          <form className={styles.resolveForm} onSubmit={(event) => void submit(event)}>
            <fieldset className={styles.outcomeSet} disabled={pending}>
              <legend>Outcome</legend>
              <div className={styles.outcomeOptions}>
                {(["resolved", "dismissed"] as const).map((value) => (
                  <label className={styles.outcomeOption} key={value}>
                    <input
                      type="radio"
                      name={`${id}-outcome`}
                      value={value}
                      checked={outcome === value}
                      onChange={() => setOutcome(value)}
                    />
                    <span>{value === "resolved" ? "Resolved" : "Dismissed"}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={styles.noteField}>
              <label htmlFor={noteId}>Audit note <span aria-hidden="true">*</span></label>
              <textarea
                ref={noteRef}
                id={noteId}
                name="note"
                required
                maxLength={MAX_NOTE_LENGTH}
                rows={3}
                value={note}
                disabled={pending}
                aria-invalid={noteError ? true : undefined}
                aria-describedby={noteError ? `${noteErrorId} ${id}-note-count` : `${id}-note-count`}
                onChange={(event) => {
                  setNote(event.currentTarget.value);
                  setNoteError("");
                }}
              />
              <div className={styles.noteMeta}>
                {noteError ? <p className={styles.fieldError} id={noteErrorId}>{noteError}</p> : <span />}
                <span className={styles.characterCount} id={`${id}-note-count`}>
                  {note.length.toLocaleString()} / {MAX_NOTE_LENGTH.toLocaleString()}
                </span>
              </div>
            </div>

            {feedback ? (
              <StateMessage kind={feedback.kind === "success" ? "success" : "error"} title={feedback.kind === "success" ? "Resolution submitted" : "Exception not closed"}>
                {feedback.message}
              </StateMessage>
            ) : null}

            <div className={styles.actions}>
              <Button type="submit" variant="secondary" loading={pending} loadingLabel="Closing exception" disabled={pending}>
                Close exception
              </Button>
            </div>
          </form>
        ) : exception.status === "open" ? (
          <StateMessage kind="info" title="View only">You can view this exception, but resolving it requires separate access.</StateMessage>
        ) : exception.resolutionNote ? (
          <p className={styles.resolutionNote}><span>Resolution note</span>{exception.resolutionNote}</p>
        ) : null}

      </article>
    </li>
  );
}

function statusLabel(status: HistoricalExceptionSummary["status"]): string {
  return status === "open" ? "Open" : status === "resolved" ? "Resolved" : "Dismissed";
}
