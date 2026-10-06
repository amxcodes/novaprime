const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FOCUS_TARGETS = Object.freeze({
  "leave-review": Object.freeze({ kind: "leave", parameter: "leave", feature: "leaveReview" }),
  "wfh-review": Object.freeze({ kind: "wfh", parameter: "wfh", feature: "wfhReview" }),
});

/** Read a notification row target only for its currently authorized Admin feature. */
export function resolveAdminNotificationFocus(search, grants, canShowAdminFeature) {
  if (typeof search !== "string" || typeof canShowAdminFeature !== "function") return null;

  const params = new URLSearchParams(search);
  if (params.getAll("view").length !== 1 || params.get("view") !== "admin" || params.getAll("focus").length !== 1) {
    return null;
  }

  const target = FOCUS_TARGETS[params.get("focus")];
  if (!target || params.getAll(target.parameter).length !== 1) return null;
  const otherParameter = target.parameter === "leave" ? "wfh" : "leave";
  if (params.has(otherParameter)) return null;

  const requestId = params.get(target.parameter) || "";
  if (!UUID_PATTERN.test(requestId) || !canShowAdminFeature(grants, target.feature)) return null;
  return { kind: target.kind, requestId: requestId.toLowerCase() };
}
