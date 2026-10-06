/** Build the feature-owned, server-side People search/page request. */
export function peopleDirectoryPageUrl(query, cursor = null) {
  const params = new URLSearchParams({ limit: "25" });
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (normalizedQuery) params.set("q", normalizedQuery);
  if (typeof cursor === "string" && cursor) params.set("cursor", cursor);
  return `/api/people/directory?${params.toString()}`;
}

/**
 * Own the People route's query-bound page lifecycle. The application host
 * supplies authenticated transport and page-identity checks; this adapter
 * prevents stale search/continuation responses from mutating current state.
 */
export function createPeopleDirectoryRoute({
  readPage,
  isCurrent = () => true,
  onChange = () => {},
  isDenied = () => false,
  failureMessage = () => "The people directory could not load.",
  deniedMessage = "The people directory is not available under your current access.",
} = {}) {
  if (typeof readPage !== "function") throw new TypeError("readPage must be a function");

  let generation = 0;
  let query = "";
  let read = { status: "loading", query };

  const publish = (next) => {
    read = next;
    onChange(read);
  };

  const pageFailure = (result, resource) => isDenied(result)
    ? { status: "denied", message: deniedMessage }
    : { status: "failed", query, message: failureMessage(result, resource) };

  async function search(value) {
    query = typeof value === "string" ? value.trim() : "";
    const requestGeneration = ++generation;
    publish({ status: "loading", query });

    let result;
    try {
      result = await readPage(query, null);
    } catch (error) {
      result = { readError: error?.code || "REQUEST_FAILED", readStatus: error?.httpStatus };
    }
    if (!isCurrent() || requestGeneration !== generation) return read;

    if (result?.readError) {
      publish(pageFailure(result, "people visible in your current scope"));
      return read;
    }

    const people = Array.isArray(result?.people) ? result.people.filter((person) => person && typeof person.id === "string") : [];
    const nextCursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
    if (result?.hasMore === true && !nextCursor) {
      publish({ status: "failed", query, message: "The next people page could not be identified. Retry the search." });
      return read;
    }
    publish({
      status: "ready",
      query,
      people,
      limit: Number.isSafeInteger(result?.limit) && result.limit > 0 ? result.limit : 25,
      hasMore: result?.hasMore === true,
      nextCursor,
      loadingMore: false,
    });
    return read;
  }

  async function loadMore(cursor) {
    if (!isCurrent() || read.status !== "ready" || read.loadingMore ||
        !cursor || cursor !== read.nextCursor || !read.hasMore) return read;
    const requestGeneration = generation;
    const requestedQuery = read.query;
    const existingPeople = read.people;
    publish({ ...read, loadingMore: true, loadMoreError: undefined });

    let result;
    try {
      result = await readPage(requestedQuery, cursor);
    } catch (error) {
      result = { readError: error?.code || "REQUEST_FAILED", readStatus: error?.httpStatus };
    }
    if (!isCurrent() || requestGeneration !== generation || read.status !== "ready" ||
        read.query !== requestedQuery || read.nextCursor !== cursor) return read;

    if (result?.readError) {
      if (isDenied(result)) {
        publish({ status: "denied", message: deniedMessage });
      } else {
        publish({
          ...read,
          people: existingPeople,
          loadingMore: false,
          loadMoreError: failureMessage(result, "the next people page"),
        });
      }
      return read;
    }

    const seen = new Set(existingPeople.map((person) => person.id));
    const nextPeople = Array.isArray(result?.people) ? result.people : [];
    const nextCursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
    if (result?.hasMore === true && !nextCursor) {
      publish({
        ...read,
        people: existingPeople,
        loadingMore: false,
        loadMoreError: "The next people page could not be identified. Retry loading the page.",
      });
      return read;
    }
    publish({
      ...read,
      people: [...existingPeople, ...nextPeople.filter((person) => person && typeof person.id === "string" && !seen.has(person.id))],
      limit: Number.isSafeInteger(result?.limit) && result.limit > 0 ? result.limit : read.limit,
      hasMore: result?.hasMore === true,
      nextCursor,
      loadingMore: false,
      loadMoreError: undefined,
    });
    return read;
  }

  return {
    start: () => search(query),
    search,
    retry: () => search(query),
    loadMore,
    getState: () => read,
  };
}
