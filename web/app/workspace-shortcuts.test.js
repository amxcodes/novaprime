import { afterEach, beforeEach, expect, test } from "bun:test";
import { createWorkspaceShortcutPanel } from "./workspace-shortcuts.js";

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.className = "";
    this._text = "";
  }

  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
}

function findAll(root, tagName) {
  return [
    ...(root.tagName === tagName ? [root] : []),
    ...root.children.flatMap((child) => findAll(child, tagName)),
  ];
}

const priorDocument = globalThis.document;
beforeEach(() => { globalThis.document = { createElement: (tagName) => new TestElement(tagName) }; });
afterEach(() => {
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
});

test("workspace shortcuts render supplied authorized destinations as safe, labelled route buttons", () => {
  const panel = createWorkspaceShortcutPanel([
    { view: "today", label: "My Day", summary: "Same page." },
    { view: "work", label: "Work <img>", summary: "Tasks in scope." },
    { view: "people", label: "People", summary: "Directory in scope." },
  ]);
  const buttons = findAll(panel, "button");
  expect(panel.tagName).toBe("aside");
  expect(panel.attributes["aria-labelledby"]).toBe("my-day-shortcuts-heading");
  expect(buttons.map((button) => button.dataset.nav)).toEqual(["work", "people"]);
  expect(buttons[0].textContent).toBe("Work <img>Tasks in scope.");
});

test("workspace shortcuts disappear when no other route is available", () => {
  expect(createWorkspaceShortcutPanel([{ view: "today", label: "My Day", summary: "Same page." }])).toBeNull();
  expect(createWorkspaceShortcutPanel([])).toBeNull();
});
