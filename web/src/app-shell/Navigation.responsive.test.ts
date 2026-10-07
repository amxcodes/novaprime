import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { EXPANDED_NAVIGATION_MEDIA_QUERY } from "./breakpoints";

const source = readFileSync(new URL("./Navigation.tsx", import.meta.url), "utf8");
const appShellSource = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const appShellStyles = readFileSync(new URL("./AppShell.module.css", import.meta.url), "utf8");
const navigationStyles = readFileSync(new URL("./Navigation.module.css", import.meta.url), "utf8");
const topBarStyles = readFileSync(new URL("./TopBar.module.css", import.meta.url), "utf8");
const designTokens = readFileSync(new URL("../design-system/foundations/tokens.css", import.meta.url), "utf8");

describe("responsive navigation focus", () => {
  test("moves focus into visible desktop navigation when an open drawer closes at desktop width", () => {
    const closeDialog = source.indexOf("dialog.close();");
    const desktopBreakpoint = source.indexOf("window.matchMedia(EXPANDED_NAVIGATION_MEDIA_QUERY).matches", closeDialog);
    const activeLink = source.indexOf("[aria-current=\"page\"]", desktopBreakpoint);
    const fallbackLink = source.indexOf('querySelector<HTMLElement>("a")', activeLink);
    const mainFallback = source.indexOf('getElementById("nova-main-content")', fallbackLink);
    const focusCall = source.indexOf("focusTarget?.focus({ preventScroll: true })", mainFallback);

    expect(closeDialog).toBeGreaterThanOrEqual(0);
    expect(desktopBreakpoint).toBeGreaterThan(closeDialog);
    expect(activeLink).toBeGreaterThan(desktopBreakpoint);
    expect(fallbackLink).toBeGreaterThan(activeLink);
    expect(mainFallback).toBeGreaterThan(fallbackLink);
    expect(focusCall).toBeGreaterThan(mainFallback);
  });

  test("keeps CSS layout and JavaScript drawer behavior on one expanded breakpoint", () => {
    const minWidth = Number(EXPANDED_NAVIGATION_MEDIA_QUERY.match(/\d+/)?.[0]);
    expect(minWidth).toBeGreaterThan(0);
    expect(appShellSource).toContain("window.matchMedia(EXPANDED_NAVIGATION_MEDIA_QUERY)");
    expect(source).toContain("window.matchMedia(EXPANDED_NAVIGATION_MEDIA_QUERY).matches");
    for (const stylesheet of [appShellStyles, navigationStyles]) {
      expect(stylesheet).toContain(`@media (max-width: ${minWidth - 1}px)`);
    }
    expect(topBarStyles).toContain(`@media (min-width: ${minWidth}px)`);
    expect(topBarStyles).toContain(`@media (max-width: ${minWidth - 1}px)`);
  });

  test("uses the 290px expanded and 154px compact desktop rail while retaining current touch navigation breakpoints", () => {
    const minWidth = Number(EXPANDED_NAVIGATION_MEDIA_QUERY.match(/\d+/)?.[0]);
    expect(appShellStyles).toContain("grid-template-columns: var(--nova-navigation-width-expanded) minmax(0, 1fr)");
    expect(appShellStyles).toContain("grid-template-columns: var(--nova-navigation-width-compact) minmax(0, 1fr)");
    expect(designTokens).toContain("--nova-navigation-width-expanded: 18.125rem");
    expect(designTokens).toContain("--nova-navigation-width-compact: 9.625rem");
    expect(appShellStyles).toContain('.shell[data-navigation-state="compact"]');
    expect(appShellSource).toContain('data-navigation-state={navigationCompact ? "compact" : "expanded"}');
    expect(appShellSource).toContain("setNavigationCompact((compact) => !compact)");
    expect(source).toContain("aria-controls={navigationId}");
    expect(source).toContain("aria-expanded={!compact}");
    expect(navigationStyles).toContain("min-height: var(--nova-control-touch-target)");
    expect(navigationStyles).toContain(`@media (max-width: ${minWidth - 1}px)`);
    expect(appShellStyles).toContain("column-gap: var(--nova-space-4)");
    expect(appShellStyles).toContain("padding-inline: var(--nova-space-4)");
    expect(appShellStyles).toContain("padding-inline: 0");
    expect(appShellStyles).toContain('.shell[data-navigation-state="compact"]');
    expect(appShellStyles).toContain('.shell[data-navigation-state="compact"] {\n    grid-template-columns: minmax(0, 1fr)');
    expect(navigationStyles).toContain("@media (max-width: 639px)");
    expect(navigationStyles).toContain("min-height: 3.25rem");
  });

  test("maps Figma light/dark expanded and compact sidebar frames to one token-driven component", () => {
    const compactGroupLabel = navigationStyles.match(/\.compactSidebar \.groupLabel\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(navigationStyles).toContain("border-radius: var(--nova-radius-navigation)");
    expect(navigationStyles).toContain("box-shadow: var(--nova-navigation-shadow)");
    expect(navigationStyles).toContain("background: var(--nova-navigation-surface)");
    expect(designTokens).toContain("--nova-palette-navigation-surface-light: linear-gradient(180deg, #f7f9ff 0%, #e9f1fa 50%, #f2f4fc 100%)");
    expect(designTokens).toContain("--nova-navigation-shadow: var(--nova-palette-navigation-shadow-light)");
    expect(designTokens).toContain("--nova-palette-navigation-surface-dark: #20262f");
    expect(designTokens).toContain("--nova-palette-navigation-edge-dark: #3a4555");
    expect(designTokens).toContain("--nova-navigation-shadow: var(--nova-palette-navigation-shadow-dark)");
    expect(designTokens).toContain("--nova-palette-navigation-control-surface-dark: #2a3544");
    expect(designTokens).toContain("--nova-palette-navigation-selected-surface-dark: #364251");
    expect(navigationStyles).toContain(".compactSidebar .groupLabel");
    expect(navigationStyles).toContain(".compactSidebar .link");
    expect(navigationStyles).toContain(".desktopSidebar .link");
    expect(navigationStyles).toContain("min-height: 1.8125rem");
    expect(navigationStyles).toContain("gap: 0.125rem");
    expect(designTokens).toContain("--nova-navigation-type-label: 0.6rem");
    expect(designTokens).toContain("--nova-navigation-type-label-compact: 0.5125rem");
    expect(designTokens).toContain("--nova-navigation-type-group: 0.44375rem");
    expect(source).toContain("PEOPLE + PROJECTS");
    expect(source).toContain("styles.brandWordmark");
    expect(source).toContain("styles.brandKicker");
    expect(source).not.toContain("styles.toggleIcon");
    expect(source).toContain('{compact ? "Expand" : "Compact"}');
    expect(navigationStyles).toContain(".toggleLabel");
    expect(navigationStyles).toContain(".desktopSidebar .icon { display: none; }");
    expect(compactGroupLabel).toContain("white-space: normal");
    expect(compactGroupLabel).toContain("overflow-wrap: anywhere");
    expect(navigationStyles).toContain("border-radius: var(--nova-radius-option)");
    expect(navigationStyles).toContain("border-radius: var(--nova-radius-control)");
    expect(navigationStyles).toContain(".link[aria-current=\"page\"]");
    expect(navigationStyles).toContain(".desktopSidebar .link[aria-current=\"page\"]::before");
    expect(navigationStyles).toContain("var(--nova-color-control-highlight)");
    expect(navigationStyles).toContain(".drawer .icon { display: none; }");
    expect(source).toContain("item.detail");
    expect(source).toContain('data-tone={item.detailTone ?? "muted"}');
    expect(navigationStyles).toContain('.detail[data-tone="success"]');
    expect(navigationStyles).toContain('.detail[data-tone="warning"]');
    expect(designTokens).toContain("--nova-navigation-type-detail: 0.44375rem");
    expect(designTokens).toContain("--nova-navigation-type-detail-compact: 0.41875rem");
    expect(navigationStyles).toContain("background: var(--nova-color-action-subtle)");
    expect(navigationStyles).toContain("var(--nova-color-focus)");
    expect(navigationStyles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(navigationStyles).not.toContain("data-theme");
    expect(source).not.toContain("styles.currentMark");
    expect(source).toContain("title={compact ? item.label : undefined}");
  });

  test("keeps the tablet drawer and phone quick navigation as reachable responsive adaptations", () => {
    const drawerOpenRule = navigationStyles.match(/\.drawer\[open\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(drawerOpenRule).toContain("display: flex");
    expect(navigationStyles).toContain("@media (max-width: 1199px)");
    expect(navigationStyles).toContain("@media (max-width: 639px)");
    expect(navigationStyles).toContain("@media (pointer: coarse)");
    expect(source).toContain("selectMobileNavigation(groups, mobilePrimaryIds)");
    expect(source).toContain("aria-haspopup=\"dialog\"");
  });

  test("keeps rail resizing motion-reduced and the toggle legible in forced colors", () => {
    const reducedMotionRule = appShellStyles.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? "";
    const forcedColorsRule = navigationStyles.slice(navigationStyles.indexOf("@media (forced-colors: active)"));

    expect(reducedMotionRule).toContain("transition: none");
    expect(forcedColorsRule).toContain(".desktopToggle");
    expect(forcedColorsRule).toContain("ButtonFace");
    expect(forcedColorsRule).toContain("ButtonText");
    expect(forcedColorsRule).toContain("outline-color: Highlight");
  });

  test("uses an opaque theme-token backdrop when reduced transparency is requested", () => {
    const reducedTransparencyRule = navigationStyles.match(
      /@media \(prefers-reduced-transparency: reduce\)\s*\{\s*\.drawer::backdrop\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(reducedTransparencyRule).toContain("var(--nova-color-text-primary)");
    expect(reducedTransparencyRule).toContain("var(--nova-color-surface)");
    expect(reducedTransparencyRule).not.toContain("transparent");
  });

  test("preserves reachable navigation and minimum quick-action width at extreme compact widths", () => {
    const extremeCompactRule = navigationStyles.match(
      /@media \(max-width: 15\.75rem\)\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? "";

    expect(extremeCompactRule).toContain(".bottomItem:not(:last-child)");
    expect(extremeCompactRule).toContain("display: none");
    expect(extremeCompactRule).toContain(".bottomItem:last-child");
    expect(extremeCompactRule).toContain("flex: 1 1 auto");
    expect(extremeCompactRule).toContain("min-width: var(--nova-control-touch-target)");
    expect(source).toContain('<span className={styles.bottomLabel}>More</span>');
  });

  test("returns keyboard focus to the control that opened the drawer on compact viewports", () => {
    expect(appShellSource).toContain("navigationTriggerRef.current = event.currentTarget");
    expect(appShellSource).toContain("restoreFocus={() => navigationTriggerRef.current}");
    expect(source).toContain("trigger?.getClientRects().length");
    expect(source).toContain("focusTarget?.focus({ preventScroll: true })");
    expect(source).toContain("onClick={(event) => onOpen?.(event)}");
  });

  test("keeps the mobile header, drawer, and content clear of device safe areas", () => {
    expect(topBarStyles).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(topBarStyles).toContain("env(safe-area-inset-left)");
    expect(topBarStyles).toContain("env(safe-area-inset-top)");
    expect(topBarStyles).toContain("overflow-x: auto");
    expect(navigationStyles).toContain("env(safe-area-inset-bottom)");
    expect(navigationStyles).toContain("env(safe-area-inset-right)");
    expect(appShellStyles).toContain("env(safe-area-inset-top)");
    expect(readFileSync(new URL("./ContentFrame.module.css", import.meta.url), "utf8"))
      .toContain("env(safe-area-inset-left)");
  });

  test("uses the bottom More action as the single phone drawer trigger when quick navigation exists", () => {
    const phoneRules = topBarStyles.match(/@media \(max-width: 639px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(appShellSource).toContain("selectMobileNavigation(navigation, mobilePrimaryIds).length > 0");
    expect(phoneRules).toContain(".menuButtonWithBottomNavigation");
    expect(phoneRules).toContain("display: none");
    expect(topBarStyles).toContain("@media (max-width: 1199px)");
  });
});
