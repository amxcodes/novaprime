/**
 * Rename an owner-scoped saved task view through the existing task-view command.
 * Dependencies stay explicit so page/identity guards and conflict recovery are testable.
 */
export async function renameSavedTaskViewFromSettings({
  view,
  name,
  personId,
  identityEpoch,
  isCurrent,
  getCurrentView,
  saveTaskView,
  reloadTaskViews,
  setMessage,
  updateEditor,
  formatError,
}) {
  if (!isCurrent() || !personId || !view?.id) return false;

  const current = getCurrentView(view.id);
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName || Array.from(trimmedName).length > 40 || trimmedName === current?.name) return false;
  if (!current || current.revision !== view.revision) {
    const refreshed = await reloadTaskViews(personId, identityEpoch);
    if (!isCurrent()) return false;
    setMessage(refreshed
      ? "That saved view changed or is no longer available. The list was refreshed."
      : "That saved view could not be renamed, and the saved-view list could not be refreshed.", "warning");
    updateEditor();
    return false;
  }

  try {
    const saved = await saveTaskView({
      id: current.id,
      name: trimmedName,
      collection: current.collection,
      status: current.status,
      due: current.due,
      search: current.search,
    }, current.revision);
    if (!saved || !isCurrent()) return false;
  } catch (error) {
    if (error?.code !== "TASK_VIEW_CONFLICT" && error?.code !== "TASK_VIEW_NOT_FOUND") throw error;
    const refreshed = await reloadTaskViews(personId, identityEpoch);
    if (!isCurrent()) return false;
    setMessage(refreshed
      ? formatError(error)
      : "That saved view could not be renamed, and the saved-view list could not be refreshed.", "warning");
    updateEditor();
    return false;
  }

  updateEditor();
  return true;
}
