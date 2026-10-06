import type {
  ClientMembershipOperationState,
  ClientMembershipReadState,
  ClientMembershipRecord,
  ClientMembershipClient,
  CreateClientMembershipInput,
} from "./contracts";

export interface ClientMembershipsPageDto {
  memberships: ClientMembershipRecord[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ClientMembershipRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}

export type ClientMembershipRequestPort = (request: ClientMembershipRequest) => Promise<unknown>;

/** Host owns auth/session transport and page lifecycle; the feature owns endpoint paths and state. */
export type ClientMembershipCommandRunner = <T>(
  command: () => Promise<T>,
  successMessage: string,
) => Promise<T | undefined>;

export interface ClientMembershipControllerDependencies {
  client: ClientMembershipClient;
  /** Effective capabilities come from the host. They are presentation gates, not API authorization. */
  canViewMemberships: boolean;
  canManageMemberships: boolean;
  /** Presentation gate only; the server rechecks people.view before every write. */
  canSearchPeople: boolean;
  request: ClientMembershipRequestPort;
  runCommand: ClientMembershipCommandRunner;
  isCurrent: () => boolean;
  errorMessage: (error: unknown) => string;
}

export interface ClientMembershipControllerState {
  read: ClientMembershipReadState;
  addOperation: ClientMembershipOperationState;
  endOperations: Readonly<Record<string, ClientMembershipOperationState | undefined>>;
}

const PAGE_LIMIT = 50;
const initialReadState: ClientMembershipReadState = {
  status: "idle",
  memberships: [],
  hasMore: false,
  nextCursor: null,
  loadingMore: false,
};

function readPageDto(value: unknown): ClientMembershipsPageDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The membership response was invalid.");
  }
  const dto = value as Partial<ClientMembershipsPageDto>;
  return {
    memberships: Array.isArray(dto.memberships) ? dto.memberships : [],
    limit: Number.isSafeInteger(dto.limit) ? Number(dto.limit) : PAGE_LIMIT,
    hasMore: dto.hasMore === true,
    nextCursor: typeof dto.nextCursor === "string" ? dto.nextCursor : null,
  };
}

function membershipPath(clientId: string): string {
  return `/api/clients/${encodeURIComponent(clientId)}/members`;
}

function requestPath(clientId: string, cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) query.set("cursor", cursor);
  return `${membershipPath(clientId)}?${query.toString()}`;
}

function operationIsPending(operation: ClientMembershipOperationState | undefined): boolean {
  return operation?.status === "pending";
}

export class ClientMembershipsController {
  private snapshot: ClientMembershipControllerState = {
    read: { ...initialReadState },
    addOperation: { status: "idle" },
    endOperations: {},
  };
  private readonly listeners = new Set<() => void>();
  private requestGeneration = 0;
  private disposed = false;

  constructor(private readonly dependencies: ClientMembershipControllerDependencies) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ClientMembershipControllerState => this.snapshot;

  dispose(): void {
    this.disposed = true;
    this.requestGeneration += 1;
    this.listeners.clear();
  }

  async loadFirstPage(): Promise<void> {
    await this.loadPage(null, false);
  }

  async loadMore(cursor: string): Promise<void> {
    if (!cursor || cursor !== this.snapshot.read.nextCursor) return;
    await this.loadPage(cursor, true);
  }

  async add(input: CreateClientMembershipInput): Promise<void> {
    const normalized: CreateClientMembershipInput = {
      personId: input.personId.trim(),
      membershipLabel: input.membershipLabel?.trim() || null,
      effectiveOn: input.effectiveOn.trim(),
      ...(input.clientDepartmentId === undefined ? {} : { clientDepartmentId: input.clientDepartmentId || null }),
    };
    if (!this.dependencies.canManageMemberships || !this.dependencies.canSearchPeople ||
        !normalized.personId || !normalized.effectiveOn || operationIsPending(this.snapshot.addOperation)) return;

    await this.runMutation(
      { kind: "add" },
      () => this.dependencies.request({
        method: "POST",
        path: membershipPath(this.dependencies.client.id),
        body: normalized,
      }),
      "Client membership added.",
    );
  }

  async end(membershipId: string, effectiveUntil: string): Promise<void> {
    const date = effectiveUntil.trim();
    if (!this.dependencies.canManageMemberships || !membershipId || !date ||
        operationIsPending(this.snapshot.endOperations[membershipId])) return;

    await this.runMutation(
      { kind: "end", membershipId },
      () => this.dependencies.request({
        method: "PATCH",
        path: `${membershipPath(this.dependencies.client.id)}/${encodeURIComponent(membershipId)}/end`,
        body: { effectiveUntil: date },
      }),
      `Client membership ended on ${date}.`,
    );
  }

  private isCurrent(): boolean {
    return !this.disposed && this.dependencies.isCurrent();
  }

  private publish(next: ClientMembershipControllerState): void {
    if (this.disposed) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  private setOperation(
    operation: { kind: "add" } | { kind: "end"; membershipId: string },
    value: ClientMembershipOperationState,
  ): void {
    if (operation.kind === "add") {
      this.publish({ ...this.snapshot, addOperation: value });
      return;
    }
    const endOperations = { ...this.snapshot.endOperations };
    if (value.status === "idle") delete endOperations[operation.membershipId];
    else endOperations[operation.membershipId] = value;
    this.publish({ ...this.snapshot, endOperations });
  }

  private clearTransientReadState(): void {
    const read = this.snapshot.read;
    if (!read.loadingMore && read.status !== "loading") return;
    this.publish({
      ...this.snapshot,
      read: {
        ...read,
        status: read.memberships.length ? "ready" : "idle",
        loadingMore: false,
        error: undefined,
      },
    });
  }

  private invalidateRead(): void {
    this.publish({ ...this.snapshot, read: { ...initialReadState } });
  }

  private settleStaleRead(generation: number): void {
    if (this.disposed || generation !== this.requestGeneration) return;
    const read = this.snapshot.read;
    this.publish({
      ...this.snapshot,
      read: {
        ...read,
        status: read.memberships.length ? "ready" : "idle",
        loadingMore: false,
      },
    });
  }

  private async loadPage(cursor: string | null, append: boolean): Promise<void> {
    if (!this.dependencies.canViewMemberships || this.disposed) return;
    const currentRead = this.snapshot.read;
    if (currentRead.status === "loading" || currentRead.loadingMore) return;
    if (!this.isCurrent()) {
      this.clearTransientReadState();
      return;
    }

    const generation = ++this.requestGeneration;
    this.publish({
      ...this.snapshot,
      read: {
        ...currentRead,
        status: append ? "ready" : "loading",
        loadingMore: append,
        error: undefined,
      },
    });

    try {
      const page = readPageDto(await this.dependencies.request({
        method: "GET",
        path: requestPath(this.dependencies.client.id, cursor),
      }));
      if (!this.isCurrent()) {
        this.settleStaleRead(generation);
        return;
      }
      if (generation !== this.requestGeneration) return;
      const latest = this.snapshot.read;
      this.publish({
        ...this.snapshot,
        read: {
          status: "ready",
          memberships: append ? [...latest.memberships, ...page.memberships] : page.memberships,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          loadingMore: false,
        },
      });
    } catch (error) {
      if (!this.isCurrent()) {
        this.settleStaleRead(generation);
        return;
      }
      if (generation !== this.requestGeneration) return;
      const latest = this.snapshot.read;
      if (typeof error === "object" && error !== null && "httpStatus" in error && error.httpStatus === 403) {
        this.publish({
          ...this.snapshot,
          read: {
            status: "error",
            memberships: [],
            hasMore: false,
            nextCursor: null,
            loadingMore: false,
            error: this.dependencies.errorMessage(error),
          },
        });
        return;
      }
      this.publish({
        ...this.snapshot,
        read: append
          ? { ...latest, status: "ready", loadingMore: false, error: this.dependencies.errorMessage(error) }
          : { ...latest, status: "error", loadingMore: false, error: this.dependencies.errorMessage(error) },
      });
    }
  }

  private async runMutation(
    operation: { kind: "add" } | { kind: "end"; membershipId: string },
    command: () => Promise<unknown>,
    successMessage: string,
  ): Promise<void> {
    if (this.disposed || !this.isCurrent()) return;
    this.requestGeneration += 1;
    this.clearTransientReadState();
    this.setOperation(operation, { status: "pending" });

    try {
      const result = await this.dependencies.runCommand(command, successMessage);
      if (this.disposed) return;
      if (result === undefined || !this.isCurrent()) {
        this.setOperation(operation, { status: "idle" });
        this.invalidateRead();
        return;
      }
      this.setOperation(operation, { status: "idle" });
      await this.loadPage(null, false);
    } catch (error) {
      if (this.disposed) return;
      if (!this.isCurrent()) {
        this.setOperation(operation, { status: "idle" });
        this.invalidateRead();
        return;
      }
      if (typeof error === "object" && error !== null && "httpStatus" in error && error.httpStatus === 403) {
        this.invalidateRead();
      }
      this.setOperation(operation, { status: "error", error: this.dependencies.errorMessage(error) });
    }
  }
}
