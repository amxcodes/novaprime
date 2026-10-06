import { describe, expect, it } from "bun:test";
import type { NotificationRecord } from "./contracts";
import { formatNotificationDate, notificationGroups } from "./presentation";

const notification = (id: string, createdAt: string): NotificationRecord => ({
  id,
  eventKey: "task.submitted",
  title: `Notification ${id}`,
  body: "A work item changed.",
  deepLink: null,
  readAt: null,
  createdAt,
});

describe("notification presentation", () => {
  it("groups the host-provided newest-first activity by local day", () => {
    const now = new Date(2026, 9, 2, 12);
    const groups = notificationGroups([
      notification("today", new Date(2026, 9, 2, 9).toISOString()),
      notification("yesterday", new Date(2026, 9, 1, 20).toISOString()),
      notification("older", new Date(2026, 8, 28, 11).toISOString()),
    ], now, "en-US");

    expect(groups.map(({ label }) => label)).toEqual(["Today", "Yesterday", "Monday, September 28, 2026"]);
    expect(groups.flatMap(({ notifications }) => notifications.map(({ id }) => id))).toEqual(["today", "yesterday", "older"]);
  });

  it("keeps invalid dates readable rather than throwing", () => {
    expect(formatNotificationDate("not-a-date", "en-US")).toBe("Date unavailable");
    expect(notificationGroups([notification("bad-date", "not-a-date")], new Date(2026, 9, 2))[0]?.label).toBe("Date unavailable");
  });
});
