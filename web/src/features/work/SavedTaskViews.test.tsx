import { describe, expect, it } from "bun:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsSavedTaskViews } from "./SettingsSavedTaskViews";
import { WorkSavedTaskViews } from "./WorkSavedTaskViews";
import { prepareSavedTaskViewRename, submitSavedTaskViewRename } from "./saved-task-view-rename";
import type {
  SavedTaskView,
  SettingsSavedTaskViewsProps,
  WorkSavedTaskViewsProps,
} from "./saved-task-views-contracts";

const myView: SavedTaskView = {
  id: "view-mine",
  name: "Overdue design work",
  collection: "mine",
  status: "in_progress",
  due: "overdue",
  search: "design",
  revision: 3,
  sortOrder: 0,
};

const visibleView: SavedTaskView = {
  ...myView,
  id: "view-visible",
  name: "Visible backlog",
  collection: "visible",
  status: "open",
  due: "any",
  search: "",
};

const workProps: WorkSavedTaskViewsProps = {
  views: [myView],
  collection: "mine",
  filters: { status: "all", due: "today", search: "design" },
  readStatus: "ready",
  availableCollections: ["mine"],
  atLimit: false,
  onOpen: () => {},
  onCreate: () => {},
  onUpdate: () => {},
  onRetry: () => {},
};

const settingsProps: SettingsSavedTaskViewsProps = {
  views: [myView],
  availableCollections: ["mine"],
  readStatus: "ready",
  onDelete: () => {},
  onRename: () => {},
  onRetry: () => {},
};

function renderWork(props: Partial<WorkSavedTaskViewsProps> = {}) {
  return renderToStaticMarkup(createElement(WorkSavedTaskViews, { ...workProps, ...props }));
}

function renderSettings(props: Partial<SettingsSavedTaskViewsProps> = {}) {
  return renderToStaticMarkup(createElement(SettingsSavedTaskViews, { ...settingsProps, ...props }));
}

describe("WorkSavedTaskViews", () => {
  it("shows a loading state and withholds stale action controls while saved views load", () => {
    const markup = renderWork({ readStatus: "loading" });

    expect(markup).toContain("Loading saved views");
    expect(markup).not.toContain("Open a saved view");
    expect(markup).not.toContain('role="combobox"');
    expect(markup).toContain("disabled=\"\"");
  });

  it("shows recoverable read failures while keeping the current task filters usable", () => {
    const markup = renderWork({ readStatus: "error" });

    expect(markup).toContain("Saved views could not be loaded.");
    expect(markup).toContain("Retry");
    expect(markup).toContain("Save current filters");
    expect(markup).not.toContain('role="combobox"');
    expect(markup).toMatch(/<input(?=[^>]*name="name")(?=[^>]*disabled="")[^>]*>/);
  });

  it("renders an empty available collection and respects the twelve-view limit", () => {
    const empty = renderWork({ views: [] });
    const limited = renderWork({ views: Array.from({ length: 12 }, (_, index) => ({ ...myView, id: "view-" + index })), atLimit: true });

    expect(empty).toContain("No saved views for this task list yet.");
    expect(empty).toContain("Save current filters");
    expect(empty).not.toContain('role="combobox"');
    expect(limited).toContain("Delete a saved view in Settings to make room.");
    expect(limited).toMatch(/<input(?=[^>]*name="name")(?=[^>]*disabled="")[^>]*>/);
  });

  it("shows only the current collection and keeps the selected view in the authored picker", () => {
    const markup = renderWork({ views: [myView, visibleView] });

    expect(markup).toContain("Overdue design work");
    expect(markup).not.toContain("Visible backlog");
    expect(markup).toMatch(/<select tabindex="-1" name="savedViewId">/);
    expect(markup).toMatch(/<option value="view-mine" selected="">Overdue design work<\/option>/);
    expect(markup).toMatch(/<button id="[^"]+"(?=[^>]*aria-haspopup="listbox")(?=[^>]*aria-expanded="false")/);
    expect(markup.match(/<select\b/g)).toHaveLength(1);
    expect(markup).toMatch(/data-testid="hidden-select-container"><label><select tabindex="-1" name="savedViewId">/);
    expect(markup).toContain("Open view");
    expect(markup).toContain("Update selected view");
    expect(markup).toContain("Save current view");
  });

  it("disables the selected-view picker while any saved-view action is pending", () => {
    const markup = renderWork({ pendingAction: "open" });

    expect(markup).toMatch(/<button id="[^"]+"(?=[^>]*disabled="")(?=[^>]*aria-haspopup="listbox")[^>]*>/);
    expect(markup).toContain("Opening…");
  });

  it("hides create and open controls when the collection is unavailable to this role", () => {
    const markup = renderWork({ availableCollections: [] });

    expect(markup).toContain("Saved views for this task list are unavailable with your current access.");
    expect(markup).not.toContain("Open a saved view");
    expect(markup).not.toContain("Save current filters");
  });

  it("renders a pending create action with a disabled control and loading semantics", () => {
    const markup = renderWork({ pendingAction: "create" });

    expect(markup).toContain("Saving…");
    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toMatch(/type="submit"[^>]*disabled=""/);
  });

  it("uses unique description IDs when both collection panels appear together", () => {
    const markup = renderToStaticMarkup(createElement(Fragment, null,
      createElement(WorkSavedTaskViews, { ...workProps, collection: "mine" }),
      createElement(WorkSavedTaskViews, { ...workProps, collection: "visible" }),
    ));
    const references = [...markup.matchAll(/<fieldset aria-describedby="([^"]+)"/g)].map((match) => match[1]);

    expect(references).toHaveLength(2);
    expect(new Set(references).size).toBe(2);
    for (const id of references) expect(markup).toContain('id="' + id + '"');
  });
});

describe("SettingsSavedTaskViews", () => {
  it("renders a loading state without showing an empty state", () => {
    const markup = renderSettings({ views: [], readStatus: "loading" });

    expect(markup).toMatch(/<h2[^>]*>Saved task views<\/h2>/);
    expect(markup).not.toContain("<h3");
    expect(markup).toContain("Loading saved task views");
    expect(markup).not.toContain("No saved task views yet.");
  });

  it("shows empty and retryable error states", () => {
    const empty = renderSettings({ views: [] });
    const failed = renderSettings({ readStatus: "error" });

    expect(empty).toContain("No saved task views yet. Save a filter from Work.");
    expect(failed).toContain("Saved task views could not be loaded.");
    expect(failed).toContain("Retry");
    expect(failed).not.toContain("Overdue design work");
    expect(failed).not.toContain('aria-label="Delete saved view Overdue design work"');
  });

  it("marks role-hidden views unavailable but keeps their delete action available", () => {
    const markup = renderSettings({ views: [myView, visibleView], availableCollections: ["mine"] });

    expect(markup).toContain("Overdue design work");
    expect(markup).toContain("Visible backlog");
    expect(markup).toContain("unavailable under your current role; you can still delete this filter");
    expect(markup).toContain('aria-label="Delete saved view Visible backlog"');
  });

  it("offers an inline, initially collapsed rename form prefilled with each saved name", () => {
    const markup = renderSettings({ views: [myView, visibleView] });

    expect(markup).toContain('aria-label="Rename saved view Overdue design work"');
    expect(markup).toContain('aria-label="Rename saved view Visible backlog"');
    expect(markup).toMatch(/<form[^>]*hidden=""[^>]*aria-label="Rename saved view Overdue design work"/);
    expect(markup).toMatch(/<input(?=[^>]*name="savedViewName")(?=[^>]*value="Overdue design work")/);
    expect(markup).toMatch(/<label[^>]*><span>Saved view name<\/span>/);
    expect(markup).toContain("Use a different name, up to 40 characters.");
  });

  it("shows a per-view pending rename state and disables other row actions", () => {
    const markup = renderSettings({ pendingAction: "rename", pendingRenameId: myView.id });

    expect(markup).toContain("Saving…");
    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Delete saved view Overdue design work")(?=[^>]*disabled="")[^>]*>/);
  });

  it("builds a trimmed rename while preserving the selected view's collection, filters, and revision", () => {
    expect(prepareSavedTaskViewRename(myView, "  Escalations  ")).toEqual({
      ...myView,
      name: "Escalations",
    });
  });

  it("rejects blank, unchanged, and over-40-character names without calling the host", async () => {
    const onRename = async () => { throw new Error("must not submit"); };

    expect(prepareSavedTaskViewRename(myView, "  ")).toBeNull();
    expect(prepareSavedTaskViewRename(myView, myView.name)).toBeNull();
    expect(prepareSavedTaskViewRename(myView, "x".repeat(41))).toBeNull();
    expect(prepareSavedTaskViewRename(myView, "🙂".repeat(40))?.name).toBe("🙂".repeat(40));
    expect(prepareSavedTaskViewRename(myView, "🙂".repeat(41))).toBeNull();
    expect(await submitSavedTaskViewRename(myView, "  ", onRename)).toBe("invalid");
    expect(await submitSavedTaskViewRename(myView, myView.name, onRename)).toBe("invalid");
    expect(await submitSavedTaskViewRename(myView, "x".repeat(41), onRename)).toBe("invalid");
  });

  it("submits only a valid changed name and preserves the selected filter values", async () => {
    const submitted: SavedTaskView[] = [];
    const outcome = await submitSavedTaskViewRename(myView, "  Escalations  ", (next) => { submitted.push(next); });

    expect(outcome).toBe("saved");
    expect(submitted).toEqual([{ ...myView, name: "Escalations" }]);
  });

  it("keeps host failures available to the inline error state", async () => {
    const error = new Error("save failed");
    await expect(submitSavedTaskViewRename(myView, "Escalations", async () => { throw error; })).rejects.toBe(error);
  });

  it("renders a pending delete action accessibly", () => {
    const markup = renderSettings({ pendingAction: "delete", pendingDeleteId: "view-mine" });

    expect(markup).toContain("Deleting…");
    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Deleting saved view Overdue design work")(?=[^>]*disabled="")[^>]*>/);
  });
});

describe("Saved task views responsive contract", () => {
  it("keeps controls touch-sized and collapses both layouts inside narrow containers", async () => {
    const workCss = await Bun.file(new URL("./WorkSavedTaskViews.module.css", import.meta.url)).text();
    const settingsCss = await Bun.file(new URL("./SettingsSavedTaskViews.module.css", import.meta.url)).text();

    expect(workCss).toContain("container-name: saved-task-work");
    expect(workCss).toContain("@container saved-task-work (max-width: 44rem)");
    expect(workCss).toContain("min-height: var(--nova-control-touch-target)");
    expect(settingsCss).toContain("container-name: saved-task-settings");
    expect(settingsCss).toContain("@container saved-task-settings (max-width: 40rem)");
    expect(settingsCss).toContain("min-height: var(--nova-control-touch-target)");
    expect(settingsCss).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(settingsCss).toContain(".renameForm { grid-template-columns: minmax(0, 1fr); }");
    expect(settingsCss).toContain(".renameActions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }");
  });
});
