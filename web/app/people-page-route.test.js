import assert from "node:assert/strict";
import { test } from "node:test";
import { createPeoplePageRoute, isPeopleDirectoryContext } from "./people-page-route.js";
import { createPeopleDirectoryRoute } from "./people-directory-route.js";
import { createPeopleHistoryRoute } from "./people-history-route.js";

const person = (id) => ({ id, displayName: `Person ${id}`, email: `${id}@example.test` });
const historyPage = (id) => ({
  person: { id, displayName: `Person ${id}` },
  history: [],
  limit: 50,
  hasMore: false,
  nextCursor: null,
});

function createFixture({
  href = "https://nova.test/?view=people&person=person-a",
  historyState = null,
  pageApi = async (path) => path.endsWith("/history?limit=50")
    ? historyPage("person-a")
    : { person: person("person-a") },
  loadPage,
  loadFeature,
  loadDirectoryRoute = async () => ({ createPeopleDirectoryRoute, peopleDirectoryPageUrl: (query, cursor) => {
    const params = new URLSearchParams({ limit: "25" });
    if (query) params.set("q", query.trim());
    if (cursor) params.set("cursor", cursor);
    return `/api/people/directory?${params}`;
  } }),
  loadHistoryRoute = async () => ({ createPeopleHistoryRoute }),
  loadLifecycleHost = async () => ({
    createPeopleLifecyclePageActionProvider: () => () => undefined,
  }),
  isCurrentPageRequest = () => true,
} = {}) {
  const PeoplePage = function PeoplePage() {};
  const PeopleWorkspace = function PeopleWorkspace() {};
  const target = {
    isConnected: true,
    replacements: [],
    replaceChildren(...children) { this.replacements.push(children); },
  };
  const pageRoot = {
    isConnected: true,
    replacements: [],
    querySelector(selector) { return selector === "#people-content" ? target : null; },
    replaceChildren(...children) { this.replacements.push(children); },
  };
  const mounted = [];
  const feedback = [];
  const requests = [];
  const historyWrites = [];
  const readIssues = [];
  const lifecycleProviderRequests = [];
  const loaderCalls = { page: 0, feature: 0, directory: 0, history: 0, lifecycle: 0 };
  const controls = {
    href,
    historyState,
    activeView: null,
    resetCount: 0,
    current: true,
    setHref(value) { this.href = value; },
  };
  const routeFactory = createPeoplePageRoute({
    getLocationHref: () => controls.href,
    getHistoryState: () => controls.historyState,
    getWorkspaceSessionId: () => "active-session",
    pushHistoryState: (...args) => {
      historyWrites.push(args);
      controls.historyState = args[0];
      controls.href = String(args[2]);
    },
    setActiveView: (view) => { controls.activeView = view; },
    resetPopStateState: () => { controls.resetCount += 1; },
    navigatePersonHistory: (id) => { controls.navigatedPersonId = id; },
    isCurrentPageRequest: (lifetime) => controls.current && isCurrentPageRequest(lifetime),
    pageApi: async (path, lifetime) => {
      requests.push({ path, lifetime });
      return pageApi(path, lifetime);
    },
    mountReactIsland: (root, Component, props) => mounted.push({ root, Component, props }),
    showFeedback: () => feedback.push(true),
    noticeElement: (message, kind) => ({ message, kind }),
    readIssue: (result, resource) => {
      readIssues.push({ result, resource });
      return { message: `Safe read message for ${resource}.` };
    },
    createLifecycleActionProvider: (input) => {
      lifecycleProviderRequests.push(input);
      return input.lifecycleHostUi.createPeopleLifecyclePageActionProvider(input);
    },
    loadPage: async (...args) => {
      loaderCalls.page += 1;
      return (loadPage || (async () => ({ PeoplePage })))(...args);
    },
    loadFeature: async (...args) => {
      loaderCalls.feature += 1;
      return (loadFeature || (async () => ({ PeopleWorkspace })))(...args);
    },
    loadDirectoryRoute: async (...args) => {
      loaderCalls.directory += 1;
      return loadDirectoryRoute(...args);
    },
    loadHistoryRoute: async (...args) => {
      loaderCalls.history += 1;
      return loadHistoryRoute(...args);
    },
    loadLifecycleHost: async (...args) => {
      loaderCalls.lifecycle += 1;
      return loadLifecycleHost(...args);
    },
  });

  return {
    mount: (overrides = {}) => routeFactory({ pageRoot, lifetime: "page-1", personId: null, directoryContext: false, ...overrides }),
    PeoplePage,
    PeopleWorkspace,
    target,
    pageRoot,
    mounted,
    feedback,
    requests,
    historyWrites,
    readIssues,
    lifecycleProviderRequests,
    loaderCalls,
    controls,
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function lastWorkspace(fixture) {
  return fixture.mounted.filter(({ root }) => root === fixture.target).at(-1)?.props;
}

test("People deep links do not revive a directory pane marker from an earlier page session", () => {
  assert.equal(isPeopleDirectoryContext(null, null, "active-session"), true);
  assert.equal(isPeopleDirectoryContext("person-a", {
    novaPeopleWorkspace: { fromDirectory: true, sessionId: "active-session" },
  }, "active-session"), true);
  assert.equal(isPeopleDirectoryContext("person-a", {
    novaPeopleWorkspace: { fromDirectory: true, sessionId: "previous-session" },
  }, "active-session"), false);
  assert.equal(isPeopleDirectoryContext("person-a", {
    novaPeopleWorkspace: { fromDirectory: true },
  }, "active-session"), false);
});

test("direct person URLs read only that exact summary and its first server history page", async () => {
  const fixture = createFixture({
    pageApi: async (path) => path === "/api/people/person-a"
      ? { person: person("person-a") }
      : historyPage("person-a"),
  });

  await fixture.mount({ personId: "person-a", directoryContext: false });
  await settle();

  assert.deepEqual(fixture.requests.map(({ path }) => path).sort(), [
    "/api/people/person-a",
    "/api/people/person-a/history?limit=50",
  ]);
  assert.ok(fixture.requests.every(({ lifetime }) => lifetime === "page-1"));
  assert.equal(lastWorkspace(fixture).selected.personId, "person-a");
  assert.deepEqual(lastWorkspace(fixture).selected.history.read.pages[0].history, []);
  assert.equal(fixture.lifecycleProviderRequests.length, 1);
  assert.equal(fixture.lifecycleProviderRequests[0].requestedPersonId, "person-a");
  assert.equal(fixture.lifecycleProviderRequests[0].lifetime, "page-1");
  assert.equal(fixture.lifecycleProviderRequests[0].pageRoot, fixture.pageRoot);
  assert.deepEqual(fixture.loaderCalls, { page: 1, feature: 1, directory: 0, history: 1, lifecycle: 1 });
});

test("directory selection reuses its matching summary and writes reversible URL state", async () => {
  const fixture = createFixture({
    href: "https://nova.test/?view=people",
    pageApi: async (path) => path.startsWith("/api/people/directory")
      ? { people: [person("person-a")], limit: 25, hasMore: false, nextCursor: null }
      : historyPage("person-a"),
  });
  await fixture.mount({ personId: null, directoryContext: true });
  await settle();

  assert.equal(fixture.loaderCalls.history, 0);
  assert.equal(fixture.loaderCalls.lifecycle, 0);
  const workspace = lastWorkspace(fixture);
  assert.equal(workspace.directory.read.status, "ready");
  workspace.directory.onSelectPerson("person-a");
  await settle();
  assert.deepEqual(fixture.requests.map(({ path }) => path), [
    "/api/people/directory?limit=25",
    "/api/people/person-a/history?limit=50",
  ]);
  assert.equal(fixture.historyWrites[0][0].novaPeopleWorkspace.fromDirectory, true);
  assert.equal(fixture.historyWrites[0][0].novaPeopleWorkspace.sessionId, "active-session");
  assert.equal(String(fixture.historyWrites[0][2]), "https://nova.test/?view=people&person=person-a");
  assert.equal(lastWorkspace(fixture).selected.personId, "person-a");
  assert.equal(fixture.loaderCalls.history, 1);
  assert.equal(fixture.loaderCalls.lifecycle, 1);

  lastWorkspace(fixture).onBackToDirectory();
  assert.equal(String(fixture.historyWrites[1][2]), "https://nova.test/?view=people");
  assert.equal(lastWorkspace(fixture).selected, null);
});

test("popstate restores directory selection by URL, reuses its exact visible summary, and resets route focus state", async () => {
  const fixture = createFixture({
    href: "https://nova.test/?view=people",
    pageApi: async (path) => path.startsWith("/api/people/directory")
      ? { people: [person("person-a")], limit: 25, hasMore: false, nextCursor: null }
      : historyPage("person-a"),
  });
  const route = await fixture.mount({ personId: null, directoryContext: true });
  await settle();
  fixture.controls.setHref("https://nova.test/?view=people&person=person-a");

  assert.equal(route.handlePopState({}), true);
  await settle();
  assert.equal(fixture.controls.activeView, "people");
  assert.equal(fixture.controls.resetCount, 1);
  assert.deepEqual(fixture.requests.map(({ path }) => path), [
    "/api/people/directory?limit=25",
    "/api/people/person-a/history?limit=50",
  ]);
  assert.equal(lastWorkspace(fixture).selected.personId, "person-a");
  assert.equal(fixture.loaderCalls.history, 1);
  assert.equal(fixture.loaderCalls.lifecycle, 1);
});

test("rapid directory selection shares lazy imports and only selects the latest person", async () => {
  let resolveHistoryRoute;
  const pendingHistoryRoute = new Promise((resolve) => { resolveHistoryRoute = resolve; });
  const fixture = createFixture({
    href: "https://nova.test/?view=people",
    loadHistoryRoute: () => pendingHistoryRoute,
    pageApi: async (path) => path.startsWith("/api/people/directory")
      ? { people: [person("person-a"), person("person-b")], limit: 25, hasMore: false, nextCursor: null }
      : historyPage("person-b"),
  });
  await fixture.mount({ personId: null, directoryContext: true });
  await settle();

  const workspace = lastWorkspace(fixture);
  workspace.directory.onSelectPerson("person-a");
  workspace.directory.onSelectPerson("person-b");
  assert.equal(lastWorkspace(fixture).selected.personId, "person-b");
  assert.equal(lastWorkspace(fixture).selected.history.read.status, "loading");
  assert.equal(fixture.loaderCalls.history, 1);
  assert.equal(fixture.loaderCalls.lifecycle, 1);
  assert.deepEqual(fixture.requests.map(({ path }) => path), ["/api/people/directory?limit=25"]);

  resolveHistoryRoute({ createPeopleHistoryRoute });
  await settle();
  assert.deepEqual(fixture.requests.map(({ path }) => path), [
    "/api/people/directory?limit=25",
    "/api/people/person-b/history?limit=50",
  ]);
  assert.equal(lastWorkspace(fixture).selected.personId, "person-b");
});

test("popping back while history support is loading cancels the pending selection", async () => {
  let resolveHistoryRoute;
  const pendingHistoryRoute = new Promise((resolve) => { resolveHistoryRoute = resolve; });
  const fixture = createFixture({
    href: "https://nova.test/?view=people",
    loadHistoryRoute: () => pendingHistoryRoute,
    pageApi: async (path) => path.startsWith("/api/people/directory")
      ? { people: [person("person-a")], limit: 25, hasMore: false, nextCursor: null }
      : historyPage("person-a"),
  });
  const route = await fixture.mount({ personId: null, directoryContext: true });
  await settle();

  lastWorkspace(fixture).directory.onSelectPerson("person-a");
  fixture.controls.setHref("https://nova.test/?view=people");
  assert.equal(route.handlePopState({}), true);
  assert.equal(lastWorkspace(fixture).selected, null);

  resolveHistoryRoute({ createPeopleHistoryRoute });
  await settle();
  assert.deepEqual(fixture.requests.map(({ path }) => path), ["/api/people/directory?limit=25"]);
  assert.equal(lastWorkspace(fixture).selected, null);
});

test("history failures preserve an authorized summary and surface only the mapped read message", async () => {
  const fixture = createFixture({
    pageApi: async (path) => {
      if (path === "/api/people/person-a") return { person: person("person-a") };
      throw Object.assign(new Error("private server details"), { code: "REQUEST_FAILED", httpStatus: 503 });
    },
  });
  await fixture.mount({ personId: "person-a", directoryContext: false });
  await settle();

  const selection = lastWorkspace(fixture).selected;
  assert.equal(selection.person.displayName, "Person person-a");
  assert.equal(selection.history.read.status, "failed");
  assert.equal(selection.history.read.message, "Safe read message for effective-dated history.");
  assert.equal(fixture.readIssues[0].result.readError, "REQUEST_FAILED");
  assert.equal(fixture.readIssues[0].result.readStatus, 503);
  assert.doesNotMatch(selection.history.read.message, /private server details/);
});

test("page and route import failures render a safe fallback in the correct frame", async () => {
  const pageFailure = createFixture({ loadPage: async () => { throw new Error("chunk failure"); } });
  await pageFailure.mount();
  assert.deepEqual(pageFailure.pageRoot.replacements[0], [{
    message: "People could not be displayed. Refresh the page to try again.",
    kind: "error",
  }]);
  assert.equal(pageFailure.feedback.length, 0);

  const routeFailure = createFixture({ loadFeature: async () => { throw new Error("chunk failure"); } });
  await routeFailure.mount();
  assert.equal(routeFailure.target.replacements[0][0].message,
    "People could not be displayed. Refresh the page to try again.");
  assert.equal(routeFailure.target.replacements[0][0].kind, "error");
});

test("an invalidated route does not mount a late page chunk or perform reads", async () => {
  let resolvePage;
  const pendingPage = new Promise((resolve) => { resolvePage = resolve; });
  const fixture = createFixture({ loadPage: () => pendingPage });
  const pendingMount = fixture.mount({ personId: "person-a" });
  fixture.controls.current = false;
  resolvePage({ PeoplePage: fixture.PeoplePage });
  await pendingMount;

  assert.equal(fixture.mounted.length, 0);
  assert.equal(fixture.requests.length, 0);
});
