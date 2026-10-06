import type { SavedTaskView } from "./saved-task-views-contracts";

export type SavedTaskViewRenameOutcome = "invalid" | "saved" | "stale";

/** Build an allowlisted rename while retaining the saved view's filters and revision. */
export function prepareSavedTaskViewRename(
  view: SavedTaskView,
  draft: string,
): SavedTaskView | null {
  const name = draft.trim();
  if (!name || Array.from(name).length > 40 || name === view.name) return null;
  return { ...view, name };
}

/** Keep input validation at the feature boundary and let the host own persistence. */
export async function submitSavedTaskViewRename(
  view: SavedTaskView,
  draft: string,
  onRename: (next: SavedTaskView) => boolean | void | Promise<boolean | void>,
): Promise<SavedTaskViewRenameOutcome> {
  const next = prepareSavedTaskViewRename(view, draft);
  if (!next) return "invalid";
  return (await onRename(next)) === false ? "stale" : "saved";
}
