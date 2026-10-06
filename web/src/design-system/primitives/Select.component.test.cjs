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
const { Select } = require("./Select.tsx");

const options = [
  { value: "office", label: "Office" },
  { value: "wfh", label: "Work from home", disabled: true },
];

function render(props = {}) {
  return renderToStaticMarkup(React.createElement("form", null, React.createElement(Select, {
    id: "attendance-mode",
    name: "mode",
    label: "Attendance mode",
    value: "office",
    options,
    onChange() {},
    ...props,
  })));
}

test("renders an accessible custom trigger and selected key in the named backing select", () => {
  const html = render({ required: true, hint: "Choose where attendance is recorded.", error: "Choose a mode." });

  assert.match(html, /Attendance mode/);
  assert.match(html, /data-invalid="true" data-required="true"/);
  const trigger = html.match(/<button id="attendance-mode"[^>]*>/)?.[0];
  const labelId = html.match(/<span id="([^"]+)"><span>Attendance mode<\/span>/)?.[1];
  const hintId = html.match(/<span id="([^"]+)" slot="description">/)?.[1];
  const errorId = html.match(/<span class="react-aria-FieldError" id="([^"]+)" slot="errorMessage"/)?.[1];
  assert.ok(trigger, "Select trigger is rendered as a button");
  const labelledBy = trigger.match(/aria-labelledby="([^"]+)"/)?.[1].split(" ") ?? [];
  assert.ok(labelId && labelledBy.includes(labelId), "visible label is referenced by the trigger");
  assert.match(trigger, /aria-haspopup="listbox"/);
  assert.match(trigger, /aria-expanded="false"/);
  const describedBy = trigger.match(/aria-describedby="([^"]+)"/)?.[1].split(" ") ?? [];
  assert.ok(hintId && describedBy.includes(hintId), "hint is referenced by the trigger");
  assert.ok(errorId && describedBy.includes(errorId), "validation error is referenced by the trigger");
  assert.match(html, /slot="errorMessage"[^>]*>Choose a mode\.<\/span>/);
  assert.match(html, /Attendance mode<\/span>[\s\S]*?Required/);
  assert.match(html, /data-testid="hidden-select-container"[\s\S]*?<select tabindex="-1" required="" name="mode"[\s\S]*?<option value="office" selected="">Office/);
  assert.doesNotMatch(html, /<select(?! tabindex="-1")/);
});

test("empty selection is represented by the backing select placeholder and disabled state reaches the form control", () => {
  const empty = render({ value: null, required: true });
  const disabled = render({ disabled: true, required: true });

  assert.match(empty, /Choose an option/);
  assert.match(empty, /<select tabindex="-1" required="" name="mode"><option value=""[^>]*selected=""/);
  assert.match(disabled, /data-disabled/);
  assert.match(disabled, /<button[^>]*disabled=""[^>]*data-disabled="true"/);
  assert.match(disabled, /<select tabindex="-1" disabled="" required="" name="mode"/);
});

test("styles custom popup states with NOVA theme, touch, focus, reduced-motion and forced-color contracts", () => {
  const css = fs.readFileSync(require.resolve("./Select.module.css"), "utf8");
  const source = fs.readFileSync(require.resolve("./Select.tsx"), "utf8");
  const buttonCss = fs.readFileSync(require.resolve("./Button.module.css"), "utf8");
  const fieldCss = fs.readFileSync(require.resolve("./Field.module.css"), "utf8");

  assert.match(css, /var\(--nova-control-border\)/);
  assert.match(css, /var\(--nova-control-border-focus\)/);
  assert.match(css, /var\(--nova-color-danger\)/);
  assert.match(css, /var\(--nova-control-background-disabled\)/);
  assert.match(css, /var\(--nova-select-popup-background\)/);
  assert.match(css, /var\(--nova-select-popup-border\)/);
  assert.match(css, /var\(--nova-select-popup-shadow\)/);
  assert.match(css, /\.value\s*\{[^}]*font-size:\s*var\(--nova-type-size-body\)/s);
  assert.match(css, /\.optionLabel\s*\{[^}]*font-size:\s*var\(--nova-type-size-body\)/s);
  assert.match(css, /\.optionDetail\s*\{[^}]*font-size:\s*var\(--nova-type-size-detail\)/s);
  assert.match(css, /padding:\s*calc\(var\(--nova-space-2\) - 1px\)/);
  assert.match(css, /\.listBox\s*\{[^}]*gap:\s*0/s);
  assert.match(css, /padding:\s*0\.25rem 1\.25rem 0\.25rem 0\.25rem/);
  assert.match(css, /\.selectedDetail\s*\{[^}]*width:\s*4\.375rem[^}]*text-align:\s*end/s);
  assert.match(source, /className=\{styles\.selectedDetail\}[^>]*aria-hidden="true">Selected/);
  assert.match(source, /<Popover className=\{styles\.popover\} placement="bottom start" offset=\{12\}>/);
  assert.match(css, /var\(--nova-select-option-hover\)/);
  assert.match(css, /var\(--nova-select-option-selected\)/);
  assert.match(css, /var\(--nova-control-touch-target\)/);
  assert.match(css, /\.option\s*\{\s*display:\s*flex;\s*min-width:\s*0;\s*min-height:\s*var\(--nova-control-height\)/);
  assert.match(css, /@media\s*\(any-pointer:\s*coarse\)[\s\S]*?\.trigger,\s*\.option\s*\{\s*min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(fieldCss, /@media\s*\(any-pointer:\s*coarse\)[\s\S]*?\.control\s*\{\s*min-height:\s*var\(--nova-control-touch-target\)/);
  assert.match(css, /-webkit-appearance:\s*none/);
  assert.match(css, /appearance:\s*none/);
  assert.match(css, /font:\s*inherit/);
  assert.match(css, /\.trigger\[data-focus-visible\]/);
  assert.match(css, /\.trigger\[data-focus-visible\]\s*\{\s*outline:\s*none;\s*border-color:\s*var\(--nova-control-border-focus\);\s*background:\s*var\(--nova-color-action-subtle\);\s*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/);
  assert.doesNotMatch(css.slice(0, css.indexOf("@media (forced-colors: active)")), /\.trigger\[data-focus-visible\][^}]*outline:\s*3px/);
  assert.match(css, /\.trigger\[data-open\]\s*\{[^}]*background:\s*var\(--nova-color-action-subtle\)/s);
  assert.match(css, /\.option\[data-focused\]/);
  assert.match(css, /\.option\s*\{[^}]*border-radius:\s*var\(--nova-radius-option\)/s);
  assert.match(css, /\.option\[data-focused\]\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 var\(--nova-color-action\)/s);
  assert.match(css, /\.option\[data-disabled\]/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(css, /HighlightText/);
  const forcedColorsCss = css.slice(css.indexOf("@media (forced-colors: active)"));
  assert.match(forcedColorsCss, /\.trigger\[data-focus-visible\]\s*\{\s*outline:\s*1px solid Highlight;\s*outline-offset:\s*-2px/);
  assert.match(forcedColorsCss, /\.option\[data-selected\]\s+\.optionDetail,\s*\.option\[data-focused\]\s+\.optionDetail\s*\{\s*color:\s*inherit/);
  assert.match(css, /\.select\[data-invalid\]\s+\.trigger\s*\{\s*border-color:\s*Mark/);
  assert.match(css, /\.option\[data-selected\]\s+\.selectedDetail\s*\{\s*color:\s*inherit/);
  assert.match(buttonCss, /\.button\[data-variant="primary"\]:hover:not\(:disabled\)[\s\S]*?background:\s*ButtonFace/);
  assert.match(buttonCss, /filter:\s*none/);
  assert.match(fieldCss, /\.control\[aria-invalid="true"\]\s*\{\s*border-color:\s*Mark/);
  assert.match(source, /react-aria-components/);
  assert.match(source, /isDisabled=\{option\.disabled\}/);
});

test("the static menu explains unavailable choices and stays inside a narrow viewport", () => {
  const css = fs.readFileSync(require.resolve("./Select.module.css"), "utf8");
  const source = fs.readFileSync(require.resolve("./Select.tsx"), "utf8");

  assert.match(source, /emptyMessage = "No options are available\."/);
  assert.match(source, /!options\.some\(\(option\) => !option\.disabled\)/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(css, /-webkit-appearance:\s*none/);
  assert.match(css, /appearance:\s*none/);
  assert.match(css, /width:\s*var\(--trigger-width\)/);
  assert.match(css, /max-width:\s*calc\(100vw - var\(--nova-space-8\)\)/);
  assert.match(css, /max-width:\s*calc\(100dvw - var\(--nova-space-8\)\)/);
  assert.match(css, /var\(--nova-control-border-focus\)/);
});
