import assert from "node:assert/strict";
import { test } from "node:test";
import { createPeopleHistoryRoute } from "./people-history-route.js";

const person = (id) => ({ id, displayName: id, email: `${id}@example.test` });
const page = (id, overrides = {}) => ({
  person: { id, displayName: id },
  history: [{ id: `${id}-entry`, kind: "employment", effectiveOn: "2026-10-01", effectiveUntil: null, details: {} }],
  limit: 50,
  hasMore: false,
  nextCursor: null,
  ...overrides,
});

function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

test("direct selection reads only that person's summary and first history page", async () => {
  const personReads = [];
  const pageReads = [];
  const route = createPeopleHistoryRoute({
    readPerson: async (id) => { personReads.push(id); return { person: person(id) }; },
    readPage: async (id, cursor) => { pageReads.push([id, cursor]); return page(id); },
  });

  await route.select("person-a");

  assert.deepEqual(personReads, ["person-a"]);
  assert.deepEqual(pageReads, [["person-a", null]]);
  assert.deepEqual(route.getState(), {
    personId: "person-a",
    person: person("person-a"),
    read: { status: "ready", pages: [page("person-a")], loadingMore: false },
  });
});

test("a matching authorized directory summary skips the duplicate summary read", async () => {
  const summary = person("person-a");
  let summaryReads = 0;
  const route = createPeopleHistoryRoute({
    readPerson: async () => { summaryReads += 1; throw new Error("summary read should be skipped"); },
    readPage: async (id, cursor) => page(id, { hasMore: Boolean(cursor), nextCursor: cursor ? null : "older" }),
  });

  await route.select("person-a", summary);

  assert.equal(summaryReads, 0);
  assert.equal(route.getState().person, summary);
  assert.equal(route.getState().read.pages[0].nextCursor, "older");
});

test("a slower prior selection cannot replace the newly selected person's summary or pages", async () => {
  const personRequests = [];
  const pageRequests = [];
  const route = createPeopleHistoryRoute({
    readPerson: (id) => {
      const request = deferred();
      personRequests.push({ id, ...request });
      return request.promise;
    },
    readPage: (id, cursor) => {
      const request = deferred();
      pageRequests.push({ id, cursor, ...request });
      return request.promise;
    },
  });

  const oldSelection = route.select("old");
  const currentSelection = route.select("current");
  personRequests[1].resolve({ person: person("current") });
  pageRequests[1].resolve(page("current"));
  await currentSelection;
  personRequests[0].resolve({ person: person("old") });
  pageRequests[0].resolve(page("old"));
  await oldSelection;

  assert.equal(route.getState().personId, "current");
  assert.equal(route.getState().person.id, "current");
  assert.deepEqual(route.getState().read.pages.map(({ person: identity }) => identity.id), ["current"]);
});

test("clearing the selected URL invalidates pending summary and history reads", async () => {
  const personRequest = deferred();
  const pageRequest = deferred();
  const route = createPeopleHistoryRoute({
    readPerson: () => personRequest.promise,
    readPage: () => pageRequest.promise,
  });
  const pending = route.select("person-a");

  route.clear();
  personRequest.resolve({ person: person("person-a") });
  pageRequest.resolve(page("person-a"));
  await pending;

  assert.equal(route.getState(), null);
});

test("a denied history read clears the matching summary and all history state", async () => {
  const summary = person("person-a");
  const route = createPeopleHistoryRoute({
    readPerson: async () => { throw new Error("cached summary must be reused"); },
    readPage: async () => ({ readError: "PERMISSION_DENIED" }),
    isDenied: (result) => result.readError === "PERMISSION_DENIED",
    deniedMessage: "History is not available under your access.",
  });

  await route.select("person-a", summary);

  assert.deepEqual(route.getState(), {
    personId: "person-a",
    person: null,
    read: { status: "denied", message: "History is not available under your access." },
  });
});

test("a failed older-page read retains prior pages and the same retry cursor", async () => {
  let continuationAttempt = 0;
  const route = createPeopleHistoryRoute({
    readPerson: async () => { throw new Error("matching directory summary should be reused"); },
    readPage: async (id, cursor) => {
      if (!cursor) return page(id, { hasMore: true, nextCursor: "older-1" });
      continuationAttempt += 1;
      return continuationAttempt === 1
        ? { readError: "REQUEST_FAILED" }
        : page(id, { history: [], hasMore: false, nextCursor: null });
    },
    failureMessage: (_result, resource) => `Unavailable: ${resource}.`,
  });
  const summary = person("person-a");
  await route.select("person-a", summary);
  const firstPage = route.getState().read.pages[0];

  await route.loadMore("older-1");

  assert.equal(route.getState().read.status, "ready");
  assert.deepEqual(route.getState().read.pages, [firstPage]);
  assert.equal(route.getState().read.pages.at(-1).nextCursor, "older-1");
  assert.equal(route.getState().read.loadMoreError, "Unavailable: older history.");

  await route.loadMore("older-1");
  assert.equal(route.getState().read.pages.length, 2);
  assert.equal(route.getState().read.pages.at(-1).person.id, "person-a");
  assert.equal(route.getState().read.pages.at(-1).nextCursor, null);
});

test("a stale continuation cannot append after selecting a different person", async () => {
  const nextPage = deferred();
  let pageCount = 0;
  const route = createPeopleHistoryRoute({
    readPerson: async (id) => ({ person: person(id) }),
    readPage: async (id, cursor) => {
      if (cursor) return nextPage.promise;
      pageCount += 1;
      return page(id, { hasMore: id === "first", nextCursor: id === "first" ? "older" : null });
    },
  });

  await route.select("first");
  const continuation = route.loadMore("older");
  await route.select("second");
  nextPage.resolve(page("first", { history: [], hasMore: false, nextCursor: null }));
  await continuation;

  assert.equal(route.getState().personId, "second");
  assert.deepEqual(route.getState().read.pages.map(({ person: identity }) => identity.id), ["second"]);
  assert.equal(pageCount, 2);
});

test("a continuation denial removes cached identity and previously loaded pages", async () => {
  const route = createPeopleHistoryRoute({
    readPerson: async (id) => ({ person: person(id) }),
    readPage: async (id, cursor) => cursor
      ? { readError: "PERSON_NOT_FOUND" }
      : page(id, { hasMore: true, nextCursor: "older" }),
    isDenied: (result) => result.readError === "PERSON_NOT_FOUND",
  });
  await route.select("person-a");
  await route.loadMore("older");

  assert.deepEqual(route.getState(), {
    personId: "person-a",
    person: null,
    read: { status: "denied", message: "This history is not available under your current access." },
  });
});

test("summary and page identity mismatches fail closed without publishing another person", async () => {
  const wrongSummary = createPeopleHistoryRoute({
    readPerson: async () => ({ person: person("other") }),
    readPage: async () => page("person-a"),
  });
  await wrongSummary.select("person-a");
  assert.equal(wrongSummary.getState().person, null);
  assert.equal(wrongSummary.getState().read.status, "failed");

  const wrongPage = createPeopleHistoryRoute({
    readPerson: async (id) => ({ person: person(id) }),
    readPage: async (id) => page("other", { hasMore: true, nextCursor: "opaque" }),
  });
  await wrongPage.select("person-a");
  assert.equal(wrongPage.getState().person.id, "person-a");
  assert.deepEqual(wrongPage.getState().read, {
    status: "failed",
    message: "The history response could not be verified. Retry the request.",
  });
});
