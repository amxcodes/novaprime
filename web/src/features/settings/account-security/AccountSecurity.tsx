import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import type { AccountSecurityActionState, AccountSecurityProps } from "./contracts";
import { AccountSecurityActionError } from "./contracts";
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

export function AccountSecurity({ readState, onRequestVerification, onChangePassword }: AccountSecurityProps) {
  const id = useId();
  const [verificationState, setVerificationState] = useState<AccountSecurityActionState>({ status: "idle" });
  const [passwordState, setPasswordState] = useState<AccountSecurityActionState>({ status: "idle" });
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const verificationInFlight = useRef(false);
  const passwordInFlight = useRef(false);
  const passwordForm = useRef<HTMLFormElement>(null);
  const confirmPasswordInput = useRef<HTMLInputElement>(null);

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
      </div>
    </section>
  );
}
