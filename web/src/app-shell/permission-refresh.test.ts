import { describe, expect, it } from "bun:test";
import { installPermissionRefreshOnResume, type PermissionRefreshIdentity } from "./permission-refresh";

class EventSource {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (typeof listener !== "function") return;
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener as (event: Event) => void);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (typeof listener === "function") this.listeners.get(type)?.delete(listener as (event: Event) => void);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) || []) listener(new Event(type));
  }
}

describe("permission refresh on resume", () => {
  it("refreshes when the browser tab becomes visible and applies a cooldown", async () => {
    const documentRef = Object.assign(new EventSource(), { visibilityState: "hidden" as DocumentVisibilityState });
    const windowRef = new EventSource();
    let identity: PermissionRefreshIdentity | null = { identityEpoch: 2, actorPersonId: "person-1" };
    let now = 10_000;
    const refreshed: PermissionRefreshIdentity[] = [];
    const dispose = installPermissionRefreshOnResume({
      documentRef: documentRef as unknown as Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
      windowRef: windowRef as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
      readIdentity: () => identity,
      refresh: async (current) => { refreshed.push(current); },
      now: () => now,
      minimumIntervalMs: 30_000,
    });

    documentRef.dispatch("visibilitychange");
    expect(refreshed).toHaveLength(0);
    documentRef.visibilityState = "visible";
    documentRef.dispatch("visibilitychange");
    await Promise.resolve();
    windowRef.dispatch("pageshow");
    expect(refreshed).toEqual([{ identityEpoch: 2, actorPersonId: "person-1" }]);

    now += 30_001;
    windowRef.dispatch("pageshow");
    await Promise.resolve();
    expect(refreshed).toHaveLength(2);
    dispose();
    now += 30_001;
    windowRef.dispatch("pageshow");
    expect(refreshed).toHaveLength(2);
  });

  it("refreshes a changed actor immediately even inside the previous actor's cooldown", () => {
    const documentRef = Object.assign(new EventSource(), { visibilityState: "visible" as DocumentVisibilityState });
    const windowRef = new EventSource();
    let identity: PermissionRefreshIdentity = { identityEpoch: 3, actorPersonId: "person-1" };
    const refreshed: string[] = [];
    installPermissionRefreshOnResume({
      documentRef: documentRef as unknown as Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
      windowRef: windowRef as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
      readIdentity: () => identity,
      refresh: async (current) => { refreshed.push(current.actorPersonId); },
      now: () => 10_000,
    });

    windowRef.dispatch("pageshow");
    identity = { identityEpoch: 4, actorPersonId: "person-2" };
    documentRef.dispatch("visibilitychange");
    expect(refreshed).toEqual(["person-1", "person-2"]);
  });
});
