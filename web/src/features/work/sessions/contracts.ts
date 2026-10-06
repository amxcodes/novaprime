export interface WorkSessionSummary {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  state: "running" | "completed" | "auto_closed" | "cancelled";
  closureReason: string | null;
  /** Authoritative server duration at `readAt`, in milliseconds. */
  durationMilliseconds: number;
}

export type WorkSessionsRead =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string; onRetry?: () => void }
  /** `readAt` is captured by the host with `performance.now()` when this response is projected. */
  | { status: "ready"; sessions: ReadonlyArray<WorkSessionSummary>; readAt: number };

export interface WorkSessionEligibility {
  /** Independent of read access; the host derives this from the current actor and grants. */
  canPause: boolean;
  canStop: boolean;
}

export interface WorkSessionsProps {
  canRead: boolean;
  eligibility: WorkSessionEligibility;
  read: WorkSessionsRead;
  onPause: (sessionId: string) => void | Promise<void>;
  onStop: (sessionId: string) => void | Promise<void>;
}
