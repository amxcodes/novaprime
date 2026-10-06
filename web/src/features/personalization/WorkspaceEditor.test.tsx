import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorkspaceEditor,
  type WorkspaceEditorProps,
  workspaceHomeDestinationOptions,
  workspaceHomePreferenceValue,
} from "./WorkspaceEditor";

const baseProps: WorkspaceEditorProps = {
  destinations: [
    { id: "today", label: "My Day", group: "Core" },
    { id: "people", label: "People", group: "Manage" },
  ],
  homeView: "today",
  pinnedDestinationIds: ["today"],
  modules: [
    { id: "attendance", label: "Attendance", enabled: true },
    { id: "leave", label: "Leave", enabled: false },
    { id: "assignments", label: "Assignments", enabled: true },
  ],
  readStatus: "ready",
  writable: true,
  saveStatus: "idle",
  onHomeViewChange: () => {},
  onPinChange: () => {},
  onMoveDestination: () => {},
  onModuleChange: () => {},
  onMoveModule: () => {},
  onReset: () => {},
  onReload: () => {},
};

function render(props: Partial<WorkspaceEditorProps> = {}) {
  return renderToStaticMarkup(createElement(WorkspaceEditor, { ...baseProps, ...props }));
}

describe("WorkspaceEditor", () => {
  it("renders only the authorized destinations and modules supplied by its host", () => {
    const markup = render();

    expect(markup).toContain("People");
    expect(markup).toContain("Attendance");
    expect(markup).not.toContain("Payroll");
    expect(markup).not.toContain("Credentials");
  });

  it("keeps an unavailable stored home view unchanged while distinguishing it from automatic selection", () => {
    const markup = render({ homeView: "restricted-destination" });

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('value="Saved page unavailable to this role"');
    expect(markup).toContain("Your saved page is unavailable to this role.");
    expect(markup).not.toContain("restricted-destination</option>");
    expect(markup).not.toContain("<select");
  });

  it("keeps automatic and authorized destinations while making the saved-unavailable entry non-selectable", () => {
    expect(workspaceHomeDestinationOptions(baseProps.destinations, true)).toEqual([
      { value: "auto", label: "Use NOVA’s best available page" },
      { value: "unavailable", label: "Saved page unavailable to this role", disabled: true },
      { value: "today", label: "My Day" },
      { value: "people", label: "People" },
    ]);
    expect(workspaceHomeDestinationOptions(baseProps.destinations, false)).not.toContainEqual(
      expect.objectContaining({ value: "unavailable" }),
    );
    expect(workspaceHomePreferenceValue("unavailable")).toBeNull();
    expect(workspaceHomePreferenceValue("")).toBeNull();
    expect(workspaceHomePreferenceValue("auto")).toBe("auto");
    expect(workspaceHomePreferenceValue("people")).toBe("people");
  });

  it("does not count role-hidden stored pins against the visible pin limit", () => {
    const markup = render({
      pinnedDestinationIds: ["today", "restricted-a", "restricted-b", "restricted-c"],
    });

    expect(markup).toContain("1 of 4 pinned");
    expect(markup).not.toMatch(/<input(?=[^>]*id="[^"]+-pin-people")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).not.toMatch(/<input(?=[^>]*id="[^"]+-pin-today")(?=[^>]*disabled="")[^>]*>/);
  });

  it("lets an actor pin available destinations when all stored pins are hidden by the current role", () => {
    const markup = render({
      pinnedDestinationIds: ["restricted-a", "restricted-b", "restricted-c", "restricted-d"],
    });

    expect(markup).toContain("0 of 4 pinned");
    expect(markup).not.toMatch(/<input(?=[^>]*id="[^"]+-pin-today")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).not.toMatch(/<input(?=[^>]*id="[^"]+-pin-people")(?=[^>]*disabled="")[^>]*>/);
  });

  it("provides keyboard-operable controls and prevents reordering hidden modules", () => {
    const markup = render();

    expect(markup).toContain("type=\"checkbox\"");
    expect(markup).toContain("aria-label=\"Move My Day up\"");
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Move Leave up")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Move Leave down")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toContain("Changes save automatically.");
  });

  it("exposes read-only and save-error states accessibly", () => {
    const markup = render({ writable: false, saveStatus: "error", error: "Workspace save failed." });

    expect(markup).toContain("Workspace settings are read-only.");
    expect(markup).toContain("role=\"alert\"");
    expect(markup).toContain("Workspace save failed.");
    expect(markup).toMatch(/<input(?=[^>]*id="[^"]+-home")(?=[^>]*role="combobox")(?=[^>]*disabled="")[^>]*>/);
  });

  it("locks every workspace mutation during a shared preference conflict", () => {
    const markup = render({
      blockedByConflict: true,
      saveStatus: "error",
      error: "Preference revision conflict.",
      onRetry: () => {},
    });

    expect(markup).toContain("Preferences changed elsewhere.");
    expect(markup).toContain("Resolve the saved preference conflict in Appearance before editing these settings.");
    expect(markup).toMatch(/<input(?=[^>]*id="[^"]+-home")(?=[^>]*role="combobox")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<input(?=[^>]*id="[^"]+-pin-people")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<input(?=[^>]*id="[^"]+-module-attendance")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Move People up")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Move Attendance down")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<button(?=[^>]*disabled="")[^>]*><span>Reset workspace<\/span><\/button>/);
    expect(markup).not.toContain("Try again");
    expect(markup).not.toContain("Preference revision conflict.");
  });

  it("keeps controls editable when conflict blocking is omitted or false", () => {
    for (const props of [{}, { blockedByConflict: false }]) {
      const markup = render({ ...props, saveStatus: "error", onRetry: () => {} });

      expect(markup).not.toContain("Preferences changed elsewhere.");
      expect(markup).not.toContain("Resolve the saved preference conflict");
      expect(markup).not.toMatch(/<input(?=[^>]*id="[^"]+-home")(?=[^>]*role="combobox")(?=[^>]*disabled="")[^>]*>/);
      expect(markup).not.toMatch(/<input(?=[^>]*id="[^"]+-pin-people")(?=[^>]*disabled="")[^>]*>/);
      expect(markup).not.toMatch(/<input(?=[^>]*id="[^"]+-module-attendance")(?=[^>]*disabled="")[^>]*>/);
      expect(markup).not.toMatch(/<button(?=[^>]*aria-label="Move People up")(?=[^>]*disabled="")[^>]*>/);
      expect(markup).not.toMatch(/<button(?=[^>]*disabled="")[^>]*><span>Reset workspace<\/span><\/button>/);
      expect(markup).toContain("Try again");
    }
  });
});
