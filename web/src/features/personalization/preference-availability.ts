export type PersonalPreferenceReadStatus =
  | "unavailable"
  | "ready"
  | "read-failed"
  | "unsupported"
  | "access-lost";

export interface PersonalPreferenceReadResult {
  readError?: string;
  readHttpStatus?: number;
  writable?: boolean;
}

/** A read failure is different from a server response that rejects this schema. */
export function personalPreferenceReadStatus(
  result: PersonalPreferenceReadResult,
): PersonalPreferenceReadStatus {
  if (result.readError) {
    return result.readHttpStatus === 401 || result.readHttpStatus === 403
      ? "access-lost"
      : "read-failed";
  }
  return result.writable === true ? "ready" : "unsupported";
}

/** Let recoverable previews work locally, while keeping unsupported/access-lost states closed. */
export function canEditPersonalPreferenceDraft(
  status: PersonalPreferenceReadStatus,
  writable: boolean,
  saving: boolean,
  conflict: boolean,
): boolean {
  if (saving || conflict) return false;
  return status === "read-failed" || (status === "ready" && writable);
}

/** Persist only after a successful read established that the server accepts this schema. */
export function canPersistPersonalPreferences(
  status: PersonalPreferenceReadStatus,
  writable: boolean,
  conflict: boolean,
): boolean {
  return status === "ready" && writable && !conflict;
}
