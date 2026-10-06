export function workstreamSearchStatus(query: string, matchCount: number): string {
  if (!query) return `${matchCount} manageable client workstream${matchCount === 1 ? "" : "s"} available.`;
  if (!matchCount) return "No client workstreams match the current search.";
  return `${matchCount} matching client workstream${matchCount === 1 ? "" : "s"} returned by NOVA.`;
}

export function definitionSearchStatus(query: string, matchCount: number): string {
  if (!query) return `${matchCount} predefined task definition${matchCount === 1 ? "" : "s"} available.`;
  if (!matchCount) return "No predefined task definitions match the current search.";
  return `${matchCount} matching predefined task definition${matchCount === 1 ? "" : "s"} returned by NOVA.`;
}
