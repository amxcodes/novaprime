const DEFAULT_DENIED_MESSAGE = "This history is not available under your current access.";
const DEFAULT_SUMMARY_FAILURE = "Could not load this person's current directory summary.";
const DEFAULT_HISTORY_FAILURE = "Could not load effective-dated history.";
const DEFAULT_PAGE_FAILURE = "Could not load older history.";
const DEFAULT_INVALID_PAGE = "The history response could not be verified. Retry the request.";

/**
 * Own one selected person's summary + cursor-page lifecycle. The host supplies
 * authenticated reads and route-lifetime checks; this adapter scopes results to
 * the selected id and invalidates every pending request when selection changes.
 */
export function createPeopleHistoryRoute({
  readPerson,
  readPage,
  isCurrent = () => true,
  onChange = () => {},
  isDenied = () => false,
  failureMessage = (_result, resource) => `Could not load ${resource}. Refresh the page to try again.`,
  deniedMessage = DEFAULT_DENIED_MESSAGE,
} = {}) {
  if (typeof readPerson !== "function") throw new TypeError("readPerson must be a function");
  if (typeof readPage !== "function") throw new TypeError("readPage must be a function");

  let generation = 0;
  let personId = null;
  let trustedDirectoryPerson = null;
  let state = null;

  function publish(next) {
    state = next;
    onChange(state);
    return state;
  }

  function matchesPerson(value, id) {
    return value && typeof value === "object" && typeof value.id === "string" && value.id === id
      ? value
      : null;
  }

  function asReadFailure(error) {
    return {
      readError: error?.code || "REQUEST_FAILED",
      readStatus: error?.httpStatus,
    };
  }

  async function safelyRead(read, ...args) {
    try {
      return await read(...args);
    } catch (error) {
      return asReadFailure(error);
    }
  }

  function safelyDenied(result, resource) {
    try {
      return isDenied(result, resource) === true;
    } catch {
      return false;
    }
  }

  function safeFailure(result, resource, fallback) {
    try {
      const message = failureMessage(result, resource);
      return typeof message === "string" && message.trim() ? message : fallback;
    } catch {
      return fallback;
    }
  }

  function selectionIsCurrent(requestGeneration, id) {
    return requestGeneration === generation && personId === id && isCurrent();
  }

  function denied(id) {
    trustedDirectoryPerson = null;
    return publish({
      personId: id,
      person: null,
      read: { status: "denied", message: deniedMessage },
    });
  }

  function pageFrom(result, id) {
    if (!matchesPerson(result?.person, id)) return null;
    const nextCursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
    const hasMore = result.hasMore === true;
    if (hasMore && !nextCursor) return null;
    return {
      person: { id, displayName: result.person.displayName ?? null },
      history: Array.isArray(result.history) ? result.history : [],
      limit: Number.isSafeInteger(result.limit) && result.limit > 0 ? result.limit : 50,
      hasMore,
      nextCursor,
    };
  }

  async function select(id, directoryPerson = null) {
    if (typeof id !== "string" || !id.trim()) return clear();

    const reusablePerson = matchesPerson(directoryPerson, id) ||
      (personId === id ? trustedDirectoryPerson : null);
    personId = id;
    trustedDirectoryPerson = reusablePerson;
    const requestGeneration = ++generation;
    publish({
      personId: id,
      person: reusablePerson,
      read: { status: "loading" },
    });

    const historyRead = safelyRead(readPage, id, null);
    const summaryRead = reusablePerson ? Promise.resolve({ person: reusablePerson }) : safelyRead(readPerson, id);
    const [summaryResult, pageResult] = await Promise.all([summaryRead, historyRead]);
    if (!selectionIsCurrent(requestGeneration, id)) return state;

    if (safelyDenied(summaryResult, "person summary") || safelyDenied(pageResult, "person history")) {
      return denied(id);
    }

    const person = matchesPerson(summaryResult?.person, id);
    if (summaryResult?.readError || !person) {
      const message = summaryResult?.readError
        ? safeFailure(summaryResult, "this person's current directory summary", DEFAULT_SUMMARY_FAILURE)
        : DEFAULT_SUMMARY_FAILURE;
      trustedDirectoryPerson = null;
      return publish({ personId: id, person: null, read: { status: "failed", message } });
    }

    trustedDirectoryPerson = person;
    if (pageResult?.readError) {
      return publish({
        personId: id,
        person,
        read: {
          status: "failed",
          message: safeFailure(pageResult, "effective-dated history", DEFAULT_HISTORY_FAILURE),
        },
      });
    }

    const firstPage = pageFrom(pageResult, id);
    if (!firstPage) {
      return publish({ personId: id, person, read: { status: "failed", message: DEFAULT_INVALID_PAGE } });
    }

    return publish({
      personId: id,
      person,
      read: { status: "ready", pages: [firstPage], loadingMore: false },
    });
  }

  async function loadMore(cursor) {
    const current = state;
    const read = current?.read;
    const tail = read?.status === "ready" ? read.pages[read.pages.length - 1] : null;
    if (!isCurrent() || !current || read?.status !== "ready" || read.loadingMore ||
        !tail?.hasMore || !cursor || cursor !== tail.nextCursor) return state;

    const requestGeneration = generation;
    const requestedPersonId = current.personId;
    const pages = read.pages;
    publish({
      ...current,
      read: { ...read, loadingMore: true, loadMoreError: undefined },
    });

    const result = await safelyRead(readPage, requestedPersonId, cursor);
    if (!selectionIsCurrent(requestGeneration, requestedPersonId) ||
        state?.read.status !== "ready" || state.personId !== requestedPersonId) return state;

    if (safelyDenied(result, "person history")) return denied(requestedPersonId);
    if (result?.readError) {
      return publish({
        ...state,
        read: {
          ...state.read,
          pages,
          loadingMore: false,
          loadMoreError: safeFailure(result, "older history", DEFAULT_PAGE_FAILURE),
        },
      });
    }

    const nextPage = pageFrom(result, requestedPersonId);
    if (!nextPage || (nextPage.hasMore && nextPage.nextCursor === cursor)) {
      return publish({
        ...state,
        read: { ...state.read, pages, loadingMore: false, loadMoreError: DEFAULT_INVALID_PAGE },
      });
    }

    return publish({
      ...state,
      read: { status: "ready", pages: [...pages, nextPage], loadingMore: false },
    });
  }

  function clear() {
    generation += 1;
    personId = null;
    trustedDirectoryPerson = null;
    return publish(null);
  }

  return Object.freeze({
    select,
    retry: () => personId ? select(personId, trustedDirectoryPerson) : Promise.resolve(state),
    loadMore,
    clear,
    getState: () => state,
  });
}
