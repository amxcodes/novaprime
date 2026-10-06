import { Badge, Button, SearchableSelect, Select, StateMessage } from "../../../design-system";
import type {
  PermissionCatalogueEntry,
  RoleScopeTargetReads,
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
  onAddScope,
  onUpdateGrant,
  onRemoveScope,
}: PermissionGrantMatrixProps) {
  const targetReadIssues = (Object.entries(targetReads) as Array<[RoleTargetScope, RoleScopeTargetReads[RoleTargetScope]]>)
    .filter(([, read]) => read.status !== "ready");
  const emptyTargetScopes = (Object.entries(targetReads) as Array<[RoleTargetScope, RoleScopeTargetReads[RoleTargetScope]]>)
    .filter(([, read]) => read.status === "ready" && read.options.length === 0);

  return (
    <section className={styles.matrix} aria-labelledby={`${id}-permissions-title`}>
      <div className={styles.sectionHeading}>
        <h4 id={`${id}-permissions-title`}>Permission grants</h4>
        <p>A permission may have multiple independent scopes. Target lists are shown only when the host has already loaded them.</p>
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
  canEdit: boolean;
  disabled: boolean;
  onPermissionChange: (enabled: boolean) => void;
  onAddScope: () => void;
  onUpdateGrant: (index: number, patch: Partial<PermissionGrantDraft>) => void;
  onRemoveScope: (index: number) => void;
}) {
  const availableScopes = assignableRoleScopes(permission, targetReads);
  const checkboxDisabled = disabled || !canEdit || (!grants.length && availableScopes.length === 0);
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
          <strong>{permission.key}</strong>
          <small>{permission.description}</small>
        </span>
      </label>
      {checked ? (
        <div className={styles.grantList}>
          {grants.map((grant, index) => (
            <GrantEditor
              key={`${permission.key}-${index}`}
              id={`${id}-grant-${index}`}
              permission={permission}
              grant={grant}
              targetReads={targetReads}
              disabled={disabled || !canEdit}
              onChange={(patch) => onUpdateGrant(index, patch)}
              onRemove={() => onRemoveScope(index)}
            />
          ))}
          <Button
            variant="quiet"
            size="compact"
            type="button"
            disabled={disabled || !canEdit || availableScopes.length === 0}
            onClick={onAddScope}
          >
            Add scope or target
          </Button>
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
  disabled,
  onChange,
  onRemove,
}: {
  id: string;
  permission: PermissionCatalogueEntry;
  grant: PermissionGrantDraft;
  targetReads: RoleScopeTargetReads;
  disabled: boolean;
  onChange: (patch: Partial<PermissionGrantDraft>) => void;
  onRemove: () => void;
}) {
  const targetScope = targetScopeFor(grant.scope);
  const scopeChoices = roleScopeChoices(permission, targetReads, grant.scope);
  const targetRead = targetScope ? targetReads[targetScope] : undefined;
  const options = targetRead?.status === "ready" ? targetRead.options : [];
  const savedTargetUnavailable = Boolean(grant.targetId && !options.some((option) => option.id === grant.targetId));
  const targetOptions = roleGrantTargetOptions(options, grant.targetId);
  const targetDisabled = disabled || !targetRead || targetRead.status !== "ready" || options.length === 0;
  const hint = targetRead && targetRead.status !== "ready"
    ? targetRead.message || `${targetScopeLabels[targetScope as RoleTargetScope]} options are unavailable. The saved target is kept.`
    : savedTargetUnavailable
      ? "This saved target is not in the current selector list. It is preserved unless you choose another target."
      : targetRead && options.length === 0
        ? `No ${targetScopeLabels[targetScope as RoleTargetScope].toLowerCase()} targets are available.`
        : undefined;

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
        <SearchableSelect
          id={`${id}-target`}
          label={`${targetScopeLabels[targetScope]} target`}
          value={grant.targetId}
          options={targetOptions}
          placeholder={`Choose ${targetScopeLabels[targetScope].toLowerCase()}`}
          emptyMessage={`No matching ${targetScopeLabels[targetScope].toLowerCase()} targets.`}
          disabled={targetDisabled}
          required
          hint={hint}
          onChange={(value) => onChange({ targetId: value })}
        />
      ) : null}
      <Button variant="quiet" size="compact" type="button" disabled={disabled} onClick={onRemove}>
        Remove scope
      </Button>
    </div>
  );
}

function targetScopeFor(scope: string): RoleTargetScope | undefined {
  if (scope === "office" || scope === "organisation_department" || scope === "client" ||
      scope === "client_workstream" || scope === "group") return scope;
  return undefined;
}
