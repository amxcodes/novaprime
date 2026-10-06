import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticWebResponse } from "./index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function roots() {
  const base = await mkdtemp(join(tmpdir(), "nova-static-web-"));
  temporaryRoots.push(base);
  const generated = join(base, "dist");
  const legacy = join(base, "web");
  await Promise.all([mkdir(generated, { recursive: true }), mkdir(legacy, { recursive: true })]);
  return { generated, legacy };
}

async function asset(root: string, path: string, content: string) {
  const filename = join(root, path);
  await mkdir(join(filename, ".."), { recursive: true });
  await writeFile(filename, content);
}

async function get(path: string, webRoots: Awaited<ReturnType<typeof roots>>, method = "GET") {
  return staticWebResponse(new URL(path, "https://nova.example").pathname, method, webRoots);
}

test("serves generated root, invitation, and reset entries before legacy sources", async () => {
  const webRoots = await roots();
  await asset(webRoots.generated, "index.html", "built root");
  await asset(webRoots.generated, "accept-invite/index.html", "built invite");
  await asset(webRoots.generated, "reset-password/index.html", "built reset");
  await asset(webRoots.legacy, "index.html", "legacy root");
  await asset(webRoots.legacy, "app.js", "legacy module");

  const root = await get("/", webRoots);
  const invite = await get("/accept-invite#token=private", webRoots);
  const reset = await get("/reset-password?token=private", webRoots);
  const legacy = await get("/app.js", webRoots);

  expect(await root?.text()).toBe("built root");
  expect(await invite?.text()).toBe("built invite");
  expect(await reset?.text()).toBe("built reset");
  expect(await legacy?.text()).toBe("legacy module");
  expect(root?.headers.get("cache-control")).toBe("no-store");
  expect(invite?.headers.get("content-type")).toBe("text/html; charset=utf-8");
});

test("serves hashed JavaScript, CSS, and fonts with immutable caching and correct MIME types", async () => {
  const webRoots = await roots();
  await asset(webRoots.generated, "assets/app-a1b2c3d4.js", "js");
  await asset(webRoots.generated, "assets/app-e5f6a7b8.css", "css");
  await asset(webRoots.generated, "assets/Geist-c9d0e1f2.woff2", "font");

  const script = await get("/assets/app-a1b2c3d4.js", webRoots);
  const stylesheet = await get("/assets/app-e5f6a7b8.css", webRoots);
  const font = await get("/assets/Geist-c9d0e1f2.woff2", webRoots);

  for (const response of [script, stylesheet, font]) {
    expect(response?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  }
  expect(script?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  expect(stylesheet?.headers.get("content-type")).toBe("text/css; charset=utf-8");
  expect(font?.headers.get("content-type")).toBe("font/woff2");
});

test("keeps un-hashed files short-lived, supports HEAD, and does not intercept API routes", async () => {
  const webRoots = await roots();
  await asset(webRoots.generated, "assets/app.js", "dev asset");

  const unhashed = await get("/assets/app.js", webRoots);
  const head = await get("/assets/app.js", webRoots, "HEAD");

  expect(unhashed?.headers.get("cache-control")).toBe("no-store");
  expect(head?.status).toBe(200);
  expect(await head?.text()).toBe("");
  expect(await get("/api/health", webRoots)).toBeUndefined();
  expect(await get("/health", webRoots)).toBeUndefined();
  expect(await get("/api", webRoots)).toBeUndefined();
  expect(await get("/assets/app.js", webRoots, "POST")).toBeUndefined();
});

test("rejects traversal and invalid escapes instead of reading outside the asset roots", async () => {
  const webRoots = await roots();

  const traversal = await staticWebResponse("/%2e%2e%2fsecret.txt", "GET", webRoots);
  const malformed = await staticWebResponse("/bad%zz", "GET", webRoots);
  const nul = await staticWebResponse("/bad%00name.js", "GET", webRoots);

  expect(traversal?.status).toBe(403);
  expect(await traversal?.text()).toBe("Forbidden");
  expect(malformed?.status).toBe(400);
  expect(await malformed?.text()).toBe("Invalid path");
  expect(nul?.status).toBe(400);
});
