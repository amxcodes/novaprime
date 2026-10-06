import { expect, test } from "bun:test";
import {
  parseTaskViewDeleteInput,
  parseTaskViewWriteInput,
  taskViewsOwnerReadSql,
} from "./task-views.js";

const personId = "00000000-0000-4000-8000-000000000001";
const viewId = "00000000-0000-4000-8000-000000000002";

function writeInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    expectedPersonId: personId,
    expectedRevision: 0,
    view: {
      name: "  Due this week  ",
      collection: "mine",
      status: "assigned",
      due: "upcoming",
      search: "  design review  ",
    },
    ...overrides,
  };
}

test("personal task view create normalizes user text and accepts only the finite DTO", () => {
  expect(parseTaskViewWriteInput(writeInput())).toEqual({
    schemaVersion: 1,
    expectedPersonId: personId,
    expectedRevision: 0,
    view: {
      name: "Due this week",
      collection: "mine",
      status: "assigned",
      due: "upcoming",
      search: "design review",
    },
  });
  expect(parseTaskViewWriteInput(writeInput({ organizationId: personId }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ expectedPersonId: "not-a-uuid" }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ expectedPersonId: personId.toUpperCase() }))?.expectedPersonId).toBe(personId);
  expect(parseTaskViewWriteInput(writeInput({ view: { ...writeInput().view as object, query: "select *" } }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ view: { ...writeInput().view as object, columns: ["owner"] } }))).toBeUndefined();
});

test("task view updates require a stable id and positive expected revision", () => {
  expect(parseTaskViewWriteInput(writeInput({
    expectedRevision: 4,
    view: { ...writeInput().view as object, id: viewId },
  }))?.view.id).toBe(viewId);
  expect(parseTaskViewWriteInput(writeInput({
    expectedRevision: 4,
    view: writeInput().view,
  }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({
    expectedRevision: 0,
    view: { ...writeInput().view as object, id: viewId },
  }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ expectedRevision: 2_147_483_647 }))).toBeUndefined();
});

test("task view names, searches, statuses, and due filters are bounded allowlists", () => {
  expect(parseTaskViewWriteInput(writeInput({ view: { ...writeInput().view as object, name: "x".repeat(41) } }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ view: { ...writeInput().view as object, search: "x".repeat(101) } }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ view: { ...writeInput().view as object, collection: "mine", status: "cancelled" } }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ view: { ...writeInput().view as object, collection: "visible", status: "awaiting_review" } }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ view: { ...writeInput().view as object, due: "next_month" } }))).toBeUndefined();
  expect(parseTaskViewWriteInput(writeInput({ view: { ...writeInput().view as object, search: "  " } }))?.view.search).toBe("");
});

test("task view delete uses an owner-bound revision contract", () => {
  expect(parseTaskViewDeleteInput({ schemaVersion: 1, expectedPersonId: personId, expectedRevision: 2 })).toEqual({
    schemaVersion: 1,
    expectedPersonId: personId,
    expectedRevision: 2,
  });
  expect(parseTaskViewDeleteInput({ schemaVersion: 1, expectedPersonId: personId, expectedRevision: 0 })).toBeUndefined();
  expect(parseTaskViewDeleteInput({ schemaVersion: 1, expectedPersonId: personId, expectedRevision: 2, organizationId: personId })).toBeUndefined();
  expect(parseTaskViewDeleteInput({ schemaVersion: 1, expectedPersonId: personId, expectedRevision: 2_147_483_648 })).toBeUndefined();
});

test("task view reads are owner and organisation scoped with stable bounded ordering", () => {
  const sql = taskViewsOwnerReadSql.toUpperCase();
  expect(sql).toContain("ORGANISATION_ID = $1 AND PERSON_ID = $2");
  expect(sql).toContain("ORDER BY SORT_ORDER, ID");
  expect(sql).toContain("LIMIT 12");
  expect(sql).not.toContain("ORGANIZATIONID");
});
