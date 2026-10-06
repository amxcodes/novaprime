const DEFAULT_PAGE_FAILURE = "People could not be displayed. Refresh the page to try again.";

/** A person URL only retains its directory pane while this document owns its history entry. */
export function isPeopleDirectoryContext(personId, historyState, activeSessionId) {
  if (!personId) return true;
  const workspace = historyState?.novaPeopleWorkspace;
  return workspace?.fromDirectory === true &&
    typeof activeSessionId === "string" &&
    workspace.sessionId === activeSessionId;
}

/**
 * Compose the People route from its existing page, feature, and route helpers.
 * The application host supplies authenticated reads, identity/lifetime checks,
 * navigation primitives, and the lifecycle-action provider.
 */
export function createPeoplePageRoute(host) {
  const requiredServices = [
    "getLocationHref",
    "getHistoryState",
    "getWorkspaceSessionId",
    "pushHistoryState",
    "setActiveView",
    "resetPopStateState",
    "navigatePersonHistory",
    "isCurrentPageRequest",
    "pageApi",
    "mountReactIsland",
    "showFeedback",
    "noticeElement",
    "readIssue",
    "createLifecycleActionProvider",
  ];
  for (const name of requiredServices) {
    if (typeof host?.[name] !== "function") {
      throw new TypeError(`People page route service ${name} must be a function`);
    }
  }

  const loadPage = host.loadPage || (() => import("../src/pages/people/PeoplePage.tsx"));
  const loadFeature = host.loadFeature || (() => import("../src/features/people/index.ts"));
  const loadDirectoryRoute = host.loadDirectoryRoute || (() => import("./people-directory-route.js"));
  const loadHistoryRoute = host.loadHistoryRoute || (() => import("./people-history-route.js"));
  const loadLifecycleHost = host.loadLifecycleHost || (() => import("./people-lifecycle-host.js"));

  return async function mountPeoplePage({ pageRoot, lifetime, personId, directoryContext }) {
    const isCurrent = () => host.isCurrentPageRequest(lifetime) && Boolean(pageRoot?.isConnected);
    if (!pageRoot || !isCurrent()) return null;

    let pageUi;
    try {
      pageUi = await loadPage();
    } catch {
      if (isCurrent()) {
        pageRoot.replaceChildren(host.noticeElement(DEFAULT_PAGE_FAILURE, "error"));
      }
      return null;
    }
    if (!isCurrent()) return null;

    host.mountReactIsland(pageRoot, pageUi.PeoplePage, { mode: directoryContext ? "directory" : "history" });
    host.showFeedback();
    const target = pageRoot.querySelector("#people-content");
    if (!target) return null;

    let peopleUi;
    let directoryRouteUi = null;
    try {
      [peopleUi, directoryRouteUi] = await Promise.all([
        loadFeature(),
        directoryContext ? loadDirectoryRoute() : Promise.resolve(null),
      ]);
    } catch {
      if (isCurrent() && target.isConnected) {
        target.replaceChildren(host.noticeElement(DEFAULT_PAGE_FAILURE, "error"));
      }
      return null;
    }
    if (!isCurrent() || !target.isConnected) return null;

    const { PeopleWorkspace } = peopleUi;
    const { createPeopleDirectoryRoute, peopleDirectoryPageUrl } = directoryRouteUi || {};
    const historyDeniedMessage = "This history is not available under your current access.";
    const readWithStatus = async (path, fallback) => {
      try {
        return await host.pageApi(path, lifetime);
      } catch (error) {
        return {
          ...fallback,
          readError: error?.code || "REQUEST_FAILED",
          readStatus: error?.httpStatus,
        };
      }
    };
    const readIsDenied = (result) => ["PERMISSION_DENIED", "PERSON_NOT_FOUND"].includes(result?.readError) ||
      result?.readStatus === 403 || result?.readStatus === 404;
    const readFailureMessage = (result, resource) => host.readIssue(result, resource)?.message ||
      `Could not load ${resource}. Refresh the page to try again.`;
    let directoryRoute = null;
    let historyRoute = null;
    let historySupportPromise = null;
    let lifecycleHostUi = null;
    let selectionGeneration = 0;
    let pendingHistoryPersonId = null;
    let pendingDirectoryPerson = null;
    let lifecycleTargetId = null;
    let lifecycleActionProvider = null;
    const lifecycleActionsFor = (person) => {
      const selected = historyRoute?.getState();
      if (!person || !selected || selected.personId !== person.id) return undefined;
      if (lifecycleTargetId !== person.id) {
        lifecycleTargetId = person.id;
        lifecycleActionProvider = host.createLifecycleActionProvider({
          lifecycleHostUi,
          requestedPersonId: person.id,
          lifetime,
          pageRoot,
        });
      }
      return lifecycleActionProvider?.(person);
    };
    const loadHistoryPage = async (id, cursor) => {
      const search = new URLSearchParams({ limit: "50" });
      if (cursor) search.set("cursor", cursor);
      return readWithStatus(
        "/api/people/" + encodeURIComponent(id) + "/history?" + search.toString(),
        { history: [] },
      );
    };
    const ensureHistoryRoute = () => {
      if (historyRoute) return Promise.resolve(historyRoute);
      if (historySupportPromise) return historySupportPromise;
      historySupportPromise = Promise.all([loadHistoryRoute(), loadLifecycleHost()]).then(([historyUi, lifecycleUi]) => {
        if (!isCurrent()) return null;
        lifecycleHostUi = lifecycleUi;
        historyRoute = historyUi.createPeopleHistoryRoute({
          readPerson: (id) => readWithStatus("/api/people/" + encodeURIComponent(id), { person: null }),
          readPage: loadHistoryPage,
          isCurrent,
          onChange: mountWorkspace,
          isDenied: readIsDenied,
          failureMessage: readFailureMessage,
          deniedMessage: historyDeniedMessage,
        });
        return historyRoute;
      }).catch((error) => {
        historySupportPromise = null;
        throw error;
      });
      return historySupportPromise;
    };
    const showHistoryLoadFailure = () => {
      if (isCurrent() && target.isConnected) {
        target.replaceChildren(host.noticeElement(DEFAULT_PAGE_FAILURE, "error"));
      }
    };
    const selectHistoryPerson = async (id, directoryPerson = null) => {
      const requestGeneration = ++selectionGeneration;
      pendingHistoryPersonId = id;
      pendingDirectoryPerson = directoryPerson;
      mountWorkspace();
      try {
        const route = await ensureHistoryRoute();
        if (!route || requestGeneration !== selectionGeneration || !isCurrent()) return;
        await route.select(id, directoryPerson);
        if (requestGeneration === selectionGeneration) {
          pendingHistoryPersonId = null;
          pendingDirectoryPerson = null;
        }
      } catch {
        if (requestGeneration === selectionGeneration) {
          pendingHistoryPersonId = null;
          pendingDirectoryPerson = null;
          showHistoryLoadFailure();
        }
      }
    };
    const writeWorkspaceSelection = (nextPersonId) => {
      const url = new URL("/", host.getLocationHref());
      url.searchParams.set("view", "people");
      if (nextPersonId) url.searchParams.set("person", nextPersonId);
      const currentHistoryState = host.getHistoryState();
      const safeHistoryState = currentHistoryState && typeof currentHistoryState === "object"
        ? currentHistoryState
        : {};
      host.pushHistoryState({
        ...safeHistoryState,
        novaPeopleWorkspace: {
          ...safeHistoryState.novaPeopleWorkspace,
          fromDirectory: true,
          sessionId: host.getWorkspaceSessionId(),
        },
      }, "", url);
      host.setActiveView("people");
    };
    const onBackToDirectory = () => {
      if (!directoryRoute) {
        selectionGeneration += 1;
        pendingHistoryPersonId = null;
        pendingDirectoryPerson = null;
        host.navigatePersonHistory(null);
        return;
      }
      selectionGeneration += 1;
      pendingHistoryPersonId = null;
      pendingDirectoryPerson = null;
      writeWorkspaceSelection(null);
      if (historyRoute) historyRoute.clear();
      else mountWorkspace();
    };
    const selectFromDirectory = (selectedPersonId) => {
      if (!directoryRoute || !selectedPersonId || !isCurrent()) return;
      writeWorkspaceSelection(selectedPersonId);
      const directoryRead = directoryRoute.getState();
      const directoryPerson = directoryRead.status === "ready"
        ? directoryRead.people.find((person) => person.id === selectedPersonId) || null
        : null;
      void selectHistoryPerson(selectedPersonId, directoryPerson);
    };
    const mountWorkspace = () => {
      if (!isCurrent() || !target.isConnected) return;
      const directoryRead = directoryRoute?.getState();
      const selected = historyRoute?.getState() || (pendingHistoryPersonId ? {
        personId: pendingHistoryPersonId,
        person: pendingDirectoryPerson,
        read: { status: "loading" },
      } : null);
      const directory = directoryRoute ? {
        read: directoryRead,
        onSearch: (query) => { void directoryRoute.search(query); },
        onLoadMore: (cursor) => { void directoryRoute.loadMore(cursor); },
        onSelectPerson: selectFromDirectory,
        onRetry: () => { void directoryRoute.retry(); },
      } : null;
      const person = selected && selected.person?.id === selected.personId ? selected.person : null;
      host.mountReactIsland(target, PeopleWorkspace, {
        directory,
        selected: selected ? {
          personId: selected.personId,
          person,
          history: {
            read: selected.read,
            onBack: onBackToDirectory,
            onRetry: () => { void historyRoute.retry(); },
            onLoadMore: (cursor) => { void historyRoute.loadMore(cursor); },
            lifecycleActions: lifecycleActionsFor(person),
          },
        } : null,
        onBackToDirectory,
      });
    };

    if (directoryContext) {
      directoryRoute = createPeopleDirectoryRoute({
        readPage: (query, cursor) => readWithStatus(peopleDirectoryPageUrl(query, cursor), { people: [] }),
        isCurrent,
        onChange: mountWorkspace,
        isDenied: readIsDenied,
        failureMessage: readFailureMessage,
        deniedMessage: "The people directory is not available under your current access.",
      });
    }

    const route = {
      handlePopState: () => {
        if (!isCurrent() || !directoryRoute) return false;
        const params = new URLSearchParams(new URL(host.getLocationHref()).search);
        if (params.get("view") !== "people") return false;
        host.setActiveView("people");
        host.resetPopStateState();
        const nextPersonId = params.get("person");
        const currentPersonId = pendingHistoryPersonId || historyRoute?.getState()?.personId || null;
        if (nextPersonId !== currentPersonId) {
          if (!nextPersonId) {
            selectionGeneration += 1;
            pendingHistoryPersonId = null;
            pendingDirectoryPerson = null;
            if (historyRoute) historyRoute.clear();
            else mountWorkspace();
          }
          else {
            const currentDirectory = directoryRoute.getState();
            const person = currentDirectory.status === "ready"
              ? currentDirectory.people.find((candidate) => candidate.id === nextPersonId) || null
              : null;
            void selectHistoryPerson(nextPersonId, person);
          }
        }
        return true;
      },
    };

    if (personId) void selectHistoryPerson(personId);
    else mountWorkspace();
    if (directoryRoute) void directoryRoute.start();
    return route;
  };
}
