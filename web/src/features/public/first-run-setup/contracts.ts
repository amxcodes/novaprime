export type AttendanceMode = "hour_based" | "scheduled";

/** Workspace fields shared by a new registration and a confirmed founder resume. */
export interface FirstRunSetupWorkspaceValues {
  organisationName: string;
  publicOrigin: string;
  attendanceMode: AttendanceMode;
  /** The server requires a valid value for both modes; scheduled mode ignores it. */
  requiredAttendanceMinutes: number;
  bootstrapToken: string;
}

/** Founder credentials are required only for initial registration, never resume. */
export type FirstRunSetupValues = FirstRunSetupWorkspaceValues & (
  | { founderMode: "create"; name: string; email: string; password: string }
  | { founderMode: "resume"; email: string; displayName: string }
);

export interface ResumeFounder {
  /** Identity is supplied only after the host confirms the current signed-in founder. */
  email: string;
  displayName: string;
}

export type FirstRunSetupNoticeKind = "info" | "success" | "warning" | "error";

export interface FirstRunSetupNotice {
  kind: FirstRunSetupNoticeKind;
  message: string;
  title?: string;
}

export interface FirstRunSetupProps {
  /** The host supplies the current public origin; the feature owns no route or URL access. */
  initialPublicOrigin: string;
  /** Resume after registration, only when the host confirms this founder session. */
  resumeFounder?: ResumeFounder | null;
  /** The host owns registration, workspace creation, origin saving, and session lifecycle. */
  onSubmit: (values: FirstRunSetupValues) => void | Promise<void>;
  /** Route navigation remains host-owned. */
  onCancel: () => void;
  notice?: FirstRunSetupNotice | null;
}

/** Safe, host-authored feedback for known partial-setup or server outcomes. */
export class FirstRunSetupActionError extends Error {
  readonly kind: Exclude<FirstRunSetupNoticeKind, "info" | "success">;
  readonly title: string;

  constructor(message: string, options: {
    kind?: Exclude<FirstRunSetupNoticeKind, "info" | "success">;
    title?: string;
  } = {}) {
    super(message);
    this.name = "FirstRunSetupActionError";
    this.kind = options.kind ?? "error";
    this.title = options.title ?? "Setup could not be completed";
  }
}
