import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import type { AccountSecurityActionState, AccountSecurityProps, AccountSessionsState } from "./contracts";
import { AccountSecurityActionError, AccountSessionFreshnessError } from "./contracts";
import styles from "./AccountSecurity.module.css";

const passwordMismatchMessage = "The two new passwords do not match.";

export function AccountSecurityActionFeedback({ state }: { state: AccountSecurityActionState }) {
  if (state.status === "idle") return null;
  if (state.status === "pending") return <StateMessage kind="loading">{state.label}</StateMessage>;
  if (state.status === "success") return <StateMessage kind="success">{state.message}</StateMessage>;
  return <StateMessage kind="error" title="Action could not be completed">{state.message}</StateMessage>;
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof AccountSecurityActionError && error.message.trim()) return error.message.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Something went wrong. Nothing was saved unless NOVA confirms it below.";
}

export function AccountSecurity({ readState, onRequestVerification, onChangePassword, onLoadSessions, onRevokeSession, onRevokeOtherSessions, onReauthenticate }: AccountSecurityProps) {
  const id = useId();
  const [verificationState, setVerificationState] = useState<AccountSecurityActionState>({ status: "idle" });
  const [passwordState, setPasswordState] = useState<AccountSecurityActionState>({ status: "idle" });
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [sessionsState, setSessionsState] = useState<AccountSessionsState>({ status: "loading" });
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [sessionActionState, setSessionActionState] = useState<AccountSecurityActionState>({ status: "idle" });
  const [reauthenticationPending, setReauthenticationPending] = useState(false);
  const [confirmRevokeOthers, setConfirmRevokeOthers] = useState(false);
  const [revokeOthersPending, setRevokeOthersPending] = useState(false);
  const verificationInFlight = useRef(false);
  const passwordInFlight = useRef(false);
  const passwordForm = useRef<HTMLFormElement>(null);
  const confirmPasswordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (readState.status !== "ready") return;
    let current = true;
    void onLoadSessions().then((sessions) => {
      if (current) setSessionsState({ status: "ready", sessions });
    }).catch((error: unknown) => {
      if (current) setSessionsState(sessionReadFailure(error));
    });
    return () => { current = false; };
  }, [onLoadSessions, readState.status]);

  async function refreshSessions() {
    if (sessionsRefreshing || sessionsState.status === "loading") return;
    setSessionsRefreshing(true);
    setSessionActionState({ status: "idle" });
    try {
      setSessionsState({ status: "ready", sessions: await onLoadSessions() });
    } catch (error) {
      setSessionsState(sessionReadFailure(error));
    } finally {
      setSessionsRefreshing(false);
    }
  }

  async function revokeSession(sessionId: string) {
    if (pendingSessionId) return;
    setPendingSessionId(sessionId);
    setSessionActionState({ status: "pending", label: "Signing out the selected session." });
    try {
      await onRevokeSession(sessionId);
      setSessionActionState({ status: "success", message: "Session signed out." });
      try {
        setSessionsState({ status: "ready", sessions: await onLoadSessions() });
      } catch (error) {
        setSessionsState(sessionReadFailure(error));
        setSessionActionState({ status: "error", message: "The session was signed out, but the active-session list could not be refreshed." });
      }
    } catch (error) {
      handleSessionActionFailure(error);
    } finally {
      setPendingSessionId(null);
    }
  }

  async function revokeOtherSessions() {
    if (revokeOthersPending) return;
    setRevokeOthersPending(true);
    setSessionActionState({ status: "pending", label: "Signing out other sessions." });
    try {
      await onRevokeOtherSessions();
      setConfirmRevokeOthers(false);
      setSessionActionState({ status: "success", message: "Other sessions signed out." });
      try {
        setSessionsState({ status: "ready", sessions: await onLoadSessions() });
      } catch (error) {
        setSessionsState(sessionReadFailure(error));
        setSessionActionState(error instanceof AccountSessionFreshnessError
          ? { status: "idle" }
          : { status: "error", message: "Other sessions were signed out, but the active-session list could not be refreshed." });
      }
    } catch (error) {
      handleSessionActionFailure(error);
    } finally {
      setRevokeOthersPending(false);
    }
  }

  function handleSessionActionFailure(error: unknown) {
    if (error instanceof AccountSessionFreshnessError) {
      setSessionsState(sessionReadFailure(error));
      setSessionActionState({ status: "idle" });
      return;
    }
    setSessionActionState({ status: "error", message: actionErrorMessage(error) });
  }

  async function reauthenticate() {
    if (reauthenticationPending) return;
    setReauthenticationPending(true);
    try {
      await onReauthenticate();
    } catch (error) {
      setReauthenticationPending(false);
      setSessionsState({ status: "error", message: actionErrorMessage(error) });
    }
  }

  async function requestVerification() {
    if (verificationInFlight.current || readState.status !== "ready" || readState.identity.emailVerified) return;
    verificationInFlight.current = true;
    setVerificationState({ status: "pending", label: "Requesting verification link." });
    try {
      await onRequestVerification();
      setVerificationState({
        status: "success",
        message: "Verification requested. Check your inbox, or ask an administrator for a secure system handoff if email is unavailable.",
      });
    } catch (error) {
      setVerificationState({ status: "error", message: actionErrorMessage(error) });
    } finally {
      verificationInFlight.current = false;
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordInFlight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") || "");
    const newPassword = String(data.get("newPassword") || "");
    const confirmPassword = String(data.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setPasswordMismatch(true);
      requestAnimationFrame(() => confirmPasswordInput.current?.focus());
      return;
    }

    setPasswordMismatch(false);
    passwordInFlight.current = true;
    setPasswordState({ status: "pending", label: "Changing password." });
    try {
      await onChangePassword(currentPassword, newPassword);
      passwordForm.current?.reset();
      setPasswordState({ status: "success", message: "Password changed. Other active sessions were signed out." });
      try {
        setSessionsState({ status: "ready", sessions: await onLoadSessions() });
      } catch (error) {
        setSessionsState(sessionReadFailure(error));
      }
    } catch (error) {
      setPasswordState({ status: "error", message: actionErrorMessage(error) });
    } finally {
      passwordInFlight.current = false;
    }
  }

  if (readState.status === "loading") {
    return <section className={styles.root} aria-labelledby={`${id}-title`}><h2 id={`${id}-title`}>Account security</h2><StateMessage kind="loading">Loading your account details.</StateMessage></section>;
  }
  if (readState.status === "error") {
    return <section className={styles.root} aria-labelledby={`${id}-title`}><h2 id={`${id}-title`}>Account security</h2><StateMessage kind="error" title="Account details could not be loaded">{readState.message}</StateMessage></section>;
  }

  const { identity } = readState;
  const initial = Array.from(identity.name)[0]?.toUpperCase() || "N";

  return (
    <section className={styles.root} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>My account</p>
          <h2 id={`${id}-title`}>Account security</h2>
          <p className={styles.intro}>Manage your sign-in details and verification status.</p>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.identity} aria-labelledby={`${id}-identity-heading`}>
          <div className={styles.sectionHeading}>
            <div>
              <h3 id={`${id}-identity-heading`}>Signed-in identity</h3>
              <p>Account details for the current session.</p>
            </div>
            <span className={identity.emailVerified ? styles.verified : styles.unverified}>
              {identity.emailVerified ? "Verified" : "Verification pending"}
            </span>
          </div>
          <div className={styles.identityDetails}>
            <span className={styles.avatar} aria-hidden="true">{initial}</span>
            <dl className={styles.identityValues}>
              <div><dt>Name</dt><dd>{identity.name}</dd></div>
              <div><dt>Email</dt><dd>{identity.email}</dd></div>
            </dl>
          </div>
          {!identity.emailVerified ? (
            <div className={styles.identityActions}>
              <AccountSecurityActionFeedback state={verificationState} />
              <Button type="button" variant="secondary" loading={verificationState.status === "pending"} loadingLabel="Requesting verification link" onClick={() => void requestVerification()}>
                Request verification link
              </Button>
            </div>
          ) : null}
        </section>

        <section className={styles.password} aria-labelledby={`${id}-password-heading`}>
          <div className={styles.sectionHeading}>
            <div>
              <h3 id={`${id}-password-heading`}>Change your password</h3>
              <p>Changing your password does not require email. You must know your current password.</p>
            </div>
          </div>
          <form ref={passwordForm} className={styles.passwordForm} onSubmit={(event) => void submitPassword(event)} aria-busy={passwordState.status === "pending" || undefined}>
            <AccountSecurityActionFeedback state={passwordState} />
            <Field label="Current password" required>
              {(control) => <Input {...control} name="currentPassword" type="password" autoComplete="current-password" required disabled={passwordState.status === "pending"} />}
            </Field>
            <Field label="New password" hint="Use at least 8 characters." required>
              {(control) => <Input {...control} name="newPassword" type="password" autoComplete="new-password" minLength={8} required disabled={passwordState.status === "pending"} onChange={() => setPasswordMismatch(false)} />}
            </Field>
            <Field label="Confirm new password" required error={passwordMismatch ? passwordMismatchMessage : undefined}>
              {(control) => <Input {...control} ref={confirmPasswordInput} name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required disabled={passwordState.status === "pending"} onChange={() => setPasswordMismatch(false)} />}
            </Field>
            <div className={styles.formActions}>
              <Button type="submit" loading={passwordState.status === "pending"} loadingLabel="Changing password" disabled={passwordState.status === "pending"}>
                Change password
              </Button>
            </div>
          </form>
        </section>

        <section className={styles.sessions} aria-labelledby={id + "-sessions-heading"}>
          <div className={styles.sectionHeading}>
            <div>
              <h3 id={id + "-sessions-heading"}>Active sessions</h3>
              <p>Review where you are signed in and end sessions you no longer use.</p>
            </div>
            {sessionsState.status === "ready" ? (
              <div className={styles.sessionActions}>
                {sessionsState.sessions.some((session) => !session.isCurrent) ? (
                  <Button type="button" variant="danger" disabled={sessionsRefreshing || pendingSessionId !== null || revokeOthersPending} onClick={() => setConfirmRevokeOthers(true)}>
                    Sign out other sessions
                  </Button>
                ) : null}
                <Button type="button" variant="secondary" loading={sessionsRefreshing} loadingLabel="Refreshing sessions" disabled={sessionsRefreshing || pendingSessionId !== null || revokeOthersPending} onClick={() => void refreshSessions()}>
                  Refresh
                </Button>
              </div>
            ) : null}
          </div>
          {sessionsState.status === "loading" ? <StateMessage kind="loading">Loading active sessions.</StateMessage> : null}
          {sessionsState.status === "error" ? (
            <div className={styles.sessionRecovery}>
              <StateMessage kind="error" title="Active sessions could not be loaded">{sessionsState.message}</StateMessage>
              <Button type="button" variant="secondary" loading={sessionsRefreshing} loadingLabel="Retrying session list" disabled={sessionsRefreshing} onClick={() => void refreshSessions()}>
                Retry
              </Button>
            </div>
          ) : null}
          {sessionsState.status === "reauthentication-required" ? (
            <div className={styles.sessionRecovery}>
              <StateMessage kind="error" title="Sign in again to continue">{sessionsState.message}</StateMessage>
              <Button type="button" loading={reauthenticationPending} loadingLabel="Opening sign-in" disabled={reauthenticationPending} onClick={() => void reauthenticate()}>
                Sign in again
              </Button>
            </div>
          ) : null}
          {sessionsState.status === "ready" ? (
            sessionsState.sessions.length ? (
              <>
                <AccountSecurityActionFeedback state={sessionActionState} />
                {confirmRevokeOthers ? (
                  <div className={styles.sessionConfirmation} role="group" aria-label="Confirm sign out other sessions">
                    <p>This will end every other active NOVA session. Your current session stays signed in.</p>
                    <div>
                      <Button type="button" variant="danger" loading={revokeOthersPending} loadingLabel="Signing out other sessions" disabled={revokeOthersPending} onClick={() => void revokeOtherSessions()}>
                        Confirm sign out
                      </Button>
                      <Button type="button" variant="secondary" disabled={revokeOthersPending} onClick={() => setConfirmRevokeOthers(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
                <ul className={styles.sessionList} aria-label="Active sessions">
                  {sessionsState.sessions.map((session) => (
                    <li className={styles.sessionItem} key={session.id}>
                      <div className={styles.sessionDetails}>
                        <div className={styles.sessionTitle}>
                          <strong>{session.device}</strong>
                          {session.isCurrent ? <span className={styles.currentSession}>This device</span> : null}
                        </div>
                        <p>Last active <time dateTime={session.lastActiveAt}>{formatSessionDate(session.lastActiveAt)}</time></p>
                      </div>
                      {session.isCurrent ? null : (
                        <Button type="button" variant="danger" aria-label={"Sign out " + session.device + " session"} disabled={pendingSessionId !== null || revokeOthersPending} loading={pendingSessionId === session.id} loadingLabel="Signing out session" onClick={() => void revokeSession(session.id)}>
                          Sign out
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className={styles.emptySessions}>No active sessions were returned.</p>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function sessionReadFailure(error: unknown): AccountSessionsState {
  if (error instanceof AccountSessionFreshnessError) {
    return { status: "reauthentication-required", message: error.message };
  }
  return { status: "error", message: actionErrorMessage(error) };
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "an unknown time" : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
