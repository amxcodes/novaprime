import { useEffect, useId, useRef, useState } from "react";
import { Button, Field, Input, StateMessage } from "../../design-system";
import styles from "./SettingsSavedTaskViews.module.css";
import type {
  SavedTaskView,
  SettingsSavedTaskViewsProps,
} from "./saved-task-views-contracts";
import { prepareSavedTaskViewRename, submitSavedTaskViewRename } from "./saved-task-view-rename";

function collectionLabel(collection: SavedTaskView["collection"]): string {
  return collection === "mine" ? "My assignments" : "All visible tasks";
}

function describeView(view: SavedTaskView): string {
  const parts = [
    collectionLabel(view.collection),
    String(view.status || "any status").replaceAll("_", " "),
    String(view.due || "any due date").replaceAll("_", " "),
  ];
  if (typeof view.search === "string" && view.search.trim()) parts.push("Search: “" + view.search + "”");
  return parts.join(" · ");
}

function defaultError(): string {
  return "That saved-view change could not be completed. Try again.";
}

type LocalPending = string | null;

export function SettingsSavedTaskViews({
  views,
  availableCollections,
  readStatus,
  pendingAction,
  pendingDeleteId,
  pendingRenameId,
  onDelete,
  onRename,
  onRetry,
  formatError = defaultError,
  onFailure,
}: SettingsSavedTaskViewsProps) {
  const id = useId();
  const [localPending, setLocalPending] = useState<LocalPending>(null);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const renameInput = useRef<HTMLInputElement | null>(null);
  const renameTriggers = useRef(new Map<string, HTMLButtonElement>());
  const previousEditingViewId = useRef<string | null>(null);
  const pending = pendingAction === "retry"
    ? "retry"
    : pendingAction === "delete" && pendingDeleteId
      ? "delete:" + pendingDeleteId
      : pendingAction === "delete"
        ? "delete"
        : pendingAction === "rename" && pendingRenameId
          ? "rename:" + pendingRenameId
          : pendingAction === "rename"
            ? "rename"
        : pendingAction === null
          ? null
          : localPending;
  const busy = pending !== null;

  useEffect(() => {
    if (editingViewId) {
      renameInput.current?.focus();
      renameInput.current?.select();
    } else if (previousEditingViewId.current) {
      renameTriggers.current.get(previousEditingViewId.current)?.focus();
    }
    previousEditingViewId.current = editingViewId;
  }, [editingViewId]);

  const run = async (action: LocalPending, source: HTMLButtonElement, work: () => void | Promise<void>) => {
    if (busy) return;
    setFeedback(null);
    setLocalPending(action);
    try {
      await work();
    } catch (error) {
      if (!onFailure?.(error, source)) setFeedback({ kind: "error", message: formatError(error) });
    } finally {
      setLocalPending(null);
    }
  };

  return (
    <section className={styles.section} aria-labelledby={id + "-heading"}>
      <header className={styles.header}>
        <h2 className={styles.title} id={id + "-heading"}>Saved task views</h2>
        <p className={styles.description}>
          Named task filters are personal to your account. They contain no record data and never widen your task access.
        </p>
      </header>

      {readStatus === "loading" ? <StateMessage kind="loading">Loading saved task views</StateMessage> : null}
      {readStatus === "error" ? (
        <div className={styles.readError}>
          <StateMessage kind="warning">Saved task views could not be loaded. Refresh to try again.</StateMessage>
          <Button
            variant="secondary"
            size="compact"
            loading={pending === "retry"}
            loadingLabel="Refreshing saved task views"
            disabled={busy}
            onClick={(event) => void run("retry", event.currentTarget, onRetry)}
          >
            {pending === "retry" ? "Refreshing…" : "Retry"}
          </Button>
        </div>
      ) : null}

      {readStatus === "ready" && views.length === 0 ? (
        <StateMessage kind="info">No saved task views yet. Save a filter from Work.</StateMessage>
      ) : null}

      {readStatus === "ready" && views.length ? (
        <ul className={styles.list} aria-label="Personal saved task views">
          {views.map((view) => {
            const available = availableCollections.includes(view.collection);
            const rowPending = pending === "delete:" + view.id;
            const rowRenaming = pending === "rename:" + view.id;
            const editing = editingViewId === view.id;
            const renameId = `${id}-rename-${view.id}`;
            const renameError = !renameDraft.trim()
              ? "Enter a name for this saved view."
              : Array.from(renameDraft.trim()).length > 40
                ? "Use 40 characters or fewer."
                : undefined;
            const renamedView = editing ? prepareSavedTaskViewRename(view, renameDraft) : null;
            return (
              <li className={styles.row} key={view.id}>
                <div className={styles.copy}>
                  <strong className={styles.name}>{view.name}</strong>
                  <span className={styles.details}>
                    {describeView(view)}
                    {!available ? " · unavailable under your current role; you can still delete this filter" : ""}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {!editing ? (
                    <Button
                      className={styles.renameButton}
                      variant="secondary"
                      size="compact"
                      aria-label={"Rename saved view " + view.name}
                      disabled={busy || readStatus !== "ready"}
                      ref={(element) => {
                        if (element) renameTriggers.current.set(view.id, element);
                        else renameTriggers.current.delete(view.id);
                      }}
                      onClick={() => {
                        setFeedback(null);
                        setRenameDraft(view.name);
                        setEditingViewId(view.id);
                      }}
                    >Rename</Button>
                  ) : null}
                  <Button
                    className={styles.deleteButton}
                    variant="secondary"
                    size="compact"
                    aria-label={"Delete saved view " + view.name}
                    loading={rowPending}
                    loadingLabel={"Deleting saved view " + view.name}
                    disabled={busy || readStatus !== "ready"}
                    onClick={(event) => void run("delete:" + view.id, event.currentTarget, () => onDelete(view))}
                  >
                    {rowPending ? "Deleting…" : "Delete"}
                  </Button>
                </div>
                <form
                  className={styles.renameForm}
                  hidden={!editing}
                  aria-label={"Rename saved view " + view.name}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!renamedView) return;
                    const source = event.currentTarget.querySelector<HTMLButtonElement>("[type=submit]");
                    if (!source) return;
                    void run("rename:" + view.id, source, async () => {
                      const outcome = await submitSavedTaskViewRename(view, renameDraft, onRename);
                      if (outcome === "stale") {
                        setEditingViewId(null);
                        return;
                      }
                      if (outcome === "invalid") return;
                      setEditingViewId(null);
                      setFeedback({ kind: "success", message: "Saved view renamed." });
                    });
                  }}
                >
                  <Field
                    id={renameId}
                    className={styles.renameField}
                    label="Saved view name"
                    hint="Use a different name, up to 40 characters."
                    error={editing && renameError ? renameError : undefined}
                    required
                  >
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        ref={editing ? renameInput : undefined}
                        name="savedViewName"
                        value={editing ? renameDraft : view.name}
                        disabled={busy}
                        autoComplete="off"
                        onChange={(event) => setRenameDraft(event.currentTarget.value)}
                      />
                    )}
                  </Field>
                  <div className={styles.renameActions}>
                    <Button
                      variant="secondary"
                      size="compact"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingViewId(null);
                        setRenameDraft("");
                        setFeedback(null);
                      }}
                    >Cancel</Button>
                    <Button
                      className={styles.renameButton}
                      variant="primary"
                      size="compact"
                      type="submit"
                      loading={rowRenaming}
                      loadingLabel={"Saving name for " + view.name}
                      disabled={busy || readStatus !== "ready" || !renamedView}
                    >{rowRenaming ? "Saving…" : "Save name"}</Button>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      ) : null}

      {feedback ? <StateMessage kind={feedback.kind}>{feedback.message}</StateMessage> : null}
    </section>
  );
}
