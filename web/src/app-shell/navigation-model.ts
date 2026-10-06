import type { AppNavigationGroup, AppNavigationItem } from "./contracts";

/** Flatten only the destinations already approved by the host capability planner. */
export function flattenNavigation(
  groups: readonly AppNavigationGroup[],
): AppNavigationItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * Keep the compact bar deterministic and capability-safe: IDs are resolved
 * against the already-filtered navigation and duplicates are ignored.
 */
export function selectMobileNavigation(
  groups: readonly AppNavigationGroup[],
  requestedIds: readonly string[] = [],
): AppNavigationItem[] {
  const available = new Map(flattenNavigation(groups).map((item) => [item.id, item]));
  const selected: AppNavigationItem[] = [];
  const seen = new Set<string>();

  for (const id of requestedIds) {
    const item = available.get(id);
    if (!item || seen.has(id)) continue;
    selected.push(item);
    seen.add(id);
    if (selected.length === 4) break;
  }

  return selected;
}
