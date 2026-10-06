import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const styles = readFileSync(new URL("./MyDayPage.module.css", import.meta.url), "utf8");
const leaveStyles = readFileSync(new URL("./LeaveRequestPanel.module.css", import.meta.url), "utf8");
const foundationTokens = readFileSync(new URL("../../design-system/foundations/tokens.css", import.meta.url), "utf8");

describe("My Day page layout", () => {
  it("owns its page, module, and shortcut presentation with CSS module selectors", () => {
    expect(styles).toContain(".page {");
    expect(styles).toContain(".moduleGrid {");
    expect(styles).toContain(".shortcuts {");
    expect(styles).toContain(".shortcutGrid {");
    expect(styles).not.toContain(":global(");
  });

  it("keeps shortcut actions readable, keyboard visible, and theme-token driven", () => {
    expect(styles).toContain(".shortcut:focus-visible");
    expect(styles).toContain("var(--nova-color-focus)");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain("var(--nova-control-touch-target)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (forced-colors: active)");
  });

  it("reflows shortcut actions to two columns on tablet and one on phone", () => {
    expect(styles).toMatch(/@container my-day-page\s*\(max-width:\s*60rem\)[\s\S]*?\.shortcutGrid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    expect(styles).toMatch(/@container my-day-page\s*\(max-width:\s*40rem\)[\s\S]*?\.shortcutGrid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(styles).toMatch(/@container my-day-page\s*\(max-width:\s*40rem\)[\s\S]*?\.moduleGrid \{ grid-template-columns: minmax\(0, 1fr\);/);
  });

  it("gives assignments the wide task surface and keeps module headings readable", () => {
    expect(styles).toMatch(/\.module\[data-my-day-module="assignments"\]\s*\{\s*grid-column:\s*1\s*\/\s*-1;/);
    expect(styles).toMatch(/\.module\[data-my-day-module="assignments"\] \.moduleHeader\s*\{[^}]*display:\s*grid;[^}]*border-block-end:\s*0;/s);
    expect(styles).toMatch(/\.module\[data-my-day-module="assignments"\] \.moduleHeader p\s*\{[^}]*text-align:\s*start;/s);
    expect(styles).toMatch(/@container my-day-page\s*\(max-width:\s*40rem\)[\s\S]*?\.module\[data-my-day-module="assignments"\]\s*\{\s*grid-column:\s*auto;/);
    expect(styles).toMatch(/\.moduleHeader\s*\{[\s\S]*?align-items:\s*baseline;[\s\S]*?justify-content:\s*space-between/);
    expect(styles).toMatch(/@container my-day-page\s*\(max-width:\s*40rem\)[\s\S]*?\.moduleHeader\s*\{[^}]*flex-direction:\s*column/);
  });

  it("keeps Leave form breakpoints within the width its My Day island can reach", () => {
    const wideContentWidth = Number(foundationTokens.match(/--nova-content-max:\s*(\d+)rem/)?.[1]);
    const userWideContentWidth = Number(foundationTokens.match(/data-content-width="wide"\]\s*\{\s*--nova-content-max:\s*(\d+)rem/)?.[1]);
    const widestConfiguredPage = Math.max(wideContentWidth, userWideContentWidth);

    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toContain(".islandSlot { display: contents; }");
    expect(widestConfiguredPage / 2).toBeLessThan(64);
    expect(leaveStyles).toContain("@container leave-request (min-width: 40rem)");
    expect(leaveStyles).not.toContain("64rem");
  });
});
