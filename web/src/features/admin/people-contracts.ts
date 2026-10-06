/** An authorized People summary row projected by the Admin host. */
export interface AdminPersonSummary {
  id: string;
  displayName: string;
  email: string;
  status: string;
  office?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
  role?: { id: string; name: string } | null;
  actions: AdminPersonActionVisibility;
  onboarding?: AdminOnboardingReadState;
}

/** These target-scoped flags are evaluated by the host against effective grants and server state. */
export interface AdminPersonActionVisibility {
  resendInvitation: boolean;
  freeze: boolean;
  startOffboarding: boolean;
  completeExit: boolean;
  completeOnboarding: boolean;
}

export interface AdminOnboardingOfficeOption {
  id: string;
  name: string;
  timezone: string;
}

export interface AdminOnboardingOption {
  id: string;
  name: string;
}

export type AdminOnboardingReadState =
  | { status: "denied" | "unavailable"; message: string }
  | {
      status: "ready";
      offices: ReadonlyArray<AdminOnboardingOfficeOption>;
      departments: ReadonlyArray<AdminOnboardingOption>;
      roles: ReadonlyArray<AdminOnboardingOption>;
      managers: ReadonlyArray<AdminOnboardingOption>;
    };

export type AdminPeopleReadState =
  | { status: "loading" }
  | { status: "unavailable" | "error"; message: string }
  | { status: "ready" };

export interface AdminInvitePersonInput {
  displayName: string;
  email: string;
}

export interface AdminInvitePersonResult {
  delivery: "failed" | "manual" | "sent";
  kind: "success" | "warning";
  message: string;
}

export interface AdminCompleteOnboardingInput {
  designation: string;
  officeId: string;
  employmentStartsOn: string;
  organisationDepartmentId: string;
  roleId: string;
  managerPersonId: string;
}

export interface PeopleAdministrationProps {
  /** Organization-scoped invite capability, already checked by the host. */
  canInvite: boolean;
  /** True only when the host has an effective people.view grant for a supported scope. */
  canViewPeople: boolean;
  peopleRead: AdminPeopleReadState;
  /** Host-authorized People summaries only; no permission decisions are made here. */
  people: ReadonlyArray<AdminPersonSummary>;
  onInvite: (input: AdminInvitePersonInput) => AdminInvitePersonResult | Promise<AdminInvitePersonResult>;
  onResendInvitation: (personId: string) => void | Promise<void>;
  onFreeze: (personId: string) => void | Promise<void>;
  onStartOffboarding: (personId: string, reason: string) => void | Promise<void>;
  onCompleteExit: (personId: string, reason: string) => void | Promise<void>;
  onCompleteOnboarding: (personId: string, input: AdminCompleteOnboardingInput) => void | Promise<void>;
  /** Host-safe error formatting; raw API error strings stay out of this feature. */
  formatError?: (error: unknown) => string;
}
