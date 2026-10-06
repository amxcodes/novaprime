import type { OperationsPeoplePage, OperationsPeopleReadState, OperationsPerson } from "./contracts";

export interface OperationsPeoplePageResult {
  people?: ReadonlyArray<OperationsPerson>;
  query?: string;
  cursor?: string | null;
  limit?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  readError?: string;
  readStatus?: number;
}

export interface OperationsPeopleReportControllerOptions {
  readPage: (query: string, cursor: string | null) => Promise<OperationsPeoplePageResult>;
  isCurrent?: () => boolean;
  onChange?: (read: OperationsPeopleReadState) => void;
  isDenied?: (result: OperationsPeoplePageResult) => boolean;
  failureMessage?: (result: OperationsPeoplePageResult) => string;
  deniedMessage?: string;
}

/** Own the Operations report's search and bounded, server-cursor page lifecycle. */
export function createOperationsPeopleReportController({
  readPage,
  isCurrent = () => true,
  onChange = () => {},
  isDenied = (result) => result.readError === "PERMISSION_DENIED",
  failureMessage = () => "The people report could not load. Retry the search.",
  deniedMessage = "You do not have permission to view people in this scope.",
}: OperationsPeopleReportControllerOptions) {
  let generation = 0;
  let query = "";
  let cursors: Array<string | null> = [null];
  let read: OperationsPeopleReadState = { status: "loading", query };
  let pendingPage: { direction: "next" | "previous"; cursor: string } | null = null;

  const publish = (next: OperationsPeopleReadState) => {
    read = next;
    onChange(read);
  };

  const resultError = (result: OperationsPeoplePageResult) => {
    if (isDenied(result)) {
      pendingPage = null;
      publish({ status: "denied", message: deniedMessage });
      return true;
    }
    return false;
  };

  const projectPage = (result: OperationsPeoplePageResult, requestedCursor: string | null): OperationsPeoplePage | null => {
    const people = Array.isArray(result.people)
      ? result.people.filter((person): person is OperationsPerson => Boolean(person && typeof person.id === "string"))
      : [];
    const nextCursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
    if (result.hasMore === true && !nextCursor) return null;
    return {
      people,
      query,
      cursor: requestedCursor,
      limit: Number.isSafeInteger(result.limit) && Number(result.limit) > 0 ? Number(result.limit) : 25,
      hasMore: result.hasMore === true,
      nextCursor: result.hasMore === true ? nextCursor : null,
      hasPrevious: cursors.length > 1,
    };
  };

  async function search(value: string) {
    query = typeof value === "string" ? value.trim() : "";
    cursors = [null];
    pendingPage = null;
    const requestGeneration = ++generation;
    publish({ status: "loading", query });

    let result: OperationsPeoplePageResult;
    try {
      result = await readPage(query, null);
    } catch (error) {
      result = { readError: (error as { code?: string } | undefined)?.code || "REQUEST_FAILED" };
    }
    if (!isCurrent() || requestGeneration !== generation) return read;
    if (result.readError) {
      if (!resultError(result)) publish({ status: "error", query, message: failureMessage(result) });
      return read;
    }
    const data = projectPage(result, null);
    if (!data) {
      publish({ status: "error", query, message: "The next people page could not be identified. Retry the search." });
      return read;
    }
    publish({ status: "ready", data, loadingPage: false });
    return read;
  }

  async function navigatePage(direction: "next" | "previous") {
    if (!isCurrent() || read.status !== "ready" || read.loadingPage) return read;
    const index = cursors.length - 1;
    const cursor = direction === "next"
      ? (read.data.hasMore ? read.data.nextCursor : null)
      : (index > 0 ? cursors[index - 1] : null);
    if (cursor === null || cursor === undefined) return read;

    const requestGeneration = generation;
    const requestedQuery = query;
    pendingPage = { direction, cursor };
    publish({ ...read, loadingPage: true, pageError: undefined });

    let result: OperationsPeoplePageResult;
    try {
      result = await readPage(requestedQuery, cursor);
    } catch (error) {
      result = { readError: (error as { code?: string } | undefined)?.code || "REQUEST_FAILED" };
    }
    if (!isCurrent() || requestGeneration !== generation || read.status !== "ready" ||
        read.data.query !== requestedQuery || pendingPage?.cursor !== cursor || pendingPage.direction !== direction) return read;

    if (result.readError) {
      if (!resultError(result)) {
        publish({ ...read, loadingPage: false, pageError: failureMessage(result) });
      }
      return read;
    }
    const data = projectPage(result, cursor);
    if (!data) {
      publish({ ...read, loadingPage: false, pageError: "The next people page could not be identified. Retry loading this page." });
      return read;
    }

    if (direction === "next") cursors = [...cursors, cursor];
    else cursors = cursors.slice(0, -1);
    pendingPage = null;
    data.hasPrevious = cursors.length > 1;
    publish({ status: "ready", data, loadingPage: false });
    return read;
  }

  return {
    start: () => search(query),
    search,
    retry: () => pendingPage ? navigatePage(pendingPage.direction) : search(query),
    next: (cursor?: string) => {
      if (cursor && (read.status !== "ready" || read.data.nextCursor !== cursor)) return Promise.resolve(read);
      return navigatePage("next");
    },
    previous: () => navigatePage("previous"),
    getState: () => read,
  };
}
