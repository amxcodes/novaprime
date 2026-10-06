const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const testRoot = path.join(repositoryRoot, "web", "src");
const files = [];

function collectComponentTests(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectComponentTests(file);
    } else if (entry.isFile() && entry.name.endsWith(".test.cjs")) {
      files.push(path.relative(repositoryRoot, file));
    }
  }
}

collectComponentTests(testRoot);
if (files.length === 0) {
  throw new Error("No CommonJS web component tests were found.");
}

// These render tests rely on Node's CommonJS extension hooks for TypeScript and CSS.
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
