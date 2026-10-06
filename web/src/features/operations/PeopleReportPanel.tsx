import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge, Button, EmptyState, Field, Input, StateMessage } from "../../design-system";
import { DisplayCell, ReadFailure, ReportPanel } from "./OperationsReportPanel";
import styles from "./OperationsOverview.module.css";
import type { OperationsOverviewProps, OperationsPeopleReadState } from "./contracts";

export function PeopleReportPanel({
  read,
  onViewHistory,
  historyHref,
  canExport,
  onExport,
  onSearch,
  onNext,
  onPrevious,
  onRetry,
  onRetryPeople,
  onRetryPage,
}: {
  read: OperationsPeopleReadState;
  onViewHistory: OperationsOverviewProps["onViewPersonHistory"];
  historyHref: OperationsOverviewProps["personHistoryHref"];
  canExport: boolean;
  onExport?: () => void;
  onSearch?: (query: string) => void;
  onNext?: (cursor: string) => void;
  onPrevious?: () => void;
  onRetry: () => void;
  onRetryPeople?: () => void;
  onRetryPage?: () => void;
}) {
  const appliedQuery = read.status === "ready" ? read.data.query : read.status === "denied" ? "" : read.query;
  const [draft, setDraft] = useState(appliedQuery);
  const loadingNotice = useRef<HTMLDivElement | null>(null);
  const pageProgress = useRef<HTMLSpanElement | null>(null);
  const pendingRetryFocus = useRef<"people" | "page" | null>(null);
  useEffect(() => setDraft(appliedQuery), [appliedQuery]);
  useLayoutEffect(() => {
    if (pendingRetryFocus.current === "people" && read.status === "loading") {
      pendingRetryFocus.current = null;
      loadingNotice.current?.querySelector<HTMLElement>('[data-kind="info"]')?.focus();
    } else if (pendingRetryFocus.current === "page" && read.status === "ready" && read.loadingPage) {
      pendingRetryFocus.current = null;
      pageProgress.current?.focus();
    } else if (read.status === "denied" || (read.status === "ready" && !read.loadingPage)) {
      pendingRetryFocus.current = null;
    }
  }, [read.status, read.status === "ready" && read.loadingPage]);
  const people = read.status === "ready" ? read.data.people : [];
  const pageLabel = read.status === "ready"
    ? `${people.length} ${people.length === 1 ? "person" : "people"} on this page. ${read.data.hasPrevious ? "A previous page is available. " : ""}${read.data.hasMore ? "A next page is available." : ""}`
    : "";

  return (
    <ReportPanel
      id="operations-people-title"
      title="Team and people"
      description="Search people in your current access scope. Pages and exports contain only the rows currently shown."
      className={styles.peoplePanel}
      actions={read.status === "ready" && canExport && people.length ? (
        <Button variant="secondary" size="compact" onClick={onExport}>Download people CSV</Button>
      ) : undefined}
    >
      {read.status !== "denied" ? (
        <form className={styles.peopleSearch} onSubmit={(event) => {
          event.preventDefault();
          onSearch?.(draft.trim());
        }}>
          <Field label="Search people" hint="Search name, email, title, office, department, or role.">
            {(control) => <Input {...control} type="search" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />}
          </Field>
          <Button type="submit" variant="secondary" disabled={!onSearch}>
            Search
          </Button>
        </form>
      ) : null}
      {read.status === "loading" ? (
        <div ref={loadingNotice}>
          <StateMessage tabIndex={-1} kind="info" title="Loading people">
            Searching within your current people access scope.
          </StateMessage>
        </div>
      ) : read.status === "denied" ? (
        <ReadFailure read={read} title="People report unavailable" onRetry={onRetry} />
      ) : read.status === "error" ? (
        <div className={styles.failure}>
          <StateMessage kind="error" title="People report unavailable">{read.message}</StateMessage>
          <Button variant="secondary" onClick={() => {
            pendingRetryFocus.current = "people";
            (onRetryPeople || onRetry)();
          }}>Try again</Button>
        </div>
      ) : (
        <>
          <p className={styles.rangeNote} role="status">{pageLabel}</p>
          {read.pageError ? (
            <div className={styles.pageError}>
              <StateMessage kind="error" title="Could not change people page">{read.pageError}</StateMessage>
              <Button variant="secondary" size="compact" onClick={() => {
                pendingRetryFocus.current = "page";
                onRetryPage?.();
              }} disabled={!onRetryPage}>Try again</Button>
            </div>
          ) : null}
          {!people.length ? (
            <EmptyState
              title={read.data.query ? "No people match this search" : "No people are visible in this scope"}
              description={read.data.query ? "Try another name, email, title, office, department, or role." : "The report follows the current people read permission."}
            />
          ) : (
            <div className={styles.tableViewport}>
              <table className={styles.table} aria-label="People visible on the current Operations report page">
                <thead>
                  <tr>{["Person", "Status", "Title / role", "Organisation", "Manager", "Start date", "History"].map((label) => (
                    <th key={label} scope="col">{label}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {people.map((person) => {
                    const name = person.displayName || person.email || "Unnamed person";
                    return (
                      <tr key={person.id}>
                        <td data-label="Person">
                          <div className={styles.identity}>
                            <strong>{name}</strong>
                            {person.email ? <span>{person.email}</span> : null}
                          </div>
                        </td>
                        <DisplayCell label="Status">
                          {person.status ? <Badge tone="neutral">{person.status}</Badge> : null}
                        </DisplayCell>
                        <DisplayCell label="Title / role">
                          {[person.designation, person.role?.name].filter(Boolean).join(" · ")}
                        </DisplayCell>
                        <DisplayCell label="Organisation">
                          {[person.office?.name, person.department?.name].filter(Boolean).join(" · ")}
                        </DisplayCell>
                        <DisplayCell label="Manager">{person.managerName}</DisplayCell>
                        <DisplayCell label="Start date">{person.employmentStartsOn}</DisplayCell>
                        <td data-label="History">
                          <a
                            className={styles.linkAction}
                            href={historyHref(person.id)}
                            onClick={(event) => {
                              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
                                event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
                              event.preventDefault();
                              onViewHistory(person.id);
                            }}
                          >View history<span className={styles.visuallyHidden}> for {name}</span></a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <nav className={styles.peoplePagination} aria-label="People report pages">
            <Button variant="secondary" size="compact" onClick={onPrevious} disabled={!onPrevious || !read.data.hasPrevious || read.loadingPage}>
              Previous page
            </Button>
            <span
              ref={pageProgress}
              className={styles.pageProgress}
              tabIndex={read.loadingPage ? -1 : undefined}
              aria-live={read.loadingPage ? "polite" : undefined}
            >
              {read.loadingPage ? "Loading page…" : "Showing this page only; no total is available."}
            </span>
            <Button
              variant="secondary"
              size="compact"
              onClick={() => read.data.nextCursor && onNext?.(read.data.nextCursor)}
              disabled={!onNext || !read.data.hasMore || !read.data.nextCursor || read.loadingPage}
              loading={read.loadingPage && !read.pageError}
              loadingLabel="Loading next page"
            >Next page</Button>
          </nav>
        </>
      )}
    </ReportPanel>
  );
}
