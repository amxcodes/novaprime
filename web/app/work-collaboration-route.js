const deniedReadCodes = new Set(["PERMISSION_DENIED", "PREREQUISITE_PERMISSION_REQUIRED"]);
const requestStatuses = new Set(["pending", "accepted", "declined", "withdrawn", "expired"]);
const reviewerRequestKinds = new Set(["initial", "replacement"]);

/**
 * Convert the actor-only collaboration endpoint rows into the small set of
 * fields safe for Work presentation. Eligibility flags remain server-owned.
 * Pending rows keep the existing feature contract; resolved rows are preserved
 * separately for the history surface without changing current presentation.
 */
export function projectWorkCollaborationReadState(result, resource, onRetry, readIssue) {
  const issue = typeof readIssue === "function" ? readIssue(result, resource) : null;
  if (issue) {
    const status = deniedReadCodes.has(result?.readError) ? "denied" : "error";
    return { status, message: issue.message, onRetry };
  }

  const records = Array.isArray(result?.requests) ? result.requests : null;
  if (!records) {
    return { status: "error", message: `The ${resource} response could not be read. Refresh Work to try again.`, onRetry };
  }

  const projected = records.map((record) => projectRequest(record, resource)).filter(Boolean);
  return {
    status: "ready",
    requests: projected.filter((request) => request.status === "pending"),
    history: projected.filter((request) => request.status !== "pending"),
    loadedRecordCount: records.length,
    recordLimit: 100,
  };
}

function projectRequest(record, resource) {
  if (!record || typeof record !== "object" || typeof record.id !== "string" || !record.id ||
      !requestStatuses.has(record.status)) return null;

  const reviewer = resource === "reviewer requests";
  const requestKind = reviewer
    ? (reviewerRequestKinds.has(record.request_kind) ? record.request_kind : null)
    : "handover";
  if (!requestKind) return null;

  return {
    id: record.id,
    kind: reviewer ? "reviewer" : "handover",
    requestKind,
    status: record.status,
    title: safeText(record.title),
    reason: safeText(record.reason),
    createdAt: safeInstant(record.created_at),
    expiresAt: safeInstant(record.expires_at),
    resolvedAt: safeNullableInstant(record.resolved_at),
    isRecipient: record.isRecipient === true,
    canAccept: record.canAccept === true,
    canDecline: record.canDecline === true,
    canWithdraw: record.canWithdraw === true,
  };
}

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function safeInstant(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)) ? value : "";
}

function safeNullableInstant(value) {
  return value === null ? null : safeInstant(value) || null;
}
