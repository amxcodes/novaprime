import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AvailabilityAgenda } from "./AvailabilityAgenda";
import type { AvailabilityAgendaProps } from "./contracts";
import {
  beginAvailabilityAgendaRead,
  availabilityErrorKind,
  availabilityEventKey,
  availabilityEventLabel,
  availabilityEventTypeLabel,
  completeAvailabilityAgendaRead,
  createAvailabilityAgendaState,
  failAvailabilityAgendaRead,
  isValidBusinessDateRange,
  loadAvailabilityAgendaPage,
} from "./model";

describe("Availability agenda model", () => {
  it("validates real business dates and caps ranges at 31 calendar days", () => {
    expect(isValidBusinessDateRange("2026-10-01", "2026-10-31")).toBe(true);
    expect(isValidBusinessDateRange("2026-10-01", "2026-11-01")).toBe(false);
    expect(isValidBusinessDateRange("2026-02-30", "2026-03-01")).toBe(false);
    expect(isValidBusinessDateRange("2024-02-29", "2024-02-29")).toBe(true);
    expect(isValidBusinessDateRange("2026-10-02", "2026-10-01")).toBe(false);
  });

  it("distinguishes an authorization denial from a recoverable read failure", () => {
    expect(availabilityErrorKind({ readError: "PERMISSION_DENIED" })).toBe("denied");
    expect(availabilityErrorKind({ readError: "TEMPORARY_UNAVAILABLE" })).toBe("error");
  });

  it("retains loaded rows and the failed cursor for a partial-page retry", () => {
    const firstEvent = { id: "event-1", date: "2026-10-01", type: "holiday" as const, name: "Founders day" };
    const firstPage = completeAvailabilityAgendaRead(
      createAvailabilityAgendaState(true),
      { events: [firstEvent], nextCursor: "page-2" },
      false,
      "holidays",
      "2026-10-01",
      "2026-10-31",
    );
    const loadingNext = beginAvailabilityAgendaRead(firstPage, true);
    const failedNext = failAvailabilityAgendaRead(
      loadingNext,
      { readError: "TEMPORARY_UNAVAILABLE" },
      true,
      "Could not load availability agenda. Refresh the page to try again.",
    );

    expect(loadingNext.loadingMore).toBe(true);
    expect(failedNext.status).toBe("ready");
    expect(failedNext.events).toEqual([firstEvent]);
    expect(failedNext.nextCursor).toBe("page-2");
    expect(failedNext.loadingMore).toBe(false);
    expect(failedNext.pageFailure).toContain("Could not load");
    expect(failedNext.statusMessage).toContain("1 previously loaded event;");
  });

  it("clears rows and cursors if a page request becomes unauthorized", () => {
    const loaded = completeAvailabilityAgendaRead(
      createAvailabilityAgendaState(true),
      { events: [{ id: "event-1", date: "2026-10-01", type: "holiday" }], nextCursor: "page-2" },
      false,
      "holidays",
      "2026-10-01",
      "2026-10-31",
    );
    const denied = failAvailabilityAgendaRead(
      beginAvailabilityAgendaRead(loaded, true),
      { readError: "PERMISSION_DENIED" },
      true,
      "You do not have permission to view availability agenda.",
    );

    expect(denied.status).toBe("denied");
    expect(denied.events).toHaveLength(0);
    expect(denied.nextCursor).toBeNull();
    expect(denied.statusMessage).toContain("unavailable under your current access");
  });

  it("clears all retained rows when a page cursor belongs to an older access revision", () => {
    const loaded = completeAvailabilityAgendaRead(
      createAvailabilityAgendaState(true),
      { events: [{ id: "old-office-event", date: "2026-10-01", type: "attendance" }], nextCursor: "old-revision" },
      false,
      "attendance, leave",
      "2026-10-01",
      "2026-10-31",
    );
    const changed = failAvailabilityAgendaRead(
      beginAvailabilityAgendaRead(loaded, true),
      { readError: "PERMISSION_DENIED", accessChanged: true },
      true,
      "Availability access changed.",
    );

    expect(changed.status).toBe("denied");
    expect(changed.events).toHaveLength(0);
    expect(changed.nextCursor).toBeNull();
    expect(changed.statusMessage).toContain("Reload the date range");
  });

  it("clears the old projection before restarting a stale continuation at page one", async () => {
    const calls: Array<string | null> = [];
    const order: string[] = [];
    const result = await loadAvailabilityAgendaPage({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      cursor: "old-access-page",
      append: true,
      loadEvents: async (_start, _end, cursor) => {
        calls.push(cursor);
        if (cursor) return { readError: "PERMISSION_DENIED", accessChanged: true };
        return { events: [{ id: "current-access-event", date: "2026-10-01", type: "holiday" }] };
      },
      onRestart: () => order.push("clear protected rows"),
      onAccessChanged: () => order.push("refresh grants"),
      isCurrent: () => true,
    });

    expect(calls).toEqual(["old-access-page", null]);
    expect(order).toEqual(["clear protected rows", "refresh grants"]);
    expect(result).toMatchObject({
      response: { events: [{ id: "current-access-event" }] },
      append: false,
      cancelled: false,
    });
  });

  it("formats the event types and preserves office timezone context", () => {
    expect(availabilityEventTypeLabel("wfh")).toBe("Work from home");
    const label = availabilityEventLabel({
      id: "attendance-1",
      date: "2026-10-01",
      type: "attendance",
      person: { name: "Morgan Lee" },
      office: { name: "Central office" },
      timezone: "Asia/Kolkata",
      mode: "office",
      checkedInAt: "2026-10-01T03:30:00.000Z",
    }, (value, timezone) => `${value} (${timezone})`);
    expect(label).toContain("Morgan Lee · Central office · Asia/Kolkata · office");
    expect(label).toContain("2026-10-01T03:30:00.000Z (Asia/Kolkata) · no check-out recorded");
  });

  it("keeps repeated source records distinct for each date in the rendered agenda", () => {
    const shiftOnMonday = { id: "office:calendar:rule", date: "2026-10-05", type: "shift" };
    const shiftOnTuesday = { ...shiftOnMonday, date: "2026-10-06" };
    const multiDayWfh = { id: "request-1", date: "2026-10-05", type: "wfh" };

    expect(availabilityEventKey(shiftOnMonday)).not.toBe(availabilityEventKey(shiftOnTuesday));
    expect(availabilityEventKey(shiftOnMonday)).not.toBe(availabilityEventKey(multiDayWfh));
    expect(availabilityEventKey({ ...multiDayWfh, date: "2026-10-06" }))
      .not.toBe(availabilityEventKey(multiDayWfh));
  });
});

describe("AvailabilityAgenda initial state", () => {
  it("shows the date prompt and does not read until dates are selected", () => {
    let reads = 0;
    const props: AvailabilityAgendaProps = {
      startDate: "",
      endDate: "",
      sourceLabels: ["attendance", "leave"],
      loadEvents: async () => { reads += 1; return { events: [] }; },
      updateRange: () => {},
      isCurrentPageRequest: () => true,
      readErrorMessage: () => "Unable to load availability events.",
      businessTimeLabel: (value) => value,
    };
    const markup = renderToStaticMarkup(createElement(AvailabilityAgenda, props));
    expect(markup).toContain("Choose a business-date range");
    expect(markup).toContain("Up to 31 calendar dates.");
    expect(markup).toContain('type="date"');
    expect(markup).toContain("Load agenda");
    expect(reads).toBe(0);
  });

  it("defines compact, medium, and expanded container layouts with semantic theme tokens", async () => {
    const css = await Bun.file(new URL("./AvailabilityAgenda.module.css", import.meta.url)).text();
    expect(css).toContain("@container availability (max-width: 39.999rem)");
    expect(css).toContain("@container availability (min-width: 40rem) and (max-width: 63.999rem)");
    expect(css).toContain("@container availability (min-width: 64rem)");
    expect(css).toMatch(/@container availability \(max-width: 39\.999rem\)[\s\S]*?\.pagination > \* \{ width: 100%; \}/);
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("var(--nova-color-border)");
    expect(css).toContain("var(--nova-color-surface)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
