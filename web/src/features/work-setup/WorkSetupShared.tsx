import { useId } from "react";
import { Button, Field, Input, StateMessage } from "../../design-system";
import type { WorkSetupReadState } from "./contracts";
import styles from "./WorkSetupSections.module.css";

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code : undefined;
}

export function mutationCanReload(error: unknown): boolean {
  const code = errorCode(error);
  return Boolean(code && (
    code.includes("VERSION_CONFLICT") ||
    code === "TASK_CATALOG_ENTRY_ARCHIVED" ||
    code === "PERMISSION_DENIED" ||
    code === "FORBIDDEN"
  ));
}

export function mutationMessage(error: unknown, noun: string): string {
  const code = errorCode(error);
  if (code?.includes("VERSION_CONFLICT")) return `This ${noun} changed after it was loaded. Reload the current data before trying again.`;
  if (code === "TASK_CATALOG_TITLE_EXISTS") return "A reusable task with this name already exists.";
  if (code === "TASK_CATALOG_ENTRY_ARCHIVED") return "This reusable task was archived by someone else. Reload the catalogue.";
  if (code === "TASK_CATALOG_SELF_REVIEW") return "You cannot review your own task-catalog suggestion.";
  if (code === "PERMISSION_DENIED" || code === "FORBIDDEN") return "Your access changed. Reload this section to confirm what you can manage.";
  if (code?.includes("INPUT_INVALID")) return "Check the required fields and try again.";
  return `NOVA could not save this ${noun}. Nothing on this screen confirms a change; try again.`;
}

export function ReadFeedback({
  state,
  resource,
  onRetry,
}: {
  state: Exclude<WorkSetupReadState<unknown>, { status: "ready" }>;
  resource: string;
  onRetry?: () => void;
}) {
  if (state.status === "loading") return <StateMessage kind="loading" title={`Loading ${resource}`}>Only data available under your current access is requested.</StateMessage>;
  const title = state.status === "denied" ? `${resource} access is unavailable`
    : state.status === "unavailable" ? `${resource} cannot be loaded with the current access`
      : `${resource} could not load`;
  const description = state.status === "denied"
    ? state.message || "Your current access does not allow this read."
    : state.status === "unavailable" ? state.message
      : state.message;
  return (
    <div className={styles.readIssue}>
      <StateMessage kind={state.status === "denied" || state.status === "unavailable" ? "warning" : "error"} title={title}>
        {description}
      </StateMessage>
      {onRetry ? <Button variant="secondary" size="compact" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

export function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className={styles.sectionHeading}>
      <div>
        <p className={styles.eyebrow}>Work setup</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

export function TextAreaField({
  label,
  name,
  required = false,
  maxLength,
  placeholder,
  rows = 3,
}: {
  label: string;
  name: string;
  required?: boolean;
  maxLength: number;
  placeholder?: string;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <textarea id={id} name={name} required={required} maxLength={maxLength} placeholder={placeholder} rows={rows} />
      <span className={styles.fieldHint}>Up to {maxLength.toLocaleString()} characters.</span>
    </div>
  );
}
