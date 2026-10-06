import { useId, useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Field, Input, SearchableSelect, StateMessage } from "../../../design-system";
import type {
  AuthorizedOptions,
  TaskCatalogOption,
  TaskComposerProps,
  TaskCreationTargetOption,
} from "./contracts";
import type { TaskComposerDraft, TaskComposerField } from "./task-composer-model";
import { applyCatalogSelection, parseTaskComposerDraft, targetLabel } from "./task-composer-model";
import styles from "./TaskComposer.module.css";

const priorities = [
  ["low", "Low"],
  ["normal", "Normal"],
  ["high", "High"],
  ["urgent", "Urgent"],
] as const;

const initialDraft = (props: TaskComposerProps): TaskComposerDraft => ({
  targetKey: "",
  title: "",
  catalogEntryId: "",
  groupId: "",
  departmentId: "",
  description: "",
  priority: "normal",
  dueDate: "",
  correctionOfTaskId: "",
  correctionReason: "",
  assignToSelf: props.selfAssignment.status === "eligible" &&
    (props.selfAssignmentDefault ?? props.selfAssignment.defaultChecked ?? false),
});

const focusableControlSelector = [
  "input:not(:disabled)",
  "button:not(:disabled)",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function focusFirstInvalidControl(form: HTMLFormElement | null) {
  const invalid = form?.querySelector<HTMLElement>("[aria-invalid='true']");
  if (!invalid) return;
  const control = invalid.matches(focusableControlSelector)
    ? invalid
    : invalid.querySelector<HTMLElement>(focusableControlSelector);
  control?.focus();
}

export function TaskComposer(props: TaskComposerProps) {
  const [draft, setDraft] = useState<TaskComposerDraft>(() => initialDraft(props));
  const [errors, setErrors] = useState<Partial<Record<TaskComposerField, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  if (!props.canCreate) return null;

  if (props.targets.status === "not-requested") {
    return <StateMessage kind="info" title="Workstream choices are not available">Refresh this view to load the task creation targets for your current access.</StateMessage>;
  }
  if (props.targets.status === "denied") {
    return <StateMessage kind="info" title="Workstream choices are unavailable">{props.targets.message}</StateMessage>;
  }
  if (props.targets.status === "error") {
    return <StateMessage kind="error" title="Workstream choices could not load">{props.targets.message}</StateMessage>;
  }
  const targetOptions = ready(props.targets);
  if (targetOptions.length === 0) {
    return <EmptyState title="No workstream is available for task creation" description="Your current task creation access has no eligible workstream target." />;
  }

  const setField = <K extends TaskComposerField>(field: K, value: TaskComposerDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError(null);
  };

  function selectTarget(targetKey: string) {
    const target = targetOptions.find((item) => item.key === targetKey);
    setDraft((current) => ({
      ...current,
      targetKey,
      groupId: target?.requiredGroupId || "",
      correctionOfTaskId: "",
      correctionReason: "",
    }));
    setErrors((current) => ({ ...current, targetKey: undefined, groupId: undefined, correctionOfTaskId: undefined, correctionReason: undefined }));
    setSubmitError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const result = parseTaskComposerDraft(draft, props);
    setErrors(result.errors);
    setSubmitError(null);
    if (!result.input) {
      requestAnimationFrame(() => focusFirstInvalidControl(formRef.current));
      return;
    }
    setSubmitting(true);
    try {
      await props.onSubmit(result.input);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Task creation failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const target = targetOptions.find((item) => item.key === draft.targetKey);
  const groups = ready(props.groups).filter((group) => target && belongsToTarget(group, target));
  const corrections = ready(props.corrections).filter((correction) => target && belongsToTarget(correction, target));
  const catalog = ready(props.catalog);
  const departments = ready(props.departments);
  const catalogSelection = catalog.find((entry) => entry.id === draft.catalogEntryId);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h2>{props.heading || "Create a task"}</h2>
        <p>{props.description || "Tasks belong to one authorized workstream. Assignment and review remain separate records."}</p>
      </header>
      {props.catalog && props.catalog.status === "denied" ? <OptionalReadMessage title="Task definitions unavailable" message={props.catalog.message} /> : null}
      {props.catalog && props.catalog.status === "error" ? <OptionalReadMessage title="Task definitions could not load" message={props.catalog.message} /> : null}
      {props.corrections && props.corrections.status === "denied" ? <OptionalReadMessage title="Correction links unavailable" message={props.corrections.message} /> : null}
      {props.corrections && props.corrections.status === "error" ? <OptionalReadMessage title="Completed tasks could not load" message={props.corrections.message} /> : null}
      {props.departments && props.departments.status === "denied" ? <OptionalReadMessage title="Department choices unavailable" message={props.departments.message} /> : null}
      {props.departments && props.departments.status === "error" ? <OptionalReadMessage title="Department choices could not load" message={props.departments.message} /> : null}

      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.targetField}>
          <SearchableSelect
            id={`${id}-target`}
            label="Workstream"
            required
            value={draft.targetKey}
            options={targetOptions.map((option) => ({ value: option.key, label: targetLabel(option), description: billingDetail(option) }))}
            placeholder="Choose an available workstream"
            emptyMessage="No workstreams match this search."
            error={errors.targetKey}
            disabled={submitting}
            onChange={selectTarget}
          />
          <p className={styles.policyHint} aria-live="polite">
            NOVA applies billing automatically from the selected workstream policy. Task creation never sets billing class here.
            {target && target.billingPolicyClass === null && target.kind === "client" ? " This workstream needs an authorized billing policy before the server can accept a task." : ""}
          </p>
        </div>

        {catalog.length > 0 ? (
          <SearchableSelect
            id={`${id}-catalog`}
            label="Task definition (optional)"
            value={draft.catalogEntryId}
            options={catalog.map((entry) => ({ value: entry.id, label: entry.title, description: `${entry.priority} priority · revision ${entry.revision}` }))}
            placeholder="One-off task"
            emptyMessage="No task definitions match this search."
            error={errors.catalogEntryId}
            disabled={submitting}
            clearLabel="Use a one-off task"
            onChange={(entryId) => {
              const nextDraft = applyCatalogSelection(draft, entryId, catalog);
              setDraft(nextDraft);
              setErrors((current) => ({ ...current, catalogEntryId: undefined, title: undefined, description: undefined, priority: undefined }));
              setSubmitError(null);
            }}
          />
        ) : props.catalog?.status === "ready" ? (
          <p className={styles.hint}>No approved task definitions are available. You can still create a one-off task.</p>
        ) : props.catalog?.status === "not-requested" ? (
          <p className={styles.hint}>Task definitions were not requested for this role; create a one-off task.</p>
        ) : null}
        {catalogSelection?.description ? <p className={styles.templateHint}>Definition defaults are editable before creation. {catalogSelection.description}</p> : null}

        <div className={styles.pairedFields}>
          <Field
            label="Task title"
            required={!catalogSelection}
            hint={catalogSelection ? "Uses the selected definition title unless you enter your own." : undefined}
            error={errors.title}
            className={styles.field}
          >
            {(control) => <Input {...control} value={draft.title} maxLength={320} autoComplete="off" disabled={submitting} onChange={(event) => setField("title", event.currentTarget.value)} />}
          </Field>
          <fieldset className={styles.priorityGroup} aria-invalid={errors.priority ? true : undefined} aria-describedby={errors.priority ? `${id}-priority-error` : undefined}>
            <legend className={styles.priorityLegend}>Priority <span aria-hidden="true" className={styles.requiredMark}>*</span></legend>
            <div className={styles.priorityChoices} role="radiogroup" aria-label="Priority" aria-required="true">
              {priorities.map(([value, label]) => (
                <label key={value} className={styles.priorityChoice} data-selected={draft.priority === value || undefined}>
                  <input
                    type="radio"
                    name={`${id}-priority`}
                    value={value}
                    checked={draft.priority === value}
                    disabled={submitting}
                    onChange={(event) => setField("priority", event.currentTarget.value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {errors.priority ? <span id={`${id}-priority-error`} className={styles.fieldError} role="alert">{errors.priority}</span> : null}
          </fieldset>
        </div>

        {(target?.requiredGroupId || groups.length > 0 || props.groups?.status === "error" || props.groups?.status === "denied") ? (
          target?.requiredGroupId ? (
            <Field label="Group" hint="This task target is scoped to the selected group." className={styles.field}>
              {() => <div className={styles.lockedValue}>{target.groupName || "Selected group"}</div>}
            </Field>
          ) : groups.length ? (
            <SearchableSelect
              id={`${id}-group`}
              label="Group (optional)"
              value={draft.groupId}
              options={groups.map((group) => ({ value: group.id, label: group.name }))}
              placeholder="No group"
              emptyMessage="No available groups match this search."
              error={errors.groupId}
              disabled={submitting || !target}
              clearLabel="No group"
              onChange={(value) => setField("groupId", value)}
            />
          ) : <OptionalReadMessage title="Groups unavailable" message={props.groups?.status === "ready" ? "There are no authorized groups in this workstream." : props.groups?.status === "not-requested" ? "Group options were not requested." : props.groups?.message || "Group choices are unavailable."} />
        ) : null}

        {props.departments?.status === "ready" && departments.length > 0 ? (
          <SearchableSelect
            id={`${id}-department`}
            label="Department (optional)"
            value={draft.departmentId}
            options={departments.map((department) => ({ value: department.id, label: department.name }))}
            placeholder="No department"
            emptyMessage="No departments match this search."
            error={errors.departmentId}
            disabled={submitting}
            clearLabel="No department"
            onChange={(value) => setField("departmentId", value)}
          />
        ) : null}

        <div className={styles.pairedFields}>
          <Field label="Due date (optional)" error={errors.dueDate} className={styles.field}>
            {(control) => <Input {...control} type="date" value={draft.dueDate} disabled={submitting} onChange={(event) => setField("dueDate", event.currentTarget.value)} />}
          </Field>
        </div>

        <Field label="Description (optional)" hint="Up to 10,000 characters." error={errors.description} className={`${styles.field} ${styles.full}`}>
          {(control) => <textarea {...control} className={styles.textarea} value={draft.description} maxLength={10000} rows={4} disabled={submitting} onChange={(event) => setField("description", event.currentTarget.value)} />}
        </Field>

        {props.corrections?.status === "ready" ? corrections.length > 0 ? (
          <div className={styles.full}>
            <SearchableSelect
              id={`${id}-correction`}
              label="Completed task to correct (optional)"
              hint="A correction creates separate new work; it never reopens the original."
              value={draft.correctionOfTaskId}
              options={corrections.map((correction) => ({ value: correction.id, label: correction.title }))}
              placeholder="This is not a correction task"
              emptyMessage="No completed task in this workstream matches this search."
              error={errors.correctionOfTaskId}
              disabled={submitting || !target}
              clearLabel="This is not a correction task"
              onChange={(value) => {
                setField("correctionOfTaskId", value);
                if (!value) setField("correctionReason", "");
              }}
            />
          </div>
        ) : null : null}
        {draft.correctionOfTaskId && props.corrections?.status === "ready" ? (
          <Field label="What needs correcting?" required hint="A separate reason is required for the correction record." error={errors.correctionReason} className={`${styles.field} ${styles.full}`}>
            {(control) => <textarea {...control} className={styles.textarea} value={draft.correctionReason} maxLength={2000} rows={3} disabled={submitting} onChange={(event) => setField("correctionReason", event.currentTarget.value)} />}
          </Field>
        ) : null}
        {props.corrections?.status === "ready" && corrections.length === 0 && target ? (
          <p className={styles.hint}>Correction links are available only for visible, completed, non-correction work in this same workstream.</p>
        ) : null}

        <div className={`${styles.assignment} ${styles.full}`}>
          {props.selfAssignment.status === "eligible" ? (
            <label className={styles.checkRow}>
              <input type="checkbox" checked={draft.assignToSelf} disabled={submitting} onChange={(event) => setField("assignToSelf", event.currentTarget.checked)} />
              <span>Add this to my assignments now</span>
            </label>
          ) : props.selfAssignment.status === "ineligible" ? (
            <p className={styles.hint}>{props.selfAssignment.message || "Your current role or status cannot receive assignments. You can still create the task without assigning it to yourself."}</p>
          ) : props.selfAssignment.message ? <p className={styles.hint}>{props.selfAssignment.message}</p> : null}
          <p className={styles.hint}>Client work may require review. Assignment and review are separate from task creation.</p>
        </div>

        {submitError ? <StateMessage className={`${styles.full} ${styles.submitError}`} kind="error" title="Task could not be created">{submitError}</StateMessage> : null}
        <div className={`${styles.actions} ${styles.full}`}>
          <Button type="submit" loading={submitting} loadingLabel="Creating task" disabled={submitting}>Create task</Button>
        </div>
      </form>
    </div>
  );
}

function ready<T>(options?: AuthorizedOptions<T>): readonly T[] {
  return options?.status === "ready" ? options.items : [];
}

function belongsToTarget(
  option: { workstreamId: string; workstreamKind: string },
  target: TaskCreationTargetOption,
) {
  return option.workstreamId === target.id && option.workstreamKind === target.kind;
}

function billingDetail(target: TaskCreationTargetOption): string {
  if (target.kind === "organisation") return "NOVA applies organisation-workstream billing policy";
  return target.billingPolicyClass
    ? `NOVA applies ${target.billingPolicyClass.replace("_", "-")} workstream policy`
    : "Billing policy setup required";
}

function OptionalReadMessage({ title, message }: { title: string; message: string }) {
  return <StateMessage className={styles.optionalMessage} kind="warning" title={title}>{message}</StateMessage>;
}
