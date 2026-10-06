export type OperationsReadState<T> =
  | { status: "ready"; data: T }
  | { status: "denied"; message: string }
  | { status: "error"; message: string };

export interface OperationsPeoplePage {
  people: ReadonlyArray<OperationsPerson>;
  query: string;
  cursor: string | null;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  hasPrevious: boolean;
}

export type OperationsPeopleReadState =
  | { status: "loading"; query: string }
  | { status: "denied"; message: string }
  | { status: "error"; message: string; query: string }
  | {
      status: "ready";
      data: OperationsPeoplePage;
      loadingPage: boolean;
      pageError?: string;
    };

export interface OperationsPerson {
  id: string;
  displayName?: string | null;
  email?: string | null;
  status?: string | null;
  designation?: string | null;
  employmentStartsOn?: string | null;
  managerName?: string | null;
  office?: { name?: string | null } | null;
  department?: { name?: string | null } | null;
  role?: { name?: string | null } | null;
}

export interface OperationsTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignmentCount: number;
  client: { name: string } | null;
  workstream: { name: string } | null;
  group: { name: string } | null;
  department: { name: string } | null;
}

export interface OperationsTasksPage {
  tasks: ReadonlyArray<OperationsTask>;
  cursor: string | null;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  pageNumber: number;
  hasPrevious: boolean;
}

export type OperationsTasksReadState =
  | { status: "loading" }
  | { status: "denied"; message: string }
  | { status: "error"; message: string }
  | {
      status: "ready";
      data: OperationsTasksPage;
      loadingPage: boolean;
      pageError?: string;
    };

export interface OperationsShift {
  name: string;
  startLocalTime: string;
  endLocalTime: string;
}

export interface OperationsCalendar {
  name: string;
  office?: { name?: string | null } | null;
  effectiveOn: string;
  rules?: ReadonlyArray<{
    weekday: number;
    ordinal: number;
    isWorking: boolean;
    shiftId?: string | null;
  }>;
}

export interface OperationsHoliday {
  date: string;
  name: string;
  office?: { name?: string | null } | null;
}

export interface OperationsAvailability {
  shifts: ReadonlyArray<OperationsShift>;
  calendars: ReadonlyArray<OperationsCalendar>;
  holidays: ReadonlyArray<OperationsHoliday>;
}

export interface OperationsSources {
  shifts: boolean;
  calendars: boolean;
  holidays: boolean;
}

export interface OperationsOverviewProps {
  people?: OperationsPeopleReadState;
  tasks?: OperationsTasksReadState;
  reviews?: OperationsReadState<ReadonlyArray<unknown>>;
  availability?: OperationsReadState<OperationsAvailability>;
  availabilitySources?: OperationsSources;
  recoverySlot?: HTMLElement | null;
  fatalMessage?: string;
  onRetry: () => void;
  onSearchPeople?: (query: string) => void;
  onNextPeoplePage?: (cursor: string) => void;
  onNextTasksPage?: (cursor: string) => void;
  onPreviousTasksPage?: () => void;
  onPreviousPeoplePage?: () => void;
  onRetryPeople?: () => void;
  onRetryPeoplePage?: () => void;
  onRetryTasks?: () => void;
  onRetryTasksPage?: () => void;
  personHistoryHref: (personId: string) => string;
  onViewPersonHistory: (personId: string) => void;
  taskDetailHref: (taskId: string) => string;
  onOpenTask: (taskId: string) => void;
  onExportPeople?: () => void;
  onExportWork?: () => void;
  onExportAvailability?: () => void;
}
