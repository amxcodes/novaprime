const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

// Use Node's built-in SSR test surface and the existing TypeScript compiler;
// this keeps the component slice testable without adding a UI test dependency.
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: (_target, key) => String(key) });
};

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { PeopleDirectory } = require("./PeopleDirectory.tsx");
const { PersonHistory } = require("./PersonHistory.tsx");
const { PersonLifecycleActions, PersonLifecycleOutcomeNotice } = require("./PersonLifecycleActions.tsx");
const { availablePeopleCursor, peopleDirectoryFocusRecoveryTarget, personHistoryFocusRecoveryTarget } = require("./presentation.ts");

const person = {
  id: "person-1",
  displayName: "Morgan Lee",
  email: "morgan@example.test",
  status: "active",
  designation: "Designer",
  employmentStartsOn: "2022-05-12",
  managerName: "Alex Rivera",
  office: { id: "office-1", name: "Central" },
  department: { id: "department-1", name: "Product" },
  role: { id: "role-1", name: "Contributor" },
};

function render(component, props) {
  return renderToStaticMarkup(React.createElement(component, props));
}

function directoryRead(overrides = {}) {
  return {
    status: "ready",
    query: "",
    people: [person],
    limit: 50,
    hasMore: true,
    nextCursor: "opaque-cursor",
    loadingMore: false,
    ...overrides,
  };
}

test("directory loading state exposes one named live region and reserved rows", () => {
  const html = render(PeopleDirectory, {
    read: { status: "loading" },
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading people…/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /Search people you can view/);
  assert.match(html, /aria-hidden="true"/);
});

test("load-more progress has one live announcement and keeps the focused control enabled", () => {
  const html = render(PeopleDirectory, {
    read: directoryRead({ loadingMore: true }),
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });

  assert.match(html, /role="status" aria-live="polite" aria-atomic="true">Loading more people\./);
  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /aria-label="Loading more people"|disabled=""/);
});

test("directory ready page presents supplied rows, cursor status, and accessible history action without claiming a total", () => {
  const html = render(PeopleDirectory, {
    read: directoryRead(),
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });

  assert.match(html, /1 person loaded\. More results are available\./);
  assert.doesNotMatch(html, /of 1|total of/i);
  assert.match(html, /Morgan Lee/);
  assert.match(html, /morgan@example\.test/);
  assert.match(html, /<span[^>]*data-size="32" aria-hidden="true"><svg/);
  assert.match(html, /<div[^>]*aria-hidden="true"><span>Person<\/span><span>Work details<\/span><span>Access role<\/span><span>Status<\/span><span>Actions<\/span><\/div>/);
  assert.match(html, /Access role/);
  assert.match(html, /Contributor/);
  assert.match(html, /aria-label="View effective-dated history for Morgan Lee"/);
  assert.match(html, /Load more people/);
});

test("directory distinguishes an empty scope, no search matches, and a failed read", () => {
  const empty = render(PeopleDirectory, {
    read: directoryRead({ people: [], hasMore: false, nextCursor: null }),
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });
  const noMatch = render(PeopleDirectory, {
    read: directoryRead({ query: "No match", people: [], hasMore: false, nextCursor: null }),
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });
  const failed = render(PeopleDirectory, {
    read: { status: "failed", query: "Morgan", message: "Service unavailable" },
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });
  const end = render(PeopleDirectory, {
    read: directoryRead({ hasMore: false, nextCursor: null }),
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });

  assert.match(empty, /No people returned for this access scope/);
  assert.doesNotMatch(empty, /Load more people/);
  assert.match(noMatch, /No people match this search/);
  assert.match(noMatch, /Clear search/);
  assert.match(failed, /People could not load/);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /Updating people search|Loading people…/);
  assert.doesNotMatch(failed, /role="status"[^>]*>People could not be loaded\./);
  assert.match(end, /End of people results/);
  assert.doesNotMatch(end, /Load more people/);
});

test("directory offers the same continuation cursor as a retry after a load-more failure", () => {
  const html = render(PeopleDirectory, {
    read: directoryRead({ loadMoreError: "The connection was interrupted." }),
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });

  assert.match(html, /More people could not load/);
  assert.match(html, /Retry loading more/);
});

test("directory keeps the current page visible and marks its continuation busy while loading more", () => {
  const html = render(PeopleDirectory, {
    read: directoryRead({ loadingMore: true }),
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });

  assert.match(html, /Morgan Lee/);
  assert.match(html, /Loading more people/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /aria-busy="true"/);
});

test("directory cursor is available only for the matching applied query and a valid continuation", () => {
  const page = directoryRead();
  assert.equal(availablePeopleCursor("  ", page), "opaque-cursor");
  assert.equal(availablePeopleCursor("new search", page), null);
  assert.equal(availablePeopleCursor("", directoryRead({ hasMore: false })), null);
  assert.equal(availablePeopleCursor("", directoryRead({ nextCursor: null })), null);
});

test("directory restores focus only when a focused load-more control is removed", () => {
  const finalPage = directoryRead({ hasMore: false, nextCursor: null });
  const denied = { status: "denied", message: "Directory unavailable" };
  const moreAvailable = directoryRead();
  const stillLoading = directoryRead({ loadingMore: true });

  assert.equal(peopleDirectoryFocusRecoveryTarget(false, finalPage), null);
  assert.equal(peopleDirectoryFocusRecoveryTarget(true, finalPage), "end-of-results");
  assert.equal(peopleDirectoryFocusRecoveryTarget(true, denied), "denied-notice");
  assert.equal(peopleDirectoryFocusRecoveryTarget(true, moreAvailable), null);
  assert.equal(peopleDirectoryFocusRecoveryTarget(true, stillLoading), null);
});

test("a focused directory search that becomes denied has a stable notice target", () => {
  const denied = { status: "denied", message: "Access changed." };

  assert.equal(peopleDirectoryFocusRecoveryTarget(true, denied), "denied-notice");
  assert.equal(peopleDirectoryFocusRecoveryTarget(false, denied), null);
});

test("final and denied directory states expose stable programmatic focus targets", () => {
  const finalPage = render(PeopleDirectory, {
    read: directoryRead({ hasMore: false, nextCursor: null }),
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });
  const denied = render(PeopleDirectory, {
    read: { status: "denied", message: "Access changed." },
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
  });

  assert.match(finalPage, /tabindex="-1">End of people results\./);
  assert.match(denied, /tabindex="-1" role="region" aria-label="People directory access notice"/);
  assert.match(denied, /People directory unavailable/);
});

test("people layouts adapt to feature width rather than the browser viewport", () => {
  const css = fs.readFileSync(require.resolve("./People.module.css"), "utf8");

  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /\.personRow\s*\{\s*min-height:\s*var\(--nova-table-row-height\)/);
  assert.match(css, /@container\s*\(max-width:\s*56rem\)/);
  assert.match(css, /@container\s*\(max-width:\s*40rem\)/);
  assert.match(css, /@container\s*\(max-width:\s*22\.5rem\)/);
  assert.doesNotMatch(css, /@media\s*\(max-width:/);
});

test("compact directory and history retain readable one-column actions and fact layouts", () => {
  const css = fs.readFileSync(require.resolve("./People.module.css"), "utf8");
  const compact = css.match(/@container\s*\(max-width:\s*40rem\)\s*\{([\s\S]*?)(?=\n@container|\n@media)/)?.[1] || "";
  const narrow = css.match(/@container\s*\(max-width:\s*22\.5rem\)\s*\{([\s\S]*?)(?=\n@media)/)?.[1] || "";

  assert.match(compact, /\.toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const tablet = css.match(/@container\s*\(max-width:\s*56rem\)\s*\{([\s\S]*?)(?=\n@container|\n@media)/)?.[1] || "";
  assert.match(tablet, /\.peopleHeader\s*\{[^}]*display:\s*none/);
  assert.match(tablet, /\.personRow\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(tablet, /\.personRow\s*\{[^}]*border-radius:\s*var\(--nova-radius-surface\)/);
  assert.match(tablet, /\.historyAction\s*\{[^}]*width:\s*100%/);
  // The <=56rem tablet rule also applies below 40rem; avoid duplicating it in the narrower rule.
  assert.match(compact, /\.facts,[\s\S]*?\.summaryFacts\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(compact, /\.entryHeading\s*\{[^}]*display:\s*grid/);
  assert.match(compact, /\.loadMoreGroup,[\s\S]*?\.loadMoreGroup button\s*\{[^}]*width:\s*100%/);
  assert.match(compact, /\.loadMoreButton\s*\{[^}]*width:\s*100%/);
  assert.match(narrow, /\.facts,[\s\S]*?\.summaryFacts\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("denied history clears the supplied identity and keeps the message generic", () => {
  const html = render(PersonHistory, {
    person,
    read: { status: "denied", message: "This history is not available under your current access." },
    onBack() {},
    onRetry() {},
    onLoadMore() {},
  });

  assert.match(html, /History unavailable/);
  assert.match(html, /tabindex="-1" role="region" aria-label="History access notice"/);
  assert.doesNotMatch(html, /Morgan Lee|morgan@example\.test/);
});

test("history continuation restores focus after pending, denial, failure, and final-page transitions", () => {
  const loadingMore = {
    status: "ready",
    pages: [{ person: { id: person.id, displayName: person.displayName }, history: [], limit: 50, hasMore: true, nextCursor: "next" }],
    loadingMore: true,
  };
  const moreAvailable = { ...loadingMore, loadingMore: false };
  const finalPage = {
    ...moreAvailable,
    pages: [{ ...moreAvailable.pages[0], hasMore: false, nextCursor: null }],
  };

  assert.equal(personHistoryFocusRecoveryTarget(false, { status: "denied" }), null);
  assert.equal(personHistoryFocusRecoveryTarget(true, { status: "denied" }), "denied-notice");
  assert.equal(personHistoryFocusRecoveryTarget(true, { status: "loading" }), null);
  assert.equal(personHistoryFocusRecoveryTarget(true, loadingMore), null);
  assert.equal(personHistoryFocusRecoveryTarget(true, moreAvailable), "older-history-action");
  assert.equal(personHistoryFocusRecoveryTarget(true, finalPage), "history-scope");
  assert.equal(personHistoryFocusRecoveryTarget(true, { status: "failed", message: "Unavailable" }), "retry-action");
  assert.equal(personHistoryFocusRecoveryTarget(true, { ...moreAvailable, pages: [] }), "retry-action");
});

test("history renders effective periods and accurately labels bounded cursor pages", () => {
  const html = render(PersonHistory, {
    person,
    read: {
      status: "ready",
      pages: [{
        person: { id: person.id, displayName: person.displayName },
        history: [{
          id: "history-1",
          kind: "employment",
          effectiveOn: "2026-09-01",
          effectiveUntil: null,
          details: { designation: "Lead Designer", managerName: "Alex Rivera" },
        }],
        limit: 50,
        hasMore: true,
        nextCursor: "opaque-cursor",
      }],
      loadingMore: false,
    },
    onBack() {},
    onRetry() {},
    onLoadMore() {},
  });

  assert.match(html, /Employment period/);
  assert.match(html, /<h2[^>]*id="person-summary-title">Morgan Lee<\/h2>/);
  assert.match(html, /<h2[^>]*><span id="person-history-title"[^>]*>Effective-dated history<\/span><\/h2>/);
  assert.doesNotMatch(html, /<h3[^>]*id="person-summary-title"/);
  assert.match(html, /Designation: Lead Designer/);
  assert.match(html, /Manager: Alex Rivera/);
  assert.match(html, /No end date recorded/);
  assert.match(html, /bounded page/);
  assert.match(html, /up to 50 entries/);
  assert.match(html, /Older pages are available/);
  assert.match(html, /This bounded read is not a complete personnel dossier/);
  assert.match(html, /Load older history/);
});

const lifecycleActions = (overrides = {}) => ({
  canFreeze: false,
  canStartOffboarding: false,
  canCompleteOffboarding: false,
  onFreeze: async () => ({ status: "success" }),
  onStartOffboarding: async () => ({ status: "success" }),
  onCompleteExit: async () => ({ status: "success" }),
  ...overrides,
});

test("person history hides lifecycle actions without a readable record or explicit host actions", () => {
  const noActions = render(PersonHistory, {
    person: { ...person, role: { ...person.role, name: "Super Admin" } },
    read: { status: "failed", message: "History unavailable." },
    onBack() {}, onRetry() {}, onLoadMore() {},
  });
  const denied = render(PersonHistory, {
    person,
    read: { status: "denied", message: "Access changed." },
    lifecycleActions: lifecycleActions({ canFreeze: true, canStartOffboarding: true }),
    onBack() {}, onRetry() {}, onLoadMore() {},
  });

  assert.doesNotMatch(noActions, /Freeze access|Start offboarding|Complete exit/);
  assert.doesNotMatch(denied, /Morgan Lee|Freeze access|Start offboarding|Complete exit/);
});

test("view-only and scope-projected lifecycle controls show only host-authorized actions", () => {
  const viewOnly = render(PersonLifecycleActions, {
    personName: "Morgan Lee",
    ...lifecycleActions(),
  });
  const scopedFreeze = render(PersonLifecycleActions, {
    personName: "Morgan Lee",
    ...lifecycleActions({ canFreeze: true }),
  });
  const scopedOffboard = render(PersonLifecycleActions, {
    personName: "Morgan Lee",
    ...lifecycleActions({ canStartOffboarding: true }),
  });
  const scopedComplete = render(PersonLifecycleActions, {
    personName: "Morgan Lee",
    ...lifecycleActions({ canCompleteOffboarding: true }),
  });

  assert.equal(viewOnly, "");
  assert.match(scopedFreeze, /Freeze access/);
  assert.match(scopedFreeze, /closes the person’s active work and attendance sessions and revokes their active sign-in sessions/);
  assert.doesNotMatch(scopedFreeze, /Start offboarding|Complete exit/);
  assert.match(scopedOffboard, /Start offboarding/);
  assert.doesNotMatch(scopedOffboard, /Freeze access|Complete exit/);
  assert.match(scopedOffboard, /aria-expanded="false"/);
  assert.match(scopedOffboard, /id="[^"]+-offboarding-form"[^>]*hidden=""/);
  assert.match(scopedOffboard, /<textarea[^>]*required=""[^>]*maxLength="500"/i);
  assert.match(scopedOffboard, /This reason is included in the audited access change\./);
  assert.match(scopedComplete, /Complete exit/);
  assert.doesNotMatch(scopedComplete, /Freeze access|Start offboarding/);
});

test("lifecycle completion and conflict outcomes are announced with accessible status semantics", () => {
  const success = render(PersonLifecycleOutcomeNotice, {
    outcome: { action: "start-offboarding", result: { status: "success" } },
  });
  const conflict = render(PersonLifecycleOutcomeNotice, {
    outcome: { action: "complete-exit", result: { status: "error", message: "Reassign or close active assignments first." } },
  });

  assert.match(success, /tabindex="-1"/);
  assert.match(success, /role="status" aria-live="polite"/);
  assert.match(success, /Offboarding started\. Refresh the person record before taking another action\./);
  assert.match(conflict, /role="alert" aria-live="assertive"/);
  assert.match(conflict, /Complete exit could not be completed/);
  assert.match(conflict, /Reassign or close active assignments first\./);
});

test("lifecycle controls retain keyboard focus cues and switch to full-width touch actions in narrow containers", () => {
  const css = fs.readFileSync(require.resolve("./People.module.css"), "utf8");
  const compact = css.match(/@container\s*\(max-width:\s*40rem\)\s*\{([\s\S]*?)(?=\n@container|\n@media)/)?.[1] || "";

  assert.match(css, /\.lifecycleActions textarea:focus-visible/);
  assert.doesNotMatch(css, /\.lifecycleActions :is\(button, textarea\):focus-visible/,
    "shared buttons keep the Figma focus underline instead of a feature-level ring");
  assert.match(css, /\.lifecycleActionGroup > button,[\s\S]*?min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(compact, /\.lifecycleActionGroup,[\s\S]*?display:\s*grid/);
  assert.match(compact, /\.lifecyclePanelActions > button\s*\{\s*width:\s*100%/);
  assert.match(compact, /\.lifecycleActionGroup > button,[\s\S]*?\.lifecyclePanelActions > button\s*\{[^}]*white-space:\s*normal/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
});
