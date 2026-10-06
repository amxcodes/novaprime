import type {
  AttendancePolicyMode,
  AttendancePolicyRecord,
  AttendancePolicyRequest,
} from "./contracts";

export interface AttendancePolicyDraft {
  mode: AttendancePolicyMode;
  effectiveOn: string;
  requiredAttendanceMinutes: string;
}

export type AttendancePolicyDraftErrors = Partial<Record<keyof AttendancePolicyDraft, string>>;

function parsedRequiredMinutes(value: string): number | undefined {
  const minutesText = value.trim();
  const minutes = /^\d{1,4}$/.test(minutesText) ? Number(minutesText) : NaN;
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : undefined;
}

export function attendancePolicyDraft(policy: AttendancePolicyRecord | null): AttendancePolicyDraft {
  return {
    mode: policy?.mode === "scheduled" ? "scheduled" : "hour_based",
    // Keep the business date explicit. A browser-local or UTC default can silently
    // differ from the server's organisation date and produce a rejected update.
    effectiveOn: "",
    requiredAttendanceMinutes: String(policy?.requiredAttendanceMinutes ?? 480),
  };
}

/** Stable content key for detecting a meaningful change to the server-owned policy read. */
export function attendancePolicyReadKey(policy: AttendancePolicyRecord | null): string {
  return JSON.stringify(policy
    ? [policy.mode, policy.requiredAttendanceMinutes, policy.effectiveOn]
    : null);
}

/**
 * The API requires a valid duration even in schedule mode. If the user has an
 * invalid, now-hidden duration when switching modes, preserve a valid current
 * policy value (or the product default) so the scheduled form remains usable.
 */
export function selectAttendancePolicyMode(
  draft: AttendancePolicyDraft,
  mode: AttendancePolicyMode,
  fallbackRequiredMinutes = 480,
): AttendancePolicyDraft {
  if (mode !== "scheduled" || parsedRequiredMinutes(draft.requiredAttendanceMinutes) !== undefined) {
    return { ...draft, mode };
  }

  const fallback = parsedRequiredMinutes(String(fallbackRequiredMinutes)) ?? 480;
  return { ...draft, mode, requiredAttendanceMinutes: String(fallback) };
}

export function attendancePolicyReadChanged(previousKey: string | null, nextKey: string | null): boolean {
  return nextKey !== null && previousKey !== nextKey;
}

export function buildAttendancePolicyRequest(draft: AttendancePolicyDraft): {
  request?: AttendancePolicyRequest;
  errors: AttendancePolicyDraftErrors;
} {
  const errors: AttendancePolicyDraftErrors = {};
  const minutes = parsedRequiredMinutes(draft.requiredAttendanceMinutes);

  if (draft.mode !== "hour_based" && draft.mode !== "scheduled") {
    errors.mode = "Choose an attendance calculation method.";
  }
  if (!isCalendarDate(draft.effectiveOn)) {
    errors.effectiveOn = "Choose a valid effective date.";
  }
  if (minutes === undefined) {
    errors.requiredAttendanceMinutes = "Enter a whole number from 1 to 1,440 minutes.";
  }

  if (Object.keys(errors).length) return { errors };
  return {
    request: {
      mode: draft.mode,
      effectiveOn: draft.effectiveOn,
      requiredAttendanceMinutes: minutes!,
    },
    errors,
  };
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}
