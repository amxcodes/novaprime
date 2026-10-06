const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../../../server/node_modules/typescript");

test("nested route cleanup unmounts each React island once", () => {
  const filename = path.join(__dirname, "react-islands.tsx");
  const source = fs.readFileSync(filename, "utf8");
  const originalLoad = Module._load;
  const originalExtension = require.extensions[".tsx"];
  const counts = new Map();
  let islands;
  let page;

  require.extensions[".tsx"] = (module, loadedFilename) => {
    const output = ts.transpileModule(fs.readFileSync(loadedFilename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: loadedFilename,
    }).outputText;
    module._compile(output, loadedFilename);
  };
  Module._load = function (request, parent, isMain) {
    if (request === "react") return { createElement: () => ({}) };
    if (request === "react-dom") return { flushSync: (run) => run() };
    if (request === "react-dom/client") return {
      createRoot(target) {
        return {
          render() {},
          unmount() {
            counts.set(target, (counts.get(target) || 0) + 1);
            if (target === page) islands.unmountReactIslandsWithin(page);
          },
        };
      },
    };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    islands = require("./react-islands.tsx");
    const app = { contains: (target) => target === page || target === slot };
    page = { contains: (target) => target === slot };
    const slot = {};
    islands.mountReactIsland(app, function App() {}, {});
    islands.mountReactIsland(page, function Page() {}, {});
    islands.mountReactIsland(slot, function Feature() {}, {});

    islands.clearReactIslands();

    assert.equal(counts.get(app), 1);
    assert.equal(counts.get(page), 1);
    assert.equal(counts.get(slot), 1);
  } finally {
    Module._load = originalLoad;
    if (originalExtension) require.extensions[".tsx"] = originalExtension;
    else delete require.extensions[".tsx"];
    delete require.cache[filename];
  }
});
