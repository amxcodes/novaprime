import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import type { AuditEventSummary, AuditEventsProps, AuditReadState } from "./contracts";
import styles from "./AuditEvents.module.css";

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

type SearchState = {
  query: string;
  status: "idle" | "loading" | "ready" | "error";
  result?: AuditReadState;
  message?: string;
};

export function AuditEvents({ readState, onSearch }: AuditEventsProps) {
  const generation = useRef(0);
  const [search, setSearch] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ query: "", status: "idle" });
  const query = search.trim();
  const searching = query.length > 0;

  useEffect(() => {
    const currentGeneration = ++generation.current;
    if (!query) {
      setSearchState({ query: "", status: "idle" });
      return;
    }

    setSearchState({ query, status: "loading" });
    const timer = window.setTimeout(() => {
      void onSearch({ search: query, action: null }).then((result) => {
        if (currentGeneration !== generation.current) return;
        setSearchState({ query, status: "ready", result });
      }).catch((error: unknown) => {
        if (currentGeneration !== generation.current) return;
        const message = error instanceof Error ? error.message.trim() : "";
        setSearchState({
          query,
          status: "error",
          message: message || "Audit search could not be completed. Try again.",
        });
      });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      generation.current += 1;
    };
  }, [onSearch, query]);

  const activeSearch = searching && searchState.query === query ? searchState : undefined;
  const activeRead = searching
    ? activeSearch?.status === "ready" ? activeSearch.result : undefined
    : readState;
  const rows = activeRead?.status === "ready" ? activeRead.events : [];
  const searchable = readState.status === "ready" || readState.status === "empty";

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

      {searchable ? (
        <div className={styles.collection}>
          <p className={styles.scopeNote}>
            Search runs on the server across organisation events; each response is limited to the 50 newest matches.
          </p>
          <div className={styles.filters}>
            <Field className={styles.searchField} label="Search audit actions and actors">
              {(control) => (
                <Input
                  {...control}
                  type="search"
                  maxLength={100}
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              )}
            </Field>
            {searching ? (
              <Button className={styles.clearButton} variant="quiet" onClick={() => setSearch("")}>
                Clear search
              </Button>
            ) : null}
          </div>

          {searching && (!activeSearch || activeSearch.status === "loading") ? (
            <p className={styles.scopeNote} role="status" aria-live="polite">Searching audit activity…</p>
          ) : null}
          {activeSearch?.status === "error" ? (
            <StateMessage kind="error" title="Audit search could not be completed">{activeSearch.message}</StateMessage>
          ) : null}
          {activeRead?.status === "ready" ? (
            <>
              <p className={styles.scopeNote} role="status" aria-live="polite">
                {rows.length} matching event{rows.length === 1 ? "" : "s"} returned (maximum 50).
              </p>
              <ol className={styles.events} aria-label="Most recent audit events">
                {rows.map((event) => <EventRow key={event.id} event={event} />)}
              </ol>
            </>
          ) : null}
          {activeRead?.status === "empty" ? (
            <div className={styles.empty} role="status">
              <h3 className={styles.emptyTitle}>{searching ? "No events match this search" : "No audit events"}</h3>
              <p>{searching ? "Try a different action or actor name." : "No events were returned for this view."}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
