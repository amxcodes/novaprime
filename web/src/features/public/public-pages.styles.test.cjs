const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const css = fs.readFileSync(path.join(__dirname, "public-pages.css"), "utf8");

test("global public styles own only the static shell, app frame, and loading placeholders", () => {
  for (const selector of [".site-header", ".wordmark", ".site-nav", "#app", "#app .loading"]) {
    assert.ok(css.includes(selector), `expected live public shell selector ${selector}`);
  }

  assert.doesNotMatch(
    css,
    /\.hero\b|\.card-grid\b|\.card\b|\.panel\b|\.form-grid\b|\.form-actions\b|\.button\b|\.notice\b/,
    "feature compositions and generic controls belong to their CSS Module owners",
  );
});
