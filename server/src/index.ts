import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { handleRequest } from "./app.js";

const serveWeb = process.env.NOVA_SERVE_WEB === "true";
const webRoot = fileURLToPath(new URL("../../web/", import.meta.url));
const generatedWebRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const contentTypes: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const immutableAssetCache = "public, max-age=31536000, immutable";
const noStoreCache = "no-store";

type StaticWebRoots = Readonly<{ generated: string; legacy: string }>;

async function readFileFromRoot(root: string, route: string): Promise<Buffer | undefined> {
  const filename = resolve(root, route);
  const relativeFilename = relative(root, filename);
  if (relativeFilename.startsWith("..") || isAbsolute(relativeFilename)) return undefined;

  try {
    return await readFile(filename);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return undefined;
    throw error;
  }
}

/**
 * Read the built Vite graph first while retaining the source tree as a
 * compatibility fallback until each deployment has a verified dist build.
 */
export async function staticWebResponse(
  pathname: string,
  method: string,
  roots: StaticWebRoots = { generated: generatedWebRoot, legacy: webRoot },
): Promise<Response | undefined> {
  if (!new Set(["GET", "HEAD"]).has(method.toUpperCase()) || pathname === "/api" ||
      pathname.startsWith("/api/") || pathname === "/health") return undefined;

  let route = pathname === "/"
    ? "index.html"
    : pathname === "/accept-invite" || pathname === "/accept-invite/"
      ? "accept-invite/index.html"
      : pathname === "/reset-password" || pathname === "/reset-password/"
        ? "reset-password/index.html"
        : pathname.slice(1);

  try {
    route = decodeURIComponent(route);
  } catch {
    return new Response("Invalid path", {
      status: 400,
      headers: { "cache-control": noStoreCache, "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (route.includes("\0")) {
    return new Response("Invalid path", {
      status: 400,
      headers: { "cache-control": noStoreCache, "content-type": "text/plain; charset=utf-8" },
    });
  }

  for (const root of [roots.generated, roots.legacy]) {
    const filename = resolve(root, route);
    const relativeFilename = relative(root, filename);
    if (relativeFilename.startsWith("..") || isAbsolute(relativeFilename)) {
      return new Response("Forbidden", {
        status: 403,
        headers: { "cache-control": noStoreCache, "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  const generatedContent = await readFileFromRoot(roots.generated, route);
  const legacyContent = generatedContent ? undefined : await readFileFromRoot(roots.legacy, route);
  const content = generatedContent ?? legacyContent;
  if (!content) {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": noStoreCache, "content-type": "text/plain; charset=utf-8" },
    });
  }

  const extension = extname(route).toLowerCase();
  const isHashedBuildAsset = Boolean(generatedContent) && route.startsWith("assets/") &&
    /-[a-z0-9_-]{8}\.[a-z0-9]+$/i.test(route);
  return new Response(method.toUpperCase() === "HEAD" ? null : new Uint8Array(content), {
    status: 200,
    headers: {
      "cache-control": isHashedBuildAsset ? immutableAssetCache : noStoreCache,
      "content-type": contentTypes[extension] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    },
  });
}

function requestFromNode(request: IncomingMessage): Request {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  // Fetch Request does not expose the Node socket address. Carry it through a
  // private adapter-only header when no trusted reverse proxy is configured;
  // the value is overwritten here and cannot be supplied by the caller.
  if (process.env.NOVA_TRUST_PROXY_HEADERS !== "true") {
    headers.set("x-nova-remote-ip", request.socket.remoteAddress ?? "");
  }

  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : (Readable.toWeb(request) as unknown as BodyInit);

  const trustProxyHeaders = process.env.NOVA_TRUST_PROXY_HEADERS === "true";
  const forwardedHost = trustProxyHeaders ? headers.get("x-forwarded-host")?.split(",")[0]?.trim() : undefined;
  const host = forwardedHost || headers.get("host") || "localhost";
  const forwardedProtocol = trustProxyHeaders ? headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http"
    ? forwardedProtocol
    : "http";

  return new Request(`${protocol}://${host}${request.url ?? "/"}`, {
    body,
    duplex: "half",
    headers,
    method,
  } as RequestInit & { duplex: "half" });
}

async function respond(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const pathname = new URL(
    request.url ?? "/",
    "http://" + (request.headers.host ?? "localhost"),
  ).pathname;

  if (serveWeb && (request.method === "GET" || request.method === "HEAD")) {
    const staticResponse = await staticWebResponse(pathname, request.method);
    if (staticResponse) {
      staticResponse.headers.forEach((value, name) => response.setHeader(name, value));
      response.statusCode = staticResponse.status;
      response.end(request.method === "HEAD" ? undefined : Buffer.from(await staticResponse.arrayBuffer()));
      return;
    }
  }

  const result = await handleRequest(requestFromNode(request));

  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.statusCode = result.status;

  response.end(Buffer.from(await result.arrayBuffer()));
}

function startServer(): void {
  const port = Number(process.env.PORT ?? 3001);
  createServer((request, response) => {
    void respond(request, response).catch(() => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
    });
  }).listen(port);

  console.info(`NOVA API listening on http://localhost:${port}`);
}

// Keep the adapter importable for focused static-response tests.
if (serveWeb || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) startServer();
