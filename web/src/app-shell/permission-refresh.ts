export interface PermissionRefreshIdentity {
  identityEpoch: number;
  actorPersonId: string;
}

/** Refresh grant-derived UI after a tab resumes, without polling while it stays active. */
export function installPermissionRefreshOnResume(options: {
  documentRef: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  windowRef: Pick<Window, "addEventListener" | "removeEventListener">;
  readIdentity: () => PermissionRefreshIdentity | null;
  refresh: (identity: PermissionRefreshIdentity) => Promise<unknown>;
  now?: () => number;
  minimumIntervalMs?: number;
}): () => void {
  const now = options.now || Date.now;
  const minimumIntervalMs = options.minimumIntervalMs ?? 30_000;
  let lastIdentityKey = "";
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  let inFlight: { identityKey: string; promise: Promise<unknown> } | null = null;

  const refreshIfVisible = () => {
    if (options.documentRef.visibilityState !== "visible") return;
    const identity = options.readIdentity();
    if (!identity) return;
    const identityKey = `${identity.identityEpoch}:${identity.actorPersonId}`;
    if (inFlight?.identityKey === identityKey) return inFlight.promise;
    const startedAt = now();
    if (identityKey === lastIdentityKey && startedAt - lastRefreshAt < minimumIntervalMs) return;

    lastIdentityKey = identityKey;
    lastRefreshAt = startedAt;
    const promise = Promise.resolve(options.refresh(identity)).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { identityKey, promise };
    return promise;
  };

  const onVisibilityChange = () => {
    if (options.documentRef.visibilityState === "visible") void refreshIfVisible();
  };
  options.documentRef.addEventListener("visibilitychange", onVisibilityChange);
  options.windowRef.addEventListener("pageshow", refreshIfVisible);

  return () => {
    options.documentRef.removeEventListener("visibilitychange", onVisibilityChange);
    options.windowRef.removeEventListener("pageshow", refreshIfVisible);
  };
}
