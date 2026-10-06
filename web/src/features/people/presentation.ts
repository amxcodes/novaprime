import type { PeopleDirectoryReadState, PersonHistoryEntry, PersonHistoryReadState } from "./contracts";

export function availablePeopleCursor(
  draftQuery: string,
  read: PeopleDirectoryReadState,
): string | null {
  if (read.status !== "ready" || draftQuery.trim() !== read.query || !read.hasMore) return null;
  return read.nextCursor;
}

export type PeopleDirectoryFocusTarget = "denied-notice" | "end-of-results" | null;

export function peopleDirectoryFocusRecoveryTarget(
  removedControlHadFocus: boolean,
  read: PeopleDirectoryReadState,
): PeopleDirectoryFocusTarget {
  if (!removedControlHadFocus) return null;
  if (read.status === "denied") return "denied-notice";
  if (read.status !== "ready" || read.loadingMore) return null;
  return read.hasMore && read.nextCursor ? null : "end-of-results";
}

export function personHistoryFocusRecoveryTarget(
  loadOlderHadFocus: boolean,
  read: PersonHistoryReadState,
): "denied-notice" | "retry-action" | "older-history-action" | "history-scope" | null {
  if (!loadOlderHadFocus) return null;
  if (read.status === "denied") return "denied-notice";
  if (read.status === "failed") return "retry-action";
  if (read.status !== "ready" || read.loadingMore) return null;

  const tail = read.pages.at(-1);
  if (!tail) return "retry-action";
  return tail.hasMore && tail.nextCursor ? "older-history-action" : "history-scope";
}

export function peopleWorkspaceFocusRecoveryTarget(
  previousPersonId: string | null,
  currentPersonId: string | null,
  transition: "select" | "back" | null,
): "history-heading" | "directory-action" | null {
  if (transition === "select" && currentPersonId && currentPersonId !== previousPersonId) {
    return "history-heading";
  }
  if (transition === "back" && previousPersonId && currentPersonId === null) {
    return "directory-action";
  }
  return null;
}

const historyLabels: Record<PersonHistoryEntry["kind"], string> = {
  status: "Status",
  employment: "Employment",
  office: "Office",
  department: "Department",
  role: "Role",
};

export function historyKindLabel(kind: PersonHistoryEntry["kind"]): string {
  return historyLabels[kind];
}

/** Format date-only business dates without shifting them to the browser's zone. */
export function formatEffectiveDate(value: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, yearText, monthText, dayText] = dateOnly;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value;
    return new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  if (/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      const label = new Intl.DateTimeFormat(undefined, {
        timeZone: "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
      return `${label} UTC`;
    }
  }

  return value;
}

export function historyDetails(entry: PersonHistoryEntry): ReadonlyArray<string> {
  const { details } = entry;
  switch (entry.kind) {
    case "status":
      return [
        details.status ? `Status: ${details.status.replaceAll("_", " ")}` : null,
        details.reason ? `Reason: ${details.reason}` : null,
      ].filter((value): value is string => Boolean(value));
    case "employment":
      return [
        details.designation ? `Designation: ${details.designation}` : null,
        details.managerName ? `Manager: ${details.managerName}` : null,
      ].filter((value): value is string => Boolean(value));
    case "office":
      return details.officeName ? [`Office: ${details.officeName}`] : [];
    case "department":
      return details.departmentName ? [`Department: ${details.departmentName}`] : [];
    case "role":
      return [
        details.roleName ? `Role: ${details.roleName}` : null,
        details.roleArchived ? "Role is archived" : null,
      ].filter((value): value is string => Boolean(value));
  }
}

export function personStatusLabel(status: string | null): string {
  if (!status) return "Status unavailable";
  return status.replaceAll("_", " ");
}

export function personStatusTone(status: string | null): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "notice") return "warning";
  if (status === "frozen" || status === "offboarded") return "danger";
  return "neutral";
}

export function historyScopeSummary(entryCount: number, pageCount: number, pageLimit: number, hasMore: boolean): string {
  const pageLabel = pageCount === 1 ? "page" : "pages";
  const entryLabel = entryCount === 1 ? "entry" : "entries";
  const continuation = hasMore
    ? "Older pages are available."
    : "No additional page was returned for these history categories.";
  return `${entryCount} ${entryLabel} loaded across ${pageCount} bounded ${pageLabel}. Each page is limited to up to ${pageLimit} entries. ${continuation}`;
}
