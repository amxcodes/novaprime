export interface AvailabilityAgendaPerson {
  id?: string;
  name?: string | null;
}

export interface AvailabilityAgendaOffice {
  id?: string;
  name?: string | null;
}

export interface AvailabilityAgendaEvent {
  id: string;
  date: string;
  type: "shift" | "holiday" | "attendance" | "leave" | "wfh" | string;
  name?: string | null;
  timezone?: string | null;
  office?: AvailabilityAgendaOffice | null;
  person?: AvailabilityAgendaPerson | null;
  shift?: {
    name?: string | null;
    startLocalTime?: string | null;
    endLocalTime?: string | null;
  } | null;
  mode?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  status?: string | null;
  leaveType?: string | null;
  portion?: number | null;
}

export interface AvailabilityAgendaResponse {
  events?: ReadonlyArray<AvailabilityAgendaEvent>;
  nextCursor?: string | null;
  readError?: string;
  /** The server rejected a continuation because the actor's access snapshot changed. */
  accessChanged?: boolean;
}

export interface AvailabilityAgendaProps {
  startDate: string;
  endDate: string;
  cursor?: string | null;
  sourceLabels: ReadonlyArray<string>;
  loadEvents: (
    startDate: string,
    endDate: string,
    cursor: string | null,
  ) => Promise<AvailabilityAgendaResponse>;
  updateRange: (startDate: string, endDate: string) => void;
  onAccessChanged?: () => void;
  isCurrentPageRequest: () => boolean;
  readErrorMessage: (response: AvailabilityAgendaResponse) => string;
  businessTimeLabel: (value: string, timezone?: string | null) => string;
}
