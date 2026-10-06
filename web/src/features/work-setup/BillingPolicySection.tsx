import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Field, Input, StateMessage } from "../../design-system";
import type {
  BillingClass,
  BillingPolicySectionProps,
  BillingRulesSnapshot,
  BillingWorkstreamSummary,
  TaskRuleClass,
  WorkSetupReadState,
} from "./contracts";
import { errorCode, mutationCanReload, mutationMessage, ReadFeedback, SectionHeading, TextAreaField } from "./WorkSetupShared";
import { definitionSearchStatus, workstreamSearchStatus } from "./billing-search";
import styles from "./WorkSetupSections.module.css";

const SEARCH_ANNOUNCEMENT_DELAY_MS = 300;

function useDebouncedSearchQuery(query: string, enabled: boolean): string | null {
  const [settledQuery, setSettledQuery] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const timeout = window.setTimeout(() => setSettledQuery(query), SEARCH_ANNOUNCEMENT_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [query, enabled]);
  return settledQuery;
}

function PolicyChoices({
  name,
  value,
  onChange,
  allowInherit = false,
  disabled = false,
}: {
  name: string;
  value: TaskRuleClass | "";
  onChange: (value: TaskRuleClass | "") => void;
  allowInherit?: boolean;
  disabled?: boolean;
}) {
  const options: ReadonlyArray<{ value: TaskRuleClass | ""; label: string }> = [
    ...(allowInherit ? [{ value: null, label: "Use workstream default" } as const] : []),
    { value: "billable", label: "Billable" },
    { value: "non_billable", label: "Non-billable" },
  ];
  return (
    <fieldset className={styles.choiceFieldset}>
      <legend>{allowInherit ? "Automatic class for this predefined task" : "Automatic policy for one-off tasks"}</legend>
      <div className={styles.policyChoices}>
        {options.map((option) => (
          <label className={styles.choice} key={String(option.value)}>
            <input
              type="radio"
              name={name}
              value={option.value ?? "inherit"}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function WorkstreamDefaultEditor({
  workstream,
  onSave,
  onDefaultSaved,
  onRetry,
}: {
  workstream: BillingWorkstreamSummary;
  onSave: BillingPolicySectionProps["onSaveDefault"];
  onDefaultSaved?: (workstreamId: string) => void;
  onRetry?: () => void;
}) {
  const [policyClass, setPolicyClass] = useState<BillingClass | "">(workstream.policyClass ?? "");
  const [revision, setRevision] = useState(workstream.policyRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadAvailable, setReloadAvailable] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    setPolicyClass(workstream.policyClass ?? "");
    setRevision(workstream.policyRevision);
  }, [workstream.id, workstream.policyClass, workstream.policyRevision]);
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const reason = String(new FormData(event.currentTarget).get("reason") || "").trim();
    if (!policyClass || !reason || reason.length > 2000) { setError("Choose a policy and enter a reason before saving."); return; }
    setBusy(true); setError(null); setReloadAvailable(false); setFeedback(null);
    try {
      const saved = await onSave(workstream.id, { policyClass, expectedRevision: revision, reason });
      setPolicyClass(saved.policyClass ?? "");
      setRevision(saved.revision);
      setFeedback("Saved for future tasks only. Existing task records and timers are unchanged.");
      onDefaultSaved?.(workstream.id);
    } catch (saveError) {
      setError(mutationMessage(saveError, "billing policy"));
      setReloadAvailable(mutationCanReload(saveError));
    } finally { setBusy(false); }
  };
  return (
    <article className={styles.workstream}>
      <div className={styles.workstreamHeading}>
        <div><h3>{workstream.clientName} <span aria-hidden="true">·</span> {workstream.name}</h3><p>Client workstream · policy revision {revision}</p></div>
        <span className={styles.policyBadge}>{policyClass ? (policyClass === "billable" ? "Billable" : "Non-billable") : "Policy required"}</span>
      </div>
      {!policyClass ? <StateMessage kind="warning">Task creation in this workstream stays blocked until an automatic policy is set.</StateMessage> : null}
      <form className={styles.editor} onSubmit={(event) => void submit(event)}>
        <PolicyChoices name={`default-${id}`} value={policyClass} onChange={(value) => setPolicyClass(value === "billable" || value === "non_billable" ? value : "")} />
        <TextAreaField label="Why is this policy being set or changed?" name="reason" required maxLength={2000} />
        {error ? <StateMessage kind="error">{error}</StateMessage> : null}
        {reloadAvailable && onRetry ? <Button variant="secondary" size="compact" onClick={onRetry}>Reload workstream policy</Button> : null}
        {feedback ? <StateMessage kind="success">{feedback}</StateMessage> : null}
        <Button type="submit" loading={busy}>Save default for future tasks</Button>
      </form>
    </article>
  );
}

function WorkstreamPicker({
  workstreams,
  selectedId,
  onChange,
  onSearch,
}: {
  workstreams: ReadonlyArray<BillingWorkstreamSummary>;
  selectedId: string;
  onChange: (id: string) => void;
  onSearch: BillingPolicySectionProps["onSearchWorkstreams"];
}) {
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState<{
    query: string;
    status: "loading" | "ready" | "error";
    workstreams?: ReadonlyArray<BillingWorkstreamSummary>;
    message?: string;
  } | null>(null);
  const generation = useRef(0);
  const query = search.trim();
  useEffect(() => {
    const current = ++generation.current;
    if (!query) { setSearchResult(null); return; }
    setSearchResult({ query, status: "loading" });
    const timer = window.setTimeout(() => {
      void onSearch(query).then((results) => {
        if (current === generation.current) setSearchResult({ query, status: "ready", workstreams: results });
      }).catch((error: unknown) => {
        if (current !== generation.current) return;
        setSearchResult({ query, status: "error", message: mutationMessage(error, "client workstream search") });
      });
    }, 180);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [onSearch, query]);
  const activeSearch = query && searchResult?.query === query ? searchResult : null;
  const visibleWorkstreams = query
    ? activeSearch?.status === "ready" ? activeSearch.workstreams || [] : []
    : workstreams;
  const announcementQuery = useDebouncedSearchQuery(search, Boolean(query));
  const searchStatus = announcementQuery === null || announcementQuery !== query ? "" : workstreamSearchStatus(
    announcementQuery,
    announcementQuery === query ? visibleWorkstreams.length : 0,
  );
  return (
    <div className={styles.picker}>
      <Field label="Choose a client workstream" hint="Search runs on NOVA and returns only workstreams where you can manage billing policy.">
        {(control) => <Input {...control} type="search" maxLength={120} value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search client or workstream" />}
      </Field>
      {activeSearch?.status === "loading" || (query && !activeSearch) ? <p className={styles.searchStatus} role="status">Searching authorized workstreams…</p> : null}
      {activeSearch?.status === "error" ? <StateMessage kind="error">{activeSearch.message}</StateMessage> : null}
      {searchStatus ? <p className={styles.searchStatus} role="status" aria-live="polite" aria-atomic="true">{searchStatus}</p> : null}
      <div className={styles.pickerOptions} role="group" aria-label="Authorized client workstreams">
        {visibleWorkstreams.map((workstream) => (
          <Button
            className={styles.pickerOption}
            key={workstream.id}
            variant={workstream.id === selectedId ? "secondary" : "quiet"}
            aria-pressed={workstream.id === selectedId}
            onClick={() => onChange(workstream.id)}
          >
            <span>{workstream.clientName} · {workstream.name}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function BillingRuleEditor({
  workstreamId,
  rules,
  onLoadRules,
  onSave,
  onReload,
}: {
  workstreamId: string;
  rules: BillingRulesSnapshot;
  onLoadRules: BillingPolicySectionProps["onLoadRules"];
  onSave: BillingPolicySectionProps["onSaveRule"];
  onReload: () => void;
}) {
  const [selectedEntryId, setSelectedEntryId] = useState(rules.entries[0]?.entryId ?? "");
  const [ruleClass, setRuleClass] = useState<TaskRuleClass | "">(rules.entries[0]?.billingClass ?? null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchChanged, setSearchChanged] = useState(false);
  const [entries, setEntries] = useState(rules.entries);
  const [searchResult, setSearchResult] = useState<{
    query: string;
    status: "loading" | "ready" | "error";
    snapshot?: BillingRulesSnapshot;
    message?: string;
  } | null>(null);
  const searchGeneration = useRef(0);
  const selectedEntryIdRef = useRef(selectedEntryId);
  selectedEntryIdRef.current = selectedEntryId;
  useEffect(() => {
    const currentEntries = rules.entries;
    const current = currentEntries.find((item) => item.entryId === selectedEntryId) ?? currentEntries[0];
    setEntries(currentEntries);
    setSelectedEntryId(current?.entryId ?? "");
    setRuleClass(current?.billingClass ?? null);
    setReason(""); setError(null); setFeedback(null);
  }, [workstreamId, rules]);
  const query = search.trim();
  useEffect(() => {
    const current = ++searchGeneration.current;
    if (!query) { setSearchResult(null); return; }
    setSearchResult({ query, status: "loading" });
    const timer = window.setTimeout(() => {
      void onLoadRules(workstreamId, query).then((snapshot) => {
        if (current !== searchGeneration.current) return;
        setSearchResult({ query, status: "ready", snapshot });
        if (!snapshot.entries.some((item) => item.entryId === selectedEntryIdRef.current)) {
          const first = snapshot.entries[0];
          setSelectedEntryId(first?.entryId ?? "");
          setRuleClass(first?.billingClass ?? null);
          setReason(""); setError(null); setFeedback(null);
        }
      }).catch((error: unknown) => {
        if (current !== searchGeneration.current) return;
        setSearchResult({ query, status: "error", message: mutationMessage(error, "task-definition search") });
      });
    }, 180);
    return () => { window.clearTimeout(timer); searchGeneration.current += 1; };
  }, [onLoadRules, query, workstreamId]);
  const activeSearch = query && searchResult?.query === query ? searchResult : null;
  const activeRules = activeSearch?.status === "ready" && activeSearch.snapshot
    ? activeSearch.snapshot
    : rules;
  const visibleEntries = query
    ? activeSearch?.status === "ready" ? activeSearch.snapshot?.entries || [] : []
    : entries;
  const entry = visibleEntries.find((item) => item.entryId === selectedEntryId);
  const announcementQuery = useDebouncedSearchQuery(search, searchChanged);
  const searchStatus = announcementQuery === null || announcementQuery !== query || (query && activeSearch?.status !== "ready") ? "" : definitionSearchStatus(
    announcementQuery,
    announcementQuery === query ? visibleEntries.length : 0,
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !entry) return;
    const cleanReason = reason.trim();
    if (!cleanReason || cleanReason.length > 2000) { setError("A reason is required to change this rule."); return; }
    setBusy(true); setError(null); setFeedback(null);
    try {
      const saved = await onSave(workstreamId, entry.entryId, {
        policyClass: ruleClass === "" ? null : ruleClass,
        expectedRevision: entry.ruleRevision,
        reason: cleanReason,
      });
      const updateEntry = (items: ReadonlyArray<BillingRulesSnapshot["entries"][number]>) => items.map((item) => item.entryId === entry.entryId
        ? { ...item, billingClass: saved.policyClass, ruleRevision: saved.revision }
        : item);
      setEntries((current) => updateEntry(current));
      setSearchResult((current) => current?.status === "ready" && current.snapshot
        ? { ...current, snapshot: { ...current.snapshot, entries: updateEntry(current.snapshot.entries) } }
        : current);
      setRuleClass(saved.policyClass);
      setFeedback("Saved for future tasks in this workstream only. Existing tasks and timers are unchanged.");
      setReason("");
    } catch (saveError) {
      setError(mutationMessage(saveError, "predefined-task billing rule"));
      if (errorCode(saveError)?.includes("VERSION_CONFLICT")) onReload();
    } finally { setBusy(false); }
  };
  return (
    <div className={styles.ruleEditor}>
      <div className={styles.ruleHeader}>
        <div><h3>Predefined-task billing rules</h3><p>These rules override the workstream default for future tasks selected from that definition.</p></div>
        <span className={styles.policyBadge}>Future tasks only</span>
      </div>
      <>
        <Field label="Find a predefined task" hint="Search runs on NOVA across the task catalog; matching rules stay limited to this workstream.">
          {(control) => <Input {...control} type="search" maxLength={100} value={search} onChange={(event) => { setSearch(event.currentTarget.value); setSearchChanged(true); }} placeholder="Search task definitions" />}
        </Field>
        {activeSearch?.status === "loading" || (query && !activeSearch) ? <p className={styles.searchStatus} role="status">Searching task definitions…</p> : null}
        {activeSearch?.status === "error" ? <StateMessage kind="error">{activeSearch.message}</StateMessage> : null}
        {searchStatus ? <p className={styles.searchStatus} role="status" aria-live="polite" aria-atomic="true">{searchStatus}</p> : null}
        {visibleEntries.length ? (
          <div className={styles.pickerOptions} role="group" aria-label="Predefined task definitions">
            {visibleEntries.map((item) => (
              <Button
                className={styles.pickerOption}
                key={item.entryId}
                variant={item.entryId === selectedEntryId ? "secondary" : "quiet"}
                aria-pressed={item.entryId === selectedEntryId}
                onClick={() => {
                  setSelectedEntryId(item.entryId); setRuleClass(item.billingClass); setError(null); setFeedback(null); setReason("");
                }}
              >
                <span>{item.title}</span><span className={styles.optionMeta}>{item.billingClass ? (item.billingClass === "billable" ? "Billable" : "Non-billable") : "Uses workstream default"} · rule revision {item.ruleRevision}</span>
              </Button>
            ))}
          </div>
        ) : activeSearch?.status === "ready" || (!query && !entries.length) ? (
          <EmptyState
            title={query ? "No matching task definitions" : "No reusable definitions available"}
            description={query ? "Try another task name." : "Create or approve task definitions first. Tasks entered freely use the workstream default."}
          />
        ) : null}
        {entry ? (
            <form className={styles.editor} onSubmit={(event) => void submit(event)}>
              <div className={styles.currentRule}>
                <strong>{entry.title}</strong>
                <p>{entry.billingClass ? `Current rule: ${entry.billingClass === "billable" ? "Billable" : "Non-billable"}` : `No separate rule. Future tasks inherit ${activeRules.defaultClass === "billable" ? "the billable" : activeRules.defaultClass === "non_billable" ? "the non-billable" : "the unset"} workstream default.`} · rule revision {entry.ruleRevision}</p>
              </div>
              <PolicyChoices name={`rule-${workstreamId}-${entry.entryId}`} value={ruleClass} onChange={setRuleClass} allowInherit disabled={!activeRules.defaultClass} />
              {!activeRules.defaultClass ? <StateMessage kind="warning">Set the workstream default before configuring task-specific rules.</StateMessage> : null}
              <div className={styles.field}>
                <label htmlFor={`rule-reason-${workstreamId}`}>Why is this task rule being set or changed? <span aria-hidden="true">*</span></label>
                <textarea id={`rule-reason-${workstreamId}`} required maxLength={2000} rows={3} value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
                <span className={styles.fieldHint}>Required for the audit record; up to 2,000 characters.</span>
              </div>
              {error ? <StateMessage kind="error">{error}</StateMessage> : null}
              {feedback ? <StateMessage kind="success">{feedback}</StateMessage> : null}
              <Button type="submit" loading={busy} disabled={!activeRules.defaultClass}>Save task rule</Button>
            </form>
        ) : null}
      </>
    </div>
  );
}

function BillingPolicyContent({
  workstreams,
  catalogAccess,
  onSearchWorkstreams,
  onLoadRules,
  onSaveDefault,
  onSaveRule,
  onRetryWorkstreams,
  onRetryCatalog,
}: BillingPolicySectionProps) {
  const rows = workstreams.status === "ready" ? workstreams.data : [];
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? "");
  const [rulesByWorkstream, setRulesByWorkstream] = useState<Record<string, WorkSetupReadState<BillingRulesSnapshot>>>({});
  const loadSequence = useRef(0);
  const selected = rows.find((item) => item.id === selectedId) ?? rows[0];
  const selectedIdRef = useRef(selected?.id);
  selectedIdRef.current = selected?.id;
  useEffect(() => {
    if (workstreams.status !== "ready") return;
    if (!rows.some((item) => item.id === selectedId)) setSelectedId(rows[0]?.id ?? "");
  }, [workstreams.status, rows, selectedId]);
  const loadRulesFor = useCallback((workstreamId: string) => {
    const generation = ++loadSequence.current;
    setRulesByWorkstream((current) => ({ ...current, [workstreamId]: { status: "loading" } }));
    void onLoadRules(workstreamId).then((snapshot) => {
      if (generation !== loadSequence.current || selectedIdRef.current !== workstreamId) return;
      setRulesByWorkstream((current) => ({ ...current, [workstreamId]: { status: "ready", data: snapshot } }));
    }).catch((loadError: unknown) => {
      if (generation !== loadSequence.current || selectedIdRef.current !== workstreamId) return;
      const code = errorCode(loadError);
      setRulesByWorkstream((current) => ({
        ...current,
        [workstreamId]: code === "PERMISSION_DENIED"
          ? { status: "denied", message: "Both billing-policy management and task-catalog visibility are required to inspect these rules." }
          : { status: "error", message: "Could not load the current task rules. No policy was changed." },
      }));
    });
  }, [onLoadRules]);
  useEffect(() => {
    if (!selected || catalogAccess !== "available") {
      loadSequence.current += 1;
      return;
    }
    loadRulesFor(selected.id);
    return () => { loadSequence.current += 1; };
  }, [selected?.id, catalogAccess, loadRulesFor]);
  const retryRules = () => {
    if (!selected) return;
    loadRulesFor(selected.id);
  };
  const refreshRulesAfterDefaultSave = (workstreamId: string) => {
    if (catalogAccess === "available" && selectedIdRef.current === workstreamId) loadRulesFor(workstreamId);
  };
  const selectedRules = selected ? rulesByWorkstream[selected.id] : undefined;
  return (
    <section className={styles.section} aria-label="Client workstream billing policies">
      <SectionHeading
        title="Client workstream billing policies"
        description="Authorized policy managers set how NOVA automatically classifies future work. Workers do not choose billing classes; changing a policy never rewrites existing task records or timers."
      />
      {workstreams.status === "ready" ? rows.length ? (
        <div className={styles.workstreamList}>
          {rows.map((workstream) => <WorkstreamDefaultEditor key={workstream.id} workstream={workstream} onSave={onSaveDefault} onDefaultSaved={refreshRulesAfterDefaultSave} onRetry={onRetryWorkstreams} />)}
        </div>
      ) : <EmptyState title="No manageable client workstreams" description="There are no active client workstreams in your billing-policy scope." /> : (
        <ReadFeedback state={workstreams} resource="client workstreams with billing-policy access" onRetry={onRetryWorkstreams} />
      )}
      {catalogAccess === "missing" ? (
        <StateMessage kind="warning" title="Per-task rules need separate catalogue visibility">
          You can manage workstream defaults. Ask an administrator for task-catalog view or manage access to configure predefined-task rules; catalogue access alone does not grant billing authority.
        </StateMessage>
      ) : null}
      {catalogAccess === "denied" ? <ReadFeedback state={{ status: "denied", message: "Task-catalog visibility is no longer available." }} resource="task-catalog visibility" onRetry={onRetryCatalog} /> : null}
      {catalogAccess === "error" ? <ReadFeedback state={{ status: "error", message: "Could not load task-catalog visibility." }} resource="task-catalog visibility" onRetry={onRetryCatalog} /> : null}
      {catalogAccess === "loading" ? <StateMessage kind="loading" title="Checking task-catalog visibility">Workstream defaults remain available independently.</StateMessage> : null}
      {selected && catalogAccess === "available" ? (
        <section className={styles.ruleSection} aria-label="Predefined-task rule editor">
          <WorkstreamPicker workstreams={rows} selectedId={selected.id} onChange={setSelectedId} onSearch={onSearchWorkstreams} />
          {selectedRules?.status === "ready" ? (
            <BillingRuleEditor key={`${selected.id}-${selectedRules.data.defaultRevision}`} workstreamId={selected.id} rules={selectedRules.data} onLoadRules={onLoadRules} onSave={onSaveRule} onReload={retryRules} />
          ) : selectedRules ? (
            <ReadFeedback state={selectedRules} resource="predefined-task billing rules" onRetry={retryRules} />
          ) : <StateMessage kind="loading">Loading rules for {selected.clientName} · {selected.name}…</StateMessage>}
        </section>
      ) : null}
    </section>
  );
}

export function BillingPolicySection(props: BillingPolicySectionProps) {
  return <BillingPolicyContent {...props} />;
}
