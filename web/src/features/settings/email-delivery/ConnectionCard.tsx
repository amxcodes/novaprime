import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import { classifyEmailDeliveryActionFailure } from "./contracts";
import type { EmailConnectionView, EmailDeliveryActionFailureKind, EmailProviderKind, EmailTestStatus } from "./contracts";
import styles from "./EmailDelivery.module.css";

export const providerLabels: Record<EmailProviderKind, string> = {
  console: "Console (local development)",
  smtp: "SMTP",
  gmail_oauth2: "Gmail API (OAuth)",
  resend: "Resend",
};

const fallbackError = "NOVA could not confirm the email connection action.";

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallbackError;
}

export function EmailDeliveryActionFeedback({
  kind,
  message,
  onRefresh,
  refreshLabel,
}: {
  kind: EmailDeliveryActionFailureKind;
  message: string;
  onRefresh?: () => void;
  refreshLabel: string;
}) {
  const title = kind === "conflict"
    ? "Action conflict"
    : kind === "unconfirmed"
      ? "Outcome unconfirmed"
      : "Action was not completed";
  return (
    <div className={styles.actionFeedback}>
      <StateMessage kind="error" title={title}>{message}</StateMessage>
      {kind === "unconfirmed" ? (
        <>
          <p>The request may have completed before the connection failed. Refresh and check the saved connection before trying again.</p>
          {onRefresh ? <Button type="button" size="compact" variant="secondary" onClick={onRefresh}>{refreshLabel}</Button> : null}
        </>
      ) : null}
    </div>
  );
}

function testDate(value: string | null): string {
  if (!value) return "Not tested yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Test date unavailable"
    : `Tested ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

type LocalTestResult = Readonly<{
  status: "passed" | "failed";
  serverTestedAt: string | null;
  serverStatus: EmailTestStatus;
}>;

/** Use an optimistic result only while it still describes the current server snapshot. */
export function effectiveEmailTestStatus(
  localResult: LocalTestResult | null,
  connection: Pick<EmailConnectionView, "lastTestedAt" | "lastTestStatus">,
): EmailTestStatus {
  return localResult &&
    localResult.serverTestedAt === connection.lastTestedAt &&
    localResult.serverStatus === connection.lastTestStatus
    ? localResult.status
    : connection.lastTestStatus;
}

export function TextField({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = true,
  autoComplete,
  hint,
  disabled,
  inputMode,
  min,
  max,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
  disabled: boolean;
  inputMode?: "email" | "numeric";
  min?: number;
  max?: number;
}) {
  return (
    <Field label={label} hint={hint} required={required}>
      {(control) => <Input
        {...control}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />}
    </Field>
  );
}

export function ConnectionCard({
  connection,
  canUseEmailActions,
  onRefresh,
}: {
  connection: EmailConnectionView;
  canUseEmailActions: boolean;
  onRefresh?: () => void;
}) {
  const id = useId();
  const [testOpen, setTestOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [busyAction, setBusyAction] = useState<"test" | "activate" | "deactivate" | "google" | null>(null);
  const [actionError, setActionError] = useState<{ kind: EmailDeliveryActionFailureKind; message: string } | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [localTestResult, setLocalTestResult] = useState<LocalTestResult | null>(null);
  const [localActive, setLocalActive] = useState<boolean | null>(null);
  const inFlight = useRef(false);
  const testFormId = `${id}-test-form`;
  const deactivateId = `${id}-deactivate`;
  const isActive = localActive ?? connection.isActive;
  const effectiveTestStatus = effectiveEmailTestStatus(localTestResult, connection);
  const testHasPassed = effectiveTestStatus === "passed";
  const canActivate = connection.supported && canUseEmailActions && testHasPassed;

  useEffect(() => {
    setLocalActive(null);
  }, [connection.isActive]);

  async function runAction(
    action: "test" | "activate" | "deactivate" | "google",
    callback: () => Promise<void>,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyAction(action);
    setActionError(null);
    setActionSuccess(null);
    try {
      await callback();
      if (action === "test") {
        setLocalTestResult({
          status: "passed",
          serverTestedAt: connection.lastTestedAt,
          serverStatus: connection.lastTestStatus,
        });
        setActionSuccess("Test email sent successfully. This connection can now be activated.");
      }
      if (action === "activate") {
        setLocalActive(true);
        setActionSuccess("This connection is now active for NOVA email.");
      }
      if (action === "deactivate") {
        setLocalActive(false);
        setActionSuccess("Email delivery is off. New invitation and recovery emails will not be sent.");
        setDeactivateOpen(false);
      }
      if (action === "google") setActionSuccess("Opening Google to authorize this sender.");
    } catch (error) {
      const failureKind = classifyEmailDeliveryActionFailure(error);
      if (action === "test" && failureKind !== "unconfirmed") {
        setLocalTestResult({
          status: "failed",
          serverTestedAt: connection.lastTestedAt,
          serverStatus: connection.lastTestStatus,
        });
      }
      setActionError({
        kind: failureKind,
        message: safeErrorMessage(error),
      });
    } finally {
      inFlight.current = false;
      setBusyAction(null);
    }
  }

  function submitTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipientEmail.trim() || !canUseEmailActions) return;
    void runAction("test", () => connection.onTest(recipientEmail.trim()));
  }

  return (
    <article className={styles.connection} aria-labelledby={`${id}-title`}>
      <header className={styles.connectionHeader}>
        <div className={styles.connectionIdentity}>
          <h4 id={`${id}-title`}>{connection.name}</h4>
          <p className={styles.connectionMeta}>
            {providerLabels[connection.provider]} <span aria-hidden="true">·</span> {connection.senderEmail}
          </p>
          {connection.replyToEmail ? <p className={styles.connectionMeta}>Reply-to {connection.replyToEmail}</p> : null}
        </div>
        <span className={isActive && connection.supported ? styles.activeStatus : styles.inactiveStatus}>
          {isActive ? connection.supported ? "Active" : "Active · unavailable here" : "Inactive"}
        </span>
      </header>

      {!connection.supported ? (
        <StateMessage kind="warning" title="Unavailable in this runtime">
          This saved provider cannot send from the current deployment. Deactivate it here or choose a supported provider.
        </StateMessage>
      ) : null}

      <p className={styles.testSummary}>
        {effectiveTestStatus === "failed"
          ? "The latest test failed. Send a new test before activating this connection."
          : effectiveTestStatus === "passed" && !connection.lastTestedAt
            ? "Test email sent successfully."
            : testDate(connection.lastTestedAt)}
      </p>

      {busyAction ? <StateMessage kind="loading">{{ test: "Sending test email.", activate: "Activating connection.", deactivate: "Deactivating connection.", google: "Opening Google authorization." }[busyAction]}</StateMessage> : null}
      {actionError ? (
        <EmailDeliveryActionFeedback
          kind={actionError.kind}
          message={actionError.message}
          onRefresh={actionError.kind === "unconfirmed" ? onRefresh : undefined}
          refreshLabel="Refresh saved connections"
        />
      ) : null}
      {actionSuccess ? <StateMessage kind="success">{actionSuccess}</StateMessage> : null}

      <div className={styles.connectionActions} aria-label={`Actions for ${connection.name}`}>
        {connection.supported ? (
          <>
            <Button
              type="button"
              size="compact"
              variant="secondary"
              aria-expanded={testOpen}
              aria-controls={testFormId}
              disabled={!canUseEmailActions || busyAction !== null}
              onClick={() => {
                setActionError(null);
                setActionSuccess(null);
                setTestOpen((open) => !open);
              }}
            >
              {testOpen ? "Close test" : "Send test"}
            </Button>
            {isActive ? null : (
              <Button
                type="button"
                size="compact"
                disabled={!canActivate || busyAction !== null}
                loading={busyAction === "activate"}
                loadingLabel="Activating email connection"
                onClick={() => void runAction("activate", connection.onActivate)}
              >
                Activate
              </Button>
            )}
            {connection.provider === "gmail_oauth2" && connection.onConnectGoogle ? (
              <Button
                type="button"
                size="compact"
                variant="secondary"
                disabled={!canUseEmailActions || busyAction !== null}
                loading={busyAction === "google"}
                loadingLabel="Opening Google authorization"
                onClick={() => void runAction("google", connection.onConnectGoogle!)}
              >
                Connect Google
              </Button>
            ) : null}
          </>
        ) : null}

        {isActive ? (
          <Button
            type="button"
            size="compact"
            variant="danger"
            aria-expanded={deactivateOpen}
            aria-controls={deactivateId}
            disabled={busyAction !== null}
            onClick={() => {
              setActionError(null);
              setActionSuccess(null);
              setDeactivateOpen((open) => !open);
            }}
          >
            {deactivateOpen ? "Keep active" : "Deactivate"}
          </Button>
        ) : null}
      </div>

      {connection.supported && !isActive && !testHasPassed ? (
        <p className={styles.actionHint}>Send and pass a test before this connection can be activated.</p>
      ) : null}

      {connection.supported ? (
        <form className={styles.testForm} id={testFormId} hidden={!testOpen} onSubmit={submitTest}>
          <TextField
            label="Send test email to"
            name="recipientEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={recipientEmail}
            disabled={busyAction !== null || !canUseEmailActions}
            onChange={setRecipientEmail}
          />
          <Button
            type="submit"
            size="compact"
            loading={busyAction === "test"}
            loadingLabel="Sending test email"
            disabled={!canUseEmailActions || busyAction !== null}
          >
            Send test email
          </Button>
        </form>
      ) : null}

      {isActive ? (
        <div className={styles.deactivateConfirm} id={deactivateId} hidden={!deactivateOpen}>
          <p>Deactivate this connection? NOVA will stop sending new invitation and account emails through it.</p>
          <div className={styles.confirmActions}>
            <Button
              type="button"
              size="compact"
              variant="danger"
              loading={busyAction === "deactivate"}
              loadingLabel="Deactivating email connection"
              disabled={busyAction !== null}
              onClick={() => void runAction("deactivate", connection.onDeactivate)}
            >
              Confirm deactivation
            </Button>
            <Button type="button" size="compact" variant="quiet" disabled={busyAction !== null} onClick={() => setDeactivateOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
