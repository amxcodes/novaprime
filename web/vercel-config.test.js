import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVercelConfig } from "./vercel-config.ts";

const webRoot = dirname(fileURLToPath(import.meta.url));

test("maps the feature module tree as first-class static assets", () => {
  const config = createVercelConfig(undefined);
  expect(config.rewrites).toContainEqual({ source: "/features/:path*", destination: "/web/features/:path*" });
  expect(existsSync(resolve(webRoot, "src/features/work/task-detail/TaskDetail.tsx"))).toBe(true);
  expect(existsSync(resolve(webRoot, "src/features/work/task-detail/projection.ts"))).toBe(true);
  expect(existsSync(resolve(webRoot, "src/features/work/WorkSavedTaskViews.tsx"))).toBe(true);
  expect(existsSync(resolve(webRoot, "src/features/work/SettingsSavedTaskViews.tsx"))).toBe(true);
  expect(existsSync(resolve(webRoot, "src/features/work/index.ts"))).toBe(true);
  expect(existsSync(resolve(webRoot, "features/attendance/recovery.js"))).toBe(true);
});

test("feature module asset routing precedes the application-shell fallback", () => {
  const config = createVercelConfig(undefined);
  const featureRoute = config.rewrites.findIndex((route) => route.source === "/features/:path*");
  const fallbackRoute = config.rewrites.findIndex((route) => route.source === "/:path*");
  expect(featureRoute).toBeGreaterThanOrEqual(0);
  expect(featureRoute).toBeLessThan(fallbackRoute);
});

test("serves generated Vite assets and the root, invitation, and reset entries", () => {
  const config = createVercelConfig(undefined);
  const apiRoute = config.rewrites.findIndex((route) => route.source === "/api/:path*");
  const assetsRoute = config.rewrites.findIndex((route) => route.source === "/assets/:path*");
  const fallbackRoute = config.rewrites.findIndex((route) => route.source === "/:path*");

  expect(config.buildCommand).toBe("bun run build:web");
  expect(config.rewrites).toContainEqual({ source: "/assets/:path*", destination: "/web/dist/assets/:path*" });
  expect(config.rewrites).toContainEqual({ source: "/accept-invite", destination: "/web/dist/accept-invite/index.html" });
  expect(config.rewrites).toContainEqual({ source: "/reset-password", destination: "/web/dist/reset-password/index.html" });
  expect(config.rewrites).toContainEqual({ source: "/", destination: "/web/dist/index.html" });
  expect(config.headers).toContainEqual({
    source: "/assets/:path*",
    headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
  });
  expect(config.headers).toContainEqual({
    source: "/",
    headers: [{ key: "Cache-Control", value: "no-store" }],
  });
  expect(config.rewrites.at(-1)?.destination).toBe("/web/dist/index.html");
  expect(apiRoute).toBe(0);
  expect(assetsRoute).toBeGreaterThan(apiRoute);
  expect(assetsRoute).toBeLessThan(fallbackRoute);
  expect(existsSync(resolve(webRoot, "index.html"))).toBe(true);
  expect(existsSync(resolve(webRoot, "accept-invite/index.html"))).toBe(true);
  expect(existsSync(resolve(webRoot, "reset-password/index.html"))).toBe(true);
});
