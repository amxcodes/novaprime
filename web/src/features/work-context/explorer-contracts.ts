/** Minimal, authorized rows projected from GET /api/work-context by the route host. */
export interface WorkContextClientSummary {
  id: string;
  name: string;
}

export interface WorkContextClientWorkstreamSummary {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
}

export interface WorkContextOrganisationWorkstreamSummary {
  id: string;
  name: string;
}

export interface WorkContextTaskCreationTargetSummary {
  id: string;
  name: string;
  kind: "client" | "organisation";
  clientName?: string;
}

export interface WorkContextGroupSummary {
  id: string;
  name: string;
  clientWorkstreamId: string | null;
  organisationWorkstreamId: string | null;
  /** Server-projected visibility signals; write commands remain API-owned. */
  canViewGroup: boolean;
  canCreateTask: boolean;
}

export interface WorkContextExplorerProjection {
  clients: readonly WorkContextClientSummary[];
  clientWorkstreams: readonly WorkContextClientWorkstreamSummary[];
  organisationWorkstreams: readonly WorkContextOrganisationWorkstreamSummary[];
  /** Authorized create-only workstreams omitted from the browsable hierarchy. */
  workstreamTaskTargets: readonly WorkContextTaskCreationTargetSummary[];
  groups: readonly WorkContextGroupSummary[];
}

/**
 * A create-only capability projected by the route host from effective grants.
 * IDs must come from the explicit, visible client projection; workstream-only
 * client context does not create a new browse target.
 */
export interface WorkContextClientDepartmentCreation {
  authorizedClientIds: readonly string[];
  onCreate(clientId: string, name: string): Promise<void>;
}

export type WorkContextExplorerReadState =
  | { status: "loading" }
  | { status: "denied"; message?: string }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; projection: WorkContextExplorerProjection };

export interface WorkContextExplorerProps {
  readState: WorkContextExplorerReadState;
  /** Omit when the host has no effective department-management capability. */
  departmentCreation?: WorkContextClientDepartmentCreation;
}
