import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Field, Input, SearchableSelect, Select, StateMessage } from "../../design-system";
import type {
  WfhPolicyDraft,
  WfhPolicyFieldErrors,
  WfhPolicyOverridesProps,
  WfhPolicyTargetOption,
  WfhPolicyTargetReadState,
  WfhPolicyTargetType,
} from "./wfh-policy-contracts";
import { buildWfhPolicyInput, wfhPolicyTargetLabel, wfhPolicyTargetTypeLabel } from "./wfh-policy-model";
import styles from "./WfhPolicyOverrides.module.css";

const targetTypes: ReadonlyArray<WfhPolicyTargetType> = ["office", "organisation_department", "person"];
const fallbackListError = "The WFH override list could not be loaded.";

export function availableWfhPolicyTargetTypes(
  targetReads: Readonly<Record<WfhPolicyTargetType, WfhPolicyTargetReadState>>,
): WfhPolicyTargetType[] {
  return targetTypes.filter((type) => {
    const read = targetReads[type];
    return read.status === "ready" && read.targets.length > 0;
  });
}

export function projectWfhPolicyTargetTypeOptions(types: ReadonlyArray<WfhPolicyTargetType>) {
  return types.map((type) => ({ value: type, label: wfhPolicyTargetTypeLabel(type) }));
}

export function projectWfhPolicyTargetOptions(targets: ReadonlyArray<WfhPolicyTargetOption>) {
  return [
    { value: "", label: "Choose a target" },
    ...targets.map((target) => ({ value: target.id, label: wfhPolicyTargetLabel(target) })),
  ];
}

type TargetReadProblem = Readonly<{
  type: WfhPolicyTargetType;
  status: "error" | "loading";
  message: string;
}>;

export function WfhPolicyOverrides(props: WfhPolicyOverridesProps) {
  const idPrefix = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const [preferredTargetType, setPreferredTargetType] = useState<WfhPolicyTargetType | null>(null);
  const [targetId, setTargetId] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [effectiveOn, setEffectiveOn] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<WfhPolicyFieldErrors>({});
  const [localCreateError, setLocalCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const availableTypes = useMemo(() => availableWfhPolicyTargetTypes(props.targetReads), [props.targetReads]);
  const availableTypeOptions = useMemo(() => projectWfhPolicyTargetTypeOptions(availableTypes), [availableTypes]);
  const targetType = preferredTargetType && availableTypes.includes(preferredTargetType)
    ? preferredTargetType
    : availableTypes[0] ?? null;
  const availableTargets = targetType ? props.targetReads[targetType].targets : [];
  const availableTargetOptions = useMemo(() => projectWfhPolicyTargetOptions(availableTargets), [availableTargets]);
  const selectedTargetId = availableTargets.some((target) => target.id === targetId) ? targetId : "";
  const createError = props.createError?.trim() || localCreateError;
  const isBusy = submitting || props.isCreating === true;
  const errorsId = `${idPrefix}-create-errors`;

  useEffect(() => {
    if (createError) errorRef.current?.focus();
  }, [createError]);

  if (!props.canView && !props.canManage) return null;

  const targetReadProblems = props.canManage ? targetTypes.flatMap<TargetReadProblem>((type) => {
    const read = props.targetReads[type];
    if (read.status === "error") return [{ type, status: "error" as const, message: read.error?.trim() || `Could not load ${wfhPolicyTargetTypeLabel(type).toLowerCase()} targets.` }];
    if (read.status === "loading") return [{ type, status: "loading" as const, message: `${wfhPolicyTargetTypeLabel(type)} targets are still loading.` }];
    return [];
  }) : [];

  function clearFormErrors() {
    if (Object.keys(fieldErrors).length) setFieldErrors({});
    setLocalCreateError(null);
    setCreated(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetType || isBusy || submittingRef.current) return;

    const draft: WfhPolicyDraft = {
      targetType,
      targetId: selectedTargetId,
      allowed,
      effectiveOn,
      effectiveUntil,
      reason,
    };
    const result = buildWfhPolicyInput(draft, availableTargets);
    if (!result.input) {
      setFieldErrors(result.errors);
      setLocalCreateError("Check the highlighted fields before adding this override.");
      return;
    }

    setFieldErrors({});
    setLocalCreateError(null);
    setCreated(false);
    submittingRef.current = true;
    setSubmitting(true);
    void Promise.resolve(props.onCreate(result.input))
      .then(() => {
        setTargetId("");
        setEffectiveOn("");
        setEffectiveUntil("");
        setReason("");
        setAllowed(true);
        setCreated(true);
      })
      .catch((error: unknown) => {
        const safeMessage = error instanceof Error ? error.message.trim() : "";
        setLocalCreateError(safeMessage || "The WFH override could not be added. Review the values and try again.");
      })
      .finally(() => {
        submittingRef.current = false;
        setSubmitting(false);
      });
  }

  const listContent = (() => {
    if (!props.canView) {
      return <StateMessage kind="warning" title="Existing overrides are hidden">
        Your current access allows creating overrides without reading the policy list.
      </StateMessage>;
    }
    switch (props.policyRead.status) {
      case "loading":
        return <StateMessage kind="loading" title="Loading WFH overrides">Reading the authorized policy list.</StateMessage>;
      case "error":
        return <StateMessage kind="error" title="WFH overrides could not load">{props.policyRead.error?.trim() || fallbackListError}</StateMessage>;
      case "unavailable":
        return <StateMessage kind="info" title="WFH override list unavailable">The policy list is not available right now.</StateMessage>;
      case "ready":
        if (!props.policyRead.policies.length) {
          return <EmptyState title="No WFH overrides configured" description="The organization’s role policy applies until an override is added." />;
        }
        return (
          <ul className={styles.policyList} aria-label="WFH eligibility overrides">
            {props.policyRead.policies.map((policy) => (
              <li className={styles.policyRow} key={policy.id}>
                <div className={styles.policyHeading}>
                  <h4>{policy.targetName || wfhPolicyTargetTypeLabel(policy.targetType)}</h4>
                  <Badge tone={policy.allowed ? "success" : "warning"}>
                    {policy.allowed ? "WFH allowed" : "WFH not allowed"}
                  </Badge>
                </div>
                <p className={styles.policyDates}>
                  <time dateTime={policy.effectiveOn}>{policy.effectiveOn}</time>
                  <span aria-hidden="true"> – </span>
                  {policy.effectiveUntil
                    ? <time dateTime={policy.effectiveUntil}>{policy.effectiveUntil}</time>
                    : <span>Ongoing</span>}
                  <span className={styles.targetKind}> · {wfhPolicyTargetTypeLabel(policy.targetType)}</span>
                </p>
                {policy.reason ? <p className={styles.policyReason}>{policy.reason}</p> : null}
              </li>
            ))}
          </ul>
        );
    }
  })();

  const canRenderForm = props.canManage && Boolean(targetType);
  const hasTargetReadError = targetReadProblems.some((problem) => problem.status === "error");
  const hasTargetReadLoading = targetReadProblems.some((problem) => problem.status === "loading");

  return (
    <div className={styles.section} aria-busy={isBusy || undefined}>
      {props.canManage && targetReadProblems.length > 0 ? (
        <div className={styles.targetReadNotices} role="group" aria-label="Target list status">
          {targetReadProblems.map((problem) => (
            <StateMessage
              key={problem.type}
              kind={problem.status === "error" ? "warning" : "info"}
              title={`${wfhPolicyTargetTypeLabel(problem.type)} targets ${problem.status === "error" ? "unavailable" : "loading"}`}
            >
              {problem.message}
              {availableTypes.length
                ? " Available target categories remain usable."
                : problem.status === "loading"
                  ? " Override creation is available when a target list loads."
                  : " Override creation is unavailable until a target list can be provided."}
            </StateMessage>
          ))}
        </div>
      ) : null}

      <div className={styles.workspace}>
        {props.canManage ? (
          <section className={styles.panel} aria-labelledby={`${idPrefix}-create-heading`}>
            <header className={styles.panelHeader}>
              <h3 id={`${idPrefix}-create-heading`}>Add an override</h3>
              <p>Set an effective-dated WFH rule for an authorized target.</p>
            </header>
            {canRenderForm ? (
              <form className={styles.form} noValidate onSubmit={submit}>
                {createError ? (
                  <div
                    className={styles.formError}
                    id={errorsId}
                    role="alert"
                    tabIndex={-1}
                    ref={errorRef}
                    aria-labelledby={`${errorsId}-title`}
                  >
                    <h4 id={`${errorsId}-title`}>Override needs attention</h4>
                    <p>{createError}</p>
                  </div>
                ) : null}

                <Select
                  id={`${idPrefix}-target-type`}
                  name="targetType"
                  label="Target type"
                  value={targetType}
                  options={availableTypeOptions}
                  placeholder="Choose a target type"
                  required
                  disabled={isBusy}
                  onChange={(value) => {
                    if (!availableTypes.includes(value as WfhPolicyTargetType)) return;
                    setPreferredTargetType(value as WfhPolicyTargetType);
                    setTargetId("");
                    clearFormErrors();
                  }}
                />

                <SearchableSelect
                  id={`${idPrefix}-target`}
                  name="targetId"
                  label="Target"
                  hint="Only target options supplied for this authorized form are shown."
                  value={selectedTargetId}
                  options={availableTargetOptions}
                  placeholder="Choose a target"
                  emptyMessage="No authorized targets match this search."
                  required
                  disabled={isBusy}
                  error={fieldErrors.targetId}
                  onChange={(value) => {
                    if (value && !availableTargets.some((target) => target.id === value)) return;
                    setTargetId(value);
                    clearFormErrors();
                  }}
                />

                <div className={styles.dateGrid}>
                  <Field label="Effective from" required error={fieldErrors.effectiveOn}>
                    {(control) => <Input
                      {...control}
                      type="date"
                      name="effectiveOn"
                      value={effectiveOn}
                      disabled={isBusy}
                      onChange={(event) => { setEffectiveOn(event.currentTarget.value); clearFormErrors(); }}
                    />}
                  </Field>
                  <Field label="Effective until (optional)" error={fieldErrors.effectiveUntil}>
                    {(control) => <Input
                      {...control}
                      type="date"
                      name="effectiveUntil"
                      value={effectiveUntil}
                      min={effectiveOn || undefined}
                      disabled={isBusy}
                      onChange={(event) => { setEffectiveUntil(event.currentTarget.value); clearFormErrors(); }}
                    />}
                  </Field>
                </div>
                <label className={styles.allowedControl}>
                  <input
                    type="checkbox"
                    name="allowed"
                    checked={allowed}
                    disabled={isBusy}
                    onChange={(event) => { setAllowed(event.currentTarget.checked); clearFormErrors(); }}
                  />
                  <span>WFH allowed</span>
                </label>
                <Field
                  label="Reason (optional)"
                  hint="Up to 2,000 characters."
                  error={fieldErrors.reason}
                >
                  {(control) => <Input
                    {...control}
                    type="text"
                    name="reason"
                    value={reason}
                    maxLength={2000}
                    disabled={isBusy}
                    onChange={(event) => { setReason(event.currentTarget.value); clearFormErrors(); }}
                  />}
                </Field>
                {created ? <StateMessage kind="success" title="WFH override added">The create action completed successfully.</StateMessage> : null}
                <div className={styles.actions}>
                  <Button type="submit" variant="primary" disabled={isBusy} loading={isBusy} loadingLabel="Adding WFH override">
                    Add WFH override
                  </Button>
                </div>
              </form>
            ) : (
              <div className={styles.noTargets}>
                {hasTargetReadLoading ? (
                  <StateMessage kind="loading" title="Loading override targets">Target options are being prepared.</StateMessage>
                ) : hasTargetReadError ? (
                  <StateMessage kind="warning" title="Override targets unavailable">No target list is ready. Resolve an available target-list error before creating an override.</StateMessage>
                ) : (
                  <EmptyState title="No target options available" description="Creating an override also needs a separately authorized office, department, or people list." />
                )}
              </div>
            )}
          </section>
        ) : null}

        <section className={styles.panel} aria-labelledby={`${idPrefix}-list-heading`}>
          <header className={styles.panelHeader}>
            <h3 id={`${idPrefix}-list-heading`}>Existing overrides</h3>
            {props.canView ? <p>Rules shown are the policy rows supplied for your current access.</p> : null}
          </header>
          {listContent}
        </section>
      </div>
    </div>
  );
}
