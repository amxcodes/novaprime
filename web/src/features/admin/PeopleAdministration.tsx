import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Field, Input, SearchableSelect, StateMessage, type StatusTone } from "../../design-system";
import type {
  AdminCompleteOnboardingInput,
  AdminInvitePersonInput,
  AdminOnboardingOfficeOption,
  AdminOnboardingOption,
  AdminOnboardingPickerKind,
  AdminOnboardingReadState,
  AdminPeopleDirectoryPage,
  AdminPersonSummary,
  PeopleAdministrationProps,
} from "./people-contracts";
import styles from "./PeopleAdministration.module.css";

const fallbackError = "The People action could not be completed. Review the form and try again.";
type Feedback = { kind: "success" | "warning" | "error"; message: string };

type OnboardingFormValues = AdminCompleteOnboardingInput;
type OnboardingFormErrors = Partial<Record<keyof OnboardingFormValues, string>>;

export function employmentStartDateHint(office?: AdminOnboardingOfficeOption): string {
  return office
    ? `Date is evaluated in ${office.timezone}.`
    : "Choose an office; NOVA validates this date using that office's timezone.";
}

export function prepareAuditReason(value: unknown): { reason: string | null; error: string | null } {
  const reason = String(value || "").trim();
  return reason
    ? { reason, error: null }
    : { reason: null, error: "Enter a reason for this audited access change." };
}

/** Verify that submitted IDs came from the latest server-returned picker results. */
export function prepareOnboardingSubmission(
  values: OnboardingFormValues,
  selectedOptions: {
    office: AdminOnboardingOfficeOption | null;
    department: AdminOnboardingOption | null;
    role: AdminOnboardingOption | null;
    manager: AdminOnboardingOption | null;
  },
): { input: AdminCompleteOnboardingInput; errors: OnboardingFormErrors } | { input: null; errors: OnboardingFormErrors } {
  const errors: OnboardingFormErrors = {};
  if (!values.designation.trim()) errors.designation = "Enter a designation.";
  if (!values.employmentStartsOn) errors.employmentStartsOn = "Choose an employment start date.";
  if (!selectedOptions.office || selectedOptions.office.id !== values.officeId) errors.officeId = "Choose an office from the list.";
  if (!selectedOptions.department || selectedOptions.department.id !== values.organisationDepartmentId) {
    errors.organisationDepartmentId = "Choose a department from the list.";
  }
  if (!selectedOptions.role || selectedOptions.role.id !== values.roleId) errors.roleId = "Choose a role from the list.";
  if (values.managerPersonId && selectedOptions.manager?.id !== values.managerPersonId) {
    errors.managerPersonId = "Choose a manager from the list or clear the selection.";
  }
  if (Object.keys(errors).length) return { input: null, errors };
  return {
    input: { ...values, designation: values.designation.trim() },
    errors,
  };
}

export function onboardingValidationSummary(errors: OnboardingFormErrors): string | null {
  const messages = Object.values(errors).filter((message): message is string => Boolean(message));
  if (!messages.length) return null;
  const count = messages.length;
  return `${count} onboarding ${count === 1 ? "field needs" : "fields need"} attention. ${messages.join(" ")}`;
}

export function OnboardingValidationFeedback({ errors }: { errors: OnboardingFormErrors }) {
  const summary = onboardingValidationSummary(errors);
  if (!summary) return null;
  return <StateMessage className={styles.validationSummary} kind="error" title="Review the onboarding form">{summary}</StateMessage>;
}

function safeError(error: unknown, formatError?: (error: unknown) => string): string {
  const message = formatError?.(error)?.trim();
  return message || fallbackError;
}

function personStatusTone(status: string): StatusTone {
  switch (status.trim().toLowerCase()) {
    case "active": return "success";
    case "invited":
    case "onboarding": return "info";
    case "notice":
    case "offboarding": return "warning";
    case "frozen":
    case "offboarded": return "danger";
    default: return "neutral";
  }
}

function personStatusLabel(status: string): string {
  return status.trim().replaceAll("_", " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export function PeopleAdministration(props: PeopleAdministrationProps) {
  const id = useId();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const pendingRef = useRef<string | null>(null);
  const busy = pendingAction !== null;
  const canShowList = props.canViewPeople;

  async function run<T = void>(
    action: string,
    successMessage: string | ((result: T) => Exclude<Feedback, { kind: "error" }>),
    callback: () => T | Promise<T>,
  ) {
    if (pendingRef.current !== null) return;
    pendingRef.current = action;
    setPendingAction(action);
    setFeedback(null);
    try {
      const result = await callback();
      setFeedback(typeof successMessage === "function"
        ? successMessage(result)
        : { kind: "success", message: successMessage });
    } catch (error) {
      setFeedback({ kind: "error", message: safeError(error, props.formatError) });
    } finally {
      pendingRef.current = null;
      setPendingAction(null);
    }
  }

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.canInvite || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const input: AdminInvitePersonInput = {
      displayName: String(data.get("displayName") || "").trim(),
      email: String(data.get("email") || "").trim(),
    };
    void run("invite", (result) => ({ kind: result.kind, message: result.message }), async () => {
      const result = await props.onInvite(input);
      form.reset();
      return result;
    });
  }

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ADMINISTRATION</p>
          <h2 id={`${id}-title`} className={styles.title}>People and onboarding</h2>
          <p className={styles.description}>Invite people, complete their operational setup, and manage access while preserving their employment history.</p>
        </div>
      </header>

      {feedback ? (
        <StateMessage kind={feedback.kind} title={feedback.kind === "error" ? "Action not completed" : "People updated"}>
          {feedback.message}
        </StateMessage>
      ) : null}

      {props.canInvite ? (
        <section className={styles.invitePanel} aria-labelledby={`${id}-invite-title`}>
          <div className={styles.panelHeading}>
            <div>
              <h3 id={`${id}-invite-title`}>Invite a person</h3>
              <p>NOVA sends a one-time link. The invited person creates their own password.</p>
            </div>
          </div>
          <form className={styles.inviteForm} onSubmit={submitInvite} aria-busy={busy || undefined}>
            <Field label="Full name" required>
              {(control) => <Input {...control} name="displayName" autoComplete="name" maxLength={180} required disabled={busy} />}
            </Field>
            <Field label="Work email" required>
              {(control) => <Input {...control} name="email" type="email" autoComplete="email" required disabled={busy} />}
            </Field>
            <div className={styles.formActions}>
              <Button type="submit" loading={pendingAction === "invite"} loadingLabel="Sending invitation" disabled={busy}>
                Send invitation
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {canShowList ? <PeopleList
        id={`${id}-directory`}
        read={props.peopleRead}
        initialPage={props.peoplePage}
        searchPeopleDirectory={props.searchPeopleDirectory}
        formatError={props.formatError}
        pendingAction={pendingAction}
        onRun={run}
        onResendInvitation={props.onResendInvitation}
        onFreeze={props.onFreeze}
        onStartOffboarding={props.onStartOffboarding}
        onCompleteExit={props.onCompleteExit}
        onCompleteOnboarding={props.onCompleteOnboarding}
        searchOnboardingOptions={props.searchOnboardingOptions}
      /> : null}
    </section>
  );
}

function PeopleList({
  id,
  read,
  initialPage,
  searchPeopleDirectory,
  formatError,
  pendingAction,
  onRun,
  onResendInvitation,
  onFreeze,
  onStartOffboarding,
  onCompleteExit,
  onCompleteOnboarding,
  searchOnboardingOptions,
}: {
  id: string;
  read: PeopleAdministrationProps["peopleRead"];
  initialPage: AdminPeopleDirectoryPage;
  searchPeopleDirectory: PeopleAdministrationProps["searchPeopleDirectory"];
  formatError: PeopleAdministrationProps["formatError"];
  pendingAction: string | null;
  onRun: (action: string, successMessage: string, callback: () => void | Promise<void>) => Promise<void>;
  onResendInvitation: PeopleAdministrationProps["onResendInvitation"];
  onFreeze: PeopleAdministrationProps["onFreeze"];
  onStartOffboarding: PeopleAdministrationProps["onStartOffboarding"];
  onCompleteExit: PeopleAdministrationProps["onCompleteExit"];
  onCompleteOnboarding: PeopleAdministrationProps["onCompleteOnboarding"];
  searchOnboardingOptions: PeopleAdministrationProps["searchOnboardingOptions"];
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(initialPage);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  async function loadPage(nextQuery: string, cursor: string | null, nextHistory: Array<string | null>, nextIndex: number) {
    const sequence = ++requestSequence.current;
    setSearchBusy(true);
    setSearchError(null);
    setPage({ people: [], limit: 25, hasMore: false, nextCursor: null });
    try {
      const result = await searchPeopleDirectory(nextQuery, cursor);
      if (sequence !== requestSequence.current) return;
      setPage(result);
      setCursorHistory(nextHistory);
      setPageIndex(nextIndex);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setSearchError(safeError(error, formatError));
    } finally {
      if (sequence === requestSequence.current) setSearchBusy(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.normalize("NFC").trim();
    setQuery(normalized);
    void loadPage(normalized, null, [null], 0);
  }

  function goToNextPage() {
    if (!page.nextCursor || searchBusy) return;
    void loadPage(query, page.nextCursor, [...cursorHistory.slice(0, pageIndex + 1), page.nextCursor], pageIndex + 1);
  }

  function goToPreviousPage() {
    if (pageIndex <= 0 || searchBusy) return;
    const nextIndex = pageIndex - 1;
    void loadPage(query, cursorHistory[nextIndex] ?? null, cursorHistory, nextIndex);
  }

  if (read.status === "loading") {
    return <section className={styles.directory} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className={styles.directoryTitle}>People in your scope</h3>
      <StateMessage kind="loading" title="Loading people">Reading the people currently authorized for this view.</StateMessage>
    </section>;
  }
  if (read.status === "error" || read.status === "unavailable") {
    return <section className={styles.directory} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className={styles.directoryTitle}>People in your scope</h3>
      <StateMessage kind={read.status === "error" ? "error" : "info"} title={read.status === "error" ? "People could not load" : "People are unavailable"}>
        {read.message}
      </StateMessage>
    </section>;
  }
  const people = page.people;

  return (
    <section className={styles.directory} aria-labelledby={`${id}-title`}>
      <div className={styles.directoryHeading}>
        <div>
          <h3 id={`${id}-title`} className={styles.directoryTitle}>People in your scope</h3>
          <p className={styles.directoryDescription} role="status" aria-live="polite" aria-atomic="true">
            {searchBusy ? "Searching the authorized directory…" : searchError ?? (
              `${people.length} visible record${people.length === 1 ? "" : "s"} on page ${pageIndex + 1}. Results reflect your current access scope.`
            )}
          </p>
        </div>
      </div>
      <form className={styles.directorySearch} onSubmit={submitSearch} role="search" aria-label="Search people in your scope">
        <Field label="Search people you can view" hint="Search runs on the server across your authorized directory.">
          {(control) => <Input {...control} type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} maxLength={100} autoComplete="off" placeholder="Name, email, office, department, or role" disabled={searchBusy} />}
        </Field>
        <Button type="submit" variant="secondary" disabled={searchBusy} loading={searchBusy} loadingLabel="Searching people">Search</Button>
      </form>
      {searchError ? <StateMessage kind="error" title="People search failed">{searchError}</StateMessage> : null}
      {!searchBusy && !searchError && people.length === 0 ? (
        <EmptyState role="status" aria-live="polite" aria-atomic="true" title={query ? "No people match this search in your scope" : "No people are visible in your current scope"} />
      ) : null}
      {people.length ? <ul className={styles.peopleList} aria-label="People on this directory page">
        {people.map((person) => (
          <li key={person.id}>
            <PersonRow
              person={person}
              pendingAction={pendingAction}
              onRun={onRun}
              onResendInvitation={onResendInvitation}
              onFreeze={onFreeze}
              onStartOffboarding={onStartOffboarding}
              onCompleteExit={onCompleteExit}
              onCompleteOnboarding={onCompleteOnboarding}
              searchOnboardingOptions={searchOnboardingOptions}
            />
          </li>
        ))}
      </ul> : null}
      <nav className={styles.directoryPagination} aria-label="People directory pages">
        <Button variant="secondary" disabled={pageIndex === 0 || searchBusy} onClick={goToPreviousPage}>Previous</Button>
        <span aria-live="polite">Page {pageIndex + 1}</span>
        <Button variant="secondary" disabled={!page.hasMore || searchBusy} onClick={goToNextPage}>Next</Button>
      </nav>
    </section>
  );
}

function PersonRow({
  person,
  pendingAction,
  onRun,
  onResendInvitation,
  onFreeze,
  onStartOffboarding,
  onCompleteExit,
  onCompleteOnboarding,
  searchOnboardingOptions,
}: {
  person: AdminPersonSummary;
  pendingAction: string | null;
  onRun: (action: string, successMessage: string, callback: () => void | Promise<void>) => Promise<void>;
  onResendInvitation: PeopleAdministrationProps["onResendInvitation"];
  onFreeze: PeopleAdministrationProps["onFreeze"];
  onStartOffboarding: PeopleAdministrationProps["onStartOffboarding"];
  onCompleteExit: PeopleAdministrationProps["onCompleteExit"];
  onCompleteOnboarding: PeopleAdministrationProps["onCompleteOnboarding"];
  searchOnboardingOptions: PeopleAdministrationProps["searchOnboardingOptions"];
}) {
  const id = useId();
  const personName = person.displayName.trim() || person.email || "Unnamed person";
  const details = [person.office?.name, person.department?.name, person.role?.name].filter(Boolean);
  const rowBusy = pendingAction !== null;
  const targetAction = (action: string) => `${action}:${person.id}`;

  return (
    <article className={styles.person} aria-labelledby={`${id}-name`}>
      <header className={styles.personHeader}>
        <div className={styles.personIdentity}>
          <h4 id={`${id}-name`} className={styles.personName}>{personName}</h4>
          <a className={styles.email} href={`mailto:${person.email}`}>{person.email}</a>
          {details.length ? <p className={styles.meta}>{details.join(" · ")}</p> : null}
        </div>
        <Badge className={styles.status} data-status={person.status.trim().toLowerCase()} tone={personStatusTone(person.status)}>
          {personStatusLabel(person.status)}
        </Badge>
      </header>

      {person.actions.resendInvitation || person.actions.freeze || person.actions.startOffboarding || person.actions.completeExit ? (
        <div className={styles.actions} role="group" aria-label={`Actions for ${personName}`}>
          {person.actions.resendInvitation ? <Button variant="secondary" disabled={rowBusy} loading={pendingAction === targetAction("resend")} loadingLabel={`Resending invitation to ${personName}`} onClick={() => void onRun(targetAction("resend"), "Invitation resent.", () => onResendInvitation(person.id))}>
            Resend invitation
          </Button> : null}
          {person.actions.freeze ? <FreezeAction
            personName={personName}
            pending={pendingAction === targetAction("freeze")}
            disabled={rowBusy}
            onConfirm={() => onRun(
              targetAction("freeze"),
              "Person frozen and existing sessions revoked.",
              () => onFreeze(person.id),
            )}
          /> : null}
          {person.actions.startOffboarding ? <ReasonAction
            title="Start offboarding"
            label={`Start offboarding for ${personName}`}
            action={targetAction("offboard-start")}
            pendingAction={pendingAction}
            onSubmit={(reason) => onRun(targetAction("offboard-start"), "Offboarding started. Reassignments and review handover remain audited.", () => onStartOffboarding(person.id, reason))}
          /> : null}
          {person.actions.completeExit ? <ReasonAction
            title="Complete exit"
            label={`Complete exit for ${personName}`}
            action={targetAction("offboard-complete")}
            pendingAction={pendingAction}
            onSubmit={(reason) => onRun(targetAction("offboard-complete"), "Exit completed; history was preserved.", () => onCompleteExit(person.id, reason))}
          /> : null}
        </div>
      ) : null}

      {person.status === "onboarding" ? <OnboardingPanel
        person={person}
        read={person.onboarding}
        enabled={person.actions.completeOnboarding}
        pending={rowBusy}
        pendingAction={pendingAction}
        onRun={onRun}
        onComplete={onCompleteOnboarding}
        searchOptions={searchOnboardingOptions}
      /> : null}
    </article>
  );
}

function FreezeAction({
  personName,
  pending,
  disabled,
  onConfirm,
}: {
  personName: string;
  pending: boolean;
  disabled: boolean;
  onConfirm: () => Promise<void>;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const hasOpened = useRef(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (confirming) {
      hasOpened.current = true;
      cancelRef.current?.focus();
    } else if (hasOpened.current) {
      hasOpened.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  function confirm() {
    if (disabled || pending) return;
    void onConfirm().finally(() => setConfirming(false));
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="danger"
        aria-expanded={confirming}
        aria-controls={`${id}-confirmation`}
        disabled={disabled || pending}
        onClick={() => setConfirming((current) => !current)}
      >
        Freeze access
      </Button>
      <section
        className={styles.freezeConfirmation}
        id={`${id}-confirmation`}
        aria-labelledby={`${id}-confirmation-title`}
        hidden={!confirming}
      >
        <h5 id={`${id}-confirmation-title`}>Freeze {personName}’s access?</h5>
        <p>This closes their active work and attendance and revokes their active sessions.</p>
        <div className={styles.freezeConfirmationActions}>
          <Button ref={cancelRef} variant="secondary" disabled={disabled || pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={disabled}
            loading={pending}
            loadingLabel={`Freezing access for ${personName}`}
            onClick={confirm}
          >
            Confirm freeze
          </Button>
        </div>
      </section>
    </>
  );
}

function ReasonAction({
  title,
  label,
  action,
  pendingAction,
  onSubmit,
}: {
  title: string;
  label: string;
  action: string;
  pendingAction: string | null;
  onSubmit: (reason: string) => void;
}) {
  const id = useId();
  const reasonInput = useRef<HTMLTextAreaElement | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const pending = pendingAction === action;
  useEffect(() => {
    if (reasonError) reasonInput.current?.focus();
  }, [reasonError]);
  return (
    <details className={styles.reasonAction}>
      <summary aria-label={label}>{title}</summary>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (pendingAction !== null) return;
        const result = prepareAuditReason(new FormData(event.currentTarget).get("reason"));
        setReasonError(result.error);
        if (!result.reason) return;
        onSubmit(result.reason);
      }}>
        <Field id={`${id}-reason`} label="Reason" required hint="This reason is included in the audited access change." error={reasonError}>
          {(control) => <textarea {...control} ref={reasonInput} className={styles.reasonInput} name="reason" required maxLength={500} disabled={pending} onChange={(event) => {
            if (reasonError && event.currentTarget.value.trim()) setReasonError(null);
          }} />}
        </Field>
        <Button type="submit" variant="danger" disabled={pendingAction !== null} loading={pending} loadingLabel={`${title} in progress`}>
          {title}
        </Button>
      </form>
    </details>
  );
}

function OnboardingPanel({
  person,
  read,
  enabled,
  pending,
  pendingAction,
  onRun,
  onComplete,
  searchOptions,
}: {
  person: AdminPersonSummary;
  read?: AdminOnboardingReadState;
  enabled: boolean;
  pending: boolean;
  pendingAction: string | null;
  onRun: (action: string, successMessage: string, callback: () => void | Promise<void>) => Promise<void>;
  onComplete: PeopleAdministrationProps["onCompleteOnboarding"];
  searchOptions: PeopleAdministrationProps["searchOnboardingOptions"];
}) {
  const id = useId();
  if (!enabled) {
    return <StateMessage kind="warning" title="Onboarding is unavailable">{read?.status === "denied" ? read.message : "You do not have all permissions required to complete onboarding."}</StateMessage>;
  }
  if (!read) {
    return <StateMessage kind="warning" title="Onboarding options unavailable">Required office, department, or role options were not supplied.</StateMessage>;
  }
  if (read.status !== "ready") {
    return <StateMessage kind="warning" title={read.status === "denied" ? "Onboarding is unavailable" : "Onboarding options unavailable"}>{read.message}</StateMessage>;
  }
  const action = `onboard:${person.id}`;
  const personName = person.displayName.trim() || person.email || "this person";
  return <OnboardingForm
    id={id}
    personName={personName}
    read={read}
    busy={pending}
    actionPending={pendingAction === action}
    anyActionPending={pendingAction !== null}
    onSubmit={(input) => void onRun(action, "Onboarding completed.", () => onComplete(person.id, input))}
    searchOptions={(kind, query) => searchOptions(person.id, kind, query)}
  />;
}

function OnboardingForm({
  id,
  personName,
  read,
  busy,
  actionPending,
  anyActionPending,
  onSubmit,
  searchOptions,
}: {
  id: string;
  personName: string;
  read: Extract<AdminOnboardingReadState, { status: "ready" }>;
  busy: boolean;
  actionPending: boolean;
  anyActionPending: boolean;
  onSubmit: (input: AdminCompleteOnboardingInput) => void;
  searchOptions: (kind: AdminOnboardingPickerKind, query: string) => Promise<ReadonlyArray<AdminOnboardingOption>>;
}) {
  const [officeId, setOfficeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [managerPersonId, setManagerPersonId] = useState("");
  const [errors, setErrors] = useState<OnboardingFormErrors>({});
  const [officeResults, setOfficeResults] = useState<ReadonlyArray<AdminOnboardingOfficeOption>>([]);
  const [departmentResults, setDepartmentResults] = useState<ReadonlyArray<AdminOnboardingOption>>([]);
  const [roleResults, setRoleResults] = useState<ReadonlyArray<AdminOnboardingOption>>([]);
  const [managerResults, setManagerResults] = useState<ReadonlyArray<AdminOnboardingOption>>([]);
  const [selectedOffice, setSelectedOffice] = useState<AdminOnboardingOfficeOption | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<AdminOnboardingOption | null>(null);
  const [selectedRole, setSelectedRole] = useState<AdminOnboardingOption | null>(null);
  const [selectedManager, setSelectedManager] = useState<AdminOnboardingOption | null>(null);
  const office = selectedOffice?.id === officeId ? selectedOffice : undefined;
  function remoteSearch(kind: AdminOnboardingPickerKind, query: string) {
    return searchOptions(kind, query).then((options) => {
      if (kind === "office") {
        const offices = options.filter(isOfficeOption);
        setOfficeResults(offices);
        return selectOptions(offices);
      }
      if (kind === "department") setDepartmentResults(options);
      else if (kind === "role") setRoleResults(options);
      else setManagerResults(options);
      return selectOptions(options);
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (anyActionPending) return;
    const values = new FormData(event.currentTarget);
    const result = prepareOnboardingSubmission({
      designation: String(values.get("designation") || "").trim(),
      officeId: String(values.get("officeId") || ""),
      employmentStartsOn: String(values.get("employmentStartsOn") || ""),
      organisationDepartmentId: String(values.get("organisationDepartmentId") || ""),
      roleId: String(values.get("roleId") || ""),
      managerPersonId: String(values.get("managerPersonId") || ""),
    }, {
      office: selectedOffice,
      department: selectedDepartment,
      role: selectedRole,
      manager: selectedManager,
    });
    setErrors(result.errors);
    if (!result.input) return;
    onSubmit(result.input);
  }
  return (
    <section className={styles.onboarding} aria-labelledby={`${id}-title`}>
      <div className={styles.panelHeading}>
        <div>
          <h5 id={`${id}-title`}>Complete onboarding</h5>
          <p>Set the person's initial work placement and role.</p>
        </div>
      </div>
      <form className={styles.onboardingForm} onSubmit={submit} aria-busy={busy || undefined} noValidate>
        <OnboardingValidationFeedback errors={errors} />
        <Field label="Designation" required error={errors.designation}>
          {(control) => <Input {...control} name="designation" maxLength={180} required disabled={busy} onChange={() => setErrors((current) => ({ ...current, designation: undefined }))} />}
        </Field>
        <SearchableSelect
          id={`${id}-office`}
          name="officeId"
          label="Office"
          required
          value={officeId}
          options={[]}
          searchMode="remote"
          onSearch={(query) => remoteSearch("office", query)}
          selectedOption={selectOption(selectedOffice)}
          searchErrorMessage="Offices could not be loaded. Edit the search to try again."
          placeholder="Choose office"
          emptyMessage="No matching offices."
          error={errors.officeId}
          disabled={busy}
          onChange={(value) => {
            setOfficeId(value);
            setSelectedOffice(officeResults.find((option) => option.id === value && typeof option.timezone === "string") || null);
            setErrors((current) => ({ ...current, officeId: undefined }));
          }}
        />
        <Field label="Employment start (office local date)" required error={errors.employmentStartsOn} hint={employmentStartDateHint(office)}>
          {(control) => <Input {...control} name="employmentStartsOn" type="date" required disabled={busy} onChange={() => setErrors((current) => ({ ...current, employmentStartsOn: undefined }))} />}
        </Field>
        <SearchableSelect
          id={`${id}-department`}
          name="organisationDepartmentId"
          label="Department"
          required
          value={departmentId}
          options={[]}
          searchMode="remote"
          onSearch={(query) => remoteSearch("department", query)}
          selectedOption={selectOption(selectedDepartment)}
          searchErrorMessage="Departments could not be loaded. Edit the search to try again."
          placeholder="Choose department"
          emptyMessage="No matching departments."
          error={errors.organisationDepartmentId}
          disabled={busy}
          onChange={(value) => {
            setDepartmentId(value);
            setSelectedDepartment(departmentResults.find((option) => option.id === value) || null);
            setErrors((current) => ({ ...current, organisationDepartmentId: undefined }));
          }}
        />
        <SearchableSelect
          id={`${id}-role`}
          name="roleId"
          label="Role"
          required
          value={roleId}
          options={[]}
          searchMode="remote"
          onSearch={(query) => remoteSearch("role", query)}
          selectedOption={selectOption(selectedRole)}
          searchErrorMessage="Roles could not be loaded. Edit the search to try again."
          placeholder="Choose role"
          emptyMessage="No matching roles."
          error={errors.roleId}
          disabled={busy}
          onChange={(value) => {
            setRoleId(value);
            setSelectedRole(roleResults.find((option) => option.id === value) || null);
            setErrors((current) => ({ ...current, roleId: undefined }));
          }}
        />
        <SearchableSelect
          id={`${id}-manager`}
          name="managerPersonId"
          label="Manager (optional)"
          value={managerPersonId}
          options={[]}
          searchMode="remote"
          onSearch={(query) => remoteSearch("manager", query)}
          selectedOption={managerPersonId ? selectOption(selectedManager) : null}
          searchErrorMessage="Managers could not be loaded. Edit the search to try again."
          placeholder="Choose a manager"
          emptyMessage="No eligible managers match this search."
          clearLabel="Clear manager selection"
          disabled={busy}
          onChange={(value) => {
            setManagerPersonId(value);
            setSelectedManager(managerResults.find((option) => option.id === value) || null);
          }}
        />
        <div className={styles.formActions}>
          <Button type="submit" disabled={anyActionPending} loading={actionPending} loadingLabel={`Completing onboarding for ${personName}`}>
            Complete onboarding
          </Button>
        </div>
      </form>
    </section>
  );
}

function selectOption(option?: AdminOnboardingOption | null) {
  return option ? {
    value: option.id,
    label: option.name,
    ...(option.timezone ? { description: option.timezone } : {}),
  } : null;
}

function isOfficeOption(option: AdminOnboardingOption): option is AdminOnboardingOfficeOption {
  return typeof option.timezone === "string";
}

function selectOptions(options: ReadonlyArray<AdminOnboardingOption>) {
  return options.map(({ id: value, name: label, timezone }) => ({
    value,
    label,
    ...(timezone ? { description: timezone } : {}),
  }));
}
