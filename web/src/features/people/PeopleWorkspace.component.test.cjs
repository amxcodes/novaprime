const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../../../server/node_modules/typescript");

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
const { PeopleWorkspace } = require("./PeopleWorkspace.tsx");

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

function directoryProps(overrides = {}) {
  return {
    read: {
      status: "ready",
      query: "",
      people: [person],
      limit: 50,
      hasMore: false,
      nextCursor: null,
      loadingMore: false,
    },
    onSearch() {},
    onLoadMore() {},
    onSelectPerson() {},
    onRetry() {},
    ...overrides,
  };
}

function selectedProps(overrides = {}) {
  return {
    personId: person.id,
    person,
    history: {
      read: {
        status: "ready",
        pages: [{
          person: { id: person.id, displayName: person.displayName },
          history: [],
          limit: 50,
          hasMore: false,
          nextCursor: null,
        }],
        loadingMore: false,
      },
      onRetry() {},
      onLoadMore() {},
    },
    ...overrides,
  };
}

function render(props) {
  return renderToStaticMarkup(React.createElement(PeopleWorkspace, {
    directory: directoryProps(),
    selected: null,
    onBackToDirectory() {},
    ...props,
  }));
}

test("workspace keeps URL-backed selection visible in both the directory and authorized detail pane", () => {
  const html = render({ selected: selectedProps() });

  assert.match(html, /data-has-directory="true" data-has-selection="true"/);
  assert.match(html, /data-people-directory-pane/);
  assert.match(html, /data-selected="true"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /data-people-detail-pane/);
  assert.match(html, /Effective-dated history/);
  assert.match(html, /data-people-history-heading="true" tabindex="-1"/);
  assert.match(html, /data-person-history-action="person-1"/);
  assert.match(html, /Clear selected person/);
  assert.match(html, /Back to people/);
  assert.match(html, /data-people-directory-heading="true" tabindex="-1"/);
});

test("directory-only route does not mount or imply a selected-person history read", () => {
  const html = render({ selected: null });

  assert.match(html, /data-has-directory="true" data-has-selection="false"/);
  assert.match(html, /People directory/);
  assert.doesNotMatch(html, /data-people-detail-pane|Effective-dated history/);
});

test("direct person links render only the exact host-provided history and do not require a directory read", () => {
  const html = render({ directory: null, selected: selectedProps({ person: null }) });

  assert.match(html, /data-has-directory="false" data-has-selection="true"/);
  assert.match(html, /data-people-detail-pane/);
  assert.match(html, /Effective-dated history/);
  assert.match(html, /Back to people/);
  assert.doesNotMatch(html, /People directory|Search people you can view|morgan@example\.test/);
  assert.match(html, /Morgan Lee/, "the target identity may come from the exact history response");
});

test("a directory summary is used only when its identity matches the selected URL target", () => {
  const wrongPerson = { ...person, id: "another-person", displayName: "Unrelated person" };
  const html = render({ selected: selectedProps({ person: wrongPerson }) });

  assert.match(html, /Effective-dated history/);
  assert.doesNotMatch(html, /Unrelated person/);
  assert.match(html, /Morgan Lee/, "the exact history read can still identify its own target");
});

test("container compositions support compact detail, medium single-pane, and expanded master-detail", () => {
  const css = fs.readFileSync(require.resolve("./PeopleWorkspace.module.css"), "utf8");

  assert.match(css, /container:\s*people-workspace\s*\/\s*inline-size/);
  assert.match(css, /@container people-workspace \(max-width: 63\.999rem\)/);
  assert.match(css, /@container people-workspace \(max-width: 39\.999rem\)/);
  assert.match(css, /@container people-workspace \(min-width: 64rem\)/);
  assert.match(css, /data-has-directory="true"\]\[data-has-selection="true"\] \.workspace\s*\{[^}]*grid-template-columns:\s*minmax\(18rem,\s*0\.78fr\) minmax\(0,\s*1\.42fr\)/);
  assert.match(css, /data-has-directory="true"\]\[data-has-selection="true"\] \[data-people-directory-pane\]\s*\{\s*display:\s*none;/);
  assert.match(css, /\[data-people-history-back\] > button\s*\{[^}]*min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(css, /var\(--nova-color-border\)/);
  assert.match(css, /var\(--nova-space-/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
});
