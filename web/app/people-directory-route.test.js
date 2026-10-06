import assert from "node:assert/strict";
import { test } from "node:test";
import { createPeopleDirectoryRoute, peopleDirectoryPageUrl } from "./people-directory-route.js";

function deferredReadPage() {
  const requests = [];
  return {
    requests,
    readPage(query, cursor) {
      return new Promise((resolve) => requests.push({ query, cursor, resolve }));
    },
  };
}

const person = (id) => ({ id, displayName: id, email: `${id}@example.test` });

test("directory page URLs keep server search, page size, and cursor in one encoded request", () => {
  assert.equal(peopleDirectoryPageUrl(" Aman Lee "), "/api/people/directory?limit=25&q=Aman+Lee");
  assert.equal(peopleDirectoryPageUrl("Aman", "cursor ~ 1"), "/api/people/directory?limit=25&q=Aman&cursor=cursor+%7E+1");
  assert.equal(peopleDirectoryPageUrl("", null), "/api/people/directory?limit=25");
});

test("a slower prior search cannot replace the newer authorized result", async () => {
  const deferred = deferredReadPage();
  const route = createPeopleDirectoryRoute({ readPage: deferred.readPage });
  const older = route.start();
  const newer = route.search("Morgan");

  deferred.requests[1].resolve({ people: [person("morgan")], limit: 25, hasMore: false, nextCursor: null });
  await newer;
  deferred.requests[0].resolve({ people: [person("stale")], limit: 25, hasMore: false, nextCursor: null });
  await older;

  assert.deepEqual(route.getState().people.map((row) => row.id), ["morgan"]);
  assert.equal(route.getState().query, "Morgan");
});

test("duplicate continuation is ignored and an older page cannot append after a new search", async () => {
  const deferred = deferredReadPage();
  const route = createPeopleDirectoryRoute({ readPage: deferred.readPage });
  const firstPage = route.start();
  deferred.requests[0].resolve({ people: [person("one")], limit: 1, hasMore: true, nextCursor: "next" });
  await firstPage;

  const olderPage = route.loadMore("next");
  assert.equal(deferred.requests.length, 2);
  await route.loadMore("next");
  assert.equal(deferred.requests.length, 2);

  const newSearch = route.search("new scope");
  deferred.requests[2].resolve({ people: [person("fresh")], limit: 25, hasMore: false, nextCursor: null });
  await newSearch;
  deferred.requests[1].resolve({ people: [person("stale-two")], limit: 1, hasMore: false, nextCursor: null });
  await olderPage;

  assert.deepEqual(route.getState().people.map((row) => row.id), ["fresh"]);
});

test("a failed continuation retains loaded rows and a valid cursor for retry", async () => {
  const deferred = deferredReadPage();
  const route = createPeopleDirectoryRoute({
    readPage: deferred.readPage,
    failureMessage: (_result, resource) => `Could not load ${resource}.`,
  });
  const initial = route.start();
  deferred.requests[0].resolve({ people: [person("one")], limit: 1, hasMore: true, nextCursor: "next" });
  await initial;

  const continuation = route.loadMore("next");
  deferred.requests[1].resolve({ readError: "REQUEST_FAILED" });
  await continuation;
  assert.deepEqual(route.getState().people.map((row) => row.id), ["one"]);
  assert.equal(route.getState().nextCursor, "next");
  assert.equal(route.getState().loadMoreError, "Could not load the next people page.");
});

test("scope denial clears loaded directory data", async () => {
  const deferred = deferredReadPage();
  const route = createPeopleDirectoryRoute({
    readPage: deferred.readPage,
    isDenied: (result) => result.readError === "PERMISSION_DENIED",
  });
  const initial = route.start();
  deferred.requests[0].resolve({ people: [person("one")], limit: 1, hasMore: true, nextCursor: "next" });
  await initial;
  const continuation = route.loadMore("next");
  deferred.requests[1].resolve({ readError: "PERMISSION_DENIED" });
  await continuation;
  assert.deepEqual(route.getState(), {
    status: "denied",
    message: "The people directory is not available under your current access.",
  });
});
