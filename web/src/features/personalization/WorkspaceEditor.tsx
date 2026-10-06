import { useId, useState } from "react";
import { Button, SearchableSelect, type SearchableSelectOption } from "../../design-system";
import { canEditPersonalPreferenceDraft, type PersonalPreferenceReadStatus } from "./preference-availability";
import styles from "./WorkspaceEditor.module.css";

export type WorkspaceMoveDirection = -1 | 1;
export type WorkspaceSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/** An already-authorized destination. Permission checks belong to the host. */
export interface WorkspaceDestinationOption {
  id: string;
  label: string;
  group?: string;
}

/** An already-authorized My Day module and its current enabled state. */
export interface WorkspaceModuleOption {
  id: string;
  label: string;
  enabled: boolean;
}

export interface WorkspaceEditorProps {
  /** Authorized destinations in their current visible navigation order. */
  destinations: readonly WorkspaceDestinationOption[];
  /** `auto` or the stored destination ID, including IDs unavailable to this role. */
  homeView: string;
  /** Stored pins, including known destinations unavailable to this role. Hidden pins are preserved but do not count toward this role's visible pin limit. */
  pinnedDestinationIds: readonly string[];
  /** Authorized My Day modules; preserve the host's presentation order. */
  modules: readonly WorkspaceModuleOption[];
  readStatus: PersonalPreferenceReadStatus;
  writable: boolean;
  saveStatus: WorkspaceSaveStatus;
  /** A shared preference revision conflict blocks workspace edits until Appearance resolves it. */
  blockedByConflict?: boolean;
  error?: string;
  onHomeViewChange: (view: string) => void;
  /** Apply this single-item change to the full stored pin list; retain known role-hidden destinations. */
  onPinChange: (destinationId: string, pinned: boolean) => void;
  /**
   * Move within `visibleOrderedIds`, the authorized navigation projection. Merge that reorder into
   * the full stored navigation order so known but inaccessible IDs retain their positions.
   */
  onMoveDestination: (
    destinationId: string,
    direction: WorkspaceMoveDirection,
    visibleOrderedIds: readonly string[],
  ) => void;
  /** Apply this single-item change to the full stored module list; enabling should append the ID. */
  onModuleChange: (moduleId: string, enabled: boolean) => void;
  /**
   * Move within the enabled, authorized module projection. Merge into the full stored module order
   * so disabled or inaccessible known IDs are preserved by the host.
   */
  onMoveModule: (
    moduleId: string,
    direction: WorkspaceMoveDirection,
    enabledModuleIds: readonly string[],
  ) => void;
  onReset: () => void;
  onRetry?: () => void;
  onReload: () => void;
}

const MAX_PINNED_DESTINATIONS = 4;

const SAVE_STATUS_LABEL: Record<WorkspaceSaveStatus, string> = {
  idle: "Changes save automatically.",
  pending: "Changes waiting to save…",
  saving: "Saving workspace…",
  saved: "Workspace saved.",
  error: "Workspace could not be saved.",
};

export function workspaceHomeDestinationOptions(
  destinations: readonly WorkspaceDestinationOption[],
  includeUnavailableSavedDestination: boolean,
): SearchableSelectOption[] {
  return [
    { value: "auto", label: "Use NOVA’s best available page" },
    ...(includeUnavailableSavedDestination
      ? [{ value: "unavailable", label: "Saved page unavailable to this role", disabled: true }]
      : []),
    ...destinations.map((destination) => ({ value: destination.id, label: destination.label })),
  ];
}

export function workspaceHomePreferenceValue(value: string): string | null {
  return value && value !== "unavailable" ? value : null;
}

export function WorkspaceEditor({
  destinations,
  homeView,
  pinnedDestinationIds,
  modules,
  readStatus,
  writable,
  saveStatus,
  blockedByConflict = false,
  error,
  onHomeViewChange,
  onPinChange,
  onMoveDestination,
  onModuleChange,
  onMoveModule,
  onReset,
  onRetry,
  onReload,
}: WorkspaceEditorProps) {
  const id = useId();
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const canEdit = canEditPersonalPreferenceDraft(readStatus, writable, saveStatus === "saving", blockedByConflict);
  const disabled = !canEdit;
  const pinnedIds = new Set(pinnedDestinationIds);
  const pinnedCount = destinations.reduce((count, destination) =>
    count + Number(pinnedIds.has(destination.id)), 0);
  const visibleDestinationIds = destinations.map(({ id: destinationId }) => destinationId);
  const enabledModuleIds = modules.filter(({ enabled }) => enabled).map(({ id: moduleId }) => moduleId);
  const homeIsAvailable = homeView === "auto" || destinations.some(({ id: destinationId }) => destinationId === homeView);
  const homeOptions = workspaceHomeDestinationOptions(destinations, !homeIsAvailable);

  return (
    <section className={styles.editor} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>PERSONAL SETTINGS</p>
          <h2 className={styles.title} id={`${id}-title`}>Workspace</h2>
          <p className={styles.intro}>Choose the pages and My Day sections that make your workspace easier to use.</p>
        </div>
        <Button className={styles.resetButton} variant="secondary" onClick={onReset} disabled={disabled}>
          Reset workspace
        </Button>
      </header>

      <div className={styles.statusRow}>
        <span className={styles.statusDot} data-state={saveStatus} aria-hidden="true" />
        <span role="status" aria-live="polite" aria-atomic="true">
          {blockedByConflict ? "Preferences changed elsewhere." : readStatus === "read-failed" ? "Saved workspace preferences could not be loaded." : readStatus === "unsupported" ? "Workspace settings are unavailable for this server version." : readStatus === "access-lost" ? "Personal settings access needs to be restored." : SAVE_STATUS_LABEL[saveStatus]}
        </span>
        {readStatus === "read-failed" || readStatus === "access-lost" ? (
          <Button className={styles.statusAction} variant="quiet" size="compact" onClick={onReload}>
            Reload saved settings
          </Button>
        ) : saveStatus === "error" && writable && !blockedByConflict && onRetry ? (
          <Button className={styles.statusAction} variant="quiet" size="compact" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
      {readStatus === "ready" && !writable ? (
        <p className={styles.readOnlyNote}>Workspace settings are read-only.</p>
      ) : null}
      {readStatus === "read-failed" ? <p className={styles.error} role="alert">You can preview changes in this browser session, but they will not be saved until the preferences load successfully. Reloading replaces this preview with the saved settings.</p> : null}
      {readStatus === "unsupported" ? <p className={styles.readOnlyNote}>Saved workspace settings are not supported by the current preference schema. Ask your NOVA administrator to apply the available database update.</p> : null}
      {readStatus === "access-lost" ? <p className={styles.readOnlyNote}>Your session cannot currently read personal workspace settings. Reload them after your access is restored.</p> : null}
      {blockedByConflict ? (
        <p className={styles.conflictNote} role="status">
          Workspace changes are paused. Resolve the saved preference conflict in Appearance before editing these settings.
        </p>
      ) : error && readStatus === "ready" ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.sections}>
        <section className={styles.section} aria-labelledby={`${id}-home-title`}>
          <div className={styles.sectionHeading}>
            <div>
              <h3 className={styles.sectionTitle} id={`${id}-home-title`}>Home page</h3>
              <p className={styles.sectionDescription}>Choose where NOVA opens for you.</p>
            </div>
          </div>
          <div className={styles.homeSelect}>
            <SearchableSelect
              id={`${id}-home`}
              label="Open NOVA to"
              hint={!homeIsAvailable ? "Your saved page is unavailable to this role. It stays saved until you choose another page." : undefined}
              value={homeIsAvailable ? homeView : "unavailable"}
              options={homeOptions}
              placeholder="Search available pages"
              emptyMessage="No available pages match this search."
              disabled={disabled}
              onChange={(view) => {
                const nextView = workspaceHomePreferenceValue(view);
                if (nextView !== null) onHomeViewChange(nextView);
              }}
            />
          </div>
        </section>

        <section className={styles.section} aria-labelledby={`${id}-navigation-title`}>
          <div className={styles.sectionHeading}>
            <div>
              <h3 className={styles.sectionTitle} id={`${id}-navigation-title`}>Navigation</h3>
              <p className={styles.sectionDescription}>Pin useful pages and set their order.</p>
            </div>
            <span className={styles.count}>{pinnedCount} of {MAX_PINNED_DESTINATIONS} pinned</span>
          </div>
          {destinations.length ? (
            <ul className={styles.itemList} aria-label="Available navigation pages">
              {destinations.map((destination, index) => {
                const pinned = pinnedIds.has(destination.id);
                const atCapacity = pinnedCount >= MAX_PINNED_DESTINATIONS;
                return (
                  <li className={styles.item} key={destination.id}>
                    <label className={styles.itemLabel} htmlFor={`${id}-pin-${destination.id}`}>
                      <input
                        className={styles.checkbox}
                        id={`${id}-pin-${destination.id}`}
                        type="checkbox"
                        checked={pinned}
                        disabled={disabled || (!pinned && atCapacity)}
                        onChange={(event) => onPinChange(destination.id, event.currentTarget.checked)}
                      />
                      <span className={styles.itemCopy}>
                        <span className={styles.itemTitle}>{destination.label}</span>
                        {destination.group ? <span className={styles.itemMeta}>{destination.group}</span> : null}
                      </span>
                      <span className={styles.pinLabel}>{pinned ? "Pinned" : "Pin"}</span>
                    </label>
                    <div className={styles.reorderActions} role="group" aria-label={`Reorder ${destination.label}`}>
                      <Button
                        className={styles.reorderButton}
                        variant="quiet"
                        size="compact"
                        aria-label={`Move ${destination.label} up`}
                        disabled={disabled || index === 0}
                        onClick={() => {
                          setReorderAnnouncement(`${destination.label} moved to position ${index} of ${destinations.length} in navigation.`);
                          onMoveDestination(destination.id, -1, visibleDestinationIds);
                        }}
                      >↑</Button>
                      <Button
                        className={styles.reorderButton}
                        variant="quiet"
                        size="compact"
                        aria-label={`Move ${destination.label} down`}
                        disabled={disabled || index === destinations.length - 1}
                        onClick={() => {
                          setReorderAnnouncement(`${destination.label} moved to position ${index + 2} of ${destinations.length} in navigation.`);
                          onMoveDestination(destination.id, 1, visibleDestinationIds);
                        }}
                      >↓</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.emptyState}>No navigation pages are available for your account.</p>
          )}
        </section>

        <section className={styles.section} aria-labelledby={`${id}-modules-title`}>
          <div className={styles.sectionHeading}>
            <div>
              <h3 className={styles.sectionTitle} id={`${id}-modules-title`}>My Day</h3>
              <p className={styles.sectionDescription}>Show only the sections you use. Reorder enabled sections.</p>
            </div>
          </div>
          {modules.length ? (
            <ul className={styles.itemList} aria-label="Available My Day sections">
              {modules.map((module) => {
                const enabledIndex = module.enabled ? enabledModuleIds.indexOf(module.id) : -1;
                return (
                  <li className={styles.item} key={module.id}>
                    <label className={styles.itemLabel} htmlFor={`${id}-module-${module.id}`}>
                      <input
                        className={styles.checkbox}
                        id={`${id}-module-${module.id}`}
                        type="checkbox"
                        checked={module.enabled}
                        disabled={disabled}
                        onChange={(event) => onModuleChange(module.id, event.currentTarget.checked)}
                      />
                      <span className={styles.itemCopy}>
                        <span className={styles.itemTitle}>{module.label}</span>
                        <span className={styles.itemMeta}>{module.enabled ? "Shown in My Day" : "Hidden from My Day"}</span>
                      </span>
                      <span className={styles.pinLabel}>{module.enabled ? "Shown" : "Hidden"}</span>
                    </label>
                    <div className={styles.reorderActions} role="group" aria-label={`Reorder ${module.label}`}>
                      <Button
                        className={styles.reorderButton}
                        variant="quiet"
                        size="compact"
                        aria-label={`Move ${module.label} up`}
                        disabled={disabled || !module.enabled || enabledIndex === 0}
                        onClick={() => {
                          setReorderAnnouncement(`${module.label} moved to position ${enabledIndex} of ${enabledModuleIds.length} in My Day.`);
                          onMoveModule(module.id, -1, enabledModuleIds);
                        }}
                      >↑</Button>
                      <Button
                        className={styles.reorderButton}
                        variant="quiet"
                        size="compact"
                        aria-label={`Move ${module.label} down`}
                        disabled={disabled || !module.enabled || enabledIndex === enabledModuleIds.length - 1}
                        onClick={() => {
                          setReorderAnnouncement(`${module.label} moved to position ${enabledIndex + 2} of ${enabledModuleIds.length} in My Day.`);
                          onMoveModule(module.id, 1, enabledModuleIds);
                        }}
                      >↓</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.emptyState}>No My Day sections are available for your account.</p>
          )}
        </section>
      </div>
      <p className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{reorderAnnouncement}</p>
    </section>
  );
}
