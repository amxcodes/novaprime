import type { BillingRulesEntrySummary, BillingWorkstreamSummary } from "./contracts";

export function filterWorkstreams(
  workstreams: ReadonlyArray<BillingWorkstreamSummary>,
  query: string,
): BillingWorkstreamSummary[] {
  const search = query.toLocaleLowerCase();
  return workstreams.filter((item) => `${item.clientName} ${item.name}`.toLocaleLowerCase().includes(search));
}

export function filterBillingDefinitions(
  entries: ReadonlyArray<BillingRulesEntrySummary>,
  query: string,
): BillingRulesEntrySummary[] {
  const search = query.toLocaleLowerCase();
  return entries.filter((item) => item.title.toLocaleLowerCase().includes(search));
}

export function workstreamSearchStatus(query: string, matchCount: number, totalCount: number): string {
  if (!query) return `${totalCount} manageable client workstream${totalCount === 1 ? "" : "s"} available.`;
  if (!matchCount) return "No client workstreams match the current filter.";
  return `${matchCount} matching client workstream${matchCount === 1 ? "" : "s"}.`;
}

export function definitionSearchStatus(query: string, matchCount: number, totalCount: number): string {
  if (!query) return `${totalCount} predefined task definition${totalCount === 1 ? "" : "s"} available.`;
  if (!matchCount) return "No predefined task definitions match the current search.";
  return `${matchCount} matching predefined task definition${matchCount === 1 ? "" : "s"}.`;
}
