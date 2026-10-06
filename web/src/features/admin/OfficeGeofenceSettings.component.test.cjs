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
const { OfficeGeofenceSettings } = require("./OfficeGeofenceSettings.tsx");
const { OfficeGeofenceSettingsSection } = require("./OfficeGeofenceSettingsSection.tsx");

const office = {
  id: "office-1",
  name: "Central office",
  latitude: null,
  longitude: null,
  geofenceRadiusMeters: 150,
};

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(OfficeGeofenceSettings, {
    canManage: true,
    read: { status: "ready", offices: [office] },
    onSave() {},
    ...props,
  }));
}

test("does not render office names or forms without the host's manage grant", () => {
  const html = render({ canManage: false });
  assert.equal(html, "");
  assert.doesNotMatch(html, /Central office|Latitude|Save geofence/);
});

test("renders authorized office forms with accessible labels and server-aligned limits", () => {
  const html = render();
  assert.match(html, /Central office/);
  assert.match(html, /Not configured/);
  assert.match(html, /<label[^>]*for="[^"]+-latitude"[^>]*>[^<]*<span>Latitude<\/span>/);
  assert.match(html, /min="-90" max="90" step="0\.00001"/);
  assert.match(html, /min="-180" max="180" step="0\.00001"/);
  assert.match(html, /min="10" max="100000" step="1"/);
  assert.match(html, /Radius \(metres\)/);
  assert.match(html, /Save geofence/);
});

test("shows read errors and empty results as distinct states", () => {
  const errorHtml = render({ read: { status: "error", offices: [], message: "Could not load office settings." } });
  assert.match(errorHtml, /Office geofence settings could not load/);
  assert.match(errorHtml, /Could not load office settings\./);
  assert.doesNotMatch(errorHtml, /Central office/);

  const emptyHtml = render({ read: { status: "ready", offices: [] } });
  assert.match(emptyHtml, /No offices are available to configure/);
  assert.doesNotMatch(emptyHtml, /<form/);
});

test("typed section preserves one h2 and its purpose description while the feature chunk loads", () => {
  const html = renderToStaticMarkup(React.createElement(OfficeGeofenceSettingsSection, {
    canManage: true,
    read: { status: "ready", offices: [] },
    onSave() {},
  }));

  assert.equal((html.match(/<h2\b/g) || []).length, 1);
  assert.match(html, /<h2[^>]*>Attendance geofences<\/h2>/);
  assert.match(html, /Set the office coordinates and radius used to validate office check-ins\./);
  assert.match(html, /Loading attendance geofences/);
});
