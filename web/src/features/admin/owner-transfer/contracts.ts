export interface OwnerTransferChoice {
  /** A safe, user-facing name prepared by the Admin host. */
  label: string;
  /** The host closure retains the selected person ID and API policy. */
  transfer: () => void | Promise<void>;
}

export type OwnerTransferReadState =
  | { status: "loading" }
  | { status: "unavailable"; message?: string }
  | { status: "error"; message: string }
  | { status: "ready"; choices: ReadonlyArray<OwnerTransferChoice> };

export interface OwnerTransferProps {
  /** The host mounts this feature only for the current Super Admin. */
  canTransfer: boolean;
  /** Contains only active or notice targets authorized and prepared by the host. */
  read: OwnerTransferReadState;
  /** Repeats the host-owned people read; no API access belongs to this feature. */
  onRetry: () => void | Promise<void>;
}
