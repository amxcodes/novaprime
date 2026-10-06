import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { SearchableSelect } from "../../design-system";
import { Button } from "../../design-system/primitives/Button";
import { Field, Input } from "../../design-system/primitives/Field";
import type {
  ClientMembershipClient,
  ClientMembershipOperationState,
  ClientMembershipReadState,
  ClientMembershipsProps,
  CreateClientMembershipInput,
} from "./contracts";
import {
  ClientMembershipsController,
  type ClientMembershipCommandRunner,
  type ClientMembershipRequestPort,
} from "./client-memberships-controller";
import styles from "./ClientMemberships.module.css";

export type {
  ClientDepartmentOption,
  ClientMembershipClient,
  ClientMembershipPersonOption,
  ClientMembershipSearchOption,
  ClientMembershipOperationState,
  ClientMembershipOperationStatus,
  ClientMembershipReadState,
  ClientMembershipReadStatus,
  ClientMembershipRecord,
  ClientMembershipsProps,
  CreateClientMembershipInput,
} from "./contracts";

export interface ClientMembershipFeatureProps extends Omit<
  ClientMembershipsProps,
  "read" | "addOperation" | "endOperations" | "onLoadMemberships" | "onLoadMore" | "onAddMembership" | "onEndMembership"
> {
  request: ClientMembershipRequestPort;
  runCommand: ClientMembershipCommandRunner;
  isCurrent: () => boolean;
  errorMessage: (error: unknown) => string;
}

export type ClientMembershipInputBuildResult =
  | { status: "ready"; input: CreateClientMembershipInput }
  | { status: "person-required" }
  | { status: "effective-date-required" };

export function buildClientMembershipInput(
  values: FormData,
): ClientMembershipInputBuildResult {
  const personId = String(values.get("personId") || "").trim();
  const departmentId = String(values.get("clientDepartmentId") || "").trim();
  const effectiveOn = String(values.get("effectiveOn") || "");
  // The chosen IDs are claims; the server rechecks people.view, membership
  // management, client ownership, and department ownership before writing.
  if (!personId) return { status: "person-required" };
  if (!effectiveOn) return { status: "effective-date-required" };

  const input: CreateClientMembershipInput = {
    personId,
    membershipLabel: String(values.get("membershipLabel") || "").trim() || null,
    effectiveOn,
  };
  input.clientDepartmentId = departmentId || null;
  return { status: "ready", input };
}

function addMembership(
  event: FormEvent<HTMLFormElement>,
  props: ClientMembershipsProps,
  onValidationError: (field: "person" | "effectiveOn", message: string | null) => void,
) {
  event.preventDefault();
  if (!props.canManageMemberships || !props.canSearchPeople || props.addOperation?.status === "pending") return;
  const values = new FormData(event.currentTarget);
  const result = buildClientMembershipInput(values);
  if (result.status === "person-required") {
    onValidationError("person", "Choose a person from the authorized list.");
    return;
  }
  if (result.status === "effective-date-required") {
    onValidationError("effectiveOn", "Choose an effective start date.");
    return;
  }
  onValidationError("person", null);
  onValidationError("effectiveOn", null);
  props.onAddMembership(result.input);
}

function endMembership(
  event: FormEvent<HTMLFormElement>,
  membershipId: string,
  operation: ClientMembershipOperationState | undefined,
  props: ClientMembershipsProps,
) {
  event.preventDefault();
  if (!props.canManageMemberships || operation?.status === "pending") return;
  const values = new FormData(event.currentTarget);
  const effectiveUntil = String(values.get("effectiveUntil") || "");
  if (effectiveUntil) props.onEndMembership(membershipId, effectiveUntil);
}

export function ClientMembershipsView(props: ClientMembershipsProps) {
  const id = useId();
  const [personId, setPersonId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [personError, setPersonError] = useState<string | null>(null);
  const [effectiveOnError, setEffectiveOnError] = useState<string | null>(null);
  const {
    client,
    canViewMemberships,
    canManageMemberships,
    canSearchPeople,
    read,
    onSearchPeople,
    onSearchDepartments,
    addOperation = { status: "idle" },
    endOperations = {},
    onLoadMemberships,
    onLoadMore,
  } = props;

  useEffect(() => {
    if (personId && !canSearchPeople) {
      setPersonId("");
      setPersonError(null);
    }
  }, [canSearchPeople, personId]);

  if (!canViewMemberships) {
    return (
      <section className={styles.feature} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>Client memberships</h2>
        <p className={styles.unavailable} role="status">Memberships are unavailable with your current access.</p>
      </section>
    );
  }

  const showPeopleNotice = canManageMemberships && !canSearchPeople;

  return (
    <section className={styles.feature} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>WORK CONTEXT</p>
          <h2 className={styles.title} id={`${id}-title`}>Client memberships</h2>
          <p className={styles.intro}>{client.name}</p>
        </div>
      </header>

      <div className={styles.readStatus} role={read.status === "error" ? "alert" : "status"} aria-live={read.status === "error" ? "assertive" : "polite"} aria-atomic="true">
        {read.status === "idle" ? <span>Memberships have not been loaded.</span> : null}
        {read.status === "loading" ? <span>Loading memberships…</span> : null}
        {read.status === "ready" ? (
          <span>{read.memberships.length} membership record{read.memberships.length === 1 ? "" : "s"} loaded{read.hasMore ? "; more are available." : "."}</span>
        ) : null}
        {read.status === "error" ? <span>{read.error || "Memberships could not be loaded."}</span> : null}
        {read.status === "ready" && read.error ? <span className={styles.inlineError} role="alert">{read.error}</span> : null}
      </div>

      {read.status === "idle" || read.status === "error" ? (
        <Button
          className={styles.action}
          variant="secondary"
          onClick={onLoadMemberships}
        >
          {read.status === "error" ? "Retry memberships" : "Load client memberships"}
        </Button>
      ) : null}

      {read.memberships.length > 0 ? (
        <ul className={styles.membershipList} aria-label={`${client.name} memberships`}>
          {read.memberships.map((membership) => {
            const operation = endOperations[membership.id];
            const personName = membership.person.displayName || "Unnamed person";
            return (
              <li className={styles.membershipItem} key={membership.id}>
                <article className={styles.membership} aria-labelledby={`${id}-membership-${membership.id}`}>
                  <div className={styles.recordHeading}>
                    <h3 id={`${id}-membership-${membership.id}`}>{personName}</h3>
                    <span className={styles.recordStatus} data-active={!membership.effectiveUntil || undefined}>
                      {membership.effectiveUntil ? "Ended" : "Current"}
                    </span>
                  </div>
                  <dl className={styles.facts}>
                    {membership.clientDepartment ? (
                      <div><dt>Department</dt><dd>{membership.clientDepartment.name || "Department no longer available"}</dd></div>
                    ) : null}
                    {membership.membershipLabel ? (
                      <div><dt>Label</dt><dd>{membership.membershipLabel}</dd></div>
                    ) : null}
                    <div><dt>Effective from</dt><dd><time dateTime={membership.effectiveOn}>{membership.effectiveOn}</time></dd></div>
                    <div><dt>Effective until</dt><dd>{membership.effectiveUntil ? <time dateTime={membership.effectiveUntil}>{membership.effectiveUntil}</time> : "No end date"}</dd></div>
                  </dl>
                  {canManageMemberships && !membership.effectiveUntil ? (
                    <form className={styles.endForm} onSubmit={(event) => endMembership(event, membership.id, operation, props)}>
                      <label className={styles.field}>
                        <span>End access on</span>
                        <Input
                          className={styles.input}
                          type="date"
                          name="effectiveUntil"
                          aria-label={`End access on for ${personName}`}
                          aria-describedby={`${id}-end-date-hint-${membership.id}`}
                          min={membership.effectiveOn}
                          required
                          disabled={operation?.status === "pending"}
                        />
                        <span className={styles.dateHint} id={`${id}-end-date-hint-${membership.id}`}>
                          Must be on or after the membership start and your current business date.
                        </span>
                      </label>
                      <Button className={styles.action} variant="secondary" type="submit" aria-label={`End membership for ${personName}`} disabled={operation?.status === "pending"}>
                        {operation?.status === "pending" ? "Ending…" : "End membership"}
                      </Button>
                      {operation?.status === "error" ? <p className={styles.inlineError} role="alert">{operation.error || "Membership could not be ended."}</p> : null}
                    </form>
                  ) : operation?.status === "error" ? <p className={styles.inlineError} role="alert">{operation.error || "Membership could not be ended."}</p> : null}
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}

      {read.status === "ready" && read.memberships.length === 0 ? (
        <p className={styles.emptyState}>No membership records were found for this client.</p>
      ) : null}

      {read.nextCursor ? (
        <Button
          className={styles.action}
          variant="secondary"
          onClick={() => onLoadMore(read.nextCursor!)}
          disabled={read.loadingMore}
        >
          {read.loadingMore ? "Loading older memberships…" : read.error ? "Retry older memberships" : "Load older memberships"}
        </Button>
      ) : null}

      {showPeopleNotice ? (
        <p className={styles.unavailable} role="status">
          Adding a person requires organization-level people viewing access. This client manager cannot search people with the current access.
        </p>
      ) : null}

      {canManageMemberships && canSearchPeople ? (
        <form className={styles.addForm} noValidate onSubmit={(event) => addMembership(event, props, (field, message) => {
          if (field === "person") {
            setPersonError(message);
            if (message) setEffectiveOnError(null);
          } else {
            setEffectiveOnError(message);
            if (message) setPersonError(null);
          }
        })}>
          <h3>Add a client membership</h3>
          <div className={styles.addFields}>
            <SearchableSelect
              id={`${id}-person`}
              name="personId"
              label="Person"
              required
              value={personId}
              options={[]}
              searchMode="remote"
              onSearch={onSearchPeople}
              placeholder="Search people"
              emptyMessage="No authorized people match this search."
              error={personError || undefined}
              disabled={addOperation.status === "pending"}
              onChange={(value) => { setPersonId(value); setPersonError(null); }}
            />
            <SearchableSelect
              id={`${id}-department`}
              name="clientDepartmentId"
              label="Client department (optional)"
              hint="Leave blank when this membership is not department-specific."
              value={departmentId}
              options={[]}
              searchMode="remote"
              onSearch={onSearchDepartments}
              placeholder="Search client departments"
              emptyMessage="No authorized client departments match this search."
              clearLabel="Clear department selection"
              error={undefined}
              disabled={addOperation.status === "pending"}
              onChange={setDepartmentId}
            />
            <Field className={styles.control} label="Membership label (optional)">
              {(controlProps) => <Input {...controlProps} name="membershipLabel" maxLength={120} disabled={addOperation.status === "pending"} />}
            </Field>
            <Field className={styles.control} label="Effective from" required error={effectiveOnError || undefined}>
              {(controlProps) => <Input {...controlProps} name="effectiveOn" type="date" required disabled={addOperation.status === "pending"} onChange={() => setEffectiveOnError(null)} />}
            </Field>
          </div>
          {personError || effectiveOnError ? (
            <p className={styles.srOnly} role="alert" aria-live="assertive" aria-atomic="true">{personError || effectiveOnError}</p>
          ) : null}
          <div className={styles.formActions}>
            <Button className={styles.action} variant="secondary" type="submit" disabled={addOperation.status === "pending"}>
              {addOperation.status === "pending" ? "Adding membership…" : "Add client membership"}
            </Button>
            {addOperation.status === "error" ? <p className={styles.inlineError} role="alert">{addOperation.error || "Membership could not be added."}</p> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** Feature-owned controller/presentation boundary; the host supplies only auth transport and route guards. */
export function ClientMemberships(props: ClientMembershipFeatureProps) {
  const [controller] = useState(() => new ClientMembershipsController({
    client: props.client,
    canViewMemberships: props.canViewMemberships,
    canManageMemberships: props.canManageMemberships,
    canSearchPeople: props.canSearchPeople,
    request: props.request,
    runCommand: props.runCommand,
    isCurrent: props.isCurrent,
    errorMessage: props.errorMessage,
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.dispose(), [controller]);

  return <ClientMembershipsView
    client={props.client}
    canViewMemberships={props.canViewMemberships}
    canManageMemberships={props.canManageMemberships}
    canSearchPeople={props.canSearchPeople}
    onSearchPeople={props.onSearchPeople}
    onSearchDepartments={props.onSearchDepartments}
    read={snapshot.read}
    addOperation={snapshot.addOperation}
    endOperations={snapshot.endOperations}
    onLoadMemberships={() => { void controller.loadFirstPage(); }}
    onLoadMore={(cursor) => { void controller.loadMore(cursor); }}
    onAddMembership={(input) => { void controller.add(input); }}
    onEndMembership={(membershipId, effectiveUntil) => { void controller.end(membershipId, effectiveUntil); }}
  />;
}
