const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const sourceRoot = path.resolve(__dirname, "../..");
const tokenFile = path.join(__dirname, "tokens.css");

function collectCssFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectCssFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".css") ? [fullPath] : [];
  });
}

function withoutCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("every consumed spacing token exists in the design-system foundation", () => {
  const tokenSource = withoutCssComments(fs.readFileSync(tokenFile, "utf8"));
  const declared = new Set([...tokenSource.matchAll(/(--nova-space-[\w-]+)\s*:/g)].map((match) => match[1]));
  const consumed = new Set();

  for (const file of collectCssFiles(sourceRoot)) {
    const source = withoutCssComments(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(/var\(\s*(--nova-space-[\w-]+)/g)) consumed.add(match[1]);
  }

  const missing = [...consumed].filter((token) => !declared.has(token)).sort();
  assert.deepEqual(missing, [], "define spacing tokens in foundations/tokens.css before consuming them");
});

test("comfortable and compact density both define the full page-layout spacing token", () => {
  const tokenSource = withoutCssComments(fs.readFileSync(tokenFile, "utf8"));
  const compactBlock = tokenSource.match(/:root\[data-density="compact"\]\s*\{([^}]*)\}/);

  assert.match(tokenSource, /--nova-space-7:\s*1\.75rem\s*;/);
  assert.ok(compactBlock, "compact density block exists");
  assert.match(compactBlock[1], /--nova-space-7:\s*1\.4rem\s*;/);
});
