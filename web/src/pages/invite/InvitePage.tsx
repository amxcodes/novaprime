import type { FormEvent } from "react";
import { Button, Field, Input, PageHeader, StateMessage } from "../../design-system";
import styles from "./InvitePage.module.css";

export interface InvitePageProps {
  canInvite: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function InvitePage({ canInvite, onSubmit }: InvitePageProps) {
  return (
    <section className={styles.page} aria-labelledby="invite-page-title">
      <div className={styles.content}>
        <PageHeader
          className={styles.header}
          eyebrow="People"
          title={<span id="invite-page-title">Invite a person</span>}
          description="NOVA sends a one-time link. The invited person creates their own password; no temporary password is created or shared."
        />

        <p id="feedback" className={`notice ${styles.feedback}`} role="status" hidden />

        {canInvite ? (
          <section className={styles.invitation} aria-label="Invitation details">
            <form id="invite-form" className={styles.form} onSubmit={onSubmit}>
              <Field label="Full name" required>
                {(control) => <Input {...control} name="displayName" autoComplete="name" maxLength={180} required />}
              </Field>
              <Field label="Work email" required>
                {(control) => <Input {...control} name="email" type="email" autoComplete="email" required />}
              </Field>
              <div className={styles.actions}>
                <Button type="submit">Send invitation</Button>
              </div>
            </form>
          </section>
        ) : (
          <StateMessage kind="warning" title="Invitation unavailable">
            Your role does not include permission to invite people.
          </StateMessage>
        )}
      </div>
    </section>
  );
}
