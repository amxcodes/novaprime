import { forwardRef, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, Field, StateMessage } from "../../design-system";
import styles from "./People.module.css";

export type PersonLifecycleAction = "freeze" | "start-offboarding" | "complete-exit";

export type PersonLifecycleActionResult =
  | { status: "success"; message?: string }
  | { status: "error"; message?: string };

export interface PersonLifecycleActionsProps {
  personName: string;
  /** The host has already verified target readability and the actor's effective scoped grant. */
  canFreeze: boolean;
  canStartOffboarding: boolean;
  canCompleteOffboarding: boolean;
  onFreeze: () => Promise<PersonLifecycleActionResult>;
  onStartOffboarding: (reason: string) => Promise<PersonLifecycleActionResult>;
  onCompleteExit: (reason: string) => Promise<PersonLifecycleActionResult>;
}

export interface PersonLifecycleOutcome {
  action: PersonLifecycleAction;
  result: PersonLifecycleActionResult;
}

function actionTitle(action: PersonLifecycleAction): string {
  if (action === "freeze") return "Freeze access";
  if (action === "start-offboarding") return "Start offboarding";
  return "Complete exit";
}

function outcomeCopy({ action, result }: PersonLifecycleOutcome): { kind: "success" | "error"; title: string; message: string } {
  if (result.status === "error") {
    return {
      kind: "error",
      title: `${actionTitle(action)} could not be completed`,
      message: result.message?.trim() || "Refresh this person record before trying again.",
    };
  }

  const message = action === "freeze"
    ? "Access was frozen. Refresh the person record to confirm its current status."
    : action === "start-offboarding"
      ? "Offboarding started. Refresh the person record before taking another action."
      : "Exit completed. Refresh the person record to confirm the current status.";
  return { kind: "success", title: `${actionTitle(action)} complete`, message };
}

/** Outcome feedback is shared by the local async flow and the component tests. */
export const PersonLifecycleOutcomeNotice = forwardRef<HTMLDivElement, { outcome: PersonLifecycleOutcome }>(function PersonLifecycleOutcomeNotice({ outcome }, ref) {
  const copy = outcomeCopy(outcome);
  return (
    <div ref={ref} className={styles.lifecycleOutcomeFocus} tabIndex={-1}>
      <StateMessage kind={copy.kind} title={copy.title}>{copy.message}</StateMessage>
    </div>
  );
});

type OffboardingMode = "start-offboarding" | "complete-exit";

export function PersonLifecycleActions({
  personName,
  canFreeze,
  canStartOffboarding,
  canCompleteOffboarding,
  onFreeze,
  onStartOffboarding,
  onCompleteExit,
}: PersonLifecycleActionsProps) {
  const id = useId();
  const freezeTrigger = useRef<HTMLButtonElement>(null);
  const startTrigger = useRef<HTMLButtonElement>(null);
  const completeTrigger = useRef<HTMLButtonElement>(null);
  const freezeCancel = useRef<HTMLButtonElement>(null);
  const offboardingCancel = useRef<HTMLButtonElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const outcomeTarget = useRef<HTMLDivElement>(null);
  const progressTarget = useRef<HTMLParagraphElement>(null);
  const focusReturn = useRef<HTMLButtonElement | null>(null);
  const pendingRef = useRef<PersonLifecycleAction | null>(null);
  const [freezeConfirming, setFreezeConfirming] = useState(false);
  const [offboardingMode, setOffboardingMode] = useState<OffboardingMode | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PersonLifecycleAction | null>(null);
  const [outcome, setOutcome] = useState<PersonLifecycleOutcome | null>(null);
  const hasActions = canFreeze || canStartOffboarding || canCompleteOffboarding;

  useEffect(() => {
    if (freezeConfirming) freezeCancel.current?.focus();
    else if (offboardingMode) reasonInput.current?.focus();
    else if (focusReturn.current) {
      focusReturn.current.focus();
      focusReturn.current = null;
    }
  }, [freezeConfirming, offboardingMode]);

  useEffect(() => {
    if (outcome) outcomeTarget.current?.focus();
  }, [outcome]);

  useEffect(() => {
    if (pendingAction) progressTarget.current?.focus();
  }, [pendingAction]);

  if (!hasActions && !outcome && !pendingAction) return null;

  async function runAction(action: PersonLifecycleAction, command: () => Promise<PersonLifecycleActionResult>) {
    if (pendingRef.current) return;
    pendingRef.current = action;
    setPendingAction(action);
    setOutcome(null);
    setReasonError(null);
    try {
      const result = await command();
      const nextOutcome = { action, result } satisfies PersonLifecycleOutcome;
      setOutcome(nextOutcome);
      if (result.status === "success") {
        setFreezeConfirming(false);
        setOffboardingMode(null);
        setReason("");
      }
    } catch {
      setOutcome({
        action,
        result: { status: "error", message: "The request could not be completed. Refresh this person record and try again." },
      });
    } finally {
      pendingRef.current = null;
      setPendingAction(null);
    }
  }

  function cancelFreeze() {
    if (pendingRef.current) return;
    focusReturn.current = freezeTrigger.current;
    setFreezeConfirming(false);
  }

  function cancelOffboarding() {
    if (pendingRef.current) return;
    focusReturn.current = offboardingMode === "complete-exit" ? completeTrigger.current : startTrigger.current;
    setOffboardingMode(null);
    setReason("");
    setReasonError(null);
  }

  function submitOffboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!offboardingMode || pendingRef.current) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setReasonError("Enter a reason for this audited access change.");
      reasonInput.current?.focus();
      return;
    }
    if (offboardingMode === "start-offboarding") {
      void runAction(offboardingMode, () => onStartOffboarding(trimmedReason));
    } else {
      void runAction(offboardingMode, () => onCompleteExit(trimmedReason));
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>, close: () => void) {
    if (event.key === "Escape" && !pendingRef.current) {
      event.preventDefault();
      close();
    }
  }

  const busy = pendingAction !== null;
  const isOffboarding = offboardingMode !== null;
  const offboardingTitle = offboardingMode === "complete-exit"
    ? "Complete exit"
    : offboardingMode === "start-offboarding" || canStartOffboarding
      ? "Start offboarding"
      : "Complete exit";
  const offboardingPending = offboardingMode !== null && pendingAction === offboardingMode;
  const actionInProgress = pendingAction === "freeze"
    ? "Freezing access…"
    : pendingAction === "complete-exit"
      ? "Completing exit…"
      : pendingAction === "start-offboarding"
        ? "Starting offboarding…"
        : null;

  return (
    <section className={styles.lifecycleActions} aria-label={`Account actions for ${personName}`} aria-busy={busy || undefined}>
      {hasActions ? (
        <div className={styles.lifecycleActionGroup} role="group" aria-label={`Available account actions for ${personName}`}>
          {canFreeze ? (
            <Button
              ref={freezeTrigger}
              variant="danger"
              aria-expanded={freezeConfirming}
              aria-controls={`${id}-freeze-confirmation`}
              disabled={busy}
              onClick={() => {
                setOutcome(null);
                setOffboardingMode(null);
                setFreezeConfirming((current) => !current);
              }}
            >
              Freeze access
            </Button>
          ) : null}
          {canStartOffboarding ? (
            <Button
              ref={startTrigger}
              variant="secondary"
              aria-expanded={offboardingMode === "start-offboarding"}
              aria-controls={`${id}-offboarding-form`}
              disabled={busy}
              onClick={() => {
                setOutcome(null);
                setFreezeConfirming(false);
                setReason("");
                setReasonError(null);
                setOffboardingMode("start-offboarding");
              }}
            >
              Start offboarding
            </Button>
          ) : null}
          {canCompleteOffboarding ? (
            <Button
              ref={completeTrigger}
              variant="danger"
              aria-expanded={offboardingMode === "complete-exit"}
              aria-controls={`${id}-offboarding-form`}
              disabled={busy}
              onClick={() => {
                setOutcome(null);
                setFreezeConfirming(false);
                setReason("");
                setReasonError(null);
                setOffboardingMode("complete-exit");
              }}
            >
              Complete exit
            </Button>
          ) : null}
        </div>
      ) : null}

      {canFreeze ? (
        <section
          id={`${id}-freeze-confirmation`}
          className={styles.lifecyclePanel}
          aria-labelledby={`${id}-freeze-title`}
          hidden={!freezeConfirming}
          onKeyDown={(event) => handlePanelKeyDown(event, cancelFreeze)}
        >
          <h3 id={`${id}-freeze-title`}>Freeze {personName}’s access?</h3>
          <p>This closes the person’s active work and attendance sessions and revokes their active sign-in sessions.</p>
          <div className={styles.lifecyclePanelActions}>
            <Button ref={freezeCancel} variant="secondary" disabled={busy} onClick={cancelFreeze}>Cancel</Button>
            <Button
              variant="danger"
              disabled={pendingAction === "freeze"}
              onClick={() => void runAction("freeze", onFreeze)}
            >
              {pendingAction === "freeze" ? "Freezing access…" : "Confirm freeze"}
            </Button>
          </div>
        </section>
      ) : null}

      {canStartOffboarding || canCompleteOffboarding ? (
        <section
          id={`${id}-offboarding-form`}
          className={styles.lifecyclePanel}
          aria-labelledby={`${id}-offboarding-title`}
          hidden={!isOffboarding}
          onKeyDown={(event) => handlePanelKeyDown(event, cancelOffboarding)}
        >
          <h3 id={`${id}-offboarding-title`}>{offboardingTitle} for {personName}</h3>
          <p>Reassign or close active assignments first. This change closes active work and attendance sessions, revokes active sessions and identities, and revokes pending invitations.</p>
          <form className={styles.lifecycleReasonForm} onSubmit={submitOffboarding} aria-busy={offboardingPending || undefined}>
            <Field
              id={`${id}-offboarding-reason`}
              label="Reason"
              required
              hint="This reason is included in the audited access change."
              error={reasonError}
            >
              {(control) => (
                <textarea
                  {...control}
                  ref={reasonInput}
                  className={styles.lifecycleReason}
                  name="reason"
                  value={reason}
                  maxLength={500}
                  disabled={busy}
                  onChange={(event) => {
                    setReason(event.currentTarget.value);
                    if (reasonError) setReasonError(null);
                  }}
                />
              )}
            </Field>
            <div className={styles.lifecyclePanelActions}>
              <Button ref={offboardingCancel} variant="secondary" disabled={busy} onClick={cancelOffboarding}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={busy}>
                {offboardingPending ? `${offboardingTitle}…` : offboardingTitle}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {actionInProgress ? <p ref={progressTarget} className={styles.lifecycleProgress} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{actionInProgress}</p> : null}
      {outcome ? (
        <PersonLifecycleOutcomeNotice ref={outcomeTarget} outcome={outcome} />
      ) : null}
    </section>
  );
}
