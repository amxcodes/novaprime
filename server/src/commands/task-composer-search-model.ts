const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TaskComposerSearchInput = Readonly<{
  kind: "client" | "organisation";
  id: string;
  groupId?: string;
  search: string;
}>;

export function parseTaskComposerSearchInput(request: Request): TaskComposerSearchInput | null {
  const params = new URL(request.url).searchParams;
  const rawSearch = params.getAll("q");
  const rawKind = params.getAll("workstreamKind");
  const rawId = params.getAll("workstreamId");
  const rawGroupId = params.getAll("groupId");
  if (rawSearch.length > 1 || rawKind.length !== 1 || rawId.length !== 1 || rawGroupId.length > 1) return null;
  const kind = rawKind[0];
  const id = rawId[0];
  const groupValue = rawGroupId[0];
  const search = (rawSearch[0] || "").trim();
  if ((kind !== "client" && kind !== "organisation") || !uuidPattern.test(id || "") ||
      (groupValue !== undefined && !uuidPattern.test(groupValue)) || search.length > 120) return null;
  return { kind, id, ...(groupValue ? { groupId: groupValue } : {}), search };
}

export function taskComposerSearchPattern(search: string): string | null {
  const query = search.trim();
  return query ? `%${query.replace(/[\\%^_]/g, "^$&")}%` : null;
}
