import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const read = () => readFileSync(new URL("./AssignmentList.module.css", import.meta.url), "utf8");

describe("assignment list responsive contract", () => {
  it("uses a quiet shared surface with separated rows and token-backed states", () => {
    const css = read();
    const component = readFileSync(new URL("./assignment-list.tsx", import.meta.url), "utf8");

    expect(css).toMatch(/\.state\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*assignments;/s);
    expect(css).toMatch(/\.list,[\s\S]*?border:\s*1px solid var\(--nova-color-border\);[\s\S]*?border-radius:\s*var\(--nova-radius-surface\);/);
    expect(css).toMatch(/\.item \+ \.item,[\s\S]*?border-block-start:\s*1px solid var\(--nova-color-border\);/);
    expect(component).toMatch(/import \{ Badge, Button, StateMessage \} from "\.\.\/\.\.\/design-system";/);
    expect(component).toMatch(/<Badge tone=\{status\.tone\}>\{status\.label\}<\/Badge>/);
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgb\(/i);
  });

  it("uses expanded, medium, and compact layouts based on the feature container", () => {
    const css = read();

    expect(css).toMatch(/@container assignments\s*\(min-width:\s*52rem\)[\s\S]*?\.copy \{ grid-template-columns: minmax\(0, 1fr\) minmax\(12rem, max-content\);/);
    expect(css).toMatch(/@container assignments\s*\(min-width:\s*40rem\) and \(max-width:\s*51\.999rem\)[\s\S]*?\.skeletonRow \{ grid-template-columns:/);
    expect(css).toMatch(/@container assignments\s*\(max-width:\s*39\.999rem\)[\s\S]*?\.item \{ grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/@container assignments\s*\(max-width:\s*22\.5rem\)[\s\S]*?\.item,[\s\S]*?padding-inline:\s*var\(--nova-space-3\);/);
    expect(css).not.toMatch(/@media\s*\(max-width:/);
  });

  it("keeps long content and focus states available at each width", () => {
    const css = read();

    expect(css).toMatch(/\.title a:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--nova-color-focus\);/s);
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("@media (any-pointer: coarse)");
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(css).toContain("@media (forced-colors: active)");
  });
});
