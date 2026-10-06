import { useId, useState, type FormEvent } from "react";
import { Button, Field, Input, SearchableSelect, SectionHeading, StateMessage, type SearchableSelectOption } from "../../design-system";
import type { WorkContextCreationProps } from "./contracts";
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
  onSearchClients,
  onSearchGroupWorkstreams,
  onCreateClient,
  onCreateClientWorkstream,
  onCreateOrganisationWorkstream,
  onCreateGroup,
}: WorkContextCreationProps) {
  const id = useId();
  const [clientName, setClientName] = useState("");
  const [clientWorkstreamName, setClientWorkstreamName] = useState("");
  const [clientId, setClientId] = useState("");
  const [searchedClientOptions, setSearchedClientOptions] = useState<readonly SearchableSelectOption[]>([]);
  const [selectedClientOption, setSelectedClientOption] = useState<SearchableSelectOption | null>(null);
  const [organisationWorkstreamName, setOrganisationWorkstreamName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupWorkstream, setGroupWorkstream] = useState("");
  const [searchedGroupOptions, setSearchedGroupOptions] = useState<readonly SearchableSelectOption[]>([]);
  const [selectedGroupOption, setSelectedGroupOption] = useState<SearchableSelectOption | null>(null);
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
  const searchClients = async (query: string) => {
    const results = await onSearchClients(query);
    setSearchedClientOptions(results);
    return results;
  };
  const searchGroupWorkstreams = async (query: string) => {
    const results = await onSearchGroupWorkstreams(query);
    setSearchedGroupOptions(results);
    return results;
  };
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
    if (!clientOptions.some((option) => option.id === clientId) && selectedClientOption?.value !== clientId) {
      return updateState("clientWorkstream", { validation: "Choose an authorized client." });
    }
    void run("clientWorkstream", async () => {
      await onCreateClientWorkstream({ name, clientId });
      setClientWorkstreamName("");
      setClientId("");
      setSelectedClientOption(null);
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
    const selected = groupWorkstreamOptions.find((option) => `${option.kind}:${option.id}` === groupWorkstream) ||
      (selectedGroupOption?.value === groupWorkstream
        ? groupWorkstreamOptions.find((option) => `${option.kind}:${option.id}` === selectedGroupOption.value) || {
          id: selectedGroupOption.value.slice(selectedGroupOption.value.indexOf(":") + 1),
          name: selectedGroupOption.label,
          kind: selectedGroupOption.value.startsWith("client:") ? "client" as const : "organisation" as const,
        }
        : undefined);
    if (!selected) return updateState("group", { validation: "Choose an authorized workstream." });
    void run("group", async () => {
      await onCreateGroup({ name, workstreamId: selected.id, workstreamKind: selected.kind });
      setGroupName("");
      setGroupWorkstream("");
      setSelectedGroupOption(null);
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
            {readState.status !== "ready" ? (
              <StateMessage kind="info">The initial choices could not be loaded. Search still checks the current authorized clients.</StateMessage>
            ) : null}
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
              searchMode="remote"
              onSearch={searchClients}
              selectedOption={clientChoices.find((option) => option.value === clientId) || selectedClientOption}
              placeholder="Search clients"
              emptyMessage="No matching clients."
              error={states.clientWorkstream.validation === "Choose an authorized client." ? states.clientWorkstream.validation : undefined}
              disabled={states.clientWorkstream.pending}
              onChange={(value) => {
                setClientId(value);
                setSelectedClientOption(value
                  ? searchedClientOptions.find((option) => option.value === value) || clientChoices.find((option) => option.value === value) || null
                  : null);
                updateState("clientWorkstream", { validation: null, error: null });
              }}
            />
            {actionError(states.clientWorkstream)}
            <div className={styles.actions}>
              <Button type="submit" variant="secondary" loading={states.clientWorkstream.pending} loadingLabel="Creating workstream">Create client workstream</Button>
            </div>
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
            {readState.status !== "ready" ? (
              <StateMessage kind="info">The initial choices could not be loaded. Search still checks the current authorized workstreams.</StateMessage>
            ) : null}
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
              searchMode="remote"
              onSearch={searchGroupWorkstreams}
              selectedOption={groupChoices.find((option) => option.value === groupWorkstream) || selectedGroupOption}
              placeholder="Search workstreams"
              emptyMessage="No matching workstreams."
              error={states.group.validation === "Choose an authorized workstream." ? states.group.validation : undefined}
              disabled={states.group.pending}
              onChange={(value) => {
                setGroupWorkstream(value);
                setSelectedGroupOption(value
                  ? searchedGroupOptions.find((option) => option.value === value) || groupChoices.find((option) => option.value === value) || null
                  : null);
                updateState("group", { validation: null, error: null });
              }}
            />
            {actionError(states.group)}
            <div className={styles.actions}>
              <Button type="submit" variant="secondary" loading={states.group.pending} loadingLabel="Creating group">Create group</Button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
