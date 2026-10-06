function projectCandidates(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const displayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
    return id && displayName ? [{ id, displayName }] : [];
  });
}

/** Convert the candidate API DTO into the feature's small presentation contract. */
export function projectAssignmentCandidateRead(result) {
  return {
    reviewers: projectCandidates(result?.reviewers),
    handoverTargets: projectCandidates(result?.handoverTargets),
    ...(result?.readError ? { readError: result.readError } : {}),
  };
}
