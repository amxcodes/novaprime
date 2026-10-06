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
