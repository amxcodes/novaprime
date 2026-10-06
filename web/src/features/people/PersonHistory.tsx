import { useEffect, useRef } from "react";
import { Badge, Button, EmptyState, Loading, SectionHeading, StateMessage, Surface } from "../../design-system";
import type {
  PersonDirectoryRecord,
  PersonHistoryEntry,
  PersonHistoryPage,
  PersonHistoryReadState,
} from "./contracts";
import { formatEffectiveDate, historyDetails, historyKindLabel, historyScopeSummary, personHistoryFocusRecoveryTarget, personStatusLabel, personStatusTone } from "./presentation";
import styles from "./People.module.css";
import { PersonLifecycleActions, type PersonLifecycleActionsProps } from "./PersonLifecycleActions";

export interface PersonHistoryProps {
  person: PersonDirectoryRecord | null;
  read: PersonHistoryReadState;
  onBack: () => void;
  onRetry: () => void;
  onLoadMore: (cursor: string) => void;
  /** Supplied by the host only when this person record is currently readable. */
  lifecycleActions?: Omit<PersonLifecycleActionsProps, "personName">;
}

function DirectorySummary({ person, name }: { person: PersonDirectoryRecord | null; name: string }) {
  return (
    <Surface as="section" level="subtle" className={styles.personSummary} aria-labelledby="person-summary-title">
      <div className={styles.summaryHeader}>
        <div className={styles.summaryIdentity}>
          <p className={styles.summaryEyebrow}>Directory summary</p>
          <h2 className={styles.summaryName} id="person-summary-title">{name}</h2>
          {person ? <p className={styles.email}>{person.email}</p> : null}
        </div>
        {person ? <Badge tone={personStatusTone(person.status)}>{personStatusLabel(person.status)}</Badge> : null}
      </div>
      {person ? (
        <dl className={styles.summaryFacts}>
          {person.designation ? <Fact label="Designation" value={person.designation} /> : null}
          {person.office?.name ? <Fact label="Office" value={person.office.name} /> : null}
          {person.department?.name ? <Fact label="Department" value={person.department.name} /> : null}
          {person.role?.name ? <Fact label="Role" value={person.role.name} /> : null}
          {person.managerName ? <Fact label="Manager" value={person.managerName} /> : null}
          {person.employmentStartsOn ? <Fact label="Employment start" value={formatEffectiveDate(person.employmentStartsOn)} /> : null}
        </dl>
      ) : <p className={styles.summaryNote}>Current directory fields are not part of this history read.</p>}
    </Surface>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className={styles.fact}><dt>{label}</dt><dd>{value}</dd></div>;
}

function HistoryEntry({ entry }: { entry: PersonHistoryEntry }) {
  const kind = historyKindLabel(entry.kind);
  const details = historyDetails(entry);
  return (
    <li className={styles.historyEntry}>
      <span className={styles.timelineMarker} aria-hidden="true" />
      <article className={styles.entryContent}>
        <div className={styles.entryHeading}>
          <div className={styles.entryTitleGroup}>
            <Badge>{kind}</Badge>
            <h3 className={styles.entryTitle}>{kind} period</h3>
          </div>
          <time className={styles.effectiveDate} dateTime={entry.effectiveOn}>{formatEffectiveDate(entry.effectiveOn)}</time>
        </div>
        {details.length ? (
          <ul className={styles.entryDetails} aria-label={`${kind} details`}>
            {details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
        ) : <p className={styles.entryDetailsEmpty}>No additional details were returned.</p>}
        <p className={styles.periodEnd}>
          {entry.effectiveUntil
            ? <>Until <time dateTime={entry.effectiveUntil}>{formatEffectiveDate(entry.effectiveUntil)}</time></>
            : "No end date recorded"}
        </p>
      </article>
    </li>
  );
}

function HistorySkeleton() {
  return (
    <ol className={styles.historySkeleton} aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <li className={styles.historySkeletonRow} key={row}>
          <span className={styles.skeletonLine} />
          <span className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
        </li>
      ))}
    </ol>
  );
}

function lastPage(pages: ReadonlyArray<PersonHistoryPage>): PersonHistoryPage | undefined {
  return pages[pages.length - 1];
}

export function PersonHistory({ person, read, onBack, onRetry, onLoadMore, lifecycleActions }: PersonHistoryProps) {
  const loadOlderButton = useRef<HTMLButtonElement | null>(null);
  const retryButton = useRef<HTMLButtonElement | null>(null);
  const historyScopeText = useRef<HTMLParagraphElement | null>(null);
  const deniedNotice = useRef<HTMLDivElement | null>(null);
  const loadOlderHadFocus = useRef(false);
  const pages = read.status === "ready" ? read.pages : [];
  const firstPage = pages[0];
  const tail = lastPage(pages);
  const entries = pages.flatMap((page) => page.history);
  const nextCursor = tail?.hasMore ? tail.nextCursor : null;
  const name = person?.displayName || firstPage?.person.displayName || "Person history";

  useEffect(() => {
    const target = personHistoryFocusRecoveryTarget(loadOlderHadFocus.current, read);
    if (target === "denied-notice") {
      loadOlderHadFocus.current = false;
      deniedNotice.current?.focus();
    } else if (target === "retry-action") {
      loadOlderHadFocus.current = false;
      retryButton.current?.focus();
    } else if (target === "older-history-action") {
      loadOlderHadFocus.current = false;
      loadOlderButton.current?.focus();
    } else if (target === "history-scope") {
      loadOlderHadFocus.current = false;
      historyScopeText.current?.focus();
    }
  }, [read]);

  return (
    <section
      className={styles.feature}
      aria-labelledby="person-history-title"
      onFocusCapture={(event) => {
        if (event.target !== loadOlderButton.current) loadOlderHadFocus.current = false;
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (loadOlderHadFocus.current && nextTarget &&
            nextTarget !== document.body && nextTarget !== document.documentElement &&
            !event.currentTarget.contains(nextTarget)) {
          loadOlderHadFocus.current = false;
        }
      }}
    >
      <div className={styles.historyToolbar} data-people-history-back>
        <Button variant="secondary" onClick={onBack}>Back to people</Button>
      </div>

      {read.status !== "denied" && (person || firstPage) ? <DirectorySummary person={person} name={name} /> : null}
      {person && read.status !== "denied" && lifecycleActions ? (
        <PersonLifecycleActions
          personName={person.displayName?.trim() || person.email || "this person"}
          {...lifecycleActions}
        />
      ) : null}

      <div className={styles.historySection}>
        <SectionHeading
          title={<span id="person-history-title" data-people-history-heading tabIndex={-1}>Effective-dated history</span>}
          description="Available status, employment, office, department, and role periods. This bounded read is not a complete personnel dossier."
        />

        {read.status === "loading" ? (
          <div className={styles.stateRegion} aria-busy="true">
            <Loading label="Loading effective-dated history" />
            <HistorySkeleton />
          </div>
        ) : null}

        {read.status === "denied" ? (
          <div
            className={styles.deniedNotice}
            ref={deniedNotice}
            tabIndex={-1}
            role="region"
            aria-label="History access notice"
          >
            <StateMessage kind="warning" title="History unavailable" className={styles.stateRegion}>
              {read.message ?? "This history is not available under your current access."}
            </StateMessage>
          </div>
        ) : null}

        {read.status === "failed" ? (
          <div className={styles.stateRegion}>
            <StateMessage kind="error" title="History could not load">{read.message}</StateMessage>
            <Button ref={retryButton} data-people-history-retry variant="secondary" onClick={onRetry}>Try again</Button>
          </div>
        ) : null}

        {read.status === "ready" ? !firstPage ? (
          <div className={styles.stateRegion}>
            <StateMessage kind="error" title="History page unavailable">The history response did not include a page.</StateMessage>
            <Button ref={retryButton} data-people-history-retry variant="secondary" onClick={onRetry}>Try again</Button>
          </div>
        ) : (
          <div className={styles.historyContent}>
            {entries.length ? (
              <ol className={styles.historyList} aria-label="Effective-dated history, newest entries first">
                {entries.map((entry) => <HistoryEntry entry={entry} key={entry.id} />)}
              </ol>
            ) : (
              <EmptyState
                className={styles.empty}
                title="No rows returned in these history categories"
                description="This read covers only the effective-dated status, employment, office, department, and role periods supported by the history endpoint."
              />
            )}

            <div className={styles.historyFooter}>
              <p className={styles.historyScope} ref={historyScopeText} tabIndex={-1}>
                {historyScopeSummary(entries.length, pages.length, tail?.limit ?? 0, tail?.hasMore ?? false)}
              </p>
              {nextCursor ? (
                <div className={styles.loadMoreGroup}>
                  {read.loadMoreError ? (
                    <StateMessage kind="error" title="Older history could not load">{read.loadMoreError}</StateMessage>
                  ) : null}
                  <Button
                    ref={loadOlderButton}
                    variant="secondary"
                    loading={read.loadingMore}
                    loadingLabel="Loading older history"
                    disabled={read.loadingMore}
                    onClick={() => {
                      loadOlderHadFocus.current = document.activeElement === loadOlderButton.current;
                      onLoadMore(nextCursor);
                    }}
                  >
                    {read.loadMoreError ? "Retry older history" : "Load older history"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
