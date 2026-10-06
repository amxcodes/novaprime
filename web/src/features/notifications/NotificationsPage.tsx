import { useState } from "react";
import { Button, EmptyState, Loading, PageHeader, SectionHeading, StateMessage, Surface } from "../../design-system";
import type { NotificationReadState, NotificationRecord } from "./contracts";
import { formatNotificationDate, notificationGroups } from "./presentation";
import styles from "./NotificationsPage.module.css";

const NOTIFICATION_PAGE_SIZE = 100;

export interface NotificationsPageProps {
  notifications: NotificationReadState;
  onMarkRead: (id: string, source: HTMLButtonElement) => Promise<void>;
  onMarkAllRead: (source: HTMLButtonElement) => Promise<void>;
  resolveNotificationDeepLink: (rawDeepLink: string, eventKey: string) => string | null;
  onRetryNotifications: () => void;
}

function notificationIsUnread(readAt: string | null): boolean {
  return !readAt;
}

function UnreadMark() {
  return <span className={styles.unreadMark} aria-hidden="true" />;
}

function NotificationEntry({
  notification,
  pending,
  onMarkRead,
  resolveDeepLink,
}: {
  notification: NotificationRecord;
  pending: boolean;
  onMarkRead: NotificationsPageProps["onMarkRead"];
  resolveDeepLink: NotificationsPageProps["resolveNotificationDeepLink"];
}) {
  const unread = notificationIsUnread(notification.readAt);
  const destinationHref = notification.deepLink
    ? (resolveDeepLink?.(notification.deepLink, notification.eventKey) ?? null)
    : null;
  return (
    <li className={styles.entry} data-unread={unread || undefined}>
      <span className={styles.entryMarker} aria-hidden="true">{unread ? <UnreadMark /> : null}</span>
      <span className={styles.srOnly}>{unread ? "Unread notification" : "Read notification"}</span>
      <article className={styles.entryBody} aria-labelledby={`notification-title-${notification.id}`}>
        <div className={styles.entryHeading}>
          <h3 className={styles.entryTitle} id={`notification-title-${notification.id}`}>{notification.title}</h3>
          <time className={styles.timestamp} dateTime={Number.isNaN(new Date(notification.createdAt).getTime()) ? undefined : new Date(notification.createdAt).toISOString()}>
            {formatNotificationDate(notification.createdAt)}
          </time>
        </div>
        <p className={styles.message}>{notification.body}</p>
        <div className={styles.entryActions}>
          {destinationHref ? (
            <a className={styles.openLink} href={destinationHref} aria-label={`Open destination for ${notification.title}`}>
              Open destination <span aria-hidden="true">↗</span>
            </a>
          ) : null}
          {unread ? (
            <Button
              size="compact"
              variant="quiet"
              loading={pending}
              loadingLabel="Marking notification read"
              aria-label={`Mark ${notification.title} as read`}
              onClick={(event) => { void onMarkRead(notification.id, event.currentTarget); }}
            >
              Mark read
            </Button>
          ) : <span className={styles.readLabel}>Read</span>}
        </div>
      </article>
    </li>
  );
}

function NotificationList({
  state,
  pendingReadId,
  onMarkRead,
  resolveDeepLink,
  onRetry,
}: {
  state: NotificationReadState;
  pendingReadId: string | null;
  onMarkRead: NotificationsPageProps["onMarkRead"];
  resolveDeepLink: NotificationsPageProps["resolveNotificationDeepLink"];
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return <div className={styles.readState} aria-busy="true"><Loading label="Loading recent notifications" /></div>;
  }
  if (state.status === "failed") {
    return (
      <div className={styles.readState}>
        <StateMessage kind="error" title="Notifications could not load">{state.message}</StateMessage>
        <Button variant="secondary" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (!state.notifications.length) {
    return (
      <EmptyState
        className={styles.empty}
        title="You’re all caught up"
        description="New activity that is addressed to you will appear here."
      />
    );
  }

  const groups = notificationGroups(state.notifications);
  return (
    <div className={styles.activity}>
      <p className={styles.scopeNote}>Showing the most recent notifications returned, up to 100.</p>
      {groups.map((group) => (
        <section className={styles.group} aria-labelledby={`notification-group-${group.key}`} key={group.key}>
          <h3 className={styles.groupHeading} id={`notification-group-${group.key}`}>{group.label}</h3>
          <ol className={styles.entries}>
            {group.notifications.map((notification) => (
              <NotificationEntry
                key={notification.id}
                notification={notification}
                pending={pendingReadId === notification.id}
                onMarkRead={onMarkRead}
                resolveDeepLink={resolveDeepLink}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function NotificationsPage({
  notifications,
  onMarkRead,
  onMarkAllRead,
  resolveNotificationDeepLink,
  onRetryNotifications,
}: NotificationsPageProps) {
  const canMarkAllRead = notifications.status === "ready" && (
    notifications.notifications.length >= NOTIFICATION_PAGE_SIZE ||
    notifications.notifications.some(({ readAt }) => notificationIsUnread(readAt))
  );
  const [pendingReadId, setPendingReadId] = useState<string | null>(null);
  const [markAllPending, setMarkAllPending] = useState(false);
  const markRead = async (id: string, source: HTMLButtonElement) => {
    setPendingReadId(id);
    try { await onMarkRead(id, source); } finally { setPendingReadId(null); }
  };
  const markAllRead = async (source: HTMLButtonElement) => {
    setMarkAllPending(true);
    try { await onMarkAllRead(source); } finally { setMarkAllPending(false); }
  };
  return (
    <div className={styles.page}>
      <div id="feedback" className={styles.feedback} role="status" hidden />
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description={<>Keep track of updates sent to your account. <a className={styles.settingsLink} href="/?view=settings">Manage email preferences in Settings</a>.</>}
        actions={canMarkAllRead ? (
          <Button
            variant="secondary"
            loading={markAllPending}
            loadingLabel="Marking all notifications read"
            onClick={(event) => { void markAllRead(event.currentTarget); }}
          >
            Mark all read
          </Button>
        ) : undefined}
      />

      <Surface as="section" level="plain" className={styles.inboxSection} aria-labelledby="recent-activity-title">
        <SectionHeading title={<span id="recent-activity-title">Recent activity</span>} description="Your inbox is personal to your signed-in account." />
        <NotificationList
          state={notifications}
          pendingReadId={pendingReadId}
          onMarkRead={markRead}
          resolveDeepLink={resolveNotificationDeepLink}
          onRetry={onRetryNotifications}
        />
      </Surface>
    </div>
  );
}
