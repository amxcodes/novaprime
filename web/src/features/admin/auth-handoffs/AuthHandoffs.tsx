import { useEffect, useId, useRef, useState } from "react";
import { Button, EmptyState, StateMessage } from "../../../design-system";
import { AuthHandoffActionError } from "./contracts";
import type { AuthHandoffView, AuthHandoffsProps } from "./contracts";
import styles from "./AuthHandoffs.module.css";

const purposeLabels = {
  invitation: "Invitation",
  verification: "Email verification",
  password_reset: "Password reset",
} as const;

function readableExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "an unknown time" : date.toLocaleString();
}

function HandoffCard({ handoff, canRead, revealPending }: { handoff: AuthHandoffView; canRead: boolean; revealPending: boolean }) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const outputId = useId();

  useEffect(() => {
    if (url) outputRef.current?.focus();
  }, [url]);

  async function reveal() {
    if (attempted.current || busy) return;
    attempted.current = true;
    setBusy(true);
    setMessage("");
    try {
      const revealedUrl = await handoff.onReveal();
      if (typeof revealedUrl !== "string" || !revealedUrl.trim()) {
        setMessage("NOVA returned no link. Refresh the handoff list before taking further action.");
        return;
      }
      setUrl(revealedUrl);
    } catch (error) {
      setMessage(error instanceof AuthHandoffActionError
        ? error.message
        : "NOVA could not confirm this reveal. Refresh the handoff list before taking further action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.card}>
      <div className={styles.cardHeading}>
        <div className={styles.identity}>
          <p className={styles.purpose}>{purposeLabels[handoff.purpose]}</p>
          <h3 className={styles.name}>{handoff.targetDisplayName}</h3>
          <p className={styles.email}>{handoff.targetEmail}</p>
        </div>
        <p className={styles.expiry}>Expires {readableExpiry(handoff.expiresAt)}</p>
      </div>
      {handoff.reason ? <p className={styles.reason}>{handoff.reason}</p> : null}
      {url ? (
        <div className={styles.revealed}>
          <label className={styles.revealedLabel} htmlFor={outputId}>One-time secure link</label>
          <textarea ref={outputRef} id={outputId} className={styles.url} readOnly rows={3} value={url} />
          <p className={styles.warning}>Copy this link now. NOVA will not reveal it again.</p>
          <StateMessage kind="success" title="Link revealed">The one-time link is ready in the labeled field above.</StateMessage>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button type="button" variant="secondary" disabled={!canRead || handoff.revealBlocked || busy || revealPending || attempted.current} onClick={() => void reveal()}>
            {!canRead ? "No longer available" : handoff.revealBlocked || attempted.current ? "Reveal already attempted" : busy ? "Revealing…" : revealPending ? "Wait for current reveal" : "Reveal once"}
          </Button>
        </div>
      )}
      {handoff.revealBlocked && !url ? <StateMessage kind="warning" title="Reveal was already attempted">NOVA will not retry this one-time link. Refresh the list to confirm whether the handoff remains available.</StateMessage> : null}
      {message ? <StateMessage kind="warning" title="Reveal status">{message}</StateMessage> : null}
    </article>
  );
}

export function AuthHandoffs({ readState, canRead, revealPending, onRetry }: AuthHandoffsProps) {
  if (readState.status === "loading") {
    return <StateMessage kind="loading" aria-busy="true">Loading eligible handoffs.</StateMessage>;
  }

  if (readState.status === "error") {
    return (
      <div className={styles.readError}>
        <StateMessage kind="error" title="Handoffs could not be loaded">{readState.message}</StateMessage>
        <Button type="button" variant="secondary" onClick={onRetry}>Try again</Button>
      </div>
    );
  }

  if (!readState.handoffs.length) {
    return <EmptyState title="No pending handoffs" description="There are no unexpired handoffs available to your current role. Email delivery remains optional for normal NOVA activity." />;
  }

  return (
    <div className={styles.root}>
      <div className={styles.listHeading}>
        <p>Only handoffs allowed for your current role appear here. Each link can be revealed one time.</p>
        <Button type="button" size="compact" variant="secondary" disabled={!canRead || revealPending} onClick={onRetry}>Refresh list</Button>
      </div>
      {revealPending ? <StateMessage kind="info">A one-time link is being revealed. Wait for the result before refreshing or revealing another link.</StateMessage> : null}
      {!canRead ? <StateMessage kind="info">The self-verification link has been revealed. Finish verification, then reload Settings to continue.</StateMessage> : null}
      <div className={styles.list}>
        {readState.handoffs.map((handoff) => <HandoffCard key={handoff.viewKey} handoff={handoff} canRead={canRead} revealPending={revealPending} />)}
      </div>
    </div>
  );
}
