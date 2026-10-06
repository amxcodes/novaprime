import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Field, Input, StateMessage } from "../../design-system";
import {
  beginAvailabilityAgendaRead,
  completeAvailabilityAgendaRead,
  createAvailabilityAgendaState,
  availabilityEventKey,
  availabilityEventLabel,
  availabilityEventTypeLabel,
  failAvailabilityAgendaRead,
  isValidBusinessDateRange,
  loadAvailabilityAgendaPage,
} from "./model";
import styles from "./AvailabilityAgenda.module.css";
import type { AvailabilityAgendaProps, AvailabilityAgendaResponse } from "./contracts";

const fallbackReadError = "The availability agenda could not be loaded. Refresh the page and try again.";

export function AvailabilityAgenda(props: AvailabilityAgendaProps) {
  const rangeErrorId = useId();
  const [startDate, setStartDate] = useState(props.startDate);
  const [endDate, setEndDate] = useState(props.endDate);
  const [agenda, setAgenda] = useState(() => createAvailabilityAgendaState(Boolean(props.startDate && props.endDate)));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const sourceText = props.sourceLabels.length ? props.sourceLabels.join(", ") : "your permitted sources";
  const isBusy = agenda.status === "loading" || agenda.loadingMore;

  async function loadRange(rangeStart: string, rangeEnd: string, cursor: string | null, append: boolean) {
    const requestId = ++requestGeneration.current;
    setRangeError(null);
    if (!isValidBusinessDateRange(rangeStart, rangeEnd)) {
      setAgenda(createAvailabilityAgendaState());
      setRangeError("Choose a valid range of at most 31 calendar dates.");
      return;
    }
    if (!props.isCurrentPageRequest()) return;

    props.updateRange(rangeStart, rangeEnd);
    setAgenda((current) => beginAvailabilityAgendaRead(current, append));

    let response: AvailabilityAgendaResponse;
    let appendResponse = append;
    try {
      const page = await loadAvailabilityAgendaPage({
        startDate: rangeStart,
        endDate: rangeEnd,
        cursor,
        append,
        loadEvents: props.loadEvents,
        onRestart: () => setAgenda((current) => beginAvailabilityAgendaRead({
          ...current,
          events: [],
          nextCursor: null,
        }, false)),
        onAccessChanged: props.onAccessChanged,
        isCurrent: () => requestId === requestGeneration.current && props.isCurrentPageRequest(),
      });
      if (page.cancelled) return;
      response = page.response || { readError: "REQUEST_FAILED" };
      appendResponse = page.append;
    } catch {
      response = { readError: "REQUEST_FAILED" };
    }
    if (requestId !== requestGeneration.current || !props.isCurrentPageRequest()) return;

    if (response?.readError) {
      const message = props.readErrorMessage(response) || fallbackReadError;
      if (response.accessChanged) props.onAccessChanged?.();
      setAgenda((current) => failAvailabilityAgendaRead(current, response, appendResponse, message));
      return;
    }

    setAgenda((current) => completeAvailabilityAgendaRead(
      current, response, appendResponse, sourceText, rangeStart, rangeEnd,
    ));
  }

  useEffect(() => {
    if (props.startDate && props.endDate) {
      void loadRange(props.startDate, props.endDate, props.cursor || null, false);
    }
    return () => { requestGeneration.current += 1; };
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadRange(startDate, endDate, null, false);
  }

  function handleMore() {
    if (!agenda.nextCursor || agenda.loadingMore || agenda.status !== "ready") return;
    void loadRange(startDate, endDate, agenda.nextCursor, true);
  }

  return (
    <section className={styles.agenda} aria-label="Availability agenda">
      <form className={styles.rangeForm} onSubmit={handleSubmit}>
        <Field className={styles.startField} label="Business date from" required>
          {(control) => <Input
            {...control}
            aria-describedby={rangeError
              ? [control["aria-describedby"], rangeErrorId].filter(Boolean).join(" ")
              : control["aria-describedby"]}
            aria-invalid={rangeError ? true : control["aria-invalid"]}
            type="date"
            value={startDate}
            onChange={(event) => { setStartDate(event.currentTarget.value); setRangeError(null); }}
            disabled={isBusy}
          />}
        </Field>
        <Field className={styles.endField} label="Business date to" required>
          {(control) => <Input
            {...control}
            aria-describedby={rangeError
              ? [control["aria-describedby"], rangeErrorId].filter(Boolean).join(" ")
              : control["aria-describedby"]}
            aria-invalid={rangeError ? true : control["aria-invalid"]}
            type="date"
            value={endDate}
            onChange={(event) => { setEndDate(event.currentTarget.value); setRangeError(null); }}
            disabled={isBusy}
          />}
        </Field>
        <p className={styles.rangeHint}>
          Up to 31 calendar dates. Event times use each office’s timezone.
        </p>
        <div className={styles.rangeActions}>
          <Button type="submit" variant="primary" disabled={isBusy}>
            {agenda.status === "error" ? "Try again" : "Load agenda"}
          </Button>
        </div>
        {rangeError ? <StateMessage id={rangeErrorId} className={styles.rangeError} kind="error" title="Date range needs attention">{rangeError}</StateMessage> : null}
      </form>

      <section className={styles.results} aria-label="Availability events" aria-busy={isBusy || undefined}>
        {agenda.status === "idle" ? (
          <EmptyState
            title="Choose a business-date range"
            description="The agenda will show only event sources available under your current permissions."
          />
        ) : null}
        {agenda.status === "loading" ? (
          <StateMessage kind="loading" title="Loading availability events">Reading the selected business dates.</StateMessage>
        ) : null}
        {agenda.status === "denied" ? (
          <StateMessage kind="warning" title="Availability events unavailable">{agenda.statusMessage}</StateMessage>
        ) : null}
        {agenda.status === "error" ? (
          <StateMessage kind="error" title="Availability events could not be loaded">
            {agenda.pageFailure || fallbackReadError}
          </StateMessage>
        ) : null}
        {agenda.status === "ready" ? (
          <>
            <p className={styles.status} role="status" aria-live="polite">{agenda.statusMessage}</p>
            {agenda.pageFailure ? (
              <div className={styles.pageFailure}>
                <StateMessage kind="warning" title="More events could not be loaded">{agenda.pageFailure}</StateMessage>
                <Button variant="secondary" onClick={handleMore} disabled={agenda.loadingMore}>
                  Retry loading more events
                </Button>
              </div>
            ) : null}
            {agenda.events.length ? (
              <ol className={styles.eventList}>
                {agenda.events.map((event) => (
                  <li className={styles.eventRow} key={availabilityEventKey(event)}>
                    <time className={styles.eventDate} dateTime={event.date}>{event.date}</time>
                    <div className={styles.eventDetail}>
                      <Badge tone="neutral">{availabilityEventTypeLabel(event.type)}</Badge>
                      <p>{availabilityEventLabel(event, props.businessTimeLabel)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="No permitted events in this range"
                description={`No events from ${sourceText} were returned between ${startDate} and ${endDate}.`}
              />
            )}
            {agenda.nextCursor && !agenda.pageFailure ? (
              <div className={styles.pagination}>
                <Button variant="secondary" onClick={handleMore} disabled={agenda.loadingMore}>
                  {agenda.loadingMore ? "Loading more events…" : "Load more events"}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </section>
  );
}
