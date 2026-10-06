const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("../../server/node_modules/typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const routeModule = import("./settings-public-origin-route.js");
const featureContracts = require("../src/features/settings/public-origin/contracts.ts");
const featureProjection = require("../src/features/settings/public-origin/projection.ts");

const response = {
  allowedOrigins: ["https://work.example.test", "https://preview.example.test"],
  configuredOrigin: "https://work.example.test",
  effectiveOrigin: "https://work.example.test",
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeHarness(overrides = {}) {
  const events = [];
  const target = {
    isConnected: true,
    replaceChildren(...children) { events.push({ replaced: children }); },
  };
  const state = { identityEpoch: 4 };
  let currentPage = true;
  let currentIdentity = true;
  let currentCommand = true;
  let readOrigin = async () => response;
  let saveOrigin = async () => response;
  let loadFeature = async () => ({
    PublicOrigin() {},
    ...featureProjection,
    ...featureContracts,
  });
  const originBridge = {
    published: [],
    publish(value) { this.published.push(value); this.current = value; },
    retry: null,
  };
  const host = {
    getIdentityEpoch: () => state.identityEpoch,
    readOrigin: () => readOrigin(),
    saveOrigin: (origin) => saveOrigin(origin),
    captureCommandContext(source) {
      const context = { source, identityEpoch: state.identityEpoch };
      events.push({ captured: context });
      return context;
    },
    isCurrentCommand: (context) => currentCommand && context.identityEpoch === state.identityEpoch,
    isCurrentCommandIdentity: (context) => currentIdentity && context.identityEpoch === state.identityEpoch,
    recoverProtectedCommandFailure(error, context, message) {
      events.push({ recovered: { error, context, message } });
      return overrides.recoverResult || false;
    },
    publishOriginSnapshot(snapshot) { events.push({ snapshot }); },
    clearOriginSnapshot() { events.push({ cleared: true }); },
    mountReactIsland(_target, component, props) { events.push({ render: { component, props } }); },
    noticeElement(message, kind) { return { message, kind }; },
    errorText(error) { return `safe:${error?.code || "unknown"}`; },
    loadFeature: () => loadFeature(),
  };
  const options = {
    target,
    isCurrentSettings: () => currentPage,
    originBridge,
    host,
  };
  return {
    events,
    target,
    state,
    originBridge,
    host,
    options,
    setPageCurrent(value) { currentPage = value; },
    setIdentityCurrent(value) { currentIdentity = value; },
    setCommandCurrent(value) { currentCommand = value; },
    setReadOrigin(value) { readOrigin = value; },
    setSaveOrigin(value) { saveOrigin = value; },
    setLoadFeature(value) { loadFeature = value; },
    get props() { return events.filter((event) => event.render).at(-1)?.render.props; },
  };
}

async function mount(harness) {
  const { mountSettingsPublicOriginRoute } = await routeModule;
  await mountSettingsPublicOriginRoute(harness.options);
}

test("reads and publishes the projected origin through the bridge without exposing host state", async () => {
  const harness = makeHarness();
  await mount(harness);

  assert.deepEqual(harness.props.readState, {
    status: "ready",
    configuredOrigin: response.configuredOrigin,
    effectiveOrigin: response.effectiveOrigin,
    allowedOrigins: response.allowedOrigins,
  });
  assert.deepEqual(harness.originBridge.current, harness.props.readState);
  assert.equal(harness.events.filter((event) => event.snapshot).length, 1);
  assert.equal(Object.hasOwn(harness.props, "state"), false);
  assert.equal(Object.hasOwn(harness.props, "bootstrapToken"), false);
  assert.equal(Object.hasOwn(harness.props, "api"), false);
  assert.equal(Object.hasOwn(harness.props, "grants"), false);
  assert.equal(harness.props.onRetry instanceof Function, true);
  assert.equal(harness.props.onSave instanceof Function, true);
});

test("bridge and feature retries both trigger a fresh origin read", async () => {
  const harness = makeHarness();
  let reads = 0;
  harness.setReadOrigin(async () => { reads += 1; return response; });
  await mount(harness);

  harness.originBridge.retry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 2);
  harness.props.onRetry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 3);
});

test("saves the selected origin through the injected port and publishes the confirmed snapshot", async () => {
  const harness = makeHarness();
  const requested = [];
  const saved = { ...response, configuredOrigin: "https://preview.example.test", effectiveOrigin: "https://preview.example.test" };
  harness.setSaveOrigin(async (origin) => { requested.push(origin); return saved; });
  await mount(harness);

  await harness.props.onSave("https://preview.example.test");
  assert.deepEqual(requested, ["https://preview.example.test"]);
  assert.equal(harness.props.readState.configuredOrigin, "https://preview.example.test");
  assert.equal(harness.originBridge.current.effectiveOrigin, "https://preview.example.test");
});

test("maps the two server conflicts and keeps definitive client errors rejected", async () => {
  const harness = makeHarness();
  await mount(harness);
  for (const code of [
    "PUBLIC_ORIGIN_CHANGE_BLOCKED_DURING_GMAIL_AUTH",
    "PUBLIC_ORIGIN_REQUIRED_WHILE_EMAIL_ACTIVE",
  ]) {
    harness.setSaveOrigin(async () => { throw Object.assign(new Error("conflict"), { code, httpStatus: 409 }); });
    await assert.rejects(harness.props.onSave("https://preview.example.test"), (error) => {
      assert.equal(error.kind, "conflict");
      assert.equal(error.message, `safe:${code}`);
      return true;
    });
  }
  harness.setSaveOrigin(async () => { throw Object.assign(new Error("bad origin"), { code: "VALIDATION_FAILED", httpStatus: 400 }); });
  await assert.rejects(harness.props.onSave("https://preview.example.test"), (error) => {
    assert.equal(error.kind, "rejected");
    assert.equal(error.message, "safe:VALIDATION_FAILED");
    return true;
  });
});

test("reconciles uncertain saves by reading the latest value and retains both outcome messages", async () => {
  const harness = makeHarness();
  await mount(harness);
  let reads = 0;
  const latest = { ...response, configuredOrigin: "https://preview.example.test", effectiveOrigin: "https://preview.example.test" };
  harness.setSaveOrigin(async () => { throw Object.assign(new Error("timeout"), { httpStatus: 503 }); });
  harness.setReadOrigin(async () => { reads += 1; return latest; });
  await assert.rejects(harness.props.onSave("https://preview.example.test"), (error) => {
    assert.equal(error.kind, "unconfirmed");
    assert.match(error.message, /latest origin setting has been refreshed/);
    return true;
  });
  assert.equal(reads, 1);
  assert.equal(harness.props.readState.configuredOrigin, "https://preview.example.test");

  const unavailable = makeHarness();
  await mount(unavailable);
  unavailable.setSaveOrigin(async () => { throw new Error("connection reset"); });
  unavailable.setReadOrigin(async () => { throw new Error("connection reset"); });
  await assert.rejects(unavailable.props.onSave("https://preview.example.test"), (error) => {
    assert.equal(error.kind, "unconfirmed");
    assert.match(error.message, /Retry the origin check/);
    return true;
  });
  assert.equal(unavailable.props.readState.status, "error");
});

test("blocks duplicate saves while a write is in flight", async () => {
  const harness = makeHarness();
  const pending = deferred();
  let writes = 0;
  harness.setSaveOrigin(() => { writes += 1; return pending.promise; });
  await mount(harness);

  const first = harness.props.onSave("https://preview.example.test");
  const second = await harness.props.onSave("https://work.example.test");
  assert.equal(second, undefined);
  assert.equal(writes, 1);
  pending.resolve(response);
  await first;
});

test("ignores stale reads and rejects writes after the identity or command context changes", async () => {
  const staleRead = deferred();
  const stale = makeHarness();
  stale.setReadOrigin(() => staleRead.promise);
  const mounting = mount(stale);
  await new Promise((resolve) => setImmediate(resolve));
  stale.setPageCurrent(false);
  staleRead.resolve(response);
  await mounting;
  assert.equal(stale.events.some((event) => event.snapshot), false);
  assert.equal(stale.events.some((event) => event.render?.props.readState.status === "ready"), false);

  const identityChanged = makeHarness();
  const write = deferred();
  identityChanged.setSaveOrigin(() => write.promise);
  await mount(identityChanged);
  const saving = identityChanged.props.onSave("https://preview.example.test");
  identityChanged.state.identityEpoch += 1;
  write.resolve(response);
  await assert.rejects(saving, (error) => {
    assert.equal(error.kind, "unconfirmed");
    return true;
  });

  const commandChanged = makeHarness();
  await mount(commandChanged);
  commandChanged.setCommandCurrent(false);
  await assert.rejects(commandChanged.props.onSave("https://preview.example.test"), (error) => {
    assert.equal(error.kind, "rejected");
    assert.match(error.message, /Settings changed before this origin could be saved/);
    return true;
  });
});

test("recovers protected permission failures and reports feature-load failure to the bridge", async () => {
  const recovered = makeHarness({ recoverResult: true });
  recovered.setReadOrigin(async () => { throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }); });
  await mount(recovered);
  assert.equal(recovered.events.some((event) => event.recovered), true);
  assert.equal(recovered.events.some((event) => event.cleared), false);

  const failed = makeHarness();
  failed.setLoadFeature(async () => { throw new Error("chunk load failed"); });
  await mount(failed);
  assert.deepEqual(failed.originBridge.current, {
    status: "error",
    message: "Public origin settings could not load. Reload Settings to try again.",
  });
  assert.deepEqual(failed.events.at(-1).replaced, [{
    message: "Public origin settings could not load. Reload Settings to try again.",
    kind: "error",
  }]);
});
