import { useEffect, useState, type CSSProperties } from "react";
import { DEFAULT_APPEARANCE } from "../../../ui-preferences.js";
import type { UiAppearance } from "../../../ui-preferences.js";
import { isAppearanceHexColor } from "../../features/personalization/appearance-presentation";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Loading,
  SearchableSelect,
  Select,
  StateMessage,
  Status,
  Surface,
  applyAppearanceTokens,
  type PersonalAppearance,
} from "../../design-system";
import styles from "./UiWorkbench.module.css";

const appearanceOptions = {
  theme: [
    { value: "system", label: "System", description: "Follow the device appearance." },
    { value: "light", label: "Light", description: "White and green." },
    { value: "dark", label: "Dark", description: "Black and green." },
  ],
  accent: [
    { value: "nova", label: "NOVA green" },
    { value: "forest", label: "Forest" },
    { value: "teal", label: "Teal" },
    { value: "lime", label: "Lime" },
    { value: "custom", label: "Custom" },
  ],
  density: [
    { value: "comfortable", label: "Comfortable" },
    { value: "compact", label: "Compact" },
  ],
  typeScale: [
    { value: "default", label: "Default" },
    { value: "large", label: "Large" },
  ],
  font: [
    { value: "geist", label: "Geist", description: "Bundled NOVA typeface." },
    { value: "system", label: "System", description: "Device sans-serif." },
  ],
  contrast: [
    { value: "system", label: "Standard" },
    { value: "high", label: "Higher contrast" },
  ],
  motion: [
    { value: "system", label: "System" },
    { value: "reduced", label: "Reduced" },
    { value: "off", label: "Off" },
  ],
  surface: [
    { value: "standard", label: "Standard" },
    { value: "soft", label: "Soft" },
  ],
  contentWidth: [
    { value: "comfortable", label: "Comfortable" },
    { value: "wide", label: "Wide" },
  ],
} as const;

const initialAppearance: PersonalAppearance = {
  ...DEFAULT_APPEARANCE,
  theme: "light",
};

const appearanceAttributes = [
  "data-theme",
  "data-accent",
  "data-density",
  "data-type-scale",
  "data-font",
  "data-contrast",
  "data-motion",
  "data-surface",
  "data-content-width",
] as const;

const appearanceProperties = [
  "--nova-user-accent-light",
  "--nova-user-accent-dark",
  "--nova-user-accent-contrast-light",
  "--nova-user-accent-contrast-dark",
  "--nova-user-accent-hover-light",
  "--nova-user-accent-hover-dark",
  "--nova-user-accent-text-light",
  "--nova-user-accent-text-light-hover",
  "--nova-user-accent-text-dark",
  "--nova-user-accent-text-dark-hover",
] as const;

const attendanceOptions = [
  { value: "office", label: "Office", description: "Record attendance at an office." },
  { value: "remote", label: "Remote", description: "Record attendance away from an office." },
  { value: "leave", label: "Leave", disabled: true, description: "Managed by the leave workflow." },
] as const;

const peopleOptions = [
  { value: "aman", label: "Aman Kumar", description: "Product design" },
  { value: "maya", label: "Maya Shah", description: "People operations" },
  { value: "leo", label: "Leo Martin", description: "Engineering" },
] as const;

export function UiWorkbench() {
  const [appearance, setAppearance] = useState<PersonalAppearance>(initialAppearance);
  const [customAccentDraft, setCustomAccentDraft] = useState(appearance.customAccent);
  const [attendanceMode, setAttendanceMode] = useState("office");
  const [selectedPerson, setSelectedPerson] = useState("aman");

  useEffect(() => {
    const root = document.documentElement;
    const previousAttributes = appearanceAttributes.map((name) => [name, root.getAttribute(name)] as const);
    const previousProperties = appearanceProperties.map((name) => [
      name,
      root.style.getPropertyValue(name),
      root.style.getPropertyPriority(name),
    ] as const);

    return () => {
      for (const [name, value] of previousAttributes) {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
      for (const [name, value, priority] of previousProperties) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
    };
  }, []);

  useEffect(() => {
    applyAppearanceTokens(appearance);
  }, [appearance]);

  useEffect(() => setCustomAccentDraft(appearance.customAccent), [appearance.customAccent]);

  const updateAppearance = <Key extends keyof UiAppearance>(key: Key, value: UiAppearance[Key]) => {
    setAppearance((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>NOVA · development only</p>
            <h1>Design system workbench</h1>
            <p>Inspect shared controls across NOVA’s supported appearance settings. This page uses local examples only.</p>
          </div>
          <p className={styles.themeStatus} role="status">{appearance.theme} theme · {appearance.density} · {appearance.typeScale} text</p>
        </header>

        <Surface as="section" level="raised" className={styles.appearanceSection} aria-labelledby="appearance-heading">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="appearance-heading">Appearance preview</h2>
              <p>These controls change this development preview only. They are not saved.</p>
            </div>
            <Button variant="quiet" size="compact" onClick={() => setAppearance(initialAppearance)}>Reset preview</Button>
          </div>
          <div className={styles.appearanceGrid}>
            <Select label="Theme" value={appearance.theme} options={appearanceOptions.theme} onChange={(value) => updateAppearance("theme", value as UiAppearance["theme"])} />
            <Select label="Accent color" value={appearance.accent} options={appearanceOptions.accent} onChange={(value) => updateAppearance("accent", value as UiAppearance["accent"])} />
            {appearance.accent === "custom" ? (
              <Field
                id="workbench-custom-accent"
                label="Custom accent hex"
                hint="Use a six-digit hex color. NOVA pairs it with readable black or white text."
                error={!isAppearanceHexColor(customAccentDraft)
                  ? <span role="status" aria-live="polite" aria-atomic="true">Enter a color like #176a43.</span>
                  : undefined}
              >
                {(control) => (
                  <div className={styles.accentFieldRow}>
                    <span
                      className={styles.accentSwatch}
                      style={{ "--swatch-color": isAppearanceHexColor(customAccentDraft) ? customAccentDraft : "transparent" } as CSSProperties}
                      aria-hidden="true"
                    />
                    <Input
                      {...control}
                      type="text"
                      value={customAccentDraft}
                      maxLength={7}
                      pattern="#[\da-fA-F]{6}"
                      autoCapitalize="off"
                      autoComplete="off"
                      spellCheck={false}
                      className={styles.accentHexInput}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        setCustomAccentDraft(next);
                        if (isAppearanceHexColor(next)) updateAppearance("customAccent", next.toLowerCase());
                      }}
                      onBlur={() => {
                        if (!isAppearanceHexColor(customAccentDraft)) setCustomAccentDraft(appearance.customAccent);
                      }}
                    />
                  </div>
                )}
              </Field>
            ) : null}
            <Select label="Density" value={appearance.density} options={appearanceOptions.density} onChange={(value) => updateAppearance("density", value as UiAppearance["density"])} />
            <Select label="Text size" value={appearance.typeScale} options={appearanceOptions.typeScale} onChange={(value) => updateAppearance("typeScale", value as UiAppearance["typeScale"])} />
            <Select label="Typeface" value={appearance.font} options={appearanceOptions.font} onChange={(value) => updateAppearance("font", value as UiAppearance["font"])} />
            <Select label="Contrast" value={appearance.contrast} options={appearanceOptions.contrast} onChange={(value) => updateAppearance("contrast", value as UiAppearance["contrast"])} />
            <Select label="Motion" value={appearance.motion} options={appearanceOptions.motion} onChange={(value) => updateAppearance("motion", value as UiAppearance["motion"])} />
            <Select label="Surface style" value={appearance.surface} options={appearanceOptions.surface} onChange={(value) => updateAppearance("surface", value as UiAppearance["surface"])} />
            <Select label="Content width" value={appearance.contentWidth} options={appearanceOptions.contentWidth} onChange={(value) => updateAppearance("contentWidth", value as UiAppearance["contentWidth"])} />
          </div>
        </Surface>

        <div className={styles.layout}>
          <div className={styles.column}>
            <Surface as="section" level="raised" className={styles.section} aria-labelledby="controls-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="controls-heading">Buttons and fields</h2>
                  <p>Common action hierarchy, form labeling, and validation.</p>
                </div>
                <Status tone="info">Shared controls</Status>
              </div>

              <div className={styles.subsection}>
                <h3>Button states</h3>
                <div className={styles.buttonRow}>
                  <Button>Save changes</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="quiet">Quiet action</Button>
                  <Button variant="danger">Remove item</Button>
                  <Button size="compact" variant="secondary">Compact</Button>
                  <Button disabled variant="secondary">Unavailable</Button>
                  <Button loading loadingLabel="Saving changes">Save changes</Button>
                </div>
              </div>

              <div className={styles.fieldGrid}>
                <Field id="workbench-email" label="Work email" hint="A short helper message sits beside the control.">
                  {(control) => <Input {...control} type="email" defaultValue="aman@example.test" autoComplete="email" />}
                </Field>
                <Field id="workbench-locked" label="Managed setting" hint="This value is read-only in this example.">
                  {(control) => <Input {...control} defaultValue="Managed by your organization" disabled />}
                </Field>
                <Field id="workbench-reason" label="Request reason" error="Add a short reason before continuing." required>
                  {(control) => <Input {...control} placeholder="Describe the request" />}
                </Field>
              </div>
            </Surface>

            <Surface as="section" level="raised" className={styles.section} aria-labelledby="selection-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="selection-heading">Choice controls</h2>
                  <p>Finite and searchable selection using the shared popup patterns.</p>
                </div>
              </div>
              <div className={styles.fieldGrid}>
                <Select
                  name="attendanceMode"
                  label="Attendance mode"
                  hint="Choose a mode to preview the selected state."
                  required
                  value={attendanceMode}
                  options={attendanceOptions}
                  onChange={setAttendanceMode}
                />
                <Select
                  label="Managed option"
                  disabled
                  value="office"
                  options={attendanceOptions}
                  onChange={() => {}}
                />
                <SearchableSelect
                  name="person"
                  label="Find a person"
                  hint="Type a name, then use the arrow keys to choose."
                  value={selectedPerson}
                  options={peopleOptions}
                  placeholder="Search people"
                  emptyMessage="No people match this search."
                  onChange={setSelectedPerson}
                />
              </div>
            </Surface>

            <Surface as="section" level="raised" className={styles.section} aria-labelledby="surfaces-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="surfaces-heading">Surfaces and status</h2>
                  <p>Surface levels and named status tones keep meaning visible without color alone.</p>
                </div>
              </div>
              <div className={styles.surfaceGrid}>
                <Surface level="plain" className={styles.surfaceSample}>Plain surface</Surface>
                <Surface level="subtle" className={styles.surfaceSample}>Subtle surface</Surface>
                <Surface level="raised" className={styles.surfaceSample}>Raised surface</Surface>
              </div>
              <div className={styles.statusRow} aria-label="Status badge examples">
                <Badge tone="neutral">Not started</Badge>
                <Status tone="success">Complete</Status>
                <Status tone="warning">Needs review</Status>
                <Status tone="danger">Unavailable</Status>
                <Status tone="info">In progress</Status>
              </div>
            </Surface>
          </div>

          <div className={styles.column}>
            <Surface as="section" level="raised" className={styles.section} aria-labelledby="feedback-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="feedback-heading">Feedback states</h2>
                  <p>Independent messages for loading, success, and failure.</p>
                </div>
              </div>
              <div className={styles.messageList}>
                <Loading title="Loading report" label="Your recent activity is being prepared." />
                <StateMessage kind="success" title="Changes saved">Your preference is up to date.</StateMessage>
                <StateMessage kind="error" title="Could not load the report">Check your connection and try again.</StateMessage>
              </div>
              <EmptyState
                title="Nothing needs your attention"
                description="When there is new activity for you, it will appear in this space."
                action={<Button variant="secondary">Review activity</Button>}
              />
            </Surface>

            <Surface as="section" level="subtle" className={styles.note} aria-labelledby="scope-heading">
              <h2 id="scope-heading">Workbench scope</h2>
              <p>This isolated development page demonstrates existing design-system components. It does not connect to product data or alter user settings.</p>
            </Surface>
          </div>
        </div>
      </div>
    </main>
  );
}
