export interface PublicOriginSnapshot {
  configuredOrigin: string | null;
  effectiveOrigin: string;
  allowedOrigins: readonly string[];
}

export type PublicOriginReadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "ready" } & PublicOriginSnapshot);

export interface PublicOriginProps {
  readState: PublicOriginReadState;
  onRetry(): void;
  onSave(origin: string | null): Promise<void>;
}

export class PublicOriginActionError extends Error {
  constructor(
    readonly kind: "conflict" | "rejected" | "unconfirmed",
    message: string,
  ) {
    super(message);
    this.name = "PublicOriginActionError";
  }
}
