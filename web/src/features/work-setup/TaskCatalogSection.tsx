import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, EmptyState, Field, Input, StateMessage } from "../../design-system";
import type {
  CatalogArchiveInput,
  CatalogEntryInput,
  CatalogEntryRevisionInput,
  CatalogEntrySummary,
  CatalogMutationOutcome,
  CatalogProposalSummary,
  CatalogReviewInput,
  TaskCatalogSectionProps,
  TaskPriority,
} from "./contracts";
import { mutationCanReload, mutationMessage, ReadFeedback, SectionHeading, TextAreaField } from "./WorkSetupShared";
import styles from "./WorkSetupSections.module.css";

const priorities: ReadonlyArray<{ value: TaskPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function outcomeMessage(outcome: CatalogMutationOutcome, noun: string): string {
  if (outcome === "pending") return `${noun} suggestion sent for review.`;
  if (outcome === "stale") return "This suggestion was out of date and needs to be submitted again.";
  return `${noun} saved.`;
}

function PriorityChoices({ value = "normal", name = "priority" }: { value?: TaskPriority; name?: string }) {
  return (
    <fieldset className={styles.choiceFieldset}>
      <legend>Default priority</legend>
      <div className={styles.choiceRow}>
        {priorities.map((priority) => (
          <label className={styles.choice} key={priority.value}>
            <input type="radio" name={name} value={priority.value} defaultChecked={priority.value === value} />
            <span>{priority.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EntryFields({ entry }: { entry?: CatalogEntrySummary }) {
  const descriptionId = useId();
  return (
    <div className={styles.entryFields}>
      <Field label="Task name" required>
        {(control) => <Input {...control} name="title" required maxLength={320} defaultValue={entry?.title ?? ""} autoComplete="off" />}
      </Field>
      <PriorityChoices value={entry?.priority ?? "normal"} />
      <div className={styles.field}>
        <label htmlFor={descriptionId}>Description <span className={styles.optional}>(optional)</span></label>
        <textarea id={descriptionId} name="description" maxLength={10000} rows={3} defaultValue={entry?.description ?? ""} />
        <span className={styles.fieldHint}>Reusable task content only. Billing classification is configured separately.</span>
      </div>
    </div>
  );
}

function CatalogEntryForm({
  entry,
  actionLabel,
  onSave,
  onSaved,
  onRetry,
}: {
  entry?: CatalogEntrySummary;
  actionLabel: string;
  onSave: (input: CatalogEntryInput | CatalogEntryRevisionInput) => Promise<CatalogMutationOutcome>;
  onSaved: (message: string) => void;
  onRetry?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadAvailable, setReloadAvailable] = useState(false);
  const isEdit = Boolean(entry);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const title = String(values.get("title") || "").trim();
    const reason = String(values.get("reason") || "").trim();
    const description = String(values.get("description") || "").trim() || null;
    const priorityValue = String(values.get("priority") || "normal");
    const priority = priorities.some((item) => item.value === priorityValue)
      ? priorityValue as TaskPriority : "normal";
    if (!title || title.length > 320 || !reason || reason.length > 2000 || (description?.length ?? 0) > 10000) {
      setError("Enter a task name and reason within the shown limits.");
      return;
    }
    setError(null);
    setReloadAvailable(false);
    setBusy(true);
    try {
      const input: CatalogEntryInput = { title, description, priority, reason };
      const outcome = await onSave(entry ? { ...input, expectedRevision: entry.revision } : input);
      onSaved(outcomeMessage(outcome, isEdit ? "Task definition" : "Task definition"));
      form.reset();
    } catch (submitError) {
      setError(mutationMessage(submitError, "task definition"));
      setReloadAvailable(mutationCanReload(submitError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={styles.editor} onSubmit={(event) => void submit(event)}>
      <EntryFields entry={entry} />
      <TextAreaField label="Reason for this change" name="reason" required maxLength={2000} placeholder="Explain why this reusable definition is needed." />
      {error ? <StateMessage kind="error">{error}</StateMessage> : null}
      {reloadAvailable && onRetry ? <Button variant="secondary" size="compact" onClick={onRetry}>Reload catalogue</Button> : null}
      <div className={styles.actions}>
        <Button type="submit" loading={busy} loadingLabel="Saving task definition">{actionLabel}</Button>
      </div>
    </form>
  );
}

function ArchiveEntryForm({
  entry,
  onArchive,
  onSaved,
  onRetry,
}: {
  entry: CatalogEntrySummary;
  onArchive: (input: CatalogArchiveInput) => Promise<CatalogMutationOutcome>;
  onSaved: (message: string) => void;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadAvailable, setReloadAvailable] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const reason = String(new FormData(event.currentTarget).get("reason") || "").trim();
    if (!reason || reason.length > 2000) { setError("An archive reason is required (up to 2,000 characters)."); return; }
    setError(null);
    setReloadAvailable(false);
    setBusy(true);
    try {
      const outcome = await onArchive({ reason, expectedRevision: entry.revision });
      onSaved(outcomeMessage(outcome, "Archive request"));
      setExpanded(false);
    } catch (submitError) {
      setError(mutationMessage(submitError, "task definition"));
      setReloadAvailable(mutationCanReload(submitError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.archiveRegion}>
      <Button variant="quiet" size="compact" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        {expanded ? "Close archive request" : "Archive definition"}
      </Button>
      {expanded ? (
        <form className={styles.editor} onSubmit={(event) => void submit(event)}>
          <TextAreaField label="Archive reason" name="reason" required maxLength={2000} />
          {error ? <StateMessage kind="error">{error}</StateMessage> : null}
          {reloadAvailable && onRetry ? <Button variant="secondary" size="compact" onClick={onRetry}>Reload catalogue</Button> : null}
          <Button type="submit" variant="danger" loading={busy}>Confirm archive</Button>
        </form>
      ) : null}
    </div>
  );
}

function ProposalReview({
  proposal,
  canReview,
  onReview,
  onSaved,
  onRetry,
}: {
  proposal: CatalogProposalSummary;
  canReview: boolean;
  onReview: TaskCatalogSectionProps["onReview"];
  onSaved: (message: string) => void;
  onRetry?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadAvailable, setReloadAvailable] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value as CatalogReviewInput["decision"] | undefined;
    const reviewNote = String(values.get("reviewNote") || "").trim() || null;
    if (decision !== "approved" && decision !== "rejected") { setError("Choose approve or reject to submit this review."); return; }
    if (decision === "rejected" && !reviewNote) { setError("Add a note explaining why this suggestion is rejected."); return; }
    setError(null);
    setReloadAvailable(false);
    setBusy(true);
    try {
      const outcome = await onReview(proposal.id, { decision, reviewNote });
      onSaved(outcomeMessage(outcome, "Proposal review"));
    } catch (reviewError) {
      setError(mutationMessage(reviewError, "proposal"));
      setReloadAvailable(mutationCanReload(reviewError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={styles.proposal}>
      <div className={styles.proposalCopy}>
        <h4>{proposal.action} · {proposal.title}</h4>
        <p>{proposal.status} · proposed by {proposal.proposerName || "a colleague"}</p>
        <p>{proposal.reason}</p>
      </div>
      {proposal.status === "pending" && canReview ? (
        <form className={styles.reviewForm} onSubmit={(event) => void submit(event)}>
          <TextAreaField label="Review note (required to reject)" name="reviewNote" maxLength={2000} />
          {error ? <StateMessage kind="error">{error}</StateMessage> : null}
          {reloadAvailable && onRetry ? <Button variant="secondary" size="compact" onClick={onRetry}>Reload suggestions</Button> : null}
          <div className={styles.actions}>
          <Button type="submit" name="decision" value="approved" loading={busy}>Approve</Button>
            <Button type="submit" name="decision" value="rejected" variant="secondary" disabled={busy}>Reject</Button>
          </div>
        </form>
      ) : proposal.status === "pending" ? <p className={styles.help}>Review controls are unavailable for this suggestion.</p> : null}
    </article>
  );
}

function TaskCatalogContent({
  permissions,
  read,
  onCreate,
  onUpdate,
  onArchive,
  onReview,
  onRetry,
}: TaskCatalogSectionProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const canWrite = permissions.manage || permissions.propose;
  const canSeeEntries = permissions.view || permissions.manage;
  const canSeeProposals = permissions.propose || permissions.review;
  const stateFor = (node: ReactNode, resource: string) => read.status === "ready"
    ? node
    : <ReadFeedback state={read} resource={resource} onRetry={onRetry} />;
  return (
    <section className={styles.section} aria-label="Reusable task definitions">
      <SectionHeading
        title="Reusable task definitions"
        description="Definitions provide reusable task content only. Workstream defaults classify one-off tasks; a separate per-definition rule can override that default. Corrections remain linked work items, not billing adjustments."
      />
      {feedback ? <StateMessage kind="success">{feedback}</StateMessage> : null}
      {canWrite ? (
        <section className={styles.subsection} aria-labelledby="catalog-create-heading">
          <h3 id="catalog-create-heading">{permissions.manage ? "Add a definition" : "Suggest a definition"}</h3>
          <CatalogEntryForm actionLabel={permissions.manage ? "Add approved definition" : "Send suggestion"} onSave={(input) => onCreate(input as CatalogEntryInput)} onSaved={setFeedback} onRetry={onRetry} />
        </section>
      ) : null}
      {canSeeEntries ? stateFor(
        read.status === "ready" ? (
          <section className={styles.subsection} aria-labelledby="catalog-approved-heading">
            <h3 id="catalog-approved-heading">Approved definitions</h3>
            {read.data.entries.length ? (
              <ul className={styles.entryList}>
                {read.data.entries.map((entry) => (
                  <li className={styles.entry} key={entry.id}>
                    <div className={styles.entrySummary}>
                      <div><h4>{entry.title}</h4><p>{entry.priority} priority · revision {entry.revision}{entry.createdByName ? ` · added by ${entry.createdByName}` : ""}</p></div>
                      {entry.description ? <p>{entry.description}</p> : null}
                    </div>
                    {canWrite ? (
                      <details className={styles.entryTools}>
                        <summary>Edit or archive</summary>
                        <CatalogEntryForm entry={entry} actionLabel={permissions.manage ? "Save definition" : "Suggest changes"} onSave={(input) => onUpdate(entry.id, input as CatalogEntryRevisionInput)} onSaved={setFeedback} onRetry={onRetry} />
                        <ArchiveEntryForm entry={entry} onArchive={(input) => onArchive(entry.id, input)} onSaved={setFeedback} onRetry={onRetry} />
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No approved definitions yet" description="You can still create one-off tasks. Their workstream policy is applied automatically." />}
          </section>
        ) : null,
        "approved task definitions",
      ) : null}
      {canSeeProposals ? stateFor(
        read.status === "ready" ? (
          <section className={styles.subsection} aria-labelledby="catalog-proposals-heading">
            <h3 id="catalog-proposals-heading">Suggestions and review</h3>
            {read.data.proposals.length ? (
              <div className={styles.proposalList}>
                {read.data.proposals.map((proposal) => (
                  <ProposalReview key={proposal.id} proposal={proposal} canReview={permissions.review && proposal.canReview === true} onReview={onReview} onSaved={setFeedback} onRetry={onRetry} />
                ))}
              </div>
            ) : <EmptyState title="No catalogue suggestions" description={permissions.review ? "Pending suggestions will appear here." : "Suggestions you submit will appear here."} />}
          </section>
        ) : null,
        "task-catalog suggestions",
      ) : null}
    </section>
  );
}

export function TaskCatalogSection(props: TaskCatalogSectionProps) {
  if (!(props.permissions.view || props.permissions.manage || props.permissions.propose || props.permissions.review)) return null;
  return <TaskCatalogContent {...props} />;
}
