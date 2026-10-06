const deniedReadCodes = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);
const priorities = new Set(["low", "normal", "high", "urgent"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

function malformedReadState(resource) {
  return { status: "error", message: `The ${resource} response could not be read. Refresh Work setup to try again.` };
}

function validCatalogEntry(entry) {
  return isRecord(entry) && typeof entry.id === "string" && entry.id.length > 0 &&
    typeof entry.title === "string" && priorities.has(entry.priority) &&
    Number.isSafeInteger(entry.revision) && entry.revision > 0 &&
    isNullableString(entry.description) &&
    (entry.createdByName === undefined || isNullableString(entry.createdByName));
}

function validCatalogProposal(proposal) {
  return isRecord(proposal) && typeof proposal.id === "string" && proposal.id.length > 0 &&
    ["create", "update", "archive"].includes(proposal.action) && typeof proposal.title === "string" &&
    priorities.has(proposal.priority) &&
    (proposal.expectedRevision === null || (Number.isSafeInteger(proposal.expectedRevision) && proposal.expectedRevision > 0)) &&
    typeof proposal.reason === "string" && typeof proposal.status === "string" &&
    isNullableString(proposal.description) && isNullableString(proposal.proposerName) &&
    typeof proposal.canReview === "boolean" && isNullableString(proposal.reviewNote);
}

export function workSetupReadState(result, property, resource, readIssue) {
  const issue = readIssue(result, resource);
  if (issue) {
    return {
      status: deniedReadCodes.has(result?.readError) ? "denied" : "error",
      message: issue.message,
    };
  }
  if (!Array.isArray(result?.[property])) {
    return { status: "error", message: `The ${resource} response could not be read. Refresh Work setup to try again.` };
  }
  return { status: "ready", data: result[property] };
}

export function projectTaskCatalog(result, readPlan, permissions, readIssue) {
  const catalogRead = readPlan.taskCatalog
    ? workSetupReadState(result, "entries", "task definitions", readIssue)
    : { status: "unavailable", message: "Task definitions were not requested for this role." };
  const proposalRead = readPlan.taskCatalog
    ? workSetupReadState(result, "proposals", "task-definition proposals", readIssue)
    : { status: "unavailable", message: "Task-definition proposals were not requested for this role." };
  if (catalogRead.status === "ready" && catalogRead.data.some((entry) => !validCatalogEntry(entry))) {
    catalogRead.status = "error";
    catalogRead.message = malformedReadState("task definitions").message;
    delete catalogRead.data;
  }
  if (proposalRead.status === "ready" && proposalRead.data.some((proposal) => !validCatalogProposal(proposal))) {
    proposalRead.status = "error";
    proposalRead.message = malformedReadState("task-definition proposals").message;
    delete proposalRead.data;
  }
  const snapshot = catalogRead.status === "ready" && proposalRead.status === "ready"
    ? { status: "ready", data: {
      entries: catalogRead.data.map((entry) => ({
        id: entry.id, title: entry.title, description: entry.description || null,
        priority: entry.priority, revision: entry.revision, createdByName: entry.createdByName || null,
      })),
      proposals: proposalRead.data.map((proposal) => ({
        id: proposal.id, action: proposal.action, title: proposal.title,
        description: proposal.description || null, priority: proposal.priority,
        expectedRevision: proposal.expectedRevision ?? null, reason: proposal.reason || "",
        status: proposal.status, proposerName: proposal.proposerName || null,
        canReview: proposal.canReview === true && permissions.review,
        reviewNote: proposal.reviewNote || null,
      })),
    } }
    : catalogRead.status !== "ready" ? catalogRead : proposalRead;

  return { catalogRead, proposalRead, snapshot };
}

function projectBillingWorkstreams(workContext, readIssue) {
  const source = workSetupReadState(workContext, "clientWorkstreams", "client workstreams", readIssue);
  if (source.status !== "ready") return source;
  if (source.data.some((item) => !isRecord(item) || typeof item.id !== "string" ||
      typeof item.name !== "string" || typeof item.canManageBillingPolicy !== "boolean" ||
      (item.client_name !== undefined && !isNullableString(item.client_name)) ||
      (item.clientName !== undefined && !isNullableString(item.clientName)))) {
    return malformedReadState("client workstreams");
  }
  return {
    status: "ready",
    data: source.data.filter((item) => item && item.canManageBillingPolicy === true).map((item) => ({
      id: item.id,
      clientName: item.client_name || item.clientName || "Client",
      name: item.name,
      policyClass: item.billingPolicyClass || null,
      policyRevision: Number(item.billingPolicyRevision || 0),
    })),
  };
}

function projectCatalogAccess(readPlan, permissions, catalogRead, proposalRead) {
  if (!readPlan.taskCatalog) return "missing";
  if (catalogRead.status === "denied" || proposalRead.status === "denied") return "denied";
  if (catalogRead.status === "error" || proposalRead.status === "error") return "error";
  return permissions.view || permissions.manage ? "available" : "missing";
}

/**
 * Compose the independent Work Setup slots. The host owns grants, reads,
 * transport, action guards, and payloads; this adapter only projects their
 * results into the authorized feature components.
 */
export function createWorkSetupRoute({
  isCurrentPageRequest,
  mountReactIsland,
  noticeElement,
  loadCatalogSection,
  loadBillingPolicySection,
  readIssue,
}) {
  for (const [name, service] of Object.entries({
    isCurrentPageRequest, mountReactIsland, noticeElement, loadCatalogSection, loadBillingPolicySection, readIssue,
  })) {
    if (typeof service !== "function") throw new TypeError(`Work Setup route service ${name} must be a function`);
  }

  return async function composeWorkSetup({
    content,
    lifetime,
    readPlan,
    taskCatalog,
    workContext,
    permissions,
    onRetry,
    createCatalogActions,
    createBillingActions,
  }) {
    if (!isCurrentPageRequest(lifetime) || !content?.isConnected) return;
    if (!readPlan.hasAny) {
      content.replaceChildren(noticeElement("Your current role has no work-setup features available.", "warning"));
      return;
    }

    const shouldMountCatalog = readPlan.taskCatalog && Object.values(permissions).some(Boolean);
    const [catalogModule, billingModule] = await Promise.all([
      shouldMountCatalog ? Promise.resolve().then(loadCatalogSection).catch(() => null) : null,
      readPlan.billingPolicy ? Promise.resolve().then(loadBillingPolicySection).catch(() => null) : null,
    ]);
    if (!isCurrentPageRequest(lifetime) || !content.isConnected) return;
    content.querySelector("[data-work-setup-loading], [data-work-setup-no-features]")?.remove();

    const { catalogRead, proposalRead, snapshot } = projectTaskCatalog(taskCatalog, readPlan, permissions, readIssue);
    const catalogRoot = content.querySelector("#work-setup-catalog-root");
    if (shouldMountCatalog && catalogRoot) {
      if (!catalogModule?.TaskCatalogSection) {
        catalogRoot.append(noticeElement("Task catalog could not load. Refresh Work setup to try again.", "error"));
      } else {
        mountReactIsland(catalogRoot, catalogModule.TaskCatalogSection, {
          ...createCatalogActions(catalogRoot),
          permissions,
          read: snapshot,
          onRetry,
        });
      }
    } else if (readPlan.taskCatalog) {
      catalogRoot?.append(noticeElement("Your task-catalog permissions changed. Refresh Work setup to confirm current access.", "warning"));
    }

    const billingRoot = content.querySelector("#work-setup-billing-root");
    if (readPlan.billingPolicy && billingRoot) {
      if (!billingModule?.BillingPolicySection) {
        billingRoot.append(noticeElement("Billing policy could not load. Refresh Work setup to try again.", "error"));
        return;
      }
      mountReactIsland(billingRoot, billingModule.BillingPolicySection, {
        ...createBillingActions(billingRoot),
        workstreams: projectBillingWorkstreams(workContext, readIssue),
        catalogAccess: projectCatalogAccess(readPlan, permissions, catalogRead, proposalRead),
        onRetryWorkstreams: onRetry,
        onRetryCatalog: onRetry,
      });
    }
  };
}
