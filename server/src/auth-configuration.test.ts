import { expect, test } from "bun:test";
import {
  authenticationIpAddressHeaders,
  canSkipDatabaseTrustedOrigins,
} from "./auth-configuration";

test("Netlify auth uses only its trusted context-derived private IP header", () => {
  expect(authenticationIpAddressHeaders({
    NOVA_AUTH_IP_ADDRESS_HEADER: "x-nova-remote-ip",
    NOVA_TRUST_PROXY_HEADERS: "true",
  } as NodeJS.ProcessEnv)).toEqual(["x-nova-remote-ip"]);
});

test("Cloudflare keeps the existing trusted edge IP headers", () => {
  expect(authenticationIpAddressHeaders({
    NOVA_TRUST_PROXY_HEADERS: "true",
  } as NodeJS.ProcessEnv)).toEqual([
    "cf-connecting-ip",
    "x-forwarded-for",
    "x-real-ip",
  ]);
});

test("direct Node keeps its private socket IP header and safe missing-IP fallback", () => {
  expect(authenticationIpAddressHeaders({} as NodeJS.ProcessEnv))
    .toEqual(["x-nova-remote-ip"]);
});

test("skips the dynamic-origin database read only for the read-only session endpoint", () => {
  expect(canSkipDatabaseTrustedOrigins(new Request("https://nova.test/api/auth/get-session"))).toBe(true);
  expect(canSkipDatabaseTrustedOrigins(new Request("https://nova.test/api/auth/get-session", {
    method: "POST",
  }))).toBe(false);
  expect(canSkipDatabaseTrustedOrigins(new Request("https://nova.test/api/auth/verify-email"))).toBe(false);
  expect(canSkipDatabaseTrustedOrigins()).toBe(false);
});
