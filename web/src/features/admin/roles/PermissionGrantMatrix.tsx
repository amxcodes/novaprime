import { Badge, Button, SearchableSelect, Select, StateMessage, type SearchableSelectProps } from "../../../design-system";
import type {
  PermissionCatalogueEntry,
  RoleScopeTargetReads,
  RoleTargetOption,
  RoleTargetScope,
} from "./contracts";
import {
  assignableRoleScopes,
  roleGrantTargetOptions,
  roleScopeChoices,
} from "./role-editor-model";
import styles from "./PermissionGrantMatrix.module.css";

export type PermissionGrantDraft = { scope: string; targetId: string };
export type PermissionGrantDrafts = Readonly<Record<string, ReadonlyArray<PermissionGrantDraft>>>;

export interface PermissionGrantModule {
  name: string;
  permissions: ReadonlyArray<PermissionCatalogueEntry>;
}

export interface PermissionGrantMatrixProps {
  id: string;
  modules: ReadonlyArray<PermissionGrantModule>;
  grants: PermissionGrantDrafts;
  targetReads: RoleScopeTargetReads;
  canEdit: boolean;
  disabled: boolean;
  expandedModules: ReadonlySet<string>;
  onModuleToggle: (moduleName: string, open: boolean) => void;
  onPermissionChange: (permission: PermissionCatalogueEntry, enabled: boolean) => void;
  onSearchTargets?: (scope: RoleTargetScope, query: string) => Promise<ReadonlyArray<RoleTargetOption>>;
  onAddScope: (permission: PermissionCatalogueEntry) => void;
  onUpdateGrant: (permissionKey: string, index: number, patch: Partial<PermissionGrantDraft>) => void;
  onRemoveScope: (permissionKey: string, index: number) => void;
}

const targetScopeLabels: Readonly<Record<RoleTargetScope, string>> = {
  office: "Office",
  organisation_department: "Department",
  client: "Client",
  client_workstream: "Client workstream",
  group: "Group",
};

export function PermissionGrantMatrix({
  id,
  modules,
  grants,
  targetReads,
  canEdit,
  disabled,
  expandedModules,
  onModuleToggle,
  onPermissionChange,
  onSearchTargets,
  onAddScope,
  onUpdateGrant,
  onRemoveScope,
}: PermissionGrantMatrixProps) {
  const targetReadIssues = onSearchTargets ? []
    : (Object.entries(targetReads) as Array<[RoleTargetScope, RoleScopeTargetReads[RoleTargetScope]]>)
      .filter(([, read]) => read.status !== "ready");
  const emptyTargetScopes = onSearchTargets ? []
    : (Object.entries(targetReads) as Array<[RoleTargetScope, RoleScopeTargetReads[RoleTargetScope]]>)
      .filter(([, read]) => read.status === "ready" && read.options.length === 0);

  return (
    <section className={styles.matrix} aria-labelledby={`${id}-permissions-title`}>
      <div className={styles.sectionHeading}>
        <h4 id={`${id}-permissions-title`}>Permission grants</h4>
        <p>A permission may have multiple independent scopes. Target results are loaded from the authorized directory as you search.</p>
      </div>
      {targetReadIssues.length ? (
        <StateMessage kind="warning" title="Some scope targets are unavailable">
          {targetReadIssues.map(([scope, read]) => (
            <span className={styles.targetIssue} key={scope}>
              {targetScopeLabels[scope]}: {read.message || `${targetScopeLabels[scope]} targets are unavailable.`}
            </span>
          ))}
          Only scopes that need these targets are disabled. Existing grants remain in the draft until you remove them.
        </StateMessage>
      ) : null}
      {emptyTargetScopes.length ? (
        <StateMessage kind="info" title="Some scopes have no available targets">
          {emptyTargetScopes.map(([scope]) => (
            <span className={styles.targetIssue} key={scope}>
              {targetScopeLabels[scope]}: No {targetScopeLabels[scope].toLowerCase()} targets are available.
            </span>
          ))}
          Only scopes that need these targets are disabled. Existing grants remain in the draft until you remove them.
        </StateMessage>
      ) : null}
      <div className={styles.permissionModules}>
        {modules.map((module) => {
          const activeCount = module.permissions.filter((permission) => (grants[permission.key] || []).length > 0).length;
          const open = expandedModules.has(module.name);
          return (
            <details
              className={styles.permissionModule}
              key={module.name}
              open={open}
              onToggle={(event) => onModuleToggle(module.name, event.currentTarget.open)}
            >
              <summary className={styles.moduleSummary}>
                <span className={styles.moduleCopy}>
                  <strong>{module.name}</strong>
                  <small>{module.permissions.length} permissions</small>
                </span>
                <Badge tone={activeCount ? "info" : "neutral"}>{activeCount} selected</Badge>
              </summary>
              <div className={styles.permissionRows}>
                {module.permissions.map((permission) => (
                  <PermissionEditor
                    key={permission.key}
                    id={`${id}-${permission.key.replace(/[^a-z0-9]+/gi, "-")}`}
                    permission={permission}
                    grants={grants[permission.key] || []}
                    targetReads={targetReads}
              onSearchTargets={onSearchTargets}
                    canEdit={canEdit}
                    disabled={disabled}
                    onPermissionChange={(enabled) => onPermissionChange(permission, enabled)}
                    onAddScope={() => onAddScope(permission)}
                    onUpdateGrant={(index, patch) => onUpdateGrant(permission.key, index, patch)}
                    onRemoveScope={(index) => onRemoveScope(permission.key, index)}
                  />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function PermissionEditor({
  id,
  permission,
  grants,
  targetReads,
  onSearchTargets,
  canEdit,
  disabled,
  onPermissionChange,
  onAddScope,
  onUpdateGrant,
  onRemoveScope,
}: {
  id: string;
  permission: PermissionCatalogueEntry;
  grants: ReadonlyArray<PermissionGrantDraft>;
  targetReads: RoleScopeTargetReads;
  onSearchTargets?: (scope: RoleTargetScope, query: string) => Promise<ReadonlyArray<RoleTargetOption>>;
  canEdit: boolean;
  disabled: boolean;
  onPermissionChange: (enabled: boolean) => void;
  onAddScope: () => void;
  onUpdateGrant: (index: number, patch: Partial<PermissionGrantDraft>) => void;
  onRemoveScope: (index: number) => void;
}) {
  const availableScopes = assignableRoleScopes(permission, targetReads, Boolean(onSearchTargets));
  const unavailablePermission = !permission.customerRoleAssignable;
  const checkboxDisabled = disabled || !canEdit || unavailablePermission || (!grants.length && availableScopes.length === 0);
  const checked = grants.length > 0;

  return (
    <article className={styles.permissionRow}>
      <label className={styles.permissionToggle} htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={checked}
          disabled={checkboxDisabled}
          onChange={(event) => onPermissionChange(event.currentTarget.checked)}
        />
        <span className={styles.permissionCopy}>
          <strong>{permission.key}{unavailablePermission ? " — unavailable for customer roles" : ""}</strong>
          <small>{permission.description}</small>
        </span>
      </label>
      {unavailablePermission ? (
        <p className={styles.scopeUnavailable}>
          This permission belongs to a future feature. New grants are disabled; any existing grant is locked and preserved unchanged.
        </p>
      ) : null}
      {checked ? (
        <div className={styles.grantList}>
          {grants.map((grant, index) => (
            <GrantEditor
              key={`${permission.key}-${index}`}
              id={`${id}-grant-${index}`}
              permission={permission}
              grant={grant}
              targetReads={targetReads}
              onSearchTargets={onSearchTargets}
              disabled={disabled || !canEdit || unavailablePermission}
              onChange={(patch) => onUpdateGrant(index, patch)}
              onRemove={() => onRemoveScope(index)}
            />
          ))}
          {!unavailablePermission ? (
            <Button
              variant="quiet"
              size="compact"
              type="button"
              disabled={disabled || !canEdit || availableScopes.length === 0}
              onClick={onAddScope}
            >
              Add scope or target
            </Button>
          ) : null}
        </div>
      ) : null}
      {!checked && availableScopes.length === 0 ? (
        <p className={styles.scopeUnavailable}>No supported scope target is currently available for this permission.</p>
      ) : null}
    </article>
  );
}

function GrantEditor({
  id,
  permission,
  grant,
  targetReads,
  onSearchTargets,
  disabled,
  onChange,
  onRemove,
}: {
  id: string;
  permission: PermissionCatalogueEntry;
  grant: PermissionGrantDraft;
  targetReads: RoleScopeTargetReads;
  onSearchTargets?: (scope: RoleTargetScope, query: string) => Promise<ReadonlyArray<RoleTargetOption>>;
  disabled: boolean;
  onChange: (patch: Partial<PermissionGrantDraft>) => void;
  onRemove: () => void;
}) {
  const targetScope = targetScopeFor(grant.scope);
  const scopeChoices = roleScopeChoices(permission, targetReads, grant.scope, Boolean(onSearchTargets));
  const targetRead = targetScope ? targetReads[targetScope] : undefined;
  const options = targetRead?.status === "ready" ? targetRead.options : [];
  const savedTargetUnavailable = Boolean(grant.targetId && !options.some((option) => option.id === grant.targetId));
  const targetOptions = onSearchTargets ? [] : roleGrantTargetOptions(options, grant.targetId);
  const savedTarget = grant.targetId ? options.find((option) => option.id === grant.targetId) : undefined;
  const selectedOption = grant.targetId
    ? { value: grant.targetId, label: savedTarget?.name || "Previously saved target — unavailable" }
    : null;
  const targetDisabled = disabled || (!onSearchTargets && (!targetRead || targetRead.status !== "ready" || options.length === 0));
  const hint = !onSearchTargets && targetRead && targetRead.status !== "ready"
    ? targetRead.message || `${targetScopeLabels[targetScope as RoleTargetScope]} options are unavailable. The saved target is kept.`
    : !onSearchTargets && savedTargetUnavailable
      ? "This saved target is not in the current selector list. It is preserved unless you choose another target."
      : !onSearchTargets && targetRead && options.length === 0
        ? `No ${targetScopeLabels[targetScope as RoleTargetScope].toLowerCase()} targets are available.`
        : onSearchTargets && grant.targetId
          ? "The saved target remains selected until you choose another result."
        : undefined;
  const targetLabel = targetScope ? `${targetScopeLabels[targetScope]} target` : "Target";
  const targetPlaceholder = targetScope ? `Choose ${targetScopeLabels[targetScope].toLowerCase()}` : "Choose target";
  const targetEmptyMessage = targetScope ? `No matching ${targetScopeLabels[targetScope].toLowerCase()} targets.` : "No matching targets.";
  const targetChange = (value: string) => onChange({ targetId: value });
  const searchableSelectProps: SearchableSelectProps = onSearchTargets && targetScope ? {
    id: `${id}-target`,
    label: targetLabel,
    value: grant.targetId,
    options: [],
    searchMode: "remote",
    onSearch: async (query) => (await onSearchTargets(targetScope, query))
      .map((option) => ({ value: option.id, label: option.name })),
    selectedOption,
    placeholder: targetPlaceholder,
    emptyMessage: targetEmptyMessage,
    disabled: targetDisabled,
    required: true,
    hint,
    onChange: targetChange,
  } : {
    id: `${id}-target`,
    label: targetLabel,
    value: grant.targetId,
    options: targetOptions,
    searchMode: "local",
    placeholder: targetPlaceholder,
    emptyMessage: targetEmptyMessage,
    disabled: targetDisabled,
    required: true,
    hint,
    onChange: targetChange,
  };

  return (
    <div className={styles.grantRow}>
      <Select
        id={`${id}-scope`}
        label="Scope"
        value={grant.scope}
        disabled={disabled}
        onChange={(scope) => onChange({ scope, targetId: "" })}
        options={scopeChoices.map((choice) => ({ value: choice.value, label: choice.label, disabled: choice.disabled }))}
      />
      {targetScope ? (
        <SearchableSelect {...searchableSelectProps} />
      ) : null}
      {permission.customerRoleAssignable ? (
        <Button variant="quiet" size="compact" type="button" disabled={disabled} onClick={onRemove}>
          Remove scope
        </Button>
      ) : null}
    </div>
  );
}

function targetScopeFor(scope: string): RoleTargetScope | undefined {
  if (scope === "office" || scope === "organisation_department" || scope === "client" ||
      scope === "client_workstream" || scope === "group") return scope;
  return undefined;
}
