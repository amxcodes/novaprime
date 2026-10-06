import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Field, Input, SearchableSelect, StateMessage } from "../../../design-system";
import type { OwnerTransferChoice, OwnerTransferProps } from "./contracts";
import styles from "./OwnerTransfer.module.css";

const confirmationPhrase = "TRANSFER SUPER ADMIN";

export function OwnerTransfer(props: OwnerTransferProps) {
  const id = useId();
  const feedbackRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const [selectedChoice, setSelectedChoice] = useState<OwnerTransferChoice | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [targetError, setTargetError] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [error, setError] = useState("");
  const [retryError, setRetryError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (error) feedbackRef.current?.focus();
  }, [error]);

  if (!props.canTransfer) return null;

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setError("");
    setRetryError("");
    try {
      await props.onRetry();
    } catch (retryError) {
      setRetryError(messageFrom(retryError, "The people list could not be refreshed. Try again."));
    } finally {
      setRetrying(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || props.read.status !== "ready") return;
    submitLock.current = true;
    setError("");
    setSuccess(false);

    const target = selectedChoice && props.read.choices.includes(selectedChoice) ? selectedChoice : null;
    const nextTargetError = target ? "" : "Choose an eligible person.";
    const nextConfirmationError = confirmation === confirmationPhrase
      ? ""
      : `Type ${confirmationPhrase} exactly to confirm.`;
    setTargetError(nextTargetError);
    setConfirmationError(nextConfirmationError);
    if (nextTargetError || nextConfirmationError) {
      requestAnimationFrame(() => {
        if (nextTargetError) document.getElementById(`${id}-target`)?.focus();
        else confirmationRef.current?.focus();
      });
      submitLock.current = false;
      return;
    }

    setSubmitting(true);
    try {
      await target!.transfer();
      setSelectedChoice(null);
      setConfirmation("");
      setSuccess(true);
    } catch (transferError) {
      setError(messageFrom(transferError, "NOVA did not confirm the transfer. Refresh Admin and verify access before retrying."));
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  }

  const read = props.read;
  const choices = read.status === "ready" ? read.choices : [];
  const selectedValue = choices.findIndex((choice) => choice === selectedChoice);
  const options = choices.map((choice, index) => ({ value: String(index), label: choice.label }));

  return (
    <section className={styles.root} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title} id={`${id}-title`}>Ownership transfer</h2>
          <p className={styles.description}>Move the protected Super Admin role to another eligible person.</p>
        </div>
      </header>

      <StateMessage kind="warning" title="This transfer ends your current access">
        Your active sessions will be revoked when ownership transfers. You may be signed out.
      </StateMessage>

      {read.status === "loading" ? (
        <StateMessage kind="loading" title="Loading eligible people">Reading the authorized people list.</StateMessage>
      ) : null}
      {read.status === "unavailable" ? (
        <div className={styles.readState}>
          <StateMessage kind="info" title="Eligible people are unavailable">
            {read.message || "The authorized people list is not available right now."}
          </StateMessage>
          {retryError ? <StateMessage kind="error" title="Refresh did not complete">{retryError}</StateMessage> : null}
          <Button variant="secondary" type="button" loading={retrying} loadingLabel="Refreshing people" disabled={retrying || submitting} onClick={() => void retry()}>
            Retry people list
          </Button>
        </div>
      ) : null}
      {read.status === "error" ? (
        <div className={styles.readState}>
          <StateMessage kind="error" title="Eligible people could not load">{read.message}</StateMessage>
          {retryError ? <StateMessage kind="error" title="Refresh did not complete">{retryError}</StateMessage> : null}
          <Button variant="secondary" type="button" loading={retrying} loadingLabel="Refreshing people" disabled={retrying || submitting} onClick={() => void retry()}>
            Retry people list
          </Button>
        </div>
      ) : null}
      {read.status === "ready" && choices.length === 0 ? (
        <EmptyState title="No eligible person is available" description="An active or notice person who is not already the Super Admin is required." />
      ) : null}
      {read.status === "ready" && choices.length > 0 ? (
        <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
          <div className={styles.fields}>
            <div className={styles.targetField}>
              <SearchableSelect
                id={`${id}-target`}
                label="New owner"
                hint="Only active or notice people are listed."
                value={selectedValue < 0 ? "" : String(selectedValue)}
                options={options}
                placeholder="Choose a person"
                emptyMessage="No eligible people match."
                error={targetError || undefined}
                disabled={submitting}
                onChange={(value) => {
                  const index = Number(value);
                  setSelectedChoice(Number.isInteger(index) ? choices[index] || null : null);
                  setTargetError("");
                  setError("");
                  setSuccess(false);
                }}
              />
            </div>
            <Field
              id={`${id}-confirmation`}
              label="Confirmation"
              hint={`Type ${confirmationPhrase} exactly.`}
              error={confirmationError || undefined}
              required
            >
              {(control) => (
                <Input
                  {...control}
                  ref={confirmationRef}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  disabled={submitting}
                  onChange={(event) => {
                    setConfirmation(event.currentTarget.value);
                    setConfirmationError("");
                    setError("");
                    setSuccess(false);
                  }}
                />
              )}
            </Field>
          </div>

          {error ? (
            <div className={styles.feedback} ref={feedbackRef} tabIndex={-1}>
              <StateMessage kind="error" title="Transfer was not confirmed">{error}</StateMessage>
            </div>
          ) : null}
          {success ? (
            <StateMessage kind="success" title="Ownership transferred">
              Your current sessions may now be revoked. Sign in again with your updated access if needed.
            </StateMessage>
          ) : null}
          <div className={styles.actions}>
            <Button variant="danger" type="submit" loading={submitting} loadingLabel="Transferring ownership" disabled={submitting || retrying}>
              Transfer ownership
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function messageFrom(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
}
