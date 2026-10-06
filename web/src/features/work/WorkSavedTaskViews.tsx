import { useId, useState, type FormEvent } from "react";
import { Button, Field, Input, Select, StateMessage, type SelectOption } from "../../design-system";
import styles from "./WorkSavedTaskViews.module.css";
import type {
  SavedTaskView,
  WorkSavedTaskViewsProps,
} from "./saved-task-views-contracts";

function collectionLabel(collection: SavedTaskView["collection"]): string {
  return collection === "mine" ? "My assignments" : "All visible tasks";
}

function defaultError(): string {
  return "That saved-view change could not be completed. Try again.";
}

type WorkPendingAction = "retry" | "open" | "update" | "create";

export function WorkSavedTaskViews({
  views,
  collection,
  filters,
  readStatus,
  availableCollections,
  atLimit,
  pendingAction,
  onOpen,
  onCreate,
  onUpdate,
  onRetry,
  formatError = defaultError,
  onFailure,
}: WorkSavedTaskViewsProps) {
  const id = useId();
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [localPending, setLocalPending] = useState<WorkPendingAction | null>(null);
  const [feedback, setFeedback] = useState("");
  const available = availableCollections.includes(collection);
  const collectionViews = views.filter((view) => view.collection === collection);
  const selected = collectionViews.find((view) => view.id === selectedId) ?? collectionViews[0];
  const viewOptions: SelectOption[] = collectionViews.map((view) => ({ value: view.id, label: view.name }));
  const pending = pendingAction ?? localPending;
  const busy = pending !== null;

  const run = async (
    action: WorkPendingAction,
    source: HTMLButtonElement,
    work: () => void | Promise<void>,
  ) => {
    if (busy) return;
    setFeedback("");
    setLocalPending(action);
    try {
      await work();
    } catch (error) {
      if (!onFailure?.(error, source)) {
        setFeedback(formatError(error));
      }
    } finally {
      setLocalPending(null);
    }
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized || normalized.length > 40 || atLimit || readStatus !== "ready" || busy) return;
    const source = event.currentTarget.querySelector<HTMLButtonElement>("[type=submit]");
    if (!source) return;
    void run("create", source, async () => {
      await onCreate(normalized);
      setName("");
    });
  };

  const canSave = available && readStatus === "ready" && !atLimit;

  return (
    <fieldset className={styles.panel} aria-describedby={id + "-description"}>
      <legend className={styles.legend}>Saved views</legend>
      <p className={styles.description} id={id + "-description"}>
        Save and reopen filters for this task list.
      </p>

      {!available ? (
        <StateMessage kind="warning">
          Saved views for this task list are unavailable with your current access.
        </StateMessage>
      ) : readStatus === "loading" ? (
        <StateMessage kind="loading">Loading saved views</StateMessage>
      ) : readStatus === "error" ? (
        <div className={styles.readError}>
          <StateMessage kind="warning">Saved views could not be loaded. Your current filters still work.</StateMessage>
          <Button
            variant="secondary"
            size="compact"
            loading={pending === "retry"}
            loadingLabel="Refreshing saved views"
            disabled={busy}
            onClick={(event) => void run("retry", event.currentTarget, onRetry)}
          >
            {pending === "retry" ? "Refreshing…" : "Retry"}
          </Button>
        </div>
      ) : collectionViews.length ? (
        <div className={styles.openControls}>
          <Select
            label="Open a saved view"
            name="savedViewId"
            value={selected?.id ?? ""}
            options={viewOptions}
            placeholder="Choose a saved view"
            disabled={busy}
            onChange={setSelectedId}
          />
          <Button
            variant="secondary"
            size="compact"
            loading={pending === "open"}
            loadingLabel="Opening saved view"
            disabled={busy || !selected}
            onClick={(event) => {
              if (selected) void run("open", event.currentTarget, () => onOpen(selected));
            }}
          >
            {pending === "open" ? "Opening…" : "Open view"}
          </Button>
          <Button
            variant="secondary"
            size="compact"
            loading={pending === "update"}
            loadingLabel="Updating saved view"
            disabled={busy || !selected}
            onClick={(event) => {
              if (!selected) return;
              const updated: SavedTaskView = {
                ...selected,
                collection,
                status: filters.status,
                due: filters.due,
                search: String(filters.search || "").trim(),
              };
              void run("update", event.currentTarget, () => onUpdate(updated));
            }}
          >
            {pending === "update" ? "Updating…" : "Update selected view"}
          </Button>
        </div>
      ) : (
        <StateMessage kind="info">No saved views for this task list yet.</StateMessage>
      )}

      {available ? (
        <details className={styles.createDisclosure}>
          <summary>Save current filters</summary>
          <form className={styles.createForm} onSubmit={submitCreate}>
            <Field className={styles.nameField} label="Saved view name" hint="Up to 40 characters." required>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  name="name"
                  maxLength={40}
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  disabled={!canSave || busy}
                  placeholder="Name this filter"
                />
              )}
            </Field>
            <Button
              variant="secondary"
              size="compact"
              type="submit"
              loading={pending === "create"}
              loadingLabel="Saving saved view"
              disabled={!canSave || busy || !name.trim()}
            >
              {pending === "create" ? "Saving…" : "Save current view"}
            </Button>
            {atLimit ? <span className={styles.limitNote}>Delete a saved view in Settings to make room.</span> : null}
            {readStatus === "error" ? <span className={styles.limitNote}>Refresh saved views before saving another filter.</span> : null}
          </form>
        </details>
      ) : null}

      {feedback ? <StateMessage kind="error">{feedback}</StateMessage> : null}
    </fieldset>
  );
}
