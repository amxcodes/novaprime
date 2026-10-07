import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Field, Input, Select, StateMessage } from "../../../design-system";
import {
  collectRolePermissionGrants,
  groupRolePermissionGrants,
  leastPrivilegedRoleScope,
  rolePresetDraft,
  rolePresets,
  uniqueRoleKey,
} from "../../../../role-grants.js";
import type {
  PermissionCatalogueEntry,
  RoleMutationPayload,
  RoleOperationalPolicy,
  RolePermissionGrant,
  RolePermissionsEditorProps,
  RoleRecord,
} from "./contracts";
import {
  assignableRoleScopes,
  roleGrantTargetId,
  rolePermissionModules,
  preservedUnavailableRoleGrants,
} from "./role-editor-model";
import {
  isRoleOperationalPolicyFieldEnabled,
  roleOperationalPolicyPrerequisite,
  updateRoleOperationalPolicy,
} from "./role-policy-model";
import { PermissionGrantMatrix, type PermissionGrantDraft } from "./PermissionGrantMatrix";
import styles from "./RolePermissionsEditor.module.css";

type EditorDraft = {
  roleId?: string;
  expectedRevision?: number;
  key: string;
  name: string;
  operationalPolicy: RoleOperationalPolicy;
  grants: Record<string, PermissionGrantDraft[]>;
  /** Existing grants for permissions disabled in the customer-role catalogue stay immutable. */
  unavailableGrants: ReadonlyArray<RolePermissionGrant>;
};

const policyFields: ReadonlyArray<{
  key: keyof RoleOperationalPolicy;
  label: string;
  detail: string;
}> = [
  { key: "workEnabled", label: "Work enabled", detail: "Allow the role to participate in work workflows." },
  { key: "canReceiveAssignments", label: "Can receive assignments", detail: "Allow eligible work to be assigned to this role." },
  { key: "attendanceRequired", label: "Attendance required", detail: "Require attendance according to the active policy." },
  { key: "wfhAllowed", label: "WFH allowed", detail: "Allow work-from-home requests under the active policy." },
  { key: "canWorkWithoutAttendance", label: "Can work without attendance", detail: "Permit work when attendance is not recorded." },
  { key: "payrollApplicable", label: "Payroll eligibility", detail: "Mark this role for future payroll rules." },
  { key: "payrollAttendanceContributes", label: "Attendance in future payroll rules", detail: "Allow attendance to be considered if payroll workflows are added." },
  { key: "payrollOvertimeApplicable", label: "Overtime eligibility", detail: "Mark this role for future overtime rules." },
];

export function RolePermissionsEditor(props: RolePermissionsEditorProps) {
  const id = useId();
  const editorRef = useRef<HTMLFormElement>(null);
  const roleSearchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(false);
  const roleSearchGeneration = useRef(0);
  const [draft, setDraft] = useState<EditorDraft | null>(() => props.canCreate ? emptyDraft() : null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  const [roleSearchState, setRoleSearchState] = useState<{
    query: string;
    status: "idle" | "loading" | "ready" | "error";
    roles: ReadonlyArray<RoleRecord>;
    message?: string;
  }>({ query: "", status: "idle", roles: [] });
  const [presetId, setPresetId] = useState("");
  const [presetMessage, setPresetMessage] = useState("");
  const [expandedModules, setExpandedModules] = useState<ReadonlySet<string>>(() => new Set());
  const modules = useMemo(() => rolePermissionModules(props.permissions), [props.permissions]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const query = roleQuery.trim();
    const generation = ++roleSearchGeneration.current;
    if (!query) {
      setRoleSearchState({ query: "", status: "idle", roles: [] });
      return;
    }

    setRoleSearchState({ query, status: "loading", roles: [] });
    const timer = window.setTimeout(() => {
      void props.onSearch(query).then((roles) => {
        if (!mountedRef.current || generation !== roleSearchGeneration.current) return;
        setRoleSearchState({ query, status: "ready", roles });
      }).catch((searchError) => {
        if (!mountedRef.current || generation !== roleSearchGeneration.current) return;
        const message = searchError instanceof Error ? searchError.message.trim() : "";
        setRoleSearchState({
          query,
          status: "error",
          roles: [],
          message: message || "Role search could not be completed. Try again.",
        });
      });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      roleSearchGeneration.current += 1;
    };
  }, [props.onSearch, roleQuery]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (draft?.roleId) {
      editorRef.current?.scrollIntoView({ block: "start" });
      titleRef.current?.focus();
    }
  }, [draft?.roleId]);

  if (!props.canView) return null;
  if (props.readState.status === "error") {
    return (
      <div className={styles.readErrors}>
        {props.readState.messages.map((message, index) => (
          <StateMessage key={`${index}-${message}`} kind="error" title="Role data unavailable">{message}</StateMessage>
        ))}
      </div>
    );
  }

  const canEditDraft = draft ? (draft.roleId ? props.canEdit : props.canCreate) : false;
  const normalizedRoleQuery = roleQuery.trim();
  const activeRoleSearch = normalizedRoleQuery && roleSearchState.query === normalizedRoleQuery
    ? roleSearchState
    : undefined;
  const visibleRoles = normalizedRoleQuery ? activeRoleSearch?.roles || [] : props.roles;

  function resetDraft() {
    setDraft(props.canCreate ? emptyDraft() : null);
    setError("");
    setPresetId("");
    setPresetMessage("");
  }

  function editRole(role: RoleRecord) {
    if (!props.canEdit || role.isProtected || role.archivedAt) return;
    setDraft(roleToDraft(role, props.permissions));
    setError("");
    setPresetId("");
    setPresetMessage("");
    setExpandedModules(new Set(role.permissionGrants.map((grant) =>
      props.permissions.find((permission) => permission.key === grant.permissionKey)?.module || "Other permissions",
    )));
  }

  function updateDraft<K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setError("");
  }

  function togglePermission(permission: PermissionCatalogueEntry, enabled: boolean) {
    if (!draft || !canEditDraft || submitting || !permission.customerRoleAssignable) return;
    const current = draft.grants[permission.key] || [];
    if (!enabled) {
      updateDraft("grants", { ...draft.grants, [permission.key]: [] });
      return;
    }
    if (current.length) return;
    const scopes = assignableRoleScopes(permission, props.targetReads, Boolean(props.onSearchTargets));
    if (!scopes.length) return;
    const defaultScope = leastPrivilegedRoleScope(scopes);
    updateDraft("grants", { ...draft.grants, [permission.key]: [{ scope: defaultScope, targetId: "" }] });
    const moduleName = permission.module?.trim() || "Other permissions";
    setExpandedModules((previous) => new Set(previous).add(moduleName));
  }

  function addScope(permission: PermissionCatalogueEntry) {
    if (!draft || !canEditDraft || submitting || !permission.customerRoleAssignable) return;
    const current = draft.grants[permission.key] || [];
    const scopes = assignableRoleScopes(permission, props.targetReads, Boolean(props.onSearchTargets));
    if (!scopes.length) return;
    const previousScope = current.at(-1)?.scope;
    const defaultScope = previousScope && scopes.includes(previousScope)
      ? previousScope
      : leastPrivilegedRoleScope(scopes);
    updateDraft("grants", { ...draft.grants, [permission.key]: [...current, { scope: defaultScope, targetId: "" }] });
  }

  function updateGrant(permissionKey: string, index: number, patch: Partial<PermissionGrantDraft>) {
    if (!draft) return;
    const rows = [...(draft.grants[permissionKey] || [])];
    rows[index] = { ...rows[index], ...patch };
    updateDraft("grants", { ...draft.grants, [permissionKey]: rows });
  }

  function removeScope(permissionKey: string, index: number) {
    if (!draft) return;
    const rows = [...(draft.grants[permissionKey] || [])];
    rows.splice(index, 1);
    updateDraft("grants", { ...draft.grants, [permissionKey]: rows });
  }

  function applyPreset() {
    if (!draft || !canEditDraft || draft.roleId) return;
    const preset = rolePresetDraft(presetId, props.permissions);
    if (!preset) {
      setPresetMessage("Choose a starter profile to preview it.");
      return;
    }
    const grantsByPermission = groupRolePermissionGrants(preset.grants) as Map<string, ReadonlyArray<RolePermissionGrant>>;
    const grants = Object.fromEntries(props.permissions.map((permission) => [
      permission.key,
      (grantsByPermission.get(permission.key) || []).map((grant) => ({ scope: grant.scope, targetId: roleGrantTargetId(grant) })),
    ]));
    const nextDraft = {
      ...draft,
      key: uniqueRoleKey(preset.key, props.roles),
      name: preset.name,
      operationalPolicy: { ...preset.operationalPolicy } as RoleOperationalPolicy,
      grants,
    };
    setDraft(nextDraft);
    setExpandedModules(new Set(props.permissions
      .filter((permission) => (grants[permission.key] || []).length > 0)
      .map((permission) => permission.module?.trim() || "Other permissions")));
    setPresetMessage(
      `${preset.description} Applied ${preset.grants.length} grants. ` +
      `${preset.targetGrantCount ? `${preset.targetGrantCount} scoped grants need exact targets. ` : ""}` +
      `${preset.omitted.length ? `${preset.omitted.length} unavailable permission or scope entries were omitted.` : ""}`,
    );
    setError("");
  }

  function validationMessage(code: string): string {
    return props.formatError(code) || "Check the role permissions and scope targets before saving.";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canEditDraft || submittingRef.current) return;

    const grantResult = collectRolePermissionGrants(props.permissions.filter((permission) => permission.customerRoleAssignable).map((permission) => ({
      permissionKey: permission.key,
      enabled: (draft.grants[permission.key] || []).length > 0,
      grants: draft.grants[permission.key] || [],
    })));
    if ("error" in grantResult) {
      setError(validationMessage(grantResult.error));
      return;
    }

    const payload: RoleMutationPayload = {
      key: draft.key,
      name: draft.name,
      permissionGrants: [...(grantResult.grants as ReadonlyArray<RolePermissionGrant>), ...draft.unavailableGrants],
      operationalPolicy: { ...draft.operationalPolicy },
    };
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (draft.roleId) {
        await props.onUpdate(draft.roleId, { ...payload, expectedRevision: draft.expectedRevision || 1 });
      } else {
        await props.onCreate(payload);
      }
      if (mountedRef.current) resetDraft();
    } catch (saveError) {
      if (!mountedRef.current) return;
      const message = saveError instanceof Error ? saveError.message.trim() : "";
      setError(message || "The role could not be saved. Review the form and try again.");
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }

  return (
    <div className={styles.editor} data-has-draft={draft ? "true" : "false"}>
      <div className={styles.layout}>
        <div className={styles.roleList}>
          <div className={styles.listHeading}>
            <div>
              <h3 className={styles.sectionTitle}>Configured roles</h3>
              <p className={styles.sectionHint}>Protected roles are read-only. Custom roles include permission scopes and operational policy.</p>
            </div>
            <Badge tone="neutral">{normalizedRoleQuery ? visibleRoles.length : props.roles.length} roles</Badge>
          </div>
            <Field
              id={`${id}-roles-search`}
              className={styles.roleSearch}
              label="Search configured roles"
              hint="Search authorized roles by name, key, or status."
            >
              {(control) => (
                <Input
                  {...control}
                  ref={roleSearchRef}
                  type="search"
                  maxLength={100}
                  value={roleQuery}
                  onChange={(event) => setRoleQuery(event.currentTarget.value)}
                  placeholder="Role name, key, or status"
                />
              )}
            </Field>
            <p className={styles.roleSearchSummary} role="status" aria-live="polite" aria-atomic="true">
              {activeRoleSearch?.status === "loading" || (normalizedRoleQuery && !activeRoleSearch)
                ? "Searching roles…"
                : activeRoleSearch?.status === "error"
                  ? "Role search could not be completed."
                  : normalizedRoleQuery
                    ? `${visibleRoles.length} ${visibleRoles.length === 1 ? "role" : "roles"} found.`
                    : `${props.roles.length} ${props.roles.length === 1 ? "role" : "roles"} available.`}
            </p>
            {activeRoleSearch?.status === "error" ? (
              <StateMessage kind="error" title="Role search unavailable">{activeRoleSearch.message}</StateMessage>
            ) : activeRoleSearch?.status === "loading" || (normalizedRoleQuery && !activeRoleSearch) ? (
              <StateMessage kind="loading" title="Searching roles">Matching role records are being looked up securely.</StateMessage>
            ) : visibleRoles.length ? visibleRoles.map((role) => (
            <article className={styles.roleCard} key={role.id}>
              <div className={styles.roleCopy}>
                <strong className={styles.roleName}>{role.name}</strong>
                <span className={styles.roleKey}>{role.key}</span>
                <Badge tone={role.isProtected ? "warning" : role.archivedAt ? "neutral" : "success"}>
                  {role.isProtected ? "Protected" : role.archivedAt ? "Archived" : "Custom role"}
                </Badge>
              </div>
              {props.canEdit && !role.isProtected && !role.archivedAt ? (
                <Button variant="secondary" size="compact" onClick={() => editRole(role)}>Edit role</Button>
              ) : null}
            </article>
            )) : normalizedRoleQuery ? (
              <div className={styles.noRoleMatches}>
                <StateMessage kind="info" title="No roles match this search">
                  Try a different role name, key, or status.
                </StateMessage>
                <Button
                  variant="quiet"
                  size="compact"
                  onClick={() => {
                    setRoleQuery("");
                    roleSearchRef.current?.focus();
                  }}
                >Clear search</Button>
              </div>
            ) : (
            <StateMessage kind="info" title="No roles found">There are no configured roles in this organization.</StateMessage>
          )}
        </div>

        {draft ? (
          <form className={styles.form} ref={editorRef} onSubmit={(event) => void submit(event)}>
            <header className={styles.formHeader}>
              <div>
                <p className={styles.eyebrow}>{draft.roleId ? "EDIT ROLE" : "NEW ROLE"}</p>
                <h3 ref={titleRef} className={styles.sectionTitle} tabIndex={-1}>{draft.roleId ? "Edit custom role" : "Create custom role"}</h3>
                <p className={styles.sectionHint}>Role changes apply to everyone assigned this role. Scope each grant deliberately.</p>
              </div>
              {draft.roleId ? <Badge tone="info">Revision {draft.expectedRevision}</Badge> : null}
            </header>

            {!draft.roleId ? (
              <div className={styles.presetPanel}>
                <div className={styles.presetControls}>
                  <Select
                    id={`${id}-preset`}
                    label="Starter profile (optional)"
                    value={presetId || null}
                    disabled={!canEditDraft || submitting}
                    onChange={(nextId) => {
                      setPresetId(nextId);
                      const preview = rolePresetDraft(nextId, props.permissions);
                      setPresetMessage(preview
                        ? `Preview: ${preview.description} It contains ${preview.grants.length} available grants and ${preview.targetGrantCount} target-specific grants.` +
                          (preview.omitted.length ? " Some permissions or scopes are unavailable in this installation." : "")
                        : "Choose a profile to preview it. The current role draft is unchanged.");
                    }}
                    placeholder="Choose a profile"
                    options={[
                      ...rolePresets.map((preset: { id: string; name: string }) => ({ value: preset.id, label: preset.name })),
                    ]}
                  />
                  <Button variant="secondary" onClick={applyPreset} disabled={!presetId || !canEditDraft || submitting}>Apply to draft</Button>
                </div>
                <p className={styles.presetHint}>Profiles are editable starting points. Target-specific grants still require an exact available target, and saving uses the normal role permissions.</p>
                {presetMessage ? <p className={styles.liveHint} role="status">{presetMessage}</p> : null}
              </div>
            ) : null}

            <div className={styles.identityGrid}>
              <Field id={`${id}-role-key`} label="Role key" hint="Use a unique lowercase key, such as operations_manager." required>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    autoComplete="off"
                    maxLength={63}
                    value={draft.key}
                    disabled={!canEditDraft || submitting}
                    onChange={(event) => updateDraft("key", event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field id={`${id}-role-name`} label="Display name" required>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    maxLength={180}
                    value={draft.name}
                    disabled={!canEditDraft || submitting}
                    onChange={(event) => updateDraft("name", event.currentTarget.value)}
                  />
                )}
              </Field>
            </div>

            <section className={styles.policySection} aria-labelledby={`${id}-policy-title`}>
              <div className={styles.sectionHeading}>
                <h4 id={`${id}-policy-title`}>Operational policy</h4>
                <p>These defaults are separate from permission grants. Payroll fields record future eligibility only; NOVA does not calculate or run payroll.</p>
              </div>
              <div className={styles.policyGrid}>
                {policyFields.map((field) => {
                  const prerequisite = roleOperationalPolicyPrerequisite(field.key);
                  const prerequisiteField = prerequisite
                    ? policyFields.find((candidate) => candidate.key === prerequisite)
                    : undefined;
                  const prerequisiteEnabled = isRoleOperationalPolicyFieldEnabled(draft.operationalPolicy, field.key);
                  return (
                    <label className={styles.policyChoice} key={field.key}>
                      <input
                        type="checkbox"
                        checked={draft.operationalPolicy[field.key]}
                        disabled={!canEditDraft || submitting || !prerequisiteEnabled}
                        onChange={(event) => updateDraft("operationalPolicy", updateRoleOperationalPolicy(
                          draft.operationalPolicy,
                          field.key,
                          event.currentTarget.checked,
                        ))}
                      />
                      <span>
                        <strong>{field.label}</strong>
                        <small>{!prerequisiteEnabled && prerequisiteField
                          ? `Enable ${prerequisiteField.label.toLowerCase()} first. ${field.detail}`
                          : field.detail}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <PermissionGrantMatrix
              id={id}
              modules={modules}
              grants={draft.grants}
              targetReads={props.targetReads}
              onSearchTargets={props.onSearchTargets}
              canEdit={canEditDraft}
              disabled={submitting}
              expandedModules={expandedModules}
              onModuleToggle={(moduleName, open) => {
                setExpandedModules((previous) => {
                  const next = new Set(previous);
                  if (open) next.add(moduleName);
                  else next.delete(moduleName);
                  return next;
                });
              }}
              onPermissionChange={togglePermission}
              onAddScope={addScope}
              onUpdateGrant={updateGrant}
              onRemoveScope={removeScope}
            />

            {error ? (
              <div className={styles.feedback} ref={errorRef} tabIndex={-1}>
                <StateMessage kind="error" title="Role not saved">{error}</StateMessage>
              </div>
            ) : null}
            <div className={styles.formActions}>
              <Button variant="primary" type="submit" loading={submitting} loadingLabel="Saving role" disabled={!canEditDraft || submitting}>
                {draft.roleId ? "Save role" : "Create role"}
              </Button>
              <Button variant="secondary" type="button" disabled={submitting} onClick={resetDraft}>
                {draft.roleId ? "Cancel edit" : "Clear draft"}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function emptyDraft(): EditorDraft {
  return {
    key: "",
    name: "",
    operationalPolicy: {
      workEnabled: false,
      canReceiveAssignments: false,
      attendanceRequired: false,
      wfhAllowed: false,
      canWorkWithoutAttendance: false,
      payrollApplicable: false,
      payrollAttendanceContributes: false,
      payrollOvertimeApplicable: false,
    },
    grants: {},
    unavailableGrants: [],
  };
}

function roleToDraft(role: RoleRecord, permissions: ReadonlyArray<PermissionCatalogueEntry>): EditorDraft {
  const byPermission = groupRolePermissionGrants(role.permissionGrants) as Map<string, ReadonlyArray<RolePermissionGrant>>;
  return {
    roleId: role.id,
    expectedRevision: role.revision,
    key: role.key,
    name: role.name,
    operationalPolicy: { ...role.operationalPolicy },
    unavailableGrants: preservedUnavailableRoleGrants(role.permissionGrants, permissions),
    grants: Object.fromEntries(permissions.map((permission) => [
      permission.key,
      (byPermission.get(permission.key) || []).map((grant) => ({
        scope: grant.scope,
        targetId: roleGrantTargetId(grant),
      })),
    ])),
  };
}
