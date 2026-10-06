export interface NotificationDeliveryRecord {
  /** Opaque API identifier used only by the host-owned requeue callback. */
  id: string;
  eventKey: string;
  status: string;
  attempts: number;
  availableAt: string | null;
  createdAt: string;
  sentAt: string | null;
}

export type NotificationDeliveryReadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      deliveries: ReadonlyArray<NotificationDeliveryRecord>;
      limit: number;
    };

export interface NotificationDeliveryOperationsProps {
  readState: NotificationDeliveryReadState;
  /** Independent organization-scoped notifications.manage capability. */
  canRequeue: boolean;
  onRequeue: (deliveryId: string) => void | Promise<void>;
  onRetryRead: () => void;
}
