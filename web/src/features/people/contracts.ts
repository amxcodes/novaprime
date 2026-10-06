/** Exact presentation projection returned by the scoped, paged People directory read. */
export interface PersonDirectoryRecord {
  id: string;
  displayName: string | null;
  email: string;
  status: string | null;
  designation: string | null;
  employmentStartsOn: string | null;
  managerName: string | null;
  office: { id: string; name: string | null } | null;
  department: { id: string; name: string | null } | null;
  role: { id: string; name: string | null } | null;
}

export interface PersonHistoryIdentity {
  id: string;
  displayName: string | null;
}

export type PersonHistoryKind = "status" | "employment" | "office" | "department" | "role";

/** Known fields returned by GET /api/people/:id/history; no raw payload is rendered. */
export interface PersonHistoryDetails {
  status?: string;
  reason?: string;
  designation?: string;
  managerName?: string;
  officeId?: string;
  officeName?: string;
  departmentId?: string;
  departmentName?: string;
  roleId?: string;
  roleName?: string;
  roleArchived?: boolean;
}

export interface PersonHistoryEntry {
  id: string;
  kind: PersonHistoryKind;
  effectiveOn: string;
  effectiveUntil: string | null;
  details: PersonHistoryDetails;
}

/** The API's cursor page; each page is bounded by its returned limit. */
export interface PersonHistoryPage {
  person: PersonHistoryIdentity;
  history: ReadonlyArray<PersonHistoryEntry>;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export type PeopleDirectoryReadState =
  | { status: "loading"; query?: string }
  | { status: "denied"; message?: string }
  | { status: "failed"; query: string; message: string }
  | {
      status: "ready";
      /** The normalized server-side search that produced this page sequence. */
      query: string;
      /** Authorized rows accumulated in cursor order for this query. */
      people: ReadonlyArray<PersonDirectoryRecord>;
      limit: number;
      hasMore: boolean;
      nextCursor: string | null;
      loadingMore: boolean;
      loadMoreError?: string;
    };

export type PersonHistoryReadState =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      /** Pages in API order, with older pages appended by the host. */
      pages: ReadonlyArray<PersonHistoryPage>;
      loadingMore: boolean;
      loadMoreError?: string;
    };
