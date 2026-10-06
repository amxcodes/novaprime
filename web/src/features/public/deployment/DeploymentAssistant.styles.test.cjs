const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const featureDir = __dirname;
const cssPath = path.join(featureDir, "DeploymentAssistant.module.css");
const css = fs.readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function getRuleSelectors(source) {
  const selectors = [];
  let segmentStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === ";" || source[index] === "}") {
      segmentStart = index + 1;
      continue;
    }
    if (source[index] !== "{") continue;

    const prelude = source.slice(segmentStart, index).trim();
    if (prelude && !prelude.startsWith("@")) {
      selectors.push(...prelude.split(",").map((selector) => selector.trim()));
    }
    segmentStart = index + 1;
  }

  return selectors;
}

test("deployment assistant styles stay under its route-owned root", () => {
  const selectorRules = getRuleSelectors(css);

  assert.ok(selectorRules.length > 30, "the feature stylesheet should own its complete composition");
  for (const selector of selectorRules) {
    assert.match(selector, /^\.root\b/, `selector escapes the deployment assistant root: ${selector}`);
  }
  assert.doesNotMatch(css, /:global\((?:body|#app|\.panel|\.button)/);

  const component = fs.readFileSync(path.join(featureDir, "DeploymentAssistant.tsx"), "utf8");
  assert.match(component, /className=\{styles\.root\}/);
  assert.match(component, /import styles from "\.\/DeploymentAssistant\.module\.css"/);
  assert.match(component, /from "\.\.\/\.\.\/\.\.\/design-system\/primitives\/Button"/);
  assert.match(component, /className=\{styles\.publicAction\}/);
  assert.match(component, /className="link-button"[^>]*>Return to NOVA home/);
  assert.match(css, /\.root :global\(\.link-button\)\s*\{[^}]*appearance:\s*none;[^}]*min-height:\s*var\(--nova-control-touch-target\);[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.root :global\(\.link-button:hover:not\(:disabled\)\)\s*\{[^}]*color:\s*var\(--nova-color-action-text-hover\);/s);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)[\s\S]*?\.root :global\(\.link-button\)\s*\{[^}]*color:\s*LinkText;/s);
  assert.match(css, /\.root :global\(\.link-button:focus-visible\)\s*\{[^}]*outline-color:\s*Highlight;/s);
  const entry = fs.readFileSync(path.resolve(featureDir, "../../../main.tsx"), "utf8");
  assert.doesNotMatch(entry, /features\/public\/deployment\/DeploymentAssistant\.module\.css/);
});

test("deployment assistant uses semantic colors and adapts at compact widths", () => {
  assert.doesNotMatch(css, /#(?:[\da-f]{3,8})\b|\b(?:rgb|hsl|oklch)\s*\(/i);
  assert.match(css, /var\(--nova-color-[\w-]+\)/);
  assert.match(css, /var\(--nova-control-touch-target\)/);
  assert.match(css, /@container deployment-assistant \(max-width: 48rem\)/);
  assert.match(css, /@container deployment-assistant \(max-width: 32rem\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
});
