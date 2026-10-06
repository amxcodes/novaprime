const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require(path.resolve(__dirname, "../../../../server/node_modules/typescript"));
const { test } = require("node:test");

const webRoot = path.resolve(__dirname, "../../..");
const sourceRoot = path.join(webRoot, "src");
const paletteFile = path.join(sourceRoot, "design-system", "foundations", "tokens.css");
const colorProperties =
  /(?:^|[;{])\s*(?:--[\w-]+|color|background(?:-color|-image)?|border(?:-[\w-]+)?|outline(?:-[\w-]+)?|fill|stroke|accent-color|caret-color|text-decoration-color|box-shadow|text-shadow|filter|scrollbar-color|column-rule)\s*:\s*([^;{}]+)/gim;
const commonNamedColors = [
  "black", "silver", "gray", "grey", "white", "maroon", "red", "purple", "fuchsia", "magenta",
  "green", "lime", "olive", "yellow", "navy", "blue", "teal", "aqua", "cyan", "orange",
  "rebeccapurple", "pink", "brown", "gold", "coral", "crimson", "tomato", "indigo", "violet",
  "beige", "ivory", "khaki", "tan",
];
const cssSystemColors = [
  "Canvas", "CanvasText", "LinkText", "VisitedText", "ActiveText", "ButtonFace", "ButtonText",
  "ButtonBorder", "Field", "FieldText", "Highlight", "HighlightText", "GrayText", "Mark", "MarkText",
  "SelectedItem", "SelectedItemText", "AccentColor", "AccentColorText",
];
const rawColor = new RegExp([
  "#(?:[\\da-f]{3}|[\\da-f]{4}|[\\da-f]{6}|[\\da-f]{8})\\b",
  "\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\\s*\\(",
  `(?<![a-z\\d-])(?:${commonNamedColors.join("|")})(?![a-z\\d-])`,
].join("|"), "i");
const systemColor = new RegExp(
  `(?<![a-z\\d-])(?:${cssSystemColors.join("|")})(?![a-z\\d-])`,
  "i",
);
const paletteTokenReference = /var\(\s*--nova-palette-[\w-]+/i;

function getMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return source.length;
}

function getForcedColorRanges(source) {
  return [...source.matchAll(/@media\b[^{}]*\(\s*forced-colors\s*:\s*active\s*\)[^{}]*\{/gi)]
    .map((match) => {
      const openIndex = match.index + match[0].lastIndexOf("{");
      return [openIndex, getMatchingBrace(source, openIndex)];
    });
}

function findRawThemeColors(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const forcedColorRanges = getForcedColorRanges(source);
  const findings = [];

  for (const match of source.matchAll(colorProperties)) {
    const isSystemColor = systemColor.test(match[1]);
    const isInsideForcedColors = forcedColorRanges.some(([start, end]) => match.index > start && match.index < end);
    if (!rawColor.test(match[1]) && !paletteTokenReference.test(match[1]) && (!isSystemColor || isInsideForcedColors)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    findings.push({ line, declaration: match[0].trim() });
  }

  return findings;
}

function unwrapTsExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function findRawInlineStyleColors(source, fileName = "component.tsx") {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  const styleAttributes = [];

  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializers = declarations.get(node.name.text) || [];
      initializers.push(node.initializer);
      declarations.set(node.name.text, initializers);
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "style" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      styleAttributes.push(node.initializer.expression);
    }
    ts.forEachChild(node, collect);
  }
  collect(sourceFile);

  const findings = [];
  for (const styleExpression of styleAttributes) {
    const expression = unwrapTsExpression(styleExpression);
    const candidates = ts.isIdentifier(expression)
      ? declarations.get(expression.text) || []
      : [expression];
    if (!candidates.length) {
      findings.push({ line: sourceFile.getLineAndCharacterOfPosition(styleExpression.getStart(sourceFile)).line + 1, declaration: "style expression is not statically inspectable" });
      continue;
    }

    for (const candidate of candidates) {
      const initializer = unwrapTsExpression(candidate);
      if (!ts.isObjectLiteralExpression(initializer)) {
        findings.push({ line: sourceFile.getLineAndCharacterOfPosition(candidate.getStart(sourceFile)).line + 1, declaration: "style value is not a statically inspectable object" });
        continue;
      }
      const objectText = initializer.getText(sourceFile);
      if (rawColor.test(objectText) || paletteTokenReference.test(objectText)) {
        findings.push({ line: sourceFile.getLineAndCharacterOfPosition(initializer.getStart(sourceFile)).line + 1, declaration: objectText });
      }
    }
  }
  return findings;
}

function collectCssFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectCssFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".css") ? [fullPath] : [];
  });
}

function collectTsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

test("theme and feature styles use semantic color tokens outside the palette source", () => {
  // Keep this boundary comprehensive: new page shells and experiments are
  // still product UI and must not become separate theme islands.
  const files = collectCssFiles(sourceRoot)
    .filter((file) => path.resolve(file) !== paletteFile);
  const findings = files.flatMap((file) =>
    findRawThemeColors(fs.readFileSync(file, "utf8")).map((finding) => ({
      file: path.relative(webRoot, file),
      ...finding,
    })),
  );

  assert.deepEqual(findings, [], "raw theme colors belong in foundations/tokens.css; use semantic tokens in component and feature CSS");
});

test("the color boundary catches common literals and allows token references", () => {
  assert.equal(findRawThemeColors(".control { color: #fff; }").length, 1);
  assert.equal(findRawThemeColors(".control { background: rgb(10 20 30); }").length, 1);
  assert.equal(findRawThemeColors(".control { --local-accent: #fff; }").length, 1);
  assert.equal(findRawThemeColors(".control { color: green; }").length, 1);
  assert.equal(findRawThemeColors(".control { color: grey; }").length, 1);
  assert.equal(findRawThemeColors(".control { color: fuchsia; }").length, 1);
  assert.equal(findRawThemeColors(".control { background: var(--nova-color-surface); }").length, 0);
  assert.equal(findRawThemeColors(".control { color: var(--nova-palette-action-800); }").length, 1);
  assert.equal(findRawThemeColors(".control { background: color-mix(in srgb, var(--token) 10%, transparent); }").length, 0);
  assert.equal(findRawThemeColors("@media (forced-colors: active) { .control { color: CanvasText; background: Canvas; outline-color: Highlight; } }").length, 0);
  assert.equal(findRawThemeColors(".control { color: CanvasText; }").length, 1);
  assert.equal(findRawThemeColors(".control { color: currentColor; }").length, 0);
});

test("React inline style objects cannot bypass the semantic theme-color boundary", () => {
  assert.equal(findRawInlineStyleColors('<div style={{ color: "#ffffff" }} />').length, 1);
  assert.equal(findRawInlineStyleColors('<div style={{ background: "var(--nova-palette-action-700)" }} />').length, 1);
  assert.equal(findRawInlineStyleColors('<div style={{ "--swatch-color": isValid(draft) ? draft : "transparent" }} />').length, 0);
  assert.equal(findRawInlineStyleColors('<div style={{ left: geometry.left, top: geometry.top }} />').length, 0);

  const files = collectTsxFiles(sourceRoot);
  const findings = files.flatMap((file) =>
    findRawInlineStyleColors(fs.readFileSync(file, "utf8"), file).map((finding) => ({
      file: path.relative(webRoot, file),
      ...finding,
    })),
  );

  assert.deepEqual(findings, [], "inline JSX styles must use semantic theme tokens; approved dynamic appearance previews remain data-driven");
});
