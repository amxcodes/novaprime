const assert = require("node:assert/strict");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const {
  calculateSearchableSelectPopupGeometry,
  filterSearchableSelectOptions,
  findSearchableSelectActiveIndex,
  findSearchableSelectBoundaryIndex,
  getSearchableSelectAriaState,
  getSearchableSelectOptionId,
  isSearchableSelectPointerOutside,
  isSearchableSelectTouchScroll,
  isSearchableSelectOptionSelectable,
  isCurrentSearchableSelectRequest,
  resolveSearchableSelectOptions,
  shouldCommitSearchableSelectSelection,
  shouldUseSearchableSelectBoundaryNavigation,
  stepSearchableSelectActiveIndex,
} = require("./searchable-select-model.ts");

const options = [
  { value: "one", label: "Prepare report", description: "Client delivery" },
  { value: "two", label: "Review request", description: "Internal" },
  { value: "three", label: "Close project" },
];

test("filters by visible labels and descriptions and keeps keyboard indices bounded", () => {
  assert.deepEqual(filterSearchableSelectOptions(options, " DELIVERY ").map((option) => option.value), ["one"]);
  assert.deepEqual(filterSearchableSelectOptions(options, "review").map((option) => option.value), ["two"]);
  assert.equal(findSearchableSelectActiveIndex(options, "two"), 1);
  assert.equal(findSearchableSelectActiveIndex(options, "missing"), 0);
  assert.equal(stepSearchableSelectActiveIndex(0, options.length, "next"), 1);
  assert.equal(stepSearchableSelectActiveIndex(options.length, options.length, "next"), 2);
  assert.equal(stepSearchableSelectActiveIndex(0, options.length, "previous"), 0);
  assert.equal(stepSearchableSelectActiveIndex(2, 0, "previous"), -1);
});

test("remote mode trusts the server result set while local mode keeps its existing label filtering", () => {
  const serverResults = [
    { value: "one", label: "Server-ranked result" },
    { value: "two", label: "Another server result" },
  ];
  assert.equal(resolveSearchableSelectOptions(serverResults, "no local match", "remote"), serverResults);
  assert.deepEqual(resolveSearchableSelectOptions(options, "review").map((option) => option.value), ["two"]);
});

test("remote responses are current only while both request identity and query match", () => {
  assert.equal(isCurrentSearchableSelectRequest(4, 4, "Ada", "Ada"), true);
  assert.equal(isCurrentSearchableSelectRequest(5, 4, "Ada", "Ada"), false);
  assert.equal(isCurrentSearchableSelectRequest(4, 4, "Grace", "Ada"), false);
});

test("keyboard movement skips disabled choices without making them selectable", () => {
  const disabledOptions = [false, true, false];
  assert.equal(stepSearchableSelectActiveIndex(0, 3, "next", disabledOptions), 2);
  assert.equal(stepSearchableSelectActiveIndex(2, 3, "previous", disabledOptions), 0);
  assert.equal(stepSearchableSelectActiveIndex(1, 3, "next", disabledOptions), 2);
  assert.equal(isSearchableSelectOptionSelectable({ value: "unavailable", label: "Unavailable", disabled: true }), false);
  assert.equal(isSearchableSelectOptionSelectable({ value: "today", label: "My Day" }), true);
});

test("opening, boundary navigation, and arrow movement keep the active choice enabled", () => {
  const choices = [
    { value: "blocked-first", label: "Unavailable first", disabled: true },
    { value: "ready", label: "Ready" },
    { value: "blocked-last", label: "Unavailable last", disabled: true },
  ];
  assert.equal(findSearchableSelectActiveIndex(choices, "blocked-first"), 1);
  assert.equal(findSearchableSelectActiveIndex(choices, "ready"), 1);
  assert.equal(findSearchableSelectBoundaryIndex(choices, "first"), 1);
  assert.equal(findSearchableSelectBoundaryIndex(choices, "last"), 1);
  assert.equal(shouldUseSearchableSelectBoundaryNavigation("Home", ""), true);
  assert.equal(shouldUseSearchableSelectBoundaryNavigation("End", ""), true);
  assert.equal(shouldUseSearchableSelectBoundaryNavigation("Home", "review"), false);
  assert.equal(shouldUseSearchableSelectBoundaryNavigation("End", "review"), false);
  assert.equal(shouldUseSearchableSelectBoundaryNavigation("Home", "", true), false);
  assert.equal(shouldUseSearchableSelectBoundaryNavigation("End", "", true), false);
  assert.equal(stepSearchableSelectActiveIndex(-1, choices.length, "next", [true, false, true]), 1);
  assert.equal(stepSearchableSelectActiveIndex(-1, choices.length, "previous", [true, false, true]), 1);
  assert.equal(findSearchableSelectActiveIndex(choices.map((choice) => ({ ...choice, disabled: true })), ""), -1);
  assert.equal(stepSearchableSelectActiveIndex(0, 2, "previous", [true, true]), -1);
});

test("ARIA active descendant is omitted when no enabled option is active", () => {
  assert.deepEqual(getSearchableSelectAriaState("items", 2, -1, true), { controls: "items" });
});

test("outside pointer detection includes both the field and its portaled popup", () => {
  const controlTarget = {};
  const popupTarget = {};
  const outsideTarget = {};
  const control = { contains: (target) => target === controlTarget };
  const popup = { contains: (target) => target === popupTarget };

  assert.equal(isSearchableSelectPointerOutside(controlTarget, control, popup), false);
  assert.equal(isSearchableSelectPointerOutside(popupTarget, control, popup), false);
  assert.equal(isSearchableSelectPointerOutside(outsideTarget, control, popup), true);
  assert.equal(isSearchableSelectPointerOutside(null, control, popup), false);
});

test("Enter commits a choice only after input-method composition has finished", () => {
  assert.equal(shouldCommitSearchableSelectSelection("Enter", true, 13), false);
  assert.equal(shouldCommitSearchableSelectSelection("Enter", false, 229), false);
  assert.equal(shouldCommitSearchableSelectSelection("Enter", false, 13), true);
  assert.equal(shouldCommitSearchableSelectSelection("ArrowDown", false, 40), false);
});

test("Arrow navigation selects the first enabled result and Enter can commit that exact option", () => {
  const choices = [
    { value: "closed", label: "Closed", disabled: true },
    { value: "open", label: "Open" },
  ];
  const index = stepSearchableSelectActiveIndex(-1, choices.length, "next", choices.map((choice) => choice.disabled));
  const active = choices[index];

  assert.equal(active.value, "open");
  assert.equal(isSearchableSelectOptionSelectable(active), true);
  assert.equal(shouldCommitSearchableSelectSelection("Enter", false, 13), true);
});

test("recognizes a touch scroll after a small movement threshold", () => {
  assert.equal(isSearchableSelectTouchScroll({ x: 20, y: 40 }, { x: 24, y: 44 }), false);
  assert.equal(isSearchableSelectTouchScroll({ x: 20, y: 40 }, { x: 20, y: 48 }), true);
  assert.equal(isSearchableSelectTouchScroll({ x: 20, y: 40 }, { x: 12, y: 40 }), true);
});

test("places the popup above an input when the mobile keyboard reduces visible space below", () => {
  const geometry = calculateSearchableSelectPopupGeometry(
    { top: 380, bottom: 428, left: 20, width: 280 },
    { top: 0, bottom: 520, left: 0, right: 320 },
  );
  assert.equal(geometry.placement, "above");
  assert.equal(geometry.left, 20);
  assert.equal(geometry.width, 280);
  assert.ok(geometry.top >= 8);
  assert.ok(geometry.top + geometry.maxHeight <= 512);
});

test("clamps a wide anchor to a narrow visible tablet viewport", () => {
  const geometry = calculateSearchableSelectPopupGeometry(
    { top: 90, bottom: 138, left: 180, width: 360 },
    { top: 0, bottom: 800, left: 0, right: 360 },
  );
  assert.equal(geometry.placement, "below");
  assert.equal(geometry.width, 344);
  assert.equal(geometry.left, 8);
  assert.ok(geometry.top + geometry.maxHeight <= 792);
});

test("never places a popup outside a very short or narrow visual viewport", () => {
  const geometry = calculateSearchableSelectPopupGeometry(
    { top: 10, bottom: 50, left: -20, width: 240 },
    { top: 0, bottom: 64, left: 0, right: 80 },
    304,
    8,
    8,
  );
  assert.equal(geometry.width, 64);
  assert.equal(geometry.left, 8);
  assert.ok(geometry.top >= 8);
  assert.ok(geometry.top + geometry.maxHeight <= 56);
});

test("keeps the combobox controls and active-descendant IDs linked in a short phone viewport", () => {
  const geometry = calculateSearchableSelectPopupGeometry(
    { top: 125, bottom: 169, left: 12, width: 296 },
    { top: 0, bottom: 230, left: 0, right: 320 },
  );
  const listboxId = "task-target-listbox";
  const aria = getSearchableSelectAriaState(listboxId, options.length, 1, true);
  assert.equal(aria.controls, listboxId);
  assert.equal(aria.activeDescendant, getSearchableSelectOptionId(listboxId, 1));
  assert.ok(geometry.left >= 8);
  assert.ok(geometry.left + geometry.width <= 312);
  assert.ok(geometry.top >= 8);
  assert.ok(geometry.top + geometry.maxHeight <= 222);
  assert.deepEqual(getSearchableSelectAriaState(listboxId, 0, 0, true), { controls: listboxId });
  assert.deepEqual(getSearchableSelectAriaState(listboxId, options.length, 9, false), {});
});
