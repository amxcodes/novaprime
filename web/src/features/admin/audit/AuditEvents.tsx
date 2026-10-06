import { useState } from "react";
import { Button, Field, Input, Select, StateMessage, type SelectOption } from "../../../design-system";
import type { AuditEventSummary, AuditEventsProps } from "./contracts";
import styles from "./AuditEvents.module.css";

const ALL_ACTIONS = "all-actions";

export function filterAuditEvents(
  events: readonly AuditEventSummary[],
  filters: { search: string; action: string | null },
): AuditEventSummary[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return events.filter((event) => {
    if (filters.action !== null && event.action !== filters.action) return false;
    if (!query) return true;
    const actor = event.actorName || "System";
    return `${event.action} ${actionLabel(event.action)} ${actor}`
      .toLocaleLowerCase()
      .includes(query);
  });
}

function timestamp(value: string): { iso: string; label: string } | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const formatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const timeZone = formatter.resolvedOptions().timeZone;

  return {
    iso: parsed.toISOString(),
    label: `${formatter.format(parsed)} · ${timeZone}`,
  };
}

function actionLabel(action: string): string {
  const readable = action.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!readable) return "Organisation activity recorded";
  return readable[0].toUpperCase() + readable.slice(1);
}

function EventRow({ event }: { event: AuditEventSummary }) {
  const occurredAt = timestamp(event.occurredAt);

  return (
    <li className={styles.event}>
      <div className={styles.time}>
        {occurredAt ? (
          <time dateTime={occurredAt.iso}>{occurredAt.label}</time>
        ) : (
          <span>Timestamp unavailable</span>
        )}
      </div>
      <div className={styles.eventCopy}>
        <p className={styles.action}>{actionLabel(event.action)}</p>
        <p className={styles.actor}>{event.actorName || "System"}</p>
      </div>
    </li>
  );
}

export function AuditEvents({ readState }: AuditEventsProps) {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<string | null>(null);

  const actions = readState.status === "ready"
    ? [...new Set(readState.events.map((event) => event.action))]
      .sort((left, right) => actionLabel(left).localeCompare(actionLabel(right)) || left.localeCompare(right))
    : [];
  const actionValues = action !== null && !actions.includes(action)
    ? [...actions, action].sort((left, right) => actionLabel(left).localeCompare(actionLabel(right)) || left.localeCompare(right))
    : actions;
  const actionOptions: readonly SelectOption[] = [
    { value: ALL_ACTIONS, label: "All actions" },
    ...actionValues.map((value) => ({ value: JSON.stringify(value), label: actionLabel(value) })),
  ];
  const filteredEvents = readState.status === "ready"
    ? filterAuditEvents(readState.events, { search, action })
    : [];

  return (
    <section className={styles.section} aria-labelledby="admin-audit-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Admin</p>
          <h2 id="admin-audit-title" className={styles.title}>Recent audit activity</h2>
          <p className={styles.description}>The most recent organisation actions included in this bounded view.</p>
        </div>
      </header>

      {readState.status === "loading" ? (
        <StateMessage kind="loading" title="Loading recent audit activity" />
      ) : null}

      {readState.status === "denied" ? (
        <StateMessage kind="warning" title="Recent audit activity is unavailable">
          {readState.message || "The audit events could not be read with the current access."}
        </StateMessage>
      ) : null}

      {readState.status === "error" ? (
        <StateMessage kind="error" title="Recent audit activity could not be loaded">
          {readState.message}
        </StateMessage>
      ) : null}

      {readState.status === "empty" ? (
        <>
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>No audit events</h3>
            <p>No events were returned for this view.</p>
          </div>
          <p className={styles.scopeNote}>This view contains only events returned by the request (maximum {readState.requestLimit}).</p>
        </>
      ) : null}

      {readState.status === "ready" ? (
        <div className={styles.collection}>
          <p className={styles.scopeNote}>
            {readState.events.length} loaded · request limit {readState.requestLimit}. Only returned events are shown.
          </p>
          {readState.events.length ? (
            <>
              <div className={styles.filters}>
                <Field className={styles.searchField} label="Search loaded actions and actors">
                  {(control) => (
                    <Input
                      {...control}
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.currentTarget.value)}
                    />
                  )}
                </Field>
                <div className={styles.actionFilter}>
                  <Select
                    label="Action"
                    value={action === null ? ALL_ACTIONS : JSON.stringify(action)}
                    options={actionOptions}
                    onChange={(value) => {
                      if (value === ALL_ACTIONS) {
                        setAction(null);
                        return;
                      }
                      try {
                        const selected: unknown = JSON.parse(value);
                        setAction(typeof selected === "string" ? selected : null);
                      } catch {
                        setAction(null);
                      }
                    }}
                  />
                </div>
                {search || action !== null ? (
                  <Button
                    className={styles.clearButton}
                    variant="quiet"
                    onClick={() => { setSearch(""); setAction(null); }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
              <p className={styles.scopeNote} role="status" aria-live="polite">
                {filteredEvents.length} of {readState.events.length} loaded events shown. Filters apply only to this request’s returned rows.
              </p>
              {filteredEvents.length ? (
                <ol className={styles.events} aria-label="Most recent audit events">
                  {filteredEvents.map((event) => <EventRow key={event.id} event={event} />)}
                </ol>
              ) : (
                <div className={styles.empty} role="status">
                  <h3 className={styles.emptyTitle}>No loaded events match these filters</h3>
                  <p>Clear the filters to see the loaded recent activity.</p>
                </div>
              )}
            </>
          ) : (
            <div className={styles.empty}>
              <h3 className={styles.emptyTitle}>No audit events</h3>
              <p>No events were returned for this view.</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
