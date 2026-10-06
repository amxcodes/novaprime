import { useId, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../design-system";
import styles from "./ClientDepartmentCreate.module.css";

export interface ClientDepartmentCreateProps {
  clientId: string;
  onCreate(name: string): Promise<void>;
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The client department could not be created. Try again.";
}

export function ClientDepartmentCreate({ clientId, onCreate }: ClientDepartmentCreateProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const normalized = name.trim();
    if (!normalized) {
      setValidation("Enter a department name.");
      setCreated(false);
      return;
    }
    if (normalized.length > 180) {
      setValidation("Use 180 characters or fewer.");
      setCreated(false);
      return;
    }

    setPending(true);
    setValidation(null);
    setError(null);
    setCreated(false);
    try {
      await onCreate(normalized);
      setName("");
      setCreated(true);
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.root} data-client-id={clientId}>
      <Button
        type="button"
        variant="secondary"
        size="compact"
        disabled={pending}
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-panel` : undefined}
        onClick={() => {
          setExpanded((current) => !current);
          setError(null);
          setValidation(null);
        }}
      >
        {expanded ? "Close department form" : "Create department"}
      </Button>
      {expanded ? (
        <form id={`${id}-panel`} className={styles.form} noValidate onSubmit={submit}>
          <Field
            id={`${id}-name`}
            label="Department name"
            hint="Departments can be created here. This view does not list existing departments."
            required
            error={validation || undefined}
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                maxLength={180}
                required
                value={name}
                disabled={pending}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                  setValidation(null);
                  setError(null);
                  setCreated(false);
                }}
              />
            )}
          </Field>
          {error ? <StateMessage className={styles.message} kind="error">{error}</StateMessage> : null}
          {created ? <StateMessage className={styles.message} kind="success">Client department created.</StateMessage> : null}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" size="compact" loading={pending} loadingLabel="Creating department">
              Create department
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
