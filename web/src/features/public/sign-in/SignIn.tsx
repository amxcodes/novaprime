import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import type { SignInProps } from "./contracts";
import styles from "./SignIn.module.css";

export function SignIn({ onSignIn, onForgotPassword, onBack, notice }: SignInProps) {
  const id = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const emailControl = emailRef.current;
    const nextEmailError = !email.trim()
      ? "Enter your email address."
      : emailControl?.validity.typeMismatch
        ? "Enter a valid email address."
        : "";
    const nextPasswordError = password.length === 0 ? "Enter your password." : "";
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setFeedback("");
    if (nextEmailError || nextPasswordError) {
      requestAnimationFrame(() => {
        if (nextEmailError) emailRef.current?.focus();
        else passwordRef.current?.focus();
      });
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      await onSignIn({ email, password });
      setPassword("");
    } catch {
      // Auth-provider codes can reveal account state. Keep the public response
      // neutral and leave both fields available for correction or retry.
      setFeedback("We couldn't sign you in. Check your details and try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.root}>
      <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Secure sign in</p>
          <h1 className={styles.title} id={`${id}-title`}>Welcome back.</h1>
          <p className={styles.description}>Use the email and password you set yourself.</p>
        </header>

        {notice?.message ? (
          <div className={styles.feedback}>
            <StateMessage kind={notice.kind}>{notice.message}</StateMessage>
          </div>
        ) : null}

        {feedback ? (
          <div className={styles.feedback}>
            <StateMessage kind="error" title="Sign in was not completed">{feedback}</StateMessage>
          </div>
        ) : null}

        <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
          <Field
            id={`${id}-email`}
            label="Email address"
            error={emailError || undefined}
            required
          >
            {(control) => (
              <Input
                {...control}
                ref={emailRef}
                type="email"
                name="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                value={email}
                disabled={submitting}
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                  setEmailError("");
                  setFeedback("");
                }}
              />
            )}
          </Field>

          <Field
            id={`${id}-password`}
            label="Password"
            error={passwordError || undefined}
            required
          >
            {(control) => (
              <Input
                {...control}
                ref={passwordRef}
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                disabled={submitting}
                onChange={(event) => {
                  setPassword(event.currentTarget.value);
                  setPasswordError("");
                  setFeedback("");
                }}
              />
            )}
          </Field>

          <Button
            className={styles.submit}
            type="submit"
            loading={submitting}
            loadingLabel="Signing in"
            disabled={submitting}
          >
            Sign in
          </Button>
        </form>

        <nav className={styles.navigation} aria-label="Sign-in options">
          <Button type="button" variant="quiet" disabled={submitting} onClick={onForgotPassword}>Forgot password?</Button>
          <span className={styles.separator} aria-hidden="true">·</span>
          <Button type="button" variant="quiet" disabled={submitting} onClick={onBack}>Back</Button>
        </nav>
      </section>
    </div>
  );
}
