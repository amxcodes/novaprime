import { expect, test } from "bun:test";
import type { PersonHistoryEntry } from "./contracts";
import {
  availablePeopleCursor,
  formatEffectiveDate,
  historyDetails,
  historyKindLabel,
  historyScopeSummary,
  peopleWorkspaceFocusRecoveryTarget,
  personStatusLabel,
  personStatusTone,
} from "./presentation";

test("directory continuation only belongs to the applied server query", () => {
  const page = {
    status: "ready" as const,
    query: "Morgan",
    people: [],
    limit: 50,
    hasMore: true,
    nextCursor: "opaque-cursor",
    loadingMore: false,
  };

  expect(availablePeopleCursor(" Morgan ", page)).toBe("opaque-cursor");
  expect(availablePeopleCursor("Lee", page)).toBeNull();
  expect(availablePeopleCursor("Morgan", { ...page, hasMore: false })).toBeNull();
});

test("People workspace returns focus for intentional selection and back transitions", () => {
  expect(peopleWorkspaceFocusRecoveryTarget(null, "person-1", "select")).toBe("history-heading");
  expect(peopleWorkspaceFocusRecoveryTarget("person-1", "person-2", "select")).toBe("history-heading");
  expect(peopleWorkspaceFocusRecoveryTarget("person-1", null, "back")).toBe("directory-action");
  expect(peopleWorkspaceFocusRecoveryTarget("person-1", "person-1", "select")).toBeNull();
  expect(peopleWorkspaceFocusRecoveryTarget(null, "person-1", null)).toBeNull();
  expect(peopleWorkspaceFocusRecoveryTarget("person-1", null, "select")).toBeNull();
});

test("date-only values keep their business date and invalid dates stay visible", () => {
  const expected = new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date("2024-02-29T00:00:00.000Z"));
  expect(formatEffectiveDate("2024-02-29")).toBe(expected);
  expect(formatEffectiveDate("2023-02-29")).toBe("2023-02-29");
  expect(formatEffectiveDate("2026-10-01T12:30:00.000Z")).toContain("UTC");
});

test("history presentation retains supported fields without exposing raw IDs", () => {
  const status: PersonHistoryEntry = {
    id: "event-1",
    kind: "status",
    effectiveOn: "2026-09-01T12:00:00.000000Z",
    effectiveUntil: null,
    details: { status: "on_notice", reason: "Transition period", roleId: "raw-id" },
  };
  const role: PersonHistoryEntry = {
    id: "event-2",
    kind: "role",
    effectiveOn: "2026-08-01",
    effectiveUntil: "2026-08-31",
    details: { roleName: "Contributor", roleArchived: true, roleId: "raw-id" },
  };

  expect(historyKindLabel(status.kind)).toBe("Status");
  expect(historyDetails(status)).toEqual(["Status: on notice", "Reason: Transition period"]);
  expect(historyDetails(role)).toEqual(["Role: Contributor", "Role is archived"]);
});

test("history scope copy reports bounded loaded pages without claiming a total dossier", () => {
  expect(historyScopeSummary(51, 2, 50, true)).toBe(
    "51 entries loaded across 2 bounded pages. Each page is limited to up to 50 entries. Older pages are available.",
  );
  expect(historyScopeSummary(0, 1, 50, false)).toContain("No additional page was returned for these history categories.");
});

test("current status labels are textual and unknown statuses stay neutral", () => {
  expect(personStatusLabel("in_progress")).toBe("in progress");
  expect(personStatusTone("active")).toBe("success");
  expect(personStatusTone("unknown_state")).toBe("neutral");
});
