import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const read = () => readFileSync(new URL("./AssignmentList.module.css", import.meta.url), "utf8");

describe("assignment list responsive contract", () => {
  it("adapts card actions to the available feature width", () => {
    const css = read();

    expect(css).toMatch(/\.state\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*assignments;/s);
    expect(css).toMatch(/@container assignments\s*\(max-width:\s*39\.999rem\)[\s\S]*?\.item\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(css).toMatch(/@container assignments\s*\(max-width:\s*22\.5rem\)[\s\S]*?\.item,[\s\S]*?padding-inline:\s*var\(--nova-space-3\);/);
    expect(css).not.toMatch(/@media\s*\(max-width:/);
  });
});
