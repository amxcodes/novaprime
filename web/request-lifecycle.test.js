import { expect, test } from "bun:test";
import {
  createRequestLifecycle,
  isCommandContextCurrent,
  isCommandIdentityCurrent,
  withPageReadSignal,
} from "./request-lifecycle.js";

test("starting a new page lifetime aborts and invalidates the previous read lifetime", () => {
  const lifecycle = createRequestLifecycle();
  const first = lifecycle.begin(4);
  const second = lifecycle.begin(4);

  expect(first.signal.aborted).toBe(true);
  expect(lifecycle.isCurrent(first, 4)).toBe(false);
  expect(lifecycle.isCurrent(second, 4)).toBe(true);
});

test("identity changes and explicit cancellation invalidate page reads", () => {
  const lifecycle = createRequestLifecycle();
  const lifetime = lifecycle.begin(4);

  expect(lifecycle.isCurrent(lifetime, 5)).toBe(false);
  lifecycle.cancel();
  expect(lifetime.signal.aborted).toBe(true);
  expect(lifecycle.isCurrent(lifetime, 4)).toBe(false);
});

test("page signals are attached to GET requests but never to commands", () => {
  const lifecycle = createRequestLifecycle();
  const lifetime = lifecycle.begin(1);
  const read = withPageReadSignal({ credentials: "include" }, lifetime);
  const command = { method: "POST", body: "{}" };

  expect(read.signal).toBe(lifetime.signal);
  expect(withPageReadSignal(command, lifetime)).toBe(command);
  expect(withPageReadSignal({ method: "GET", signal: "explicit" }, lifetime).signal).toBe("explicit");
});

test("a command may update only the same actor on the same live page", () => {
  const context = {
    identityEpoch: 4,
    actorPersonId: "person-a",
    lifetime: { generation: 2 },
  };
  const current = {
    identityEpoch: 4,
    actorPersonId: "person-a",
    pageLifetimeCurrent: true,
    sourceConnected: true,
  };

  expect(isCommandContextCurrent(context, current)).toBe(true);
  expect(isCommandContextCurrent(context, { ...current, pageLifetimeCurrent: false })).toBe(false);
  expect(isCommandContextCurrent(context, { ...current, sourceConnected: false })).toBe(false);
  expect(isCommandIdentityCurrent(context, { ...current, actorPersonId: "person-b" })).toBe(false);
  expect(isCommandIdentityCurrent(context, { ...current, identityEpoch: 5 })).toBe(false);
});

test("commands without a page lifetime still require the same identity and connected source", () => {
  const context = { identityEpoch: 1, actorPersonId: null, source: {} };

  expect(isCommandContextCurrent(context, {
    identityEpoch: 1,
    actorPersonId: null,
    pageLifetimeCurrent: false,
    sourceConnected: true,
  })).toBe(true);
  expect(isCommandContextCurrent(context, {
    identityEpoch: 1,
    actorPersonId: null,
    pageLifetimeCurrent: true,
    sourceConnected: false,
  })).toBe(false);
});
