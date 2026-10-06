import { useId, useState, type FormEvent } from "react";
import { Button, Field, Input, SearchableSelect, SectionHeading, StateMessage, type SearchableSelectOption } from "../../design-system";
import type { WorkContextCreationProps, WorkContextCreationReadState } from "./contracts";
import styles from "./WorkContextCreation.module.css";

type FormKey = "client" | "clientWorkstream" | "organisationWorkstream" | "group";
interface FormState {
  pending: boolean;
  validation: string | null;
  error: string | null;
}

const initialFormState: FormState = { pending: false, validation: null, error: null };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "This item could not be created. Try again.";
}

function ChoiceUnavailable({ readState, subject }: { readState: WorkContextCreationReadState; subject: string }) {
  if (readState.status === "ready") {
    return <StateMessage kind="info">No authorized {subject} choices are available.</StateMessage>;
  }

  return (
    <StateMessage kind={readState.status === "error" ? "error" : "warning"} title={`${subject} choices unavailable`}>
      {readState.message}
    </StateMessage>
  );
}

function actionError(state: FormState) {
  return state.error ? <StateMessage className={styles.formError} kind="error">{state.error}</StateMessage> : null;
}

export function WorkContextCreation({
  readState,
  canCreateClient,
  canCreateClientWorkstream,
  canCreateOrganisationWorkstream,
  canCreateGroup,
  clientOptions,
  groupWorkstreamOptions,
  onCreateClient,
  onCreateClientWorkstream,
  onCreateOrganisationWorkstream,
  onCreateGroup,
}: WorkContextCreationProps) {
  const id = useId();
  const [clientName, setClientName] = useState("");
  const [clientWorkstreamName, setClientWorkstreamName] = useState("");
  const [clientId, setClientId] = useState("");
  const [organisationWorkstreamName, setOrganisationWorkstreamName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupWorkstream, setGroupWorkstream] = useState("");
  const [states, setStates] = useState<Record<FormKey, FormState>>({
    client: initialFormState,
    clientWorkstream: initialFormState,
    organisationWorkstream: initialFormState,
    group: initialFormState,
  });

  const clientChoices: SearchableSelectOption[] = clientOptions.map((option) => ({
    value: option.id,
    label: option.name,
  }));
  const groupChoices: SearchableSelectOption[] = groupWorkstreamOptions.map((option) => ({
    value: `${option.kind}:${option.id}`,
    label: `${option.kind === "client" ? "Client" : "Organisation"} · ${option.name}`,
  }));
  const hasForms = canCreateClient || canCreateClientWorkstream || canCreateOrganisationWorkstream || canCreateGroup;
  if (!hasForms) return null;

  function updateState(key: FormKey, update: Partial<FormState>) {
    setStates((current) => ({ ...current, [key]: { ...current[key], ...update } }));
  }

  async function run(key: FormKey, action: () => Promise<void>) {
    if (states[key].pending) return;
    updateState(key, { pending: true, validation: null, error: null });
    try {
      await action();
      updateState(key, initialFormState);
    } catch (error) {
      updateState(key, { pending: false, error: errorMessage(error) });
    }
  }

  function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = clientName.trim();
    if (!name) return updateState("client", { validation: "Enter a client name." });
    void run("client", async () => { await onCreateClient(name); setClientName(""); });
  }

  function submitClientWorkstream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = clientWorkstreamName.trim();
    if (!name) return updateState("clientWorkstream", { validation: "Enter a workstream name." });
    if (!clientOptions.some((option) => option.id === clientId)) {
      return updateState("clientWorkstream", { validation: "Choose an authorized client." });
    }
    void run("clientWorkstream", async () => {
      await onCreateClientWorkstream({ name, clientId });
      setClientWorkstreamName("");
      setClientId("");
    });
  }

  function submitOrganisationWorkstream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = organisationWorkstreamName.trim();
    if (!name) return updateState("organisationWorkstream", { validation: "Enter a workstream name." });
    void run("organisationWorkstream", async () => {
      await onCreateOrganisationWorkstream(name);
      setOrganisationWorkstreamName("");
    });
  }

  function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return updateState("group", { validation: "Enter a group name." });
    const selected = groupWorkstreamOptions.find((option) => `${option.kind}:${option.id}` === groupWorkstream);
    if (!selected) return updateState("group", { validation: "Choose an authorized workstream." });
    void run("group", async () => {
      await onCreateGroup({ name, workstreamId: selected.id, workstreamKind: selected.kind });
      setGroupName("");
      setGroupWorkstream("");
    });
  }

  return (
    <section className={styles.root} aria-label="Context setup">
      <SectionHeading title="Context setup" description="Create clients, workstreams, and groups." />
      <div className={styles.forms}>
        {canCreateClient ? (
          <form className={styles.form} noValidate onSubmit={submitClient}>
            <h3>New client</h3>
            <Field id={`${id}-client-name`} label="Client name" required error={states.client.validation || undefined}>
              {(control) => <Input {...control} required value={clientName} disabled={states.client.pending} onChange={(event) => {
                setClientName(event.currentTarget.value);
                updateState("client", { validation: null, error: null });
              }} />}
            </Field>
            {actionError(states.client)}
            <div className={styles.actions}>
              <Button type="submit" variant="secondary" loading={states.client.pending} loadingLabel="Creating client">Create client</Button>
            </div>
          </form>
        ) : null}

        {canCreateClientWorkstream ? (
          <form className={styles.form} noValidate onSubmit={submitClientWorkstream}>
            <h3>New client workstream</h3>
            {clientOptions.length ? (
              <>
                <Field id={`${id}-client-workstream-name`} label="Workstream name" required error={states.clientWorkstream.validation === "Enter a workstream name." ? states.clientWorkstream.validation : undefined}>
                  {(control) => <Input {...control} required value={clientWorkstreamName} disabled={states.clientWorkstream.pending} onChange={(event) => {
                    setClientWorkstreamName(event.currentTarget.value);
                    updateState("clientWorkstream", { validation: null, error: null });
                  }} />}
                </Field>
                <SearchableSelect
                  id={`${id}-client-choice`}
                  label="Client"
                  required
                  value={clientId}
                  options={clientChoices}
                  placeholder="Search clients"
                  emptyMessage="No matching clients."
                  error={states.clientWorkstream.validation === "Choose an authorized client." ? states.clientWorkstream.validation : undefined}
                  disabled={states.clientWorkstream.pending}
                  onChange={(value) => { setClientId(value); updateState("clientWorkstream", { validation: null, error: null }); }}
                />
              </>
            ) : <ChoiceUnavailable readState={readState} subject="client" />}
            {actionError(states.clientWorkstream)}
            {clientOptions.length ? (
              <div className={styles.actions}>
                <Button type="submit" variant="secondary" loading={states.clientWorkstream.pending} loadingLabel="Creating workstream">Create client workstream</Button>
              </div>
            ) : null}
          </form>
        ) : null}

        {canCreateOrganisationWorkstream ? (
          <form className={styles.form} noValidate onSubmit={submitOrganisationWorkstream}>
            <h3>New organisation workstream</h3>
            <Field id={`${id}-organisation-workstream-name`} label="Workstream name" required error={states.organisationWorkstream.validation || undefined}>
              {(control) => <Input {...control} required value={organisationWorkstreamName} disabled={states.organisationWorkstream.pending} onChange={(event) => {
                setOrganisationWorkstreamName(event.currentTarget.value);
                updateState("organisationWorkstream", { validation: null, error: null });
              }} />}
            </Field>
            {actionError(states.organisationWorkstream)}
            <div className={styles.actions}>
              <Button type="submit" variant="secondary" loading={states.organisationWorkstream.pending} loadingLabel="Creating workstream">Create organisation workstream</Button>
            </div>
          </form>
        ) : null}

        {canCreateGroup ? (
          <form className={styles.form} noValidate onSubmit={submitGroup}>
            <h3>New group</h3>
            {groupWorkstreamOptions.length ? (
              <>
                <Field id={`${id}-group-name`} label="Group name" required error={states.group.validation === "Enter a group name." ? states.group.validation : undefined}>
                  {(control) => <Input {...control} required value={groupName} disabled={states.group.pending} onChange={(event) => {
                    setGroupName(event.currentTarget.value);
                    updateState("group", { validation: null, error: null });
                  }} />}
                </Field>
                <SearchableSelect
                  id={`${id}-group-workstream`}
                  label="Workstream"
                  required
                  value={groupWorkstream}
                  options={groupChoices}
                  placeholder="Search workstreams"
                  emptyMessage="No matching workstreams."
                  error={states.group.validation === "Choose an authorized workstream." ? states.group.validation : undefined}
                  disabled={states.group.pending}
                  onChange={(value) => { setGroupWorkstream(value); updateState("group", { validation: null, error: null }); }}
                />
              </>
            ) : <ChoiceUnavailable readState={readState} subject="workstream" />}
            {actionError(states.group)}
            {groupWorkstreamOptions.length ? (
              <div className={styles.actions}>
                <Button type="submit" variant="secondary" loading={states.group.pending} loadingLabel="Creating group">Create group</Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}
