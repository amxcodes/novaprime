import { expect, test } from "bun:test";
import { normalizePublicOrigin, publicUrl, rebasePublicUrl } from "./public-origin";

test("normalizes only origin-only http and https URLs", () => {
  expect(normalizePublicOrigin(" https://work.example.test/ ")).toBe("https://work.example.test");
  expect(normalizePublicOrigin("http://localhost:3001")).toBe("http://localhost:3001");
  expect(normalizePublicOrigin("https://work.example.test/app")).toBeUndefined();
  expect(normalizePublicOrigin("javascript:alert(1)")).toBeUndefined();
  expect(normalizePublicOrigin("https://user:password@work.example.test")).toBeUndefined();
});

test("builds and rebases links without losing query or fragment", () => {
  expect(publicUrl("https://work.example.test", "/accept-invite#token=one"))
    .toBe("https://work.example.test/accept-invite#token=one");
  expect(rebasePublicUrl(
    "http://fallback.test/api/auth/verify-email?token=one#safe",
    "https://work.example.test",
  )).toBe("https://work.example.test/api/auth/verify-email?token=one#safe");
});

test("public links cannot escape their configured origin", () => {
  for (const path of [
    "//attacker.example/path",
    String.raw`\\attacker.example\path`,
    "https://attacker.example/path",
  ]) {
    expect(() => publicUrl("https://work.example.test", path)).toThrow("PUBLIC_URL_INVALID");
  }

  expect(publicUrl("https://work.example.test", "/people?tab=active#top"))
    .toBe("https://work.example.test/people?tab=active#top");
});
