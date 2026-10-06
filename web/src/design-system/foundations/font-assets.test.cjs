const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const foundationsDirectory = __dirname;
const geistDirectory = path.join(foundationsDirectory, "..", "assets", "fonts", "geist");
const interDirectory = path.join(foundationsDirectory, "..", "assets", "fonts", "inter");

test("Geist stays available as an optional local typeface", () => {
  const declarations = fs.readFileSync(path.join(geistDirectory, "wght.css"), "utf8");
  const license = fs.readFileSync(path.join(geistDirectory, "LICENSE"), "utf8");
  const foundation = fs.readFileSync(path.join(foundationsDirectory, "index.css"), "utf8");
  const entry = fs.readFileSync(path.resolve(foundationsDirectory, "../../main.tsx"), "utf8");
  const tokens = fs.readFileSync(path.join(foundationsDirectory, "tokens.css"), "utf8");
  const fontFiles = [...declarations.matchAll(/url\(\.\/files\/([^)]+)\)/g)].map((match) => match[1]);

  assert.equal(fontFiles.length, 5, "expected the Latin, extended Latin, Cyrillic, extended Cyrillic, and Vietnamese subsets");
  for (const fontFile of fontFiles) {
    assert.ok(fs.existsSync(path.join(geistDirectory, "files", fontFile)), `missing local Geist subset ${fontFile}`);
  }
  assert.match(declarations, /font-family:\s*'Geist Variable'/);
  assert.match(declarations, /font-weight:\s*100 900/);
  assert.match(declarations, /font-display:\s*swap/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(foundation.indexOf("../assets/fonts/geist/wght.css") < foundation.indexOf("./tokens.css"));
  assert.match(entry, /import "\.\/design-system\/foundations\/index\.css"/);
  assert.match(tokens, /:root\[data-font="geist"\]\s*\{\s*--nova-type-family-custom:\s*"Geist Variable"/);
});

test("Inter font declarations stay local, licensed, and connected to the design foundation", () => {
  const declarations = fs.readFileSync(path.join(interDirectory, "wght.css"), "utf8");
  const license = fs.readFileSync(path.join(interDirectory, "LICENSE"), "utf8");
  const foundation = fs.readFileSync(path.join(foundationsDirectory, "index.css"), "utf8");
  const tokens = fs.readFileSync(path.join(foundationsDirectory, "tokens.css"), "utf8");
  const fontFiles = [...declarations.matchAll(/url\(\.\/files\/([^)]+)\)/g)].map((match) => match[1]);

  assert.equal(fontFiles.length, 7, "expected local normal Inter variable subsets for supported writing systems");
  for (const fontFile of fontFiles) {
    assert.ok(fs.existsSync(path.join(interDirectory, "files", fontFile)), `missing local Inter subset ${fontFile}`);
  }
  assert.match(declarations, /font-family:\s*'Inter Variable'/);
  assert.match(declarations, /font-weight:\s*100 900/);
  assert.match(declarations, /font-display:\s*swap/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(foundation.indexOf("../assets/fonts/inter/wght.css") < foundation.indexOf("./tokens.css"));
  assert.match(tokens, /--nova-type-family-custom:\s*"Inter Variable"/);
});
