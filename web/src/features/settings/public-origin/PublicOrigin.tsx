import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, SearchableSelect, StateMessage } from "../../../design-system";
import { PublicOriginActionError } from "./contracts";
import type { PublicOriginProps } from "./contracts";
import styles from "./PublicOrigin.module.css";

const fallbackValue = "";

export function PublicOrigin({ readState, onRetry, onSave }: PublicOriginProps) {
  const id = useId();
  const [selectedOrigin, setSelectedOrigin] = useState(() => readState.status === "ready" ? readState.configuredOrigin || "" : "");
  const [selectionDirty, setSelectionDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ kind: "conflict" | "rejected" | "unconfirmed"; message: string } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (readState.status === "ready" && !selectionDirty) {
      setSelectedOrigin(readState.configuredOrigin || fallbackValue);
    }
  }, [readState, selectionDirty]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || readState.status !== "ready") return;
    inFlight.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      await onSave(selectedOrigin || null);
      setSelectionDirty(false);
      setSaveSuccess("Public origin saved. New links will use this setting.");
    } catch (error) {
      setSaveError({
        kind: error instanceof PublicOriginActionError ? error.kind : "unconfirmed",
        message: error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "The public origin could not be saved. Try again.",
      });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function retry() {
    setSaveError(null);
    setSaveSuccess(null);
    onRetry();
  }

  const options = readState.status === "ready"
    ? [
      { value: fallbackValue, label: "Use deployment fallback", description: readState.effectiveOrigin },
      ...(selectedOrigin && !readState.allowedOrigins.includes(selectedOrigin)
        ? [{ value: selectedOrigin, label: `No longer approved — ${selectedOrigin}`, disabled: true }]
        : []),
      ...readState.allowedOrigins.map((origin) => ({ value: origin, label: origin })),
    ]
    : [];
  const currentSelection = readState.status === "ready" ? readState.configuredOrigin || fallbackValue : "";
  const selectedIsAllowed = readState.status !== "ready" || !selectedOrigin || readState.allowedOrigins.includes(selectedOrigin);

  return (
    <section className={styles.root} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Public links</p>
          <h2 id={`${id}-title`}>Canonical NOVA origin</h2>
          <p className={styles.intro}>Choose the approved domain used in invitations, account links, Gmail callbacks, and notification emails.</p>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.details}>
          <h3>Current link settings</h3>
          {readState.status === "loading" ? (
            <StateMessage kind="loading" aria-busy="true">Loading approved origins.</StateMessage>
          ) : readState.status === "error" ? (
            <div className={styles.readError}>
              <StateMessage kind="error" title="Origin settings could not be loaded">{readState.message}</StateMessage>
              <Button type="button" variant="secondary" onClick={retry}>Try again</Button>
            </div>
          ) : (
            <>
              <dl className={styles.originValues}>
                <div>
                  <dt>Configured choice</dt>
                  <dd>{readState.configuredOrigin ? <code>{readState.configuredOrigin}</code> : "Deployment fallback"}</dd>
                </div>
                <div>
                  <dt>Effective link origin</dt>
                  <dd><code>{readState.effectiveOrigin}</code></dd>
                </div>
              </dl>
              {readState.allowedOrigins.length === 0 ? (
                <StateMessage kind="warning" title="No approved custom origins">
                  This deployment currently allows only its fallback origin.
                </StateMessage>
              ) : null}
            </>
          )}
        </div>

        <form className={styles.form} onSubmit={submit}>
          {saveError ? (
            <div className={styles.saveFeedback}>
              <StateMessage kind="error" title={
                saveError.kind === "conflict"
                  ? "Origin change conflict"
                  : saveError.kind === "rejected"
                    ? "Origin was not saved"
                    : "Save status could not be confirmed"
              }>{saveError.message}</StateMessage>
              {readState.status === "ready" ? <Button type="button" size="compact" variant="secondary" onClick={retry}>Refresh approved origins</Button> : null}
            </div>
          ) : null}
          {saveSuccess ? <StateMessage kind="success">{saveSuccess}</StateMessage> : null}
          {readState.status === "ready" ? (
            <>
              <SearchableSelect
                label="Approved origin"
                name="origin"
                value={selectedOrigin}
                options={options}
                searchMode="local"
                placeholder="Choose an approved origin"
                emptyMessage="No matching approved origin."
                hint="Selecting the deployment fallback clears the custom origin setting."
                disabled={saving}
                onChange={(value) => {
                  setSelectedOrigin(value);
                  setSelectionDirty(value !== currentSelection);
                  setSaveError(null);
                  setSaveSuccess(null);
                }}
              />
              {selectionDirty && !selectedIsAllowed ? (
                <StateMessage kind="warning" title="This draft is no longer approved">Choose an origin from the refreshed allowlist before saving.</StateMessage>
              ) : null}
              <div className={styles.actions}>
                <Button type="submit" loading={saving} loadingLabel="Saving public origin" disabled={saving || selectedOrigin === currentSelection || !selectedIsAllowed}>
                  Save public origin
                </Button>
              </div>
            </>
          ) : readState.status === "loading" ? (
            <StateMessage kind="loading">Origin choices will appear when the current settings load.</StateMessage>
          ) : (
            <p className={styles.formHint}>Retry the origin read before making a change.</p>
          )}
        </form>
      </div>
    </section>
  );
}
