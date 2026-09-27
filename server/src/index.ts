import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { handleRequest } from "./app.js";

const serveWeb = process.env.NOVA_SERVE_WEB === "true";
const webRoot = fileURLToPath(new URL("../../web/", import.meta.url));
const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

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

  if (
    serveWeb &&
    (request.method === "GET" || request.method === "HEAD") &&
    !pathname.startsWith("/api/") &&
    pathname !== "/api" &&
    pathname !== "/health"
  ) {
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
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid path");
      return;
    }

    const filename = resolve(webRoot, route);
    const relativeFilename = relative(webRoot, filename);
    if (relativeFilename.startsWith("..") || isAbsolute(relativeFilename)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    try {
      const content = await readFile(filename);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentTypes[filename.slice(filename.lastIndexOf("."))] ?? "application/octet-stream",
      });
      response.end(request.method === "HEAD" ? undefined : content);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
  }

  const result = await handleRequest(requestFromNode(request));

  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.statusCode = result.status;

  response.end(Buffer.from(await result.arrayBuffer()));
}

const port = Number(process.env.PORT ?? 3001);

createServer((request, response) => {
  void respond(request, response).catch(() => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
  });
}).listen(port);

console.info(`NOVA API listening on http://localhost:${port}`);
