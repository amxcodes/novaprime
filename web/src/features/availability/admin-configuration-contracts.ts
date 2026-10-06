/** Host-normalized availability configuration data and access state. */
export type AvailabilityReadState<T> =
  | Readonly<{ status: "ready"; data: readonly T[] }>
  | Readonly<{ status: "error" | "denied"; message: string }>;

export interface AvailabilityResource<T> {
  /** The host has authorized this resource to be shown to the current actor. */
  visible: boolean;
  /** The host has authorized management controls; the component never checks grants. */
  canManage: boolean;
  read: AvailabilityReadState<T>;
}

export interface AvailabilityOfficeOption {
  id: string;
  name: string;
}

export interface AvailabilityShiftOption {
  id: string;
  name: string;
}

export type AvailabilityPickerPurpose = "calendar" | "holiday";

export interface AvailabilitySearchOption {
  value: string;
  label: string;
}

export interface AvailabilityShift {
  id: string;
  name: string;
  startLocalTime: string;
  endLocalTime: string;
  breakStartLocalTime: string | null;
  breakEndLocalTime: string | null;
  graceMinutes: number;
  overtimeEnabled: boolean;
  spansMidnight: boolean;
}

export interface AvailabilityCalendarRule {
  weekday: number;
  ordinal: number;
  isWorking: boolean;
  shiftId?: string;
}

export interface AvailabilityCalendar {
  id: string;
  name: string;
  office: AvailabilityOfficeOption;
  effectiveOn: string;
  rules: readonly AvailabilityCalendarRule[];
}

export interface AvailabilityHoliday {
  id: string;
  office: AvailabilityOfficeOption;
  date: string;
  name: string;
}

/** Mirrors POST /api/availability/shifts. Overnight is inferred by the server. */
export interface CreateAvailabilityShiftRequest {
  name: string;
  startLocalTime: string;
  endLocalTime: string;
  graceMinutes: number;
  overtimeEnabled: boolean;
  breakStartLocalTime?: string;
  breakEndLocalTime?: string;
}

/** Mirrors POST /api/availability/calendars. */
export interface CreateAvailabilityCalendarRequest {
  name: string;
  officeId: string;
  effectiveOn: string;
  rules: readonly AvailabilityCalendarRule[];
}

/** Mirrors POST /api/availability/holidays. */
export interface CreateAvailabilityHolidayRequest {
  name: string;
  date: string;
  officeId: string;
}

export interface AdminAvailabilityConfigurationProps {
  shifts: AvailabilityResource<AvailabilityShift>;
  calendars: AvailabilityResource<AvailabilityCalendar>;
  holidays: AvailabilityResource<AvailabilityHoliday>;
  offices: AvailabilityReadState<AvailabilityOfficeOption>;
  /** Options have a distinct backend visibility gate from the shift listing. */
  shiftTargets: Readonly<{
    visible: boolean;
    read: AvailabilityReadState<AvailabilityShiftOption>;
  }>;
  searchOffices: (purpose: AvailabilityPickerPurpose, query: string) => Promise<ReadonlyArray<AvailabilitySearchOption>>;
  searchShifts: (query: string) => Promise<ReadonlyArray<AvailabilitySearchOption>>;
  onCreateShift: (request: CreateAvailabilityShiftRequest) => Promise<void>;
  onCreateCalendar: (request: CreateAvailabilityCalendarRequest) => Promise<void>;
  onCreateHoliday: (request: CreateAvailabilityHolidayRequest) => Promise<void>;
}
