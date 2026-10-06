import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Select, StateMessage } from "../../../design-system";
import { classifyEmailDeliveryActionFailure } from "./contracts";
import { ConnectionCard, EmailDeliveryActionFeedback, providerLabels, safeErrorMessage, TextField } from "./ConnectionCard";
import type {
  CreateEmailConnectionInput,
  EmailDeliveryActionFailureKind,
  EmailDeliveryProps,
  EmailProviderKind,
  GmailEmailCredentials,
  ResendEmailCredentials,
  SmtpEmailCredentials,
} from "./contracts";
import styles from "./EmailDelivery.module.css";

function callbackUri(origin?: string): string | null {
  if (!origin) return null;
  try {
    const url = new URL("/api/email-connections/gmail/callback", origin);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.toString() : null;
  } catch {
    return null;
  }
}

function providerValue(value: string): EmailProviderKind {
  return value === "console" || value === "smtp" || value === "gmail_oauth2" || value === "resend"
    ? value
    : "resend";
}

export function EmailDelivery(props: EmailDeliveryProps) {
  const id = useId();
  const [provider, setProvider] = useState<EmailProviderKind>(() => providerValue(props.supportedProviders[0] || "resend"));
  const [name, setName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [smtpDraft, setSmtpDraft] = useState<{ host: string; port: string; username: string; password: string; secure: boolean }>({ host: "", port: "587", username: "", password: "", secure: false });
  const [gmailDraft, setGmailDraft] = useState<GmailEmailCredentials>({ clientId: "", clientSecret: "" });
  const [resendDraft, setResendDraft] = useState<ResendEmailCredentials>({ apiKey: "" });
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<{ kind: EmailDeliveryActionFailureKind; message: string } | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const createInFlight = useRef(false);
  const originReady = props.publicOriginConfigured === true;
  const originPending = props.publicOriginConfigured === null;
  const canActWithUnknownPublicOrigin = props.canActWithUnknownPublicOrigin === true &&
    originPending && Boolean(props.publicOriginError);
  const canUseEmailActions = originReady || canActWithUnknownPublicOrigin;
  const readyProviders = props.supportedProviders.filter((value): value is EmailProviderKind =>
    value === "console" || value === "smtp" || value === "gmail_oauth2" || value === "resend",
  );
  const providerOptions = readyProviders.map((value) => ({ value, label: providerLabels[value] }));
  const originFeedbackId = `${id}-origin-feedback`;

  useEffect(() => {
    if (!readyProviders.length || readyProviders.includes(provider)) return;
    setProvider(readyProviders[0]);
  }, [provider, readyProviders.join("|")]);

  function buildCreateInput(): CreateEmailConnectionInput {
    const common = {
      name: name.trim(),
      senderEmail: senderEmail.trim(),
      ...(replyToEmail.trim() ? { replyToEmail: replyToEmail.trim() } : {}),
    };
    if (provider === "smtp") return { ...common, provider, credentials: { ...smtpDraft, host: smtpDraft.host.trim(), port: Number(smtpDraft.port), username: smtpDraft.username.trim() } };
    if (provider === "gmail_oauth2") return { ...common, provider, credentials: { ...gmailDraft, clientId: gmailDraft.clientId.trim() } };
    if (provider === "resend") return { ...common, provider, credentials: { ...resendDraft } };
    return { ...common, provider: "console" };
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createInFlight.current || !canUseEmailActions || props.readState.status !== "ready" || !readyProviders.length) return;
    createInFlight.current = true;
    setCreateBusy(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      await props.onCreate(buildCreateInput());
      setName("");
      setSenderEmail("");
      setReplyToEmail("");
      setSmtpDraft({ host: "", port: "587", username: "", password: "", secure: false });
      setGmailDraft({ clientId: "", clientSecret: "" });
      setResendDraft({ apiKey: "" });
      setCreateSuccess(provider === "gmail_oauth2"
        ? "Gmail connection saved. Connect Google to authorize the sender."
        : "Connection saved. Send a test before activating it.");
    } catch (error) {
      setCreateError({
        kind: classifyEmailDeliveryActionFailure(error),
        message: safeErrorMessage(error),
      });
    } finally {
      createInFlight.current = false;
      setCreateBusy(false);
    }
  }

  const publicOriginCallback = callbackUri(props.publicOrigin);

  return (
    <section className={styles.root} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Deployment settings</p>
          <h2 id={`${id}-title`}>Email delivery</h2>
          <p className={styles.intro}>Choose and test the connection NOVA uses for invitations and account email. Activation is explicit and requires a successful test.</p>
        </div>
      </header>

      {canActWithUnknownPublicOrigin ? (
        <StateMessage kind="info" id={originFeedbackId} title="Public origin details are not visible">
          Your role can manage email delivery but cannot view or change the approved public origin. NOVA will verify that an origin is configured when you save, test, connect Google, or activate a connection.
        </StateMessage>
      ) : props.publicOriginError ? (
        <div className={styles.readError} id={originFeedbackId}>
          <StateMessage kind="error" title="Public origin could not be checked">{props.publicOriginError}</StateMessage>
          {props.onRetryOrigin ? <Button type="button" variant="secondary" onClick={props.onRetryOrigin}>Retry origin check</Button> : null}
        </div>
      ) : originPending ? (
        <StateMessage kind="loading" id={originFeedbackId}>Checking the approved public origin.</StateMessage>
      ) : originReady ? (
        <div className={styles.originNotice} id={originFeedbackId}>
          <StateMessage kind="info" title="Approved public origin">Account links use {props.publicOrigin || "the configured NOVA origin"}.</StateMessage>
          {publicOriginCallback ? <p className={styles.callbackUri}>Gmail redirect URI: <code>{publicOriginCallback}</code></p> : null}
        </div>
      ) : (
        <StateMessage kind="warning" id={originFeedbackId} title="Public origin required">
          Configure an approved public NOVA URL before saving, testing, or activating email delivery. Active connections can still be deactivated.
        </StateMessage>
      )}

      {props.runtimeNotice ? <StateMessage kind="warning">{props.runtimeNotice}</StateMessage> : null}
      {props.oauthResult ? (
        <StateMessage
          kind={props.oauthResult.status === "success" ? "success" : props.oauthResult.status === "pending" ? "info" : "error"}
          title={props.oauthResult.status === "success" ? "Google connected" : props.oauthResult.status === "pending" ? "Google return received" : "Google connection failed"}
        >
          {props.oauthResult.message}
        </StateMessage>
      ) : null}

      <div className={styles.content}>
        <section className={styles.connectionSection} aria-labelledby={`${id}-connections-heading`}>
          <div className={styles.sectionHeading}>
            <div>
              <h3 id={`${id}-connections-heading`}>Saved connections</h3>
              <p>Only one supported connection can be active at a time.</p>
            </div>
            {props.readState.status === "ready" ? (
              <Button type="button" size="compact" variant="secondary" onClick={props.onRetry}>
                Refresh connections
              </Button>
            ) : null}
          </div>

          {props.readState.status === "loading" ? (
            <StateMessage kind="loading" aria-busy="true">Loading email connections.</StateMessage>
          ) : props.readState.status === "error" ? (
            <div className={styles.readError}>
              <StateMessage kind="error" title="Connections could not be loaded">{props.readState.message}</StateMessage>
              <Button type="button" variant="secondary" onClick={props.onRetry}>Try again</Button>
            </div>
          ) : props.connections.length === 0 ? (
            <EmptyState title="No email connections" description="Add a provider below, send a test, then activate it when it is ready." />
          ) : (
            <div className={styles.connectionList}>
              {props.connections.map((connection, index) => (
                <ConnectionCard
                  key={`${connection.name}-${connection.senderEmail}-${index}`}
                  connection={connection}
                  canUseEmailActions={canUseEmailActions}
                  onRefresh={props.onRetry}
                />
              ))}
            </div>
          )}
        </section>

        <section className={styles.createSection} aria-labelledby={`${id}-create-heading`}>
          <div className={styles.sectionHeading}>
            <div>
              <h3 id={`${id}-create-heading`}>Add an email connection</h3>
              <p>Provider credentials are sent to NOVA once and are not returned by the API.</p>
            </div>
          </div>

          {props.readState.status === "error" ? (
            <StateMessage kind="warning">Provider support could not be confirmed. Refresh connections before adding one.</StateMessage>
          ) : !readyProviders.length ? (
            <EmptyState title="No supported provider" description="This deployment has no email provider available for configuration." />
          ) : (
            <form className={styles.createForm} onSubmit={submitCreate}>
              {props.readState.status === "loading" ? <StateMessage kind="loading">Waiting for the provider list.</StateMessage> : null}
              <TextField label="Connection name" name="name" value={name} disabled={createBusy || props.readState.status !== "ready"} onChange={setName} />
              <Select
                label="Provider"
                name="provider"
                value={provider}
                options={providerOptions}
                placeholder="Choose a provider"
                disabled={createBusy || props.readState.status !== "ready"}
                onChange={(value) => {
                  setCreateError(null);
                  setCreateSuccess(null);
                  setProvider(providerValue(value));
                }}
              />
              <TextField label="Sender email" name="senderEmail" type="email" inputMode="email" autoComplete="email" value={senderEmail} disabled={createBusy || props.readState.status !== "ready"} onChange={setSenderEmail} />
              <TextField label="Reply-to email (optional)" name="replyToEmail" type="email" inputMode="email" autoComplete="email" required={false} value={replyToEmail} disabled={createBusy || props.readState.status !== "ready"} onChange={setReplyToEmail} />

              {provider === "smtp" ? (
                <fieldset className={styles.credentials} disabled={createBusy || props.readState.status !== "ready"}>
                  <legend>SMTP credentials</legend>
                  <div className={styles.providerFields}>
                    <TextField label="SMTP host" name="smtpHost" autoComplete="url" value={smtpDraft.host} disabled={createBusy || props.readState.status !== "ready"} onChange={(host) => setSmtpDraft((draft) => ({ ...draft, host }))} />
                    <TextField label="SMTP port" name="smtpPort" type="number" inputMode="numeric" min={1} max={65535} value={smtpDraft.port} disabled={createBusy || props.readState.status !== "ready"} onChange={(port) => setSmtpDraft((draft) => ({ ...draft, port }))} />
                    <TextField label="SMTP username" name="smtpUsername" autoComplete="username" value={smtpDraft.username} disabled={createBusy || props.readState.status !== "ready"} onChange={(username) => setSmtpDraft((draft) => ({ ...draft, username }))} />
                    <TextField label="SMTP password" name="smtpPassword" type="password" autoComplete="new-password" value={smtpDraft.password} disabled={createBusy || props.readState.status !== "ready"} onChange={(password) => setSmtpDraft((draft) => ({ ...draft, password }))} />
                    <label className={styles.checkboxField}>
                      <input type="checkbox" name="smtpSecure" checked={smtpDraft.secure} disabled={createBusy || props.readState.status !== "ready"} onChange={(event) => setSmtpDraft((draft) => ({ ...draft, secure: event.currentTarget.checked }))} />
                      <span><strong>Use TLS from the first connection</strong><small>Usually required for port 465.</small></span>
                    </label>
                  </div>
                </fieldset>
              ) : null}

              {provider === "gmail_oauth2" ? (
                <fieldset className={styles.credentials} disabled={createBusy || props.readState.status !== "ready"}>
                  <legend>Google OAuth credentials</legend>
                  <p className={styles.providerHint}>Use a customer-owned Google OAuth web client with the send-only Gmail permission. Google may require verification for public OAuth apps.</p>
                  {publicOriginCallback ? <p className={styles.callbackUri}>Authorized redirect URI: <code>{publicOriginCallback}</code></p> : null}
                  <div className={styles.providerFields}>
                    <TextField label="Google OAuth client ID" name="gmailClientId" autoComplete="off" value={gmailDraft.clientId} disabled={createBusy || props.readState.status !== "ready"} onChange={(clientId) => setGmailDraft((draft) => ({ ...draft, clientId }))} />
                    <TextField label="Google OAuth client secret" name="gmailClientSecret" type="password" autoComplete="new-password" value={gmailDraft.clientSecret} disabled={createBusy || props.readState.status !== "ready"} onChange={(clientSecret) => setGmailDraft((draft) => ({ ...draft, clientSecret }))} />
                  </div>
                </fieldset>
              ) : null}

              {provider === "resend" ? (
                <fieldset className={styles.credentials} disabled={createBusy || props.readState.status !== "ready"}>
                  <legend>Resend credentials</legend>
                  <p className={styles.providerHint}>Use an API key allowed to send from the selected sender domain.</p>
                  <TextField label="Resend API key" name="resendApiKey" type="password" autoComplete="new-password" value={resendDraft.apiKey} disabled={createBusy || props.readState.status !== "ready"} onChange={(apiKey) => setResendDraft((draft) => ({ ...draft, apiKey }))} />
                </fieldset>
              ) : (
                provider === "console" ? <StateMessage kind="info">Console output is intended for local development and has no provider credentials.</StateMessage> : null
              )}

              {createBusy ? <StateMessage kind="loading">Saving connection. Credentials will clear after success.</StateMessage> : null}
              {createError ? (
                <EmailDeliveryActionFeedback
                  kind={createError.kind}
                  message={createError.message}
                  onRefresh={createError.kind === "unconfirmed" ? props.onRetry : undefined}
                  refreshLabel="Refresh saved connections"
                />
              ) : null}
              {createSuccess ? <StateMessage kind="success">{createSuccess}</StateMessage> : null}

              <div className={styles.formFooter}>
                <p className={styles.secretNote}>Credentials stay in this unsaved form until the request succeeds. NOVA encrypts saved secrets and never returns them to this screen.</p>
                <Button type="submit" loading={createBusy} loadingLabel="Saving email connection" disabled={createBusy || props.readState.status !== "ready" || !canUseEmailActions} aria-describedby={originFeedbackId}>
                  Save connection
                </Button>
              </div>
            </form>
          )}
        </section>
      </div>
    </section>
  );
}
