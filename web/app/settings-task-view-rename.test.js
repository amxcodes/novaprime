import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renameSavedTaskViewFromSettings } from "./settings-task-view-rename.js";

const savedView = Object.freeze({
  id: "view-1",
  name: "Overdue design work",
  collection: "mine",
  status: "in_progress",
  due: "overdue",
  search: "design",
  revision: 7,
  sortOrder: 2,
  privateExtra: "must not reach the API",
});

function harness(overrides = {}) {
  const calls = { save: [], reload: [], messages: [], updates: 0 };
  const current = overrides.currentView ?? savedView;
  return {
    calls,
    input: {
      view: savedView,
      name: "  Escalations  ",
      personId: "person-1",
      identityEpoch: 12,
      isCurrent: () => true,
      getCurrentView: (id) => id === current?.id ? current : undefined,
      saveTaskView: async (payload, revision) => {
        calls.save.push({ payload, revision });
        return { id: savedView.id };
      },
      reloadTaskViews: async (personId, identityEpoch) => {
        calls.reload.push({ personId, identityEpoch });
        return true;
      },
      setMessage: (...message) => calls.messages.push(message),
      updateEditor: () => { calls.updates += 1; },
      formatError: (error) => `Safe ${error.code} message.`,
      ...overrides,
    },
  };
}

test("renames through the existing save contract with an allowlisted payload and selected revision", async () => {
  const { input, calls } = harness();

  expect(await renameSavedTaskViewFromSettings(input)).toBe(true);
  expect(calls.save).toEqual([{
    payload: {
      id: "view-1",
      name: "Escalations",
      collection: "mine",
      status: "in_progress",
      due: "overdue",
      search: "design",
    },
    revision: 7,
  }]);
  expect(calls.reload).toEqual([]);
  expect(calls.messages).toEqual([]);
  expect(calls.updates).toBe(1);
});

test("rejects blank, unchanged, or overlong names before issuing an API write", async () => {
  for (const name of ["  ", savedView.name, "x".repeat(41)]) {
    const { input, calls } = harness({ name });
    expect(await renameSavedTaskViewFromSettings(input)).toBe(false);
    expect(calls.save).toEqual([]);
    expect(calls.reload).toEqual([]);
    expect(calls.updates).toBe(0);
  }
});

test("reloads after revision conflicts and missing views, then reports only safe feedback", async () => {
  for (const code of ["TASK_VIEW_CONFLICT", "TASK_VIEW_NOT_FOUND"]) {
    const failure = Object.assign(new Error("raw server detail"), { code });
    const { input, calls } = harness({
      saveTaskView: async () => { throw failure; },
    });

    expect(await renameSavedTaskViewFromSettings(input)).toBe(false);
    expect(calls.reload).toEqual([{ personId: "person-1", identityEpoch: 12 }]);
    expect(calls.messages).toEqual([[`Safe ${code} message.`, "warning"]]);
    expect(calls.updates).toBe(1);
  }
});

test("refreshes a stale local revision without sending a possibly obsolete write", async () => {
  const { input, calls } = harness({ currentView: { ...savedView, revision: 8 } });

  expect(await renameSavedTaskViewFromSettings(input)).toBe(false);
  expect(calls.save).toEqual([]);
  expect(calls.reload).toEqual([{ personId: "person-1", identityEpoch: 12 }]);
  expect(calls.messages).toEqual([["That saved view changed or is no longer available. The list was refreshed.", "warning"]]);
  expect(calls.updates).toBe(1);
});

test("does not report or render a rename after the page or identity guard expires", async () => {
  const setup = harness();
  let guardCalls = 0;
  setup.input.isCurrent = () => ++guardCalls === 1;
  setup.input.saveTaskView = async (...args) => {
    setup.calls.save.push(args);
    return { id: savedView.id };
  };

  expect(await renameSavedTaskViewFromSettings(setup.input)).toBe(false);
  expect(setup.calls.save).toHaveLength(1);
  expect(setup.calls.messages).toEqual([]);
  expect(setup.calls.updates).toBe(0);
});

test("surfaces unexpected persistence failures to the component's recoverable error path", async () => {
  const failure = Object.assign(new Error("database unavailable"), { code: "INTERNAL_ERROR" });
  const { input, calls } = harness({
    saveTaskView: async () => { throw failure; },
  });

  await expect(renameSavedTaskViewFromSettings(input)).rejects.toBe(failure);
  expect(calls.reload).toEqual([]);
  expect(calls.messages).toEqual([]);
});

test("Settings connects the rename action to the guarded host adapter", async () => {
  const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

  expect(appSource).toMatch(/onRename:\s*\(view\)\s*=>\s*renameSavedTaskViewFromSettings\(view, target, generation, identityEpoch\)/);
  expect(appSource).toContain("isCurrent: () => isCurrentSavedTaskViewsEditor(target, generation, identityEpoch)");
  expect(appSource).toContain("getCurrentView: (viewId) => state.savedTaskViews.find((candidate) => candidate.id === viewId)");
  expect(appSource).toContain("saveTaskView,");
  expect(appSource).toContain("reloadTaskViews: loadSavedTaskViews");
});
