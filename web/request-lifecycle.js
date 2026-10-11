/** Owns one cancellable read lifetime for the currently rendered page. */
export function createRequestLifecycle() {
  let current;
  let generation = 0;

  return Object.freeze({
    begin(identityEpoch) {
      current?.controller.abort();
      const controller = new AbortController();
      const lifetime = Object.freeze({ generation: ++generation, identityEpoch, signal: controller.signal });
      current = { controller, lifetime };
      return lifetime;
    },
    isCurrent(lifetime, identityEpoch) {
      return current?.lifetime === lifetime && lifetime.identityEpoch === identityEpoch && !lifetime.signal.aborted;
    },
    cancel() {
      current?.controller.abort();
      current = undefined;
      generation += 1;
    },
  });
}

/** Attach page cancellation to reads only. Commands must finish and be reconciled. */
export function withPageReadSignal(options, lifetime) {
  const request = options || { method: "GET" };
  const isRead = (request.method || "GET").toUpperCase() === "GET";
  if (!isRead || !lifetime || request.signal) return request;
  return { ...request, signal: lifetime.signal };
}

/** Bound a read through JSON-body consumption and preserve route cancellation. */
export async function fetchJsonWithDeadline(fetcher, input, options, timeoutMs) {
  if (typeof fetcher !== "function") throw new TypeError("A fetch implementation is required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("A positive request deadline is required");

  const requestOptions = options || {};
  const sourceSignal = requestOptions.signal;
  const controller = new AbortController();
  let timedOut = false;
  const propagateAbort = () => {
    if (!controller.signal.aborted) controller.abort(sourceSignal?.reason);
  };
  if (sourceSignal?.aborted) propagateAbort();
  else sourceSignal?.addEventListener("abort", propagateAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    if (!controller.signal.aborted) controller.abort();
  }, timeoutMs);

  try {
    const response = await fetcher(input, { ...requestOptions, signal: controller.signal });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (timedOut) throw error;
      payload = {};
    }
    if (timedOut && !sourceSignal?.aborted) {
      const error = new Error("READ_TIMEOUT");
      error.code = "READ_TIMEOUT";
      throw error;
    }
    return { response, payload };
  } catch (error) {
    if (timedOut && !sourceSignal?.aborted) {
      const timeoutError = new Error("READ_TIMEOUT");
      timeoutError.code = "READ_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", propagateAbort);
  }
}

/** A write may finish after navigation, but only its original actor/page may update UI. */
export function isCommandIdentityCurrent(context, current) {
  return Boolean(context && current &&
    context.identityEpoch === current.identityEpoch &&
    (context.actorPersonId || null) === (current.actorPersonId || null));
}

export function isCommandContextCurrent(context, current) {
  return isCommandIdentityCurrent(context, current) &&
    (!context.lifetime || current.pageLifetimeCurrent === true) &&
    current.sourceConnected === true;
}
