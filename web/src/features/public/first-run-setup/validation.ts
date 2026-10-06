import type {
  AttendanceMode,
  FirstRunSetupValues,
  ResumeFounder,
} from "./contracts";

export interface FirstRunSetupDraft {
  name: string;
  organisationName: string;
  email: string;
  password: string;
  publicOrigin: string;
  attendanceMode: AttendanceMode;
  requiredAttendanceMinutes: string;
  bootstrapToken: string;
}

export type FirstRunSetupField = keyof FirstRunSetupDraft;
export type FirstRunSetupFieldErrors = Partial<Record<FirstRunSetupField, string>>;

export interface ValidatedFirstRunSetup {
  errors: FirstRunSetupFieldErrors;
  requiredAttendanceMinutes?: number;
}

function isPublicOrigin(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validAttendanceMinutes(value: string): number | undefined {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440
    ? minutes
    : undefined;
}

export function validateFirstRunSetup(
  draft: FirstRunSetupDraft,
  resumeFounder?: ResumeFounder | null,
): ValidatedFirstRunSetup {
  const errors: FirstRunSetupFieldErrors = {};
  if (!draft.organisationName.trim()) errors.organisationName = "Enter an organisation name.";
  else if (draft.organisationName.length > 180) errors.organisationName = "Use 180 characters or fewer.";

  if (!resumeFounder) {
    if (!draft.name.trim()) errors.name = "Enter the founder's name.";
    else if (draft.name.length > 180) errors.name = "Use 180 characters or fewer.";

    const email = draft.email.trim();
    if (!email) errors.email = "Enter the founder's email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Enter a valid email address.";
    }

    if (draft.password.length < 8) errors.password = "Use at least 8 characters.";
  }

  if (!draft.publicOrigin.trim()) {
    errors.publicOrigin = "Enter the public NOVA URL.";
  } else if (!isPublicOrigin(draft.publicOrigin)) {
    errors.publicOrigin = "Enter the origin only, such as https://work.example.com, with no path.";
  }

  if (!draft.bootstrapToken) errors.bootstrapToken = "Enter the deployment setup token.";

  const minutes = validAttendanceMinutes(draft.requiredAttendanceMinutes);
  if (draft.attendanceMode === "hour_based" && minutes === undefined) {
    errors.requiredAttendanceMinutes = "Enter a whole number from 1 to 1,440.";
  }

  // The server validates this field even when scheduled mode ignores it.
  // Normalize an empty or stale hidden value instead of submitting NaN/0.
  return {
    errors,
    requiredAttendanceMinutes: draft.attendanceMode === "scheduled"
      ? (minutes ?? 480)
      : minutes,
  };
}

/** Build only the data required by the current host-confirmed setup phase. */
export function toFirstRunSetupValues(
  draft: FirstRunSetupDraft,
  requiredAttendanceMinutes: number,
  resumeFounder?: ResumeFounder | null,
): FirstRunSetupValues {
  const workspace = {
    organisationName: draft.organisationName,
    publicOrigin: draft.publicOrigin,
    attendanceMode: draft.attendanceMode,
    requiredAttendanceMinutes,
    bootstrapToken: draft.bootstrapToken,
  };

  return resumeFounder
    ? {
        ...workspace,
        founderMode: "resume",
        email: resumeFounder.email,
        displayName: resumeFounder.displayName,
      }
    : {
        ...workspace,
        founderMode: "create",
        name: draft.name,
        email: draft.email,
        password: draft.password,
      };
}
