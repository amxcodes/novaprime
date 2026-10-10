import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

const compose = await readFile(new URL("../../docker/compose.yaml", import.meta.url), "utf8");
const proxyConfig = await readFile(new URL("../../docker/nginx/default.conf", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../../docker/Dockerfile", import.meta.url), "utf8");

describe("self-hosted Docker entry point", () => {
  test("the production image builds and ships only the generated web application", () => {
    expect(dockerfile).toContain("FROM build AS web-build");
    expect(dockerfile).toContain("COPY vite.config.ts ./vite.config.ts");
    expect(dockerfile).toContain("RUN bun run build:web");
    expect(dockerfile).toContain("COPY --from=web-build /app/web/dist ./web/dist");
    expect(dockerfile).toContain("COPY --from=build /app/web/review-actions.js /app/web/ui-preferences.js ./web/");
    expect(dockerfile).not.toContain("COPY --from=build /app/web ./web");
  });

  test("only the Nginx reverse proxy publishes the NOVA web/API port", () => {
    const apiStart = compose.indexOf("\n  api:");
    const proxyStart = compose.indexOf("\n  nginx:");
    const maintenanceStart = compose.indexOf("\n  maintenance:");
    expect(apiStart).toBeGreaterThan(-1);
    expect(proxyStart).toBeGreaterThan(apiStart);
    expect(maintenanceStart).toBeGreaterThan(proxyStart);

    const apiService = compose.slice(apiStart, proxyStart);
    const proxyService = compose.slice(proxyStart, maintenanceStart);
    expect(apiService).not.toMatch(/^\s+ports:/m);
    expect(proxyService).toContain("${NOVA_API_BIND_ADDRESS:-127.0.0.1}:${NOVA_API_PORT:-3001}:80");
    expect(proxyService).toContain("condition: service_healthy");
  });

  test("dependent services wait for database-backed API readiness", () => {
    const apiStart = compose.indexOf("\n  api:");
    const proxyStart = compose.indexOf("\n  nginx:");
    const apiService = compose.slice(apiStart, proxyStart);
    expect(apiService).toContain("http://127.0.0.1:3001/api/ready");
    expect(apiService).not.toContain("http://127.0.0.1:3001/api/health");
    expect(compose).toContain("api:\n        condition: service_healthy");
  });

  test("Nginx forwards only to the internal API and sets trusted proxy metadata", () => {
    expect(proxyConfig).toContain("proxy_pass http://api:3001");
    expect(proxyConfig).toContain("proxy_set_header X-Forwarded-Host $http_host;");
    expect(proxyConfig).toContain("proxy_set_header X-Forwarded-Proto $nova_forwarded_proto");
    expect(proxyConfig).toContain("proxy_set_header X-Forwarded-For $nova_forwarded_for");
    expect(proxyConfig).toContain('proxy_set_header CF-Connecting-IP ""');
  });

  test("self-hosted maintenance worker stays alive and uses its configured loop interval", () => {
    const maintenanceStart = compose.indexOf("\n  maintenance:");
    const qaStart = compose.indexOf("\n  qa:");
    const maintenanceService = compose.slice(maintenanceStart, qaStart);
    expect(maintenanceService).toContain('NOVA_MAINTENANCE_LOOP: "true"');
    expect(maintenanceService).toContain("NOVA_MAINTENANCE_INTERVAL_SECONDS: ${NOVA_MAINTENANCE_INTERVAL_SECONDS:-300}");
    expect(maintenanceService).toContain("restart: unless-stopped");
  });

  test("self-hosted API publishes its runtime identity without inventing a release SHA", () => {
    const apiStart = compose.indexOf("\n  api:");
    const proxyStart = compose.indexOf("\n  nginx:");
    const apiService = compose.slice(apiStart, proxyStart);
    expect(apiService).toContain("NOVA_RUNTIME_ADAPTER: ${NOVA_RUNTIME_ADAPTER:-vps}");
    expect(apiService).toContain("NOVA_RUNTIME_ID: ${NOVA_RUNTIME_ID:-docker-compose}");
    expect(apiService).toContain("NOVA_RELEASE_SHA: ${NOVA_RELEASE_SHA:-}");
  });
});
