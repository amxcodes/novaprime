import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

const compose = await readFile(new URL("../../docker/compose.yaml", import.meta.url), "utf8");
const proxyConfig = await readFile(new URL("../../docker/nginx/default.conf", import.meta.url), "utf8");

describe("self-hosted Docker entry point", () => {
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

  test("Nginx forwards only to the internal API and sets trusted proxy metadata", () => {
    expect(proxyConfig).toContain("proxy_pass http://api:3001");
    expect(proxyConfig).toContain("proxy_set_header X-Forwarded-Host $host");
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
});
