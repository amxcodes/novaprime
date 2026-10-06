import type { ReactNode } from "react";
import { Button } from "../design-system/primitives/Button";
import type { AppNavigationGroup, AppNavigationItem } from "./contracts";
import { AppShell } from "./AppShell";
import { NavigationIcon } from "./NavigationIcon";
import styles from "./LegacyRouteShell.module.css";
import { LegacyMyDayPage } from "../features/my-day/LegacyMyDayPage";

export interface LegacyRouteDestination {
  id: string;
  label: string;
  group: string;
  href: string;
}

export interface LegacyRouteShellProps {
  children: ReactNode;
  destinations: readonly LegacyRouteDestination[];
  activeItemId: string;
  displayName: string;
  currentPageLabel: string;
  unreadCount: number | null;
  navigationNotice?: string;
  onNavigate: (item: AppNavigationItem) => void;
}

function buildGroups(destinations: readonly LegacyRouteDestination[]): AppNavigationGroup[] {
  const groups: AppNavigationGroup[] = [];
  for (const destination of destinations) {
    let group = groups.find((candidate) => candidate.label === destination.group);
    if (!group) {
      group = { id: destination.group.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: destination.group, items: [] };
      groups.push(group);
    }
    group.items = [...group.items, {
      id: destination.id,
      label: destination.label,
      href: destination.href,
      icon: <NavigationIcon destination={destination.id} />,
    }];
  }
  return groups;
}

function UserBadge({ displayName }: { displayName: string }) {
  const name = displayName.trim() || "NOVA account";
  const initial = Array.from(name)[0]?.toLocaleUpperCase() ?? "N";
  return (
    <div className={styles.user}>
      <span className={styles.avatar} aria-hidden="true">{initial}</span>
      <span className={styles.userCopy}>
        <strong>{name}</strong>
        <span>Signed in</span>
      </span>
    </div>
  );
}

export function LegacyRouteShell({
  children,
  destinations,
  activeItemId,
  displayName,
  currentPageLabel,
  unreadCount,
  navigationNotice,
  onNavigate,
}: LegacyRouteShellProps) {
  const groups = buildGroups(destinations);
  const safeUnreadCount = typeof unreadCount === "number" && Number.isSafeInteger(unreadCount) && unreadCount > 0
    ? unreadCount
    : 0;
  const notificationLabel = safeUnreadCount === 1
    ? "1 unread notification"
    : `${safeUnreadCount} unread notifications`;
  const topActions = (
    <>
      <Button
        aria-label={safeUnreadCount ? `Notifications, ${notificationLabel}` : "Notifications"}
        className={styles.notificationAction}
        data-nav="notifications"
        variant="quiet"
      >
        <NotificationIcon />
        <span>Notifications</span>
        {safeUnreadCount ? <span className={`${styles.unreadBadge} nav-count`} aria-hidden="true">{safeUnreadCount > 99 ? "99+" : safeUnreadCount}</span> : null}
      </Button>
      <span id="notification-unread-status" className={styles.srOnly} aria-live="polite" aria-atomic="true" />
    </>
  );
  const footer = (
    <>
      <UserBadge displayName={displayName} />
      {navigationNotice ? <p className={styles.navigationNotice} role="status">{navigationNotice}</p> : null}
      <Button data-nav="settings" variant="quiet" size="compact">Personalize</Button>
      <Button className={styles.signOut} data-action="logout" variant="quiet" size="compact">Sign out</Button>
    </>
  );

  return (
    <AppShell
      activeItemId={activeItemId}
      brand={<span className={styles.wordmark}>NOVA<span aria-hidden="true">·</span></span>}
      currentPageLabel={currentPageLabel}
      headerActions={topActions}
      mobilePrimaryIds={groups.flatMap((group) => group.items).map((item) => item.id).slice(0, 4)}
      navigation={groups}
      onNavigate={onNavigate}
      sidebarFooter={footer}
    >
      {activeItemId === "today" ? (
        <LegacyMyDayPage>
          <div className={styles.legacyRouteContent} data-legacy-route-body>{children}</div>
        </LegacyMyDayPage>
      ) : (
        <div className={styles.legacyRouteContent} data-legacy-route-body>{children}</div>
      )}
    </AppShell>
  );
}

function NotificationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4" />
    </svg>
  );
}
