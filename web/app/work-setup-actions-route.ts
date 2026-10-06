import type {
  BillingDefaultInput,
  BillingClass,
  BillingMutationResult,
  BillingPolicySectionProps,
  BillingRuleInput,
  BillingRulesSnapshot,
  BillingWorkstreamSummary,
  TaskCatalogPermissions,
  TaskCatalogSectionProps,
  TaskPriority,
} from "../src/features/work-setup/contracts.ts";

type Lifetime = unknown;
type PermissionTarget = { clientId?: unknown; clientWorkstreamId?: unknown };
type RequestOptions = (method: string, body?: unknown) => RequestInit;
type Api = (path: string, options: RequestInit) => Promise<unknown>;
type PageApi = (path: string, lifetime: Lifetime) => Promise<unknown>;
type RunCommand = (
  source: Element,
  lifetime: Lifetime,
  work: () => Promise<unknown>,
  resource?: string,
) => Promise<unknown>;

interface WorkSetupActionServices {
  can: (permissionKey: string, target?: PermissionTarget) => boolean;
  api: Api;
  pageApi: PageApi;
  requestOptions: RequestOptions;
  runCommand: RunCommand;
  permissionDenied: () => Error;
}

interface CatalogActionOptions {
  source: Element;
  lifetime: Lifetime;
  permissions: TaskCatalogPermissions;
}

interface BillingActionOptions {
  source: Element;
  lifetime: Lifetime;
  workContext: unknown;
}

interface WorkstreamAccess extends Record<string, unknown> {
  id?: unknown;
  canManageBillingPolicy?: unknown;
  client_id?: unknown;
  clientId?: unknown;
}

function invalidResponse(resource: string): TypeError {
  return new TypeError(`The ${resource} response could not be read.`);
}

function responseRecord(value: unknown, resource: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidResponse(resource);
  return value as Record<string, unknown>;
}

function billingClass(value: unknown): value is BillingClass {
  return value === "billable" || value === "non_billable";
}

function validTaskPriority(value: unknown): value is TaskPriority {
  return value === "low" || value === "normal" || value === "high" || value === "urgent";
}

function projectBillingRuleEntry(value: unknown): BillingRulesSnapshot["entries"][number] {
  const entry = responseRecord(value, "billing policy entry");
  if (typeof entry.entryId !== "string" || !entry.entryId ||
      typeof entry.title !== "string" ||
      (entry.description !== null && typeof entry.description !== "string") ||
      !validTaskPriority(entry.priority) ||
      !Number.isSafeInteger(entry.catalogRevision) || Number(entry.catalogRevision) < 1 ||
      (entry.billingClass !== null && !billingClass(entry.billingClass)) ||
      !Number.isSafeInteger(entry.ruleRevision) || Number(entry.ruleRevision) < 0) {
    throw invalidResponse("billing policy entry");
  }
  return {
    entryId: entry.entryId,
    title: entry.title,
    description: entry.description as string | null,
    priority: entry.priority,
    catalogRevision: Number(entry.catalogRevision),
    billingClass: entry.billingClass as BillingRulesSnapshot["entries"][number]["billingClass"],
    ruleRevision: Number(entry.ruleRevision),
  };
}

function projectBillingMutation(value: unknown, resource: string): BillingMutationResult {
  const result = responseRecord(value, resource);
  if ((result.policyClass !== null && !billingClass(result.policyClass)) ||
      typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 0) {
    throw invalidResponse(resource);
  }
  return {
    policyClass: result.policyClass as BillingMutationResult["policyClass"],
    revision: result.revision as number,
  };
}

function billingWorkstreams(workContext: unknown): WorkstreamAccess[] {
  if (typeof workContext !== "object" || workContext === null || Array.isArray(workContext)) return [];
  const clientWorkstreams = (workContext as { clientWorkstreams?: unknown }).clientWorkstreams;
  if (!Array.isArray(clientWorkstreams)) return [];
  return clientWorkstreams.filter((item): item is WorkstreamAccess =>
    typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function projectBillingWorkstreamSearch(value: unknown): BillingWorkstreamSummary[] {
  const result = responseRecord(value, "client workstream search");
  if (!Array.isArray(result.clientWorkstreams)) throw invalidResponse("client workstream search");
  const rows = result.clientWorkstreams.filter((item): item is WorkstreamAccess =>
    typeof item === "object" && item !== null && !Array.isArray(item),
  );
  if (rows.length !== result.clientWorkstreams.length) throw invalidResponse("client workstream search");
  return rows.filter((row) => row.canManageBillingPolicy === true).map((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name : "";
    const clientName = typeof row.client_name === "string"
      ? row.client_name
      : typeof row.clientName === "string" ? row.clientName : "";
    const policyClass = row.billingPolicyClass ?? row.billing_policy_class ?? null;
    const revision = row.billingPolicyRevision ?? row.billing_policy_revision;
    if (!id || !name || !clientName ||
        (policyClass !== null && !billingClass(policyClass)) ||
        typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      throw invalidResponse("client workstream search");
    }
    return {
      id, name, clientName,
      policyClass: policyClass as BillingWorkstreamSummary["policyClass"],
      policyRevision: revision,
    };
  });
}

/**
 * Build feature-owned Work Setup action ports. The host continues to supply
 * live capability checks, authenticated APIs, and request/identity lifetimes.
 */
export function createWorkSetupActionsRoute(services: WorkSetupActionServices) {
  const { can, api, pageApi, requestOptions, runCommand, permissionDenied } = services;

  function requirePermission(permissionKey: string, target?: PermissionTarget): void {
    if (!can(permissionKey, target)) throw permissionDenied();
  }

  return {
    createCatalogActions({ source, lifetime, permissions }: CatalogActionOptions): Pick<
      TaskCatalogSectionProps,
      "onCreate" | "onUpdate" | "onArchive" | "onReview"
    > {
      const writePermission = () => permissions.manage ? "tasks.catalog.manage" : "tasks.catalog.propose";
      const write = (method: string, path: string, input: unknown) => runCommand(
        source,
        lifetime,
        () => api(path, requestOptions(method, input)),
      );

      return {
        onCreate: async (input) => {
          requirePermission(writePermission());
          const result = responseRecord(await write("POST", "/api/task-catalog", input), "task catalog");
          return result.status === "pending" ? "pending" : "saved";
        },
        onUpdate: async (entryId, input) => {
          requirePermission(writePermission());
          const result = responseRecord(await write(
            "PATCH", "/api/task-catalog/" + encodeURIComponent(entryId), input,
          ), "task catalog");
          return result.status === "pending" ? "pending" : "saved";
        },
        onArchive: async (entryId, input) => {
          requirePermission(writePermission());
          const result = responseRecord(await write(
            "POST", "/api/task-catalog/" + encodeURIComponent(entryId) + "/archive", input,
          ), "task catalog");
          return result.status === "pending" ? "pending" : "saved";
        },
        onReview: async (proposalId, input) => {
          requirePermission("tasks.catalog.review");
          const result = responseRecord(await write(
            "POST", "/api/task-catalog/proposals/" + encodeURIComponent(proposalId) + "/review", input,
          ), "task catalog proposal review");
          return result.status === "stale" ? "stale" : "saved";
        },
      };
    },

    createBillingActions({ source, lifetime, workContext }: BillingActionOptions): Pick<
      BillingPolicySectionProps,
      "onLoadRules" | "onSearchWorkstreams" | "onSaveDefault" | "onSaveRule"
    > {
      const workstreams = billingWorkstreams(workContext);
      const findManageableWorkstream = (workstreamId: string): WorkstreamAccess | null => {
        const row = workstreams.find((item) => item.id === workstreamId && item.canManageBillingPolicy === true);
        if (!row) return null;
        const target = { clientId: row.client_id || row.clientId, clientWorkstreamId: row.id };
        return can("workstreams.billing_policy.manage", target) ? row : null;
      };
      const requireBillingAndCatalog = (workstreamId: string): void => {
        if (!findManageableWorkstream(workstreamId)) throw permissionDenied();
        if (!can("tasks.catalog.view") && !can("tasks.catalog.manage")) throw permissionDenied();
      };
      const billingPath = (workstreamId: string) =>
        "/api/workstreams/client/" + encodeURIComponent(workstreamId) + "/billing-policy";
      const mutate = (path: string, input: BillingDefaultInput | BillingRuleInput) => runCommand(
        source,
        lifetime,
        () => api(path, requestOptions("PATCH", input)),
      );

      const actions: Pick<BillingPolicySectionProps, "onLoadRules" | "onSearchWorkstreams" | "onSaveDefault" | "onSaveRule"> = {
        onSearchWorkstreams: async (query) => {
          const result = await pageApi("/api/work-context?q=" + encodeURIComponent(query), lifetime);
          return projectBillingWorkstreamSearch(result);
        },
        onLoadRules: async (workstreamId, query): Promise<BillingRulesSnapshot> => {
          requireBillingAndCatalog(workstreamId);
          const search = query ? "?q=" + encodeURIComponent(query) : "";
          const result = responseRecord(await runCommand(
            source,
            lifetime,
            () => pageApi(billingPath(workstreamId) + "/definitions" + search, lifetime),
          ), "billing policy rules");
          const rawEntries = result.entries;
          if (rawEntries !== undefined && rawEntries !== null && !Array.isArray(rawEntries)) {
            throw invalidResponse("billing policy rules");
          }
          const entries = Array.isArray(rawEntries) ? rawEntries : [];
          if ((result.defaultClass !== null && !billingClass(result.defaultClass)) ||
              typeof result.defaultRevision !== "number" || !Number.isSafeInteger(result.defaultRevision) ||
              result.defaultRevision < 1) {
            throw invalidResponse("billing policy rules");
          }
          return {
            defaultClass: result.defaultClass as BillingRulesSnapshot["defaultClass"],
            defaultRevision: Number(result.defaultRevision),
            entries: entries.map(projectBillingRuleEntry),
          };
        },
        onSaveDefault: async (workstreamId, input): Promise<BillingMutationResult> => {
          if (!findManageableWorkstream(workstreamId)) throw permissionDenied();
          const result = await mutate(billingPath(workstreamId), input);
          return projectBillingMutation(result, "billing policy update");
        },
        onSaveRule: async (workstreamId, entryId, input): Promise<BillingMutationResult> => {
          requireBillingAndCatalog(workstreamId);
          const path = billingPath(workstreamId) + "/definitions/" + encodeURIComponent(entryId);
          const result = await mutate(path, input);
          return projectBillingMutation(result, "billing policy rule update");
        },
      };
      return actions;
    },
  };
}
