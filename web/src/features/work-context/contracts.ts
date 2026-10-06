export type ClientMembershipReadStatus = "idle" | "loading" | "ready" | "error";
export type ClientMembershipOperationStatus = "idle" | "pending" | "error";

export interface ClientMembershipClient {
  id: string;
  name: string;
}

export interface ClientMembershipPersonOption {
  id: string;
  label: string;
}

export interface ClientMembershipSearchOption {
  value: string;
  label: string;
}

export interface ClientDepartmentOption {
  id: string;
  name: string;
}

/** Mirrors the existing GET /clients/:clientId/members response. */
export interface ClientMembershipRecord {
  id: string;
  person: { id: string; displayName: string | null };
  clientDepartment: { id: string; name: string | null } | null;
  membershipLabel: string | null;
  effectiveOn: string;
  effectiveUntil: string | null;
}

export interface ClientMembershipReadState {
  status: ClientMembershipReadStatus;
  memberships: readonly ClientMembershipRecord[];
  hasMore: boolean;
  nextCursor: string | null;
  loadingMore: boolean;
  /** Keep existing memberships in this state if a later-page read fails. */
  error?: string;
}

export interface ClientMembershipOperationState {
  status: ClientMembershipOperationStatus;
  error?: string;
}

export interface CreateClientMembershipInput {
  personId: string;
  membershipLabel: string | null;
  effectiveOn: string;
  /** Only present when the host supplies options from a supported, authorized source. */
  clientDepartmentId?: string | null;
}

export interface WorkContextCreationClientOption {
  id: string;
  name: string;
}

export interface WorkContextCreationWorkstreamOption {
  id: string;
  name: string;
  kind: "client" | "organisation";
}

export interface WorkContextCreationSearchOption {
  value: string;
  label: string;
}

export type WorkContextCreationReadState =
  | { status: "ready" }
  | { status: "unavailable" | "error"; message: string };

export interface WorkContextCreationProps {
  readState: WorkContextCreationReadState;
  canCreateClient: boolean;
  canCreateClientWorkstream: boolean;
  canCreateOrganisationWorkstream: boolean;
  canCreateGroup: boolean;
  clientOptions: readonly WorkContextCreationClientOption[];
  groupWorkstreamOptions: readonly WorkContextCreationWorkstreamOption[];
  onSearchClients(query: string): Promise<readonly WorkContextCreationSearchOption[]>;
  onSearchGroupWorkstreams(query: string): Promise<readonly WorkContextCreationSearchOption[]>;
  onCreateClient(name: string): Promise<void>;
  onCreateClientWorkstream(input: { name: string; clientId: string }): Promise<void>;
  onCreateOrganisationWorkstream(name: string): Promise<void>;
  onCreateGroup(input: { name: string; workstreamId: string; workstreamKind: "client" | "organisation" }): Promise<void>;
}

export interface ClientMembershipsProps {
  /** Client context is already selected and authorized by the host. */
  client: ClientMembershipClient;
  /** Explicit capability gates. The host derives these from effective grants. */
  canViewMemberships: boolean;
  canManageMemberships: boolean;
  read: ClientMembershipReadState;
  /** People search is separately authorized by organization-scoped people.view. */
  canSearchPeople: boolean;
  onSearchPeople: (query: string) => Promise<readonly ClientMembershipSearchOption[]>;
  /** Department search is scoped to this client and requires its membership-management grant. */
  onSearchDepartments: (query: string) => Promise<readonly ClientMembershipSearchOption[]>;
  addOperation?: ClientMembershipOperationState;
  endOperations?: Readonly<Record<string, ClientMembershipOperationState | undefined>>;
  onLoadMemberships: () => void;
  onLoadMore: (cursor: string) => void;
  onAddMembership: (input: CreateClientMembershipInput) => void;
  onEndMembership: (membershipId: string, effectiveUntil: string) => void;
}
