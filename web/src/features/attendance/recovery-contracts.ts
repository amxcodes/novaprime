import type { FormEvent } from "react";

export interface RecoveryCandidate {
  personId: string;
  personName: string;
  businessDate: string;
  recoveryReason: string;
  officeName: string;
  officeTimezone: string;
  mode?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
}

export interface RecoveryCandidatesResponse {
  candidates?: readonly RecoveryCandidate[];
  nextCursor?: string | null;
  readError?: unknown;
}

export interface RecoveryCorrectionValues {
  mode: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  reason: string;
}

export interface RecoveryReadErrorNotice {
  message: string;
  kind: "warning" | "error";
}

export interface AttendanceRecoveryProps {
  initialResult?: RecoveryCandidatesResponse | null;
  initialReadError?: RecoveryReadErrorNotice | null;
  loadCandidates: (cursor: string | null) => Promise<RecoveryCandidatesResponse>;
  isCurrentPageRequest: () => boolean;
  makeReadError: (response: RecoveryCandidatesResponse) => RecoveryReadErrorNotice | null;
  businessTimeLabel: (value: string, timezone: string) => string;
  onCorrect: (
    event: FormEvent<HTMLFormElement>,
    candidate: RecoveryCandidate,
    values: RecoveryCorrectionValues,
  ) => unknown | Promise<unknown>;
}

export interface AttendanceRecoveryState {
  status: "loading" | "ready" | "error";
  candidates: readonly RecoveryCandidate[];
  nextCursor: string | null;
  shownCount: number;
  loadingMore: boolean;
  pageFailure: RecoveryReadErrorNotice | null;
}
