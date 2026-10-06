const STORAGE_PIN_LIMIT = 4;

/**
 * Update one pin in a full personal preference list without treating
 * role-hidden destinations as visible pins. The API stores at most four IDs,
 * so adding a visible pin prunes only as many hidden IDs as needed for space.
 */
export function updatePinnedDestinations(
  storedDestinationIds: readonly string[],
  authorizedDestinationIds: readonly string[],
  destinationId: string,
  pinned: boolean,
  maximumPinned = STORAGE_PIN_LIMIT,
): readonly string[] {
  if (typeof destinationId !== "string" || !destinationId || typeof pinned !== "boolean" ||
      !Number.isSafeInteger(maximumPinned) || maximumPinned < 0) return storedDestinationIds;

  const limit = Math.min(maximumPinned, STORAGE_PIN_LIMIT);
  const authorizedIds = new Set(authorizedDestinationIds);
  if (!authorizedIds.has(destinationId)) return storedDestinationIds;

  const wasPinned = storedDestinationIds.includes(destinationId);
  if (wasPinned === pinned) return storedDestinationIds;

  if (!pinned) {
    return storedDestinationIds.filter((id) => id !== destinationId);
  }

  const visiblePinCount = storedDestinationIds.reduce(
    (count, id) => count + Number(authorizedIds.has(id)),
    0,
  );
  if (visiblePinCount >= limit) return storedDestinationIds;

  const next = [...storedDestinationIds];
  while (next.length >= limit) {
    let hiddenIndex = -1;
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (!authorizedIds.has(next[index])) {
        hiddenIndex = index;
        break;
      }
    }
    // With a valid stored list, an available visible slot always has a hidden
    // ID available to prune when storage is full. Fail closed on malformed input.
    if (hiddenIndex < 0) return storedDestinationIds;
    next.splice(hiddenIndex, 1);
  }

  next.push(destinationId);
  return next;
}
