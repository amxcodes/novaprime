export interface NotificationRecord {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface EmailPreference {
  eventKey: string;
  label: string;
  enabled: boolean;
}

export type NotificationReadState =
  | { status: "loading" }
  | { status: "ready"; notifications: ReadonlyArray<NotificationRecord> }
  | { status: "failed"; message: string };

export type PreferenceReadState =
  | { status: "loading" }
  | { status: "ready"; preferences: ReadonlyArray<EmailPreference> }
  | { status: "failed"; message: string };
