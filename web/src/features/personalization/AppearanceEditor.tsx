import { useEffect, useId, useState, type CSSProperties } from "react";
import type { PersonalAppearance } from "../../design-system/foundations/appearance";
import { Button } from "../../design-system/primitives/Button";
import {
  ACCENT_SWATCHES,
  getAppearanceStatusMessage,
  getTypefaceAvailabilityMessage,
  isAppearanceHexColor,
  MOTION_PREFERENCE_PRESENTATION,
  TYPEFACE_PREFERENCE_PRESENTATION,
  type AppearanceSaveStatus,
} from "./appearance-presentation";
import {
  canEditPersonalPreferenceDraft,
  type PersonalPreferenceReadStatus,
} from "./preference-availability";
import styles from "./AppearanceEditor.module.css";

export type AppearanceConflictResolution = "reload" | "overwrite";

export interface AppearanceRevisionConflict {
  submittedRevision: number;
  currentRevision: number;
}

export interface AppearanceEditorProps {
  /** Fully normalized against the persisted UI-preference allowlist. */
  appearance: PersonalAppearance;
  readStatus: PersonalPreferenceReadStatus;
  writable: boolean;
  saveStatus: AppearanceSaveStatus;
  revision: number | null;
  error?: string;
  conflict?: AppearanceRevisionConflict;
  onChange: (next: PersonalAppearance) => void;
  onReset: () => void;
  onRetry: () => void;
  onReload: () => void;
  onResolveConflict: (resolution: AppearanceConflictResolution) => void;
}

type Choice<T extends string> = { value: T; label: string; detail?: string; disabled?: boolean };
type ChoiceSet<T extends string> = { [Value in T]: Choice<Value> };

const themeChoices = {
  system: { value: "system", label: "System", detail: "Follow device" },
  light: { value: "light", label: "Light", detail: "White and green" },
  dark: { value: "dark", label: "Dark", detail: "Black and green" },
} satisfies ChoiceSet<PersonalAppearance["theme"]>;
const accentChoices = {
  nova: { value: "nova", label: "NOVA", detail: "Green" },
  forest: { value: "forest", label: "Forest" },
  teal: { value: "teal", label: "Teal" },
  lime: { value: "lime", label: "Lime" },
  custom: { value: "custom", label: "Custom", detail: "Choose a hex color" },
} satisfies ChoiceSet<PersonalAppearance["accent"]>;
const densityChoices = {
  comfortable: { value: "comfortable", label: "Comfortable", detail: "More breathing room" },
  compact: { value: "compact", label: "Compact", detail: "More on screen" },
} satisfies ChoiceSet<PersonalAppearance["density"]>;
const typeScaleChoices = {
  default: { value: "default", label: "Default" },
  large: { value: "large", label: "Large", detail: "Larger interface text" },
} satisfies ChoiceSet<PersonalAppearance["typeScale"]>;
const fontChoices = {
  system: {
    value: "system",
    ...TYPEFACE_PREFERENCE_PRESENTATION.system,
    disabled: !TYPEFACE_PREFERENCE_PRESENTATION.system.available,
  },
  geist: {
    value: "geist",
    ...TYPEFACE_PREFERENCE_PRESENTATION.geist,
    disabled: !TYPEFACE_PREFERENCE_PRESENTATION.geist.available,
  },
  inter: {
    value: "inter",
    ...TYPEFACE_PREFERENCE_PRESENTATION.inter,
    disabled: !TYPEFACE_PREFERENCE_PRESENTATION.inter.available,
  },
} satisfies ChoiceSet<PersonalAppearance["font"]>;
const contrastChoices = {
  system: { value: "system", label: "Standard", detail: "Theme defaults" },
  high: { value: "high", label: "Higher contrast", detail: "Stronger text and borders" },
} satisfies ChoiceSet<PersonalAppearance["contrast"]>;
const motionChoices = {
  system: { value: "system", ...MOTION_PREFERENCE_PRESENTATION.system },
  reduced: { value: "reduced", ...MOTION_PREFERENCE_PRESENTATION.reduced },
  off: { value: "off", ...MOTION_PREFERENCE_PRESENTATION.off },
} satisfies ChoiceSet<PersonalAppearance["motion"]>;
const surfaceChoices = {
  standard: { value: "standard", label: "Standard" },
  soft: { value: "soft", label: "Soft", detail: "Quieter surface contrast" },
} satisfies ChoiceSet<PersonalAppearance["surface"]>;
const widthChoices = {
  comfortable: { value: "comfortable", label: "Comfortable", detail: "Focused reading width" },
  wide: { value: "wide", label: "Wide", detail: "Use more workspace" },
} satisfies ChoiceSet<PersonalAppearance["contentWidth"]>;

interface ChoiceGroupProps<T extends string> {
  id: string;
  legend: string;
  choices: Choice<T>[];
  value: T;
  disabled: boolean;
  describedBy?: string;
  columns?: "auto" | "three";
  swatch?: (value: T) => string | undefined;
  onChange: (value: T) => void;
}

function ChoiceGroup<T extends string>({
  id,
  legend,
  choices,
  value,
  disabled,
  describedBy,
  columns = "auto",
  swatch,
  onChange,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className={styles.choiceFieldset} disabled={disabled}>
      <legend className={styles.groupLegend}>{legend}</legend>
      <div className={styles.choices} data-columns={columns}>
        {choices.map((choice) => {
          const inputId = `${id}-${choice.value}`;
          const color = swatch?.(choice.value);
          return (
            <label className={styles.choice} data-disabled={choice.disabled || undefined} key={choice.value} htmlFor={inputId}>
              <input
                className={styles.choiceInput}
                id={inputId}
                type="radio"
                name={id}
                value={choice.value}
                disabled={choice.disabled}
                aria-describedby={describedBy}
                checked={choice.value === value}
                onChange={() => onChange(choice.value)}
              />
              <span className={styles.choiceCard} data-selected={choice.value === value || undefined}>
                {color ? <span className={styles.swatch} style={{ "--swatch-color": color } as CSSProperties} aria-hidden="true" /> : null}
                <span className={styles.choiceCopy}>
                  <span className={styles.choiceLabel}>{choice.label}</span>
                  {choice.detail ? <span className={styles.choiceDetail}>{choice.detail}</span> : null}
                </span>
                <span className={styles.radioMark} aria-hidden="true" />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AppearanceEditor({
  appearance,
  readStatus,
  writable,
  saveStatus,
  revision,
  error,
  conflict,
  onChange,
  onReset,
  onRetry,
  onReload,
  onResolveConflict,
}: AppearanceEditorProps) {
  const id = useId();
  const [customAccentDraft, setCustomAccentDraft] = useState(appearance.customAccent);
  const canEdit = canEditPersonalPreferenceDraft(readStatus, writable, saveStatus === "saving", Boolean(conflict));
  const disabled = !canEdit;
  const statusMessage = readStatus === "read-failed"
    ? "Saved appearance preferences could not be loaded."
    : readStatus === "unsupported"
      ? "Appearance settings are unavailable for this server version."
      : readStatus === "access-lost"
        ? "Personal settings access needs to be restored."
        : getAppearanceStatusMessage(saveStatus, writable);

  useEffect(() => setCustomAccentDraft(appearance.customAccent), [appearance.customAccent]);

  const update = <K extends keyof PersonalAppearance>(key: K, value: PersonalAppearance[K]) => {
    onChange({ ...appearance, [key]: value });
  };

  return (
    <section className={styles.editor} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PERSONAL SETTINGS</p>
          <h2 className={styles.title} id={`${id}-title`}>Appearance</h2>
          <p className={styles.intro}>Make NOVA feel right for your workspace. These choices apply to your account only.</p>
        </div>
        <Button variant="secondary" onClick={onReset} disabled={disabled}>Reset appearance</Button>
      </header>

      <div className={styles.statusRow}>
        <span className={styles.statusDot} data-state={readStatus === "read-failed" || readStatus === "unsupported" || readStatus === "access-lost" ? "error" : saveStatus} aria-hidden="true" />
        <span role="status" aria-live="polite" aria-atomic="true">
          {conflict ? "Appearance changed elsewhere." : statusMessage}
        </span>
        {revision !== null ? <span className={styles.revision}>Revision {revision}</span> : null}
        {readStatus === "read-failed" || readStatus === "access-lost"
          ? <Button variant="quiet" size="compact" onClick={onReload}>Reload saved settings</Button>
          : saveStatus === "error" && writable
            ? <Button variant="quiet" size="compact" onClick={onRetry}>Try again</Button>
            : null}
      </div>
      {readStatus === "read-failed" ? (
        <p className={styles.error} role="alert">You can preview changes in this browser session, but they will not be saved until the preferences load successfully. Reloading replaces this preview with the saved settings.</p>
      ) : null}
      {readStatus === "unsupported" ? <p className={styles.readOnlyNote}>Saved appearance settings are not supported by the current preference schema. Ask your NOVA administrator to apply the available database update.</p> : null}
      {readStatus === "access-lost" ? <p className={styles.readOnlyNote}>Your session cannot currently read personal appearance settings. Reload them after your access is restored.</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {conflict ? (
        <section className={styles.conflict} aria-labelledby={`${id}-conflict-title`}>
          <div>
            <h3 id={`${id}-conflict-title`}>Appearance changed elsewhere</h3>
            <p>Your edit used revision {conflict.submittedRevision}; the saved version is now revision {conflict.currentRevision}. Choose which version to keep.</p>
          </div>
          <div className={styles.conflictActions}>
            <Button variant="secondary" onClick={() => onResolveConflict("reload")}>Load saved version</Button>
            <Button onClick={() => onResolveConflict("overwrite")} disabled={!writable}>Keep my changes</Button>
          </div>
        </section>
      ) : null}

      <div className={styles.layout}>
        <section className={styles.group} aria-labelledby={`${id}-theme-title`}>
          <h3 className={styles.groupTitle} id={`${id}-theme-title`}>Color and theme</h3>
          <ChoiceGroup
            id={`${id}-theme`}
            legend="Theme"
            choices={Object.values(themeChoices)}
            value={appearance.theme}
            disabled={disabled}
            columns="three"
            onChange={(value) => update("theme", value)}
          />
          <ChoiceGroup
            id={`${id}-accent`}
            legend="Accent color"
            choices={Object.values(accentChoices)}
            value={appearance.accent}
            disabled={disabled}
            swatch={(value) => value === "custom" ? appearance.customAccent : ACCENT_SWATCHES[value]}
            onChange={(value) => update("accent", value)}
          />
          {appearance.accent === "custom" ? (
            <div className={styles.customAccent}>
              <label className={styles.fieldLabel} htmlFor={`${id}-custom-accent`}>Custom accent hex</label>
              <div className={styles.hexField}>
                <span className={styles.hexSwatch} style={{ "--swatch-color": isAppearanceHexColor(customAccentDraft) ? customAccentDraft : "transparent" } as CSSProperties} aria-hidden="true" />
                <input
                  id={`${id}-custom-accent`}
                  className={styles.textInput}
                  type="text"
                  value={customAccentDraft}
                  maxLength={7}
                  pattern="#[\da-fA-F]{6}"
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={disabled}
                  aria-required="true"
                  aria-invalid={!isAppearanceHexColor(customAccentDraft)}
                  aria-describedby={`${id}-accent-help ${id}-accent-error`}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setCustomAccentDraft(next);
                    if (isAppearanceHexColor(next)) update("customAccent", next.toLowerCase());
                  }}
                  onBlur={() => {
                    if (!isAppearanceHexColor(customAccentDraft)) setCustomAccentDraft(appearance.customAccent);
                  }}
                />
              </div>
              <p className={styles.fieldHint} id={`${id}-accent-help`}>Use a six-digit hex color. NOVA pairs it with readable black or white text.</p>
              <p className={styles.fieldError} id={`${id}-accent-error`} role="status" aria-live="polite" aria-atomic="true">
                {!isAppearanceHexColor(customAccentDraft) ? "Enter a color like #176a43." : ""}
              </p>
            </div>
          ) : null}
          <div className={styles.preview}>
            <div className={styles.previewCopy}>
              <span className={styles.previewOverline}>LIVE PREVIEW</span>
              <strong>Ready for your day</strong>
              <span>Preview the selected accent with a readable text pairing.</span>
            </div>
            <button className={styles.previewAction} type="button" tabIndex={-1} aria-hidden="true">Continue</button>
          </div>
        </section>

        <section className={styles.group} aria-labelledby={`${id}-type-title`}>
          <h3 className={styles.groupTitle} id={`${id}-type-title`}>Typography</h3>
          <ChoiceGroup id={`${id}-scale`} legend="Text size" choices={Object.values(typeScaleChoices)} value={appearance.typeScale} disabled={disabled} onChange={(value) => update("typeScale", value)} />
          <ChoiceGroup id={`${id}-font`} legend="Typeface" choices={Object.values(fontChoices)} value={appearance.font} disabled={disabled} describedBy={`${id}-font-availability`} onChange={(value) => update("font", value)} />
          <p className={styles.fieldHint} id={`${id}-font-availability`} role="status">
            {getTypefaceAvailabilityMessage(appearance.font) ?? "System is available and uses the device sans-serif."}
          </p>
        </section>

        <section className={styles.group} aria-labelledby={`${id}-layout-title`}>
          <h3 className={styles.groupTitle} id={`${id}-layout-title`}>Workspace layout</h3>
          <ChoiceGroup id={`${id}-density`} legend="Density" choices={Object.values(densityChoices)} value={appearance.density} disabled={disabled} onChange={(value) => update("density", value)} />
          <ChoiceGroup id={`${id}-surface`} legend="Surface style" choices={Object.values(surfaceChoices)} value={appearance.surface} disabled={disabled} onChange={(value) => update("surface", value)} />
          <ChoiceGroup id={`${id}-width`} legend="Content width" choices={Object.values(widthChoices)} value={appearance.contentWidth} disabled={disabled} onChange={(value) => update("contentWidth", value)} />
        </section>

        <section className={styles.group} aria-labelledby={`${id}-accessibility-title`}>
          <h3 className={styles.groupTitle} id={`${id}-accessibility-title`}>Accessibility and motion</h3>
          <ChoiceGroup id={`${id}-contrast`} legend="Contrast" choices={Object.values(contrastChoices)} value={appearance.contrast} disabled={disabled} onChange={(value) => update("contrast", value)} />
          <ChoiceGroup id={`${id}-motion`} legend="Motion" choices={Object.values(motionChoices)} value={appearance.motion} disabled={disabled} onChange={(value) => update("motion", value)} />
        </section>
      </div>
    </section>
  );
}
