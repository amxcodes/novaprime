import type { AvailabilityAgendaEvent, AvailabilityAgendaResponse } from "./contracts";

export type AvailabilityAgendaStatus = "idle" | "loading" | "ready" | "denied" | "error";

export interface AvailabilityAgendaState {
  status: AvailabilityAgendaStatus;
  events: ReadonlyArray<AvailabilityAgendaEvent>;
  nextCursor: string | null;
  loadingMore: boolean;
  pageFailure: string | null;
  statusMessage: string;
}

export function createAvailabilityAgendaState(hasInitialRange = false): AvailabilityAgendaState {
  return {
    status: hasInitialRange ? "loading" : "idle",
    events: [],
    nextCursor: null,
    loadingMore: false,
    pageFailure: null,
    statusMessage: hasInitialRange
      ? "Loading the selected business dates…"
      : "Choose a business-date range to load the agenda.",
  };
}

export function beginAvailabilityAgendaRead(
  state: AvailabilityAgendaState,
  append: boolean,
): AvailabilityAgendaState {
  return {
    ...state,
    status: append ? "ready" : "loading",
    events: append ? state.events : [],
    nextCursor: append ? state.nextCursor : null,
    loadingMore: append,
    pageFailure: null,
    statusMessage: append ? "Loading more events…" : "Loading the selected business dates…",
  };
}

export function failAvailabilityAgendaRead(
  state: AvailabilityAgendaState,
  response: AvailabilityAgendaResponse,
  append: boolean,
  message: string,
): AvailabilityAgendaState {
  if (availabilityErrorKind(response) === "denied") {
    return {
      ...state,
      status: "denied",
      events: [],
      nextCursor: null,
      loadingMore: false,
      pageFailure: null,
      statusMessage: response.accessChanged
        ? "Availability access changed. Reload the date range to see the events currently available to you."
        : "Availability events are unavailable under your current access.",
    };
  }
  if (append) {
    return {
      ...state,
      loadingMore: false,
      pageFailure: message,
      statusMessage: `Showing ${state.events.length} previously loaded event${state.events.length === 1 ? "" : "s"}; the next page could not be loaded.`,
    };
  }
  return {
    ...state,
    status: "error",
    loadingMore: false,
    pageFailure: message,
    statusMessage: "Availability events are unavailable.",
  };
}

export function completeAvailabilityAgendaRead(
  state: AvailabilityAgendaState,
  response: AvailabilityAgendaResponse,
  append: boolean,
  sourceText: string,
  startDate: string,
  endDate: string,
): AvailabilityAgendaState {
  const returnedEvents = Array.isArray(response.events) ? response.events : [];
  const events = append ? [...state.events, ...returnedEvents] : returnedEvents;
  return {
    status: "ready",
    events,
    nextCursor: response.nextCursor || null,
    loadingMore: false,
    pageFailure: null,
    statusMessage:
      `${append ? "More events loaded. " : ""}Showing ${events.length} event${events.length === 1 ? "" : "s"} ` +
      `from ${sourceText} for the selected business dates ${startDate} through ${endDate}` +
      (response.nextCursor ? ". More records are available." : ". End of this date range."),
  };
}

/**
 * Read a page and restart from page one when a continuation cursor's access
 * snapshot is stale. The caller clears its protected projection before the
 * restarted request is sent.
 */
export async function loadAvailabilityAgendaPage(options: {
  startDate: string;
  endDate: string;
  cursor: string | null;
  append: boolean;
  loadEvents: (
    startDate: string,
    endDate: string,
    cursor: string | null,
  ) => Promise<AvailabilityAgendaResponse>;
  onRestart: () => void;
  onAccessChanged?: () => void;
  isCurrent: () => boolean;
}): Promise<{
  response?: AvailabilityAgendaResponse;
  append: boolean;
  cancelled: boolean;
}> {
  const { startDate, endDate, cursor, loadEvents, onRestart, onAccessChanged, isCurrent } = options;
  let response = await loadEvents(startDate, endDate, cursor);
  if (!cursor || !response.accessChanged) {
    return { response, append: options.append, cancelled: false };
  }

  onRestart();
  onAccessChanged?.();
  if (!isCurrent()) return { append: false, cancelled: true };
  response = await loadEvents(startDate, endDate, null);
  return { response, append: false, cancelled: false };
}

export function isValidBusinessDateRange(start: string, end: string): boolean {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(start) || !validDate(end) || start > end) return false;
  const days = (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000;
  return Number.isFinite(days) && days <= 30;
}

export function availabilityErrorKind(response: AvailabilityAgendaResponse): "denied" | "error" {
  return response.readError === "PERMISSION_DENIED" ? "denied" : "error";
}

export function availabilityEventTypeLabel(type: string): string {
  const value = type === "wfh" ? "work from home" : type.replaceAll("_", " ");
  return value ? value[0].toUpperCase() + value.slice(1) : "Availability event";
}

/**
 * Agenda event IDs identify their source record, not always one rendered day.
 * A shift repeats for each scheduled date and a WFH request spans multiple
 * dates, so include the date and event type in the React row identity.
 */
export function availabilityEventKey(event: Pick<AvailabilityAgendaEvent, "date" | "id" | "type">): string {
  return `${event.date}:${event.type}:${event.id}`;
}

export function availabilityEventLabel(
  event: AvailabilityAgendaEvent,
  businessTimeLabel: (value: string, timezone?: string | null) => string,
): string {
  const office = event.office?.name || "Office";
  const timezone = event.timezone ? ` · ${event.timezone}` : "";
  if (event.type === "shift") return `${office}${timezone} · ${event.shift?.name || "Scheduled shift"} · ` +
    `${event.shift?.startLocalTime || ""}–${event.shift?.endLocalTime || ""}`;
  if (event.type === "holiday") return `${office}${timezone} · ${event.name || "Holiday"}`;
  if (event.type === "attendance") {
    const times = event.checkedInAt
      ? businessTimeLabel(event.checkedInAt, event.timezone) +
        (event.checkedOutAt ? `–${businessTimeLabel(event.checkedOutAt, event.timezone)}` : " · no check-out recorded")
      : "check-in not recorded";
    return `${event.person?.name || "Person"} · ${office}${timezone} · ${event.mode || "attendance"} · ${times}`;
  }
  if (event.type === "leave") return `${event.person?.name || "Person"} · ${event.leaveType || "leave"} · ` +
    `${event.status || "status unavailable"} · ${Number(event.portion) === 0.5 ? "half day" : "full day"}`;
  if (event.type === "wfh") return `${event.person?.name || "Person"} · work from home · ${event.status || "status unavailable"}`;
  return "Availability event";
}
