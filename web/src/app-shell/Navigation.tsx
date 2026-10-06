import { useEffect, useRef, type MouseEvent } from "react";
import type { ReactNode } from "react";
import { IconButton } from "../design-system/primitives/Button";
import type { AppNavigationGroup, AppNavigationItem } from "./contracts";
import { EXPANDED_NAVIGATION_MEDIA_QUERY } from "./breakpoints";
import { selectMobileNavigation } from "./navigation-model";
import styles from "./Navigation.module.css";

interface NavigationProps {
  groups: readonly AppNavigationGroup[];
  activeItemId?: string;
  onNavigate?: (item: AppNavigationItem) => void;
  onClose?: () => void;
  onOpen?: () => void;
  mobilePrimaryIds?: readonly string[];
  drawerOpen?: boolean;
  drawerId: string;
  brand: ReactNode;
  sidebarFooter?: ReactNode;
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}

function navigate(
  event: MouseEvent<HTMLAnchorElement>,
  item: AppNavigationItem,
  onNavigate?: (item: AppNavigationItem) => void,
) {
  if (!onNavigate || item.external || !isPlainLeftClick(event)) return;
  event.preventDefault();
  onNavigate(item);
}

function NavigationLinks({
  groups,
  activeItemId,
  onNavigate,
  onItemSelected,
  compact = false,
}: {
  groups: readonly AppNavigationGroup[];
  activeItemId?: string;
  onNavigate?: (item: AppNavigationItem) => void;
  onItemSelected?: () => void;
  compact?: boolean;
}) {
  return (
    <nav aria-label="Primary navigation" className={styles.navigation}>
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <section className={styles.group} key={group.id}>
          {group.label ? <h2 className={styles.groupLabel}>{group.label}</h2> : null}
          <ul className={styles.list}>
            {group.items.map((item) => {
              const current = activeItemId === item.id;
              return (
                <li className={styles.listItem} key={item.id}>
                  <a
                    aria-current={current ? "page" : undefined}
                    className={styles.link}
                    href={item.href}
                    onClick={(event) => {
                      const closeDrawer = isPlainLeftClick(event) && !item.external;
                      navigate(event, item, onNavigate);
                      if (closeDrawer) onItemSelected?.();
                    }}
                    title={compact ? item.label : undefined}
                  >
                    <span aria-hidden="true" className={styles.icon}>
                      {item.icon}
                    </span>
                    <span className={styles.label}>{item.label}</span>
                    {current ? <span className={styles.currentMark} aria-hidden="true" /> : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export function DesktopSidebar({
  groups,
  activeItemId,
  onNavigate,
  brand,
  sidebarFooter,
}: Pick<NavigationProps, "groups" | "activeItemId" | "onNavigate" | "brand" | "sidebarFooter">) {
  return (
    <aside aria-label="Workspace" className={styles.desktopSidebar}>
      <div className={styles.brand}>{brand}</div>
      <NavigationLinks groups={groups} activeItemId={activeItemId} onNavigate={onNavigate} />
      {sidebarFooter ? <div className={styles.sidebarFooter}>{sidebarFooter}</div> : null}
    </aside>
  );
}

interface NavigationDrawerProps extends Pick<NavigationProps, "groups" | "activeItemId" | "onNavigate" | "onClose" | "drawerOpen" | "drawerId" | "brand" | "sidebarFooter"> {}

export function NavigationDrawer({
  groups,
  activeItemId,
  onNavigate,
  onClose,
  drawerOpen = false,
  drawerId,
  brand,
  sidebarFooter,
}: NavigationDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (drawerOpen && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("a, button")?.focus();
    } else if (!drawerOpen && dialog.open) {
      dialog.close();
      if (window.matchMedia(EXPANDED_NAVIGATION_MEDIA_QUERY).matches) {
        const desktopNavigation = document.querySelector<HTMLElement>(`.${styles.desktopSidebar}`);
        const focusTarget =
          desktopNavigation?.querySelector<HTMLElement>('[aria-current="page"]') ??
          desktopNavigation?.querySelector<HTMLElement>("a") ??
          document.getElementById("nova-main-content");
        focusTarget?.focus({ preventScroll: true });
      }
    }
  }, [drawerOpen]);

  return (
    <dialog
      aria-label="Navigation"
      className={styles.drawer}
      id={drawerId}
      onCancel={(event) => {
        event.preventDefault();
        onClose?.();
      }}
      onClose={() => onClose?.()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
      ref={dialogRef}
    >
      <div className={styles.drawerHeader}>
        <div className={styles.brand}>{brand}</div>
        <IconButton aria-label="Close navigation" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
      <NavigationLinks
        activeItemId={activeItemId}
        groups={groups}
        onNavigate={onNavigate}
        onItemSelected={onClose}
      />
      {sidebarFooter ? <div className={styles.drawerFooter}>{sidebarFooter}</div> : null}
    </dialog>
  );
}

export function MobileBottomNavigation({
  groups,
  activeItemId,
  onNavigate,
  mobilePrimaryIds,
  drawerOpen,
  onOpen,
  drawerId,
}: Pick<NavigationProps, "groups" | "activeItemId" | "onNavigate" | "mobilePrimaryIds" | "drawerOpen" | "onOpen" | "drawerId">) {
  const items = selectMobileNavigation(groups, mobilePrimaryIds);
  if (items.length === 0) return null;

  return (
    <nav aria-label="Quick navigation" className={styles.bottomNavigation}>
      <ul className={styles.bottomList}>
        {items.map((item) => {
          const current = item.id === activeItemId;
          return (
            <li className={styles.bottomItem} key={item.id}>
              <a
                aria-current={current ? "page" : undefined}
                className={styles.bottomLink}
                href={item.href}
                onClick={(event) => navigate(event, item, onNavigate)}
              >
                <span aria-hidden="true" className={styles.bottomIcon}>{item.icon}</span>
                <span className={styles.bottomLabel}>{item.label}</span>
              </a>
            </li>
          );
        })}
        <li className={styles.bottomItem}>
          <button
            aria-controls={drawerId}
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            className={styles.bottomLink}
            onClick={onOpen}
            type="button"
          >
            <span aria-hidden="true" className={styles.bottomIcon}><MoreIcon /></span>
            <span className={styles.bottomLabel}>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

export function NavigationMenuButton({
  expanded,
  controls,
  onClick,
}: {
  expanded: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <IconButton
      aria-controls={controls}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      aria-label={expanded ? "Close navigation" : "Open navigation"}
      onClick={onClick}
    >
      <MenuIcon />
    </IconButton>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="16" cy="10" r="1.4" />
    </svg>
  );
}
