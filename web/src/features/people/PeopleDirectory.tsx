import { useEffect, useRef, useState } from "react";
import { Avatar, Badge, Button, EmptyState, Field, Input, SectionHeading, StateMessage } from "../../design-system";
import styles from "./People.module.css";
import type { PeopleDirectoryReadState, PersonDirectoryRecord } from "./contracts";
import {
  availablePeopleCursor,
  peopleDirectoryFocusRecoveryTarget,
  personStatusLabel,
  personStatusTone,
} from "./presentation";

export interface PeopleDirectoryProps {
  read: PeopleDirectoryReadState;
  /** Selection is projected from the current route URL by the host. */
  selectedPersonId?: string | null;
  onSearch: (query: string) => void;
  onLoadMore: (cursor: string) => void;
  onSelectPerson: (personId: string) => void;
  onRetry: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;

function DirectorySkeleton() {
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div className={styles.skeletonRow} key={row}>
          <span className={styles.skeletonLine} />
          <span className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
        </div>
      ))}
    </div>
  );
}

function PersonRow({
  person,
  selected,
  onSelect,
}: {
  person: PersonDirectoryRecord;
  selected: boolean;
  onSelect: PeopleDirectoryProps["onSelectPerson"];
}) {
  const name = person.displayName || "Unnamed person";
  const organisationalDetails = [person.department?.name, person.office?.name].filter(Boolean);
  return (
    <tr className={styles.personRow} data-selected={selected || undefined} role="row">
      <th className={styles.personRowHeader} scope="row" role="rowheader">
        <div className={styles.personIdentity}>
          <Avatar size={32} />
          <div className={styles.personMain}>
            <h3 className={styles.personName}>{name}</h3>
            <p className={styles.personMeta}>
              <span className={styles.personRole}>{person.role?.name || "No role assigned"}</span>
              <span className={styles.metaSeparator} aria-hidden="true">·</span>
              <span className={styles.personEmail}>{person.email}</span>
            </p>
          </div>
        </div>
      </th>
      <td className={styles.workDetailsCell} role="cell">
        <span className={styles.cellLabel} aria-hidden="true">Work details</span>
        <span className={styles.workDetailsValue}>
          <span className={styles.workDetailPrimary}>{person.designation || "No designation recorded"}</span>
          <span className={styles.secondaryFact}>
            {organisationalDetails.length
              ? organisationalDetails.join(" · ")
              : "No department or office recorded"}
          </span>
        </span>
      </td>
      <td className={styles.accountStatus} role="cell">
        <span className={styles.cellLabel} aria-hidden="true">Person status</span>
        <Badge tone={personStatusTone(person.status)}>{personStatusLabel(person.status)}</Badge>
      </td>
      <td className={styles.actionCell} role="cell">
        <span className={styles.cellLabel} aria-hidden="true">Actions</span>
        <Button
          className={styles.openPersonAction}
          variant="secondary"
          size="compact"
          data-person-history-action={person.id}
          aria-current={selected ? "page" : undefined}
          onClick={() => onSelect(person.id)}
          aria-label={`Open person record for ${name}`}
        >
          Open person
        </Button>
      </td>
    </tr>
  );
}

function directoryStatusText(read: PeopleDirectoryReadState, queryPending: boolean): string {
  if (queryPending) return "Updating the people search.";
  if (read.status === "loading") return read.query ? `Searching people for ${read.query}.` : "Loading people in your current access scope.";
  if (read.status === "denied") return read.message ?? "The people directory is unavailable under your current access.";
  if (read.status === "failed") return "People could not be loaded.";
  if (read.people.length === 0) {
    return read.query ? `No people match ${read.query}.` : "No people were returned for this access scope.";
  }
  const count = `${read.people.length} ${read.people.length === 1 ? "person" : "people"} loaded`;
  const search = read.query ? ` matching ${read.query}` : "";
  return read.hasMore && read.nextCursor
    ? `${count}${search}. More results are available.`
    : `${count}${search}.`;
}

export function PeopleDirectory({ read, selectedPersonId = null, onSearch, onLoadMore, onSelectPerson, onRetry }: PeopleDirectoryProps) {
  const initialQuery = read.status === "ready"
    ? read.query
    : read.status === "loading" || read.status === "failed" ? read.query ?? "" : "";
  const [query, setQuery] = useState(initialQuery);
  const searchCallback = useRef(onSearch);
  const appliedQuery = useRef(initialQuery);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const searchHadFocus = useRef(false);
  const loadMoreButton = useRef<HTMLButtonElement | null>(null);
  const endOfResults = useRef<HTMLParagraphElement | null>(null);
  const deniedNotice = useRef<HTMLDivElement | null>(null);
  const loadMoreHadFocus = useRef(false);
  searchCallback.current = onSearch;

  if (read.status === "ready") appliedQuery.current = read.query;
  else if (read.status === "loading" && read.query !== undefined) appliedQuery.current = read.query;
  else if (read.status === "failed") appliedQuery.current = read.query;

  const normalizedQuery = query.trim();
  const queryPending = normalizedQuery !== appliedQuery.current;
  const nextCursor = availablePeopleCursor(query, read);

  useEffect(() => {
    if (normalizedQuery === appliedQuery.current) return;
    const timeout = window.setTimeout(() => {
      if (normalizedQuery !== appliedQuery.current) searchCallback.current(normalizedQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [normalizedQuery]);

  const resultCountText = directoryStatusText(read, queryPending);
  const showLoading = read.status === "loading" || queryPending;

  useEffect(() => {
    if (read.status === "denied") {
      const shouldFocusNotice = searchHadFocus.current || loadMoreHadFocus.current;
      searchHadFocus.current = false;
      loadMoreHadFocus.current = false;
      if (shouldFocusNotice) deniedNotice.current?.focus();
      return;
    }

    const target = peopleDirectoryFocusRecoveryTarget(loadMoreHadFocus.current, read);
    if (target === "end-of-results") {
      loadMoreHadFocus.current = false;
      endOfResults.current?.focus();
      return;
    }
    if (loadMoreHadFocus.current && read.status === "ready" && !read.loadingMore) {
      loadMoreHadFocus.current = false;
    }
  }, [read]);

  const handleFeatureFocus = (event: React.FocusEvent<HTMLElement>) => {
    if (event.target === searchInput.current) searchHadFocus.current = true;
    else searchHadFocus.current = false;
    if (loadMoreHadFocus.current && event.target !== loadMoreButton.current) {
      loadMoreHadFocus.current = false;
    }
  };

  const handleLoadMore = (cursor: string) => {
    if (read.status !== "ready" || read.loadingMore || cursor !== nextCursor) return;
    loadMoreHadFocus.current = document.activeElement === loadMoreButton.current;
    onLoadMore(cursor);
  };

  return (
    <section
      className={styles.feature}
      aria-labelledby="people-directory-title"
      onFocusCapture={handleFeatureFocus}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (loadMoreHadFocus.current && nextTarget &&
            nextTarget !== document.body && nextTarget !== document.documentElement &&
            !event.currentTarget.contains(nextTarget)) {
          loadMoreHadFocus.current = false;
        }
        if (searchHadFocus.current && nextTarget &&
            nextTarget !== document.body && nextTarget !== document.documentElement &&
            !event.currentTarget.contains(nextTarget)) {
          searchHadFocus.current = false;
        }
      }}
    >
      <SectionHeading
        title={<span id="people-directory-title" data-people-directory-heading tabIndex={-1}>People directory</span>}
        description="People returned by your current access scope."
      />

      {read.status === "denied" ? (
        <div
          className={styles.deniedNotice}
          ref={deniedNotice}
          tabIndex={-1}
          role="region"
          aria-label="People directory access notice"
        >
          <StateMessage kind="warning" title="People directory unavailable" className={styles.stateRegion}>
            {read.message ?? "Your current access does not include the people directory."}
          </StateMessage>
        </div>
      ) : (
        <div className={styles.directory} aria-busy={showLoading || (read.status === "ready" && read.loadingMore) || undefined}>
          <div className={styles.toolbar}>
            <Field
              className={styles.searchField}
              label="Search people you can view"
              hint="Search runs across your authorized directory. Results load in bounded pages."
            >
              {(control) => (
                <Input
                  {...control}
                  ref={searchInput}
                  type="search"
                  autoComplete="off"
                  placeholder="Name, email, office, role…"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              )}
            </Field>
            <p className={styles.resultCount} aria-hidden="true">{resultCountText}</p>
            <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
              {read.status === "failed" && !queryPending
                ? ""
                : read.status === "ready" && read.loadingMore ? "Loading more people." : resultCountText}
            </p>
          </div>

          {showLoading ? (
            <div className={styles.stateRegion} aria-busy="true">
              <p className={styles.loadingLabel} aria-hidden="true">
                {queryPending ? "Updating people search…" : read.status === "loading" && read.query ? "Searching people…" : "Loading people…"}
              </p>
              <DirectorySkeleton />
            </div>
          ) : null}

          {read.status === "failed" && !queryPending ? (
            <div className={styles.stateRegion}>
              <StateMessage kind="error" title="People could not load">{read.message}</StateMessage>
              <Button variant="secondary" onClick={onRetry}>Try again</Button>
            </div>
          ) : null}

          {read.status === "ready" && !queryPending && !read.people.length ? (
            <EmptyState
              className={styles.empty}
              title={read.query ? "No people match this search" : "No people returned for this access scope"}
              description={read.query
                ? "Try a different name, email, office, department, or role."
                : "The directory shows only records returned for your current access scope."}
              action={read.query ? <Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button> : undefined}
            />
          ) : null}

          {read.status === "ready" && !queryPending && read.people.length > 0 ? (
            <div className={styles.peopleTable}>
              {/* Explicit table roles preserve header/cell relationships when compact CSS reflows rows as cards. */}
              <table className={styles.peopleGrid} role="table" aria-label="People in the current access scope">
                <thead className={styles.peopleHeader} role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">Person</th>
                    <th scope="col" role="columnheader">Work details</th>
                    <th scope="col" role="columnheader">Person status</th>
                    <th scope="col" role="columnheader" className={styles.actionHeading} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {read.people.map((person) => (
                    <PersonRow
                      key={person.id}
                      person={person}
                      selected={person.id === selectedPersonId}
                      onSelect={onSelectPerson}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {read.status === "ready" && !queryPending && read.people.length > 0 && !read.hasMore && !read.nextCursor ? (
            <p className={styles.endOfResults} ref={endOfResults} tabIndex={-1}>
              End of people results.
            </p>
          ) : null}

          {read.status === "ready" && !queryPending && read.loadingMore && !read.loadMoreError ? (
            <p className={styles.loadingLabel} aria-hidden="true">Loading more people…</p>
          ) : null}

          {read.status === "ready" && !queryPending && read.loadMoreError ? (
            <StateMessage kind="error" title="More people could not load" className={styles.loadMoreError}>
              {read.loadMoreError}
            </StateMessage>
          ) : null}

          {read.status === "ready" && !queryPending && nextCursor ? (
            <div className={styles.directoryFooter}>
              <Button
                ref={loadMoreButton}
                className={styles.loadMoreButton}
                variant="secondary"
                aria-disabled={read.loadingMore || undefined}
                onClick={() => handleLoadMore(nextCursor)}
              >
                {read.loadMoreError ? "Retry loading more" : "Load more people"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
