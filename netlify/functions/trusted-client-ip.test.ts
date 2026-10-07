import { expect, test } from "bun:test";
import {
  NETLIFY_CONTEXT_IP_HEADER,
  requestWithNetlifyContextIp,
} from "./trusted-client-ip";

test("uses Netlify context IP and preserves request content and proxy headers", async () => {
  const request = new Request("https://nova.example.test/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-host": "nova.example.test",
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify({ email: "person@example.test" }),
  });

  const forwarded = requestWithNetlifyContextIp(request, "  198.51.100.24  ");

  expect(forwarded.headers.get(NETLIFY_CONTEXT_IP_HEADER)).toBe("198.51.100.24");
  expect(forwarded.headers.get("x-forwarded-host")).toBe("nova.example.test");
  expect(forwarded.headers.get("x-forwarded-proto")).toBe("https");
  expect(await forwarded.json()).toEqual({ email: "person@example.test" });
});

test("overwrites a caller-supplied private IP header with Netlify context", () => {
  const request = new Request("https://nova.example.test/api/auth/get-session", {
    headers: { [NETLIFY_CONTEXT_IP_HEADER]: "203.0.113.250" },
  });

  const forwarded = requestWithNetlifyContextIp(request, "198.51.100.24");

  expect(forwarded.headers.get(NETLIFY_CONTEXT_IP_HEADER)).toBe("198.51.100.24");
});

test("removes a spoofed private IP header when Netlify context has no address", () => {
  const request = new Request("https://nova.example.test/api/auth/get-session", {
    headers: { [NETLIFY_CONTEXT_IP_HEADER]: "203.0.113.250" },
  });

  const forwarded = requestWithNetlifyContextIp(request, undefined);

  expect(forwarded.headers.has(NETLIFY_CONTEXT_IP_HEADER)).toBe(false);
});
