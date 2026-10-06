import type { NotificationRecord } from "./contracts";

export interface NotificationGroup {
  key: string;
  label: string;
  notifications: ReadonlyArray<NotificationRecord>;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatNotificationDate(value: string, locale?: string): string {
  const date = validDate(value);
  if (!date) return "Date unavailable";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function notificationGroups(
  notifications: ReadonlyArray<NotificationRecord>,
  now = new Date(),
  locale?: string,
): NotificationGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups: NotificationGroup[] = [];

  for (const notification of notifications) {
    const date = validDate(notification.createdAt);
    const key = date ? localDayKey(date) : "undated";
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const day = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : null;
      const label = !day ? "Date unavailable"
        : localDayKey(day) === localDayKey(today) ? "Today"
          : localDayKey(day) === localDayKey(yesterday) ? "Yesterday"
            : new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(day);
      group = { key, label, notifications: [] };
      groups.push(group);
    }
    group.notifications = [...group.notifications, notification];
  }

  return groups;
}
