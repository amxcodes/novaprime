import { useState, type FormEvent } from "react";
import {
  Button,
  FieldError,
  Form,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  Text,
} from "react-aria-components";
import "../../design-system/foundations/index.css";
import styles from "./SelectPoc.module.css";

const workspaces = [
  { id: "client-work", label: "Client delivery", detail: "Projects and client records" },
  { id: "operations", label: "Operations", detail: "Attendance and daily activity" },
  { id: "people", label: "People directory", detail: "Profiles and team membership" },
  { id: "availability", label: "Availability", detail: "Leave and schedule context" },
  { id: "my-work", label: "My assignments", detail: "Work assigned to you" },
  { id: "finance", label: "Finance analytics", detail: "Requires analytics access", disabled: true },
  { id: "workspace-settings", label: "Workspace settings", detail: "Preferences and configuration" },
] as const;

export default function SelectPoc() {
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>("operations");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [formStatus, setFormStatus] = useState("Choose an option and submit to inspect the form value.");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedValue = new FormData(event.currentTarget).get("workspace");

    if (typeof submittedValue !== "string" || submittedValue.length === 0) {
      setValidationErrors({ workspace: "Choose a workspace before continuing." });
      setFormStatus("A workspace is required.");
      return;
    }

    setValidationErrors({});
    setFormStatus(`Submitted form value: ${submittedValue}`);
  }

  function resetSelection() {
    setSelectedWorkspace(null);
    setValidationErrors({});
    setFormStatus("Selection cleared. Submit to see the required-field error.");
  }

  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <span className={styles.eyebrow}>Design system experiment</span>
            <h1>Accessible select</h1>
            <p>One React Aria control styled with NOVA tokens. Nothing here is connected to product data.</p>
          </div>
          <Button
            type="button"
            className={styles.themeButton}
            aria-pressed={theme === "dark"}
            onPress={() => {
              const nextTheme = theme === "light" ? "dark" : "light";
              setTheme(nextTheme);
              document.documentElement.dataset.theme = nextTheme;
            }}
          >
            {theme === "light" ? "Dark appearance" : "Light appearance"}
          </Button>
        </header>

        <div className={styles.columns}>
          <section className={styles.panel} aria-labelledby="workspace-heading">
            <div className={styles.panelHeading}>
              <div>
                <h2 id="workspace-heading">Workspace preference</h2>
                <p>Required value with an unavailable option and a visible validation path.</p>
              </div>
            </div>

            <Form
              className={styles.form}
              validationBehavior="aria"
              validationErrors={validationErrors}
              onSubmit={submit}
            >
              <Select
                className={styles.field}
                name="workspace"
                value={selectedWorkspace}
                onChange={(key) => {
                  setSelectedWorkspace(key == null ? null : String(key));
                  setValidationErrors({});
                  setFormStatus("Selection changed. Submit to inspect the form value.");
                }}
                isRequired
              >
                <Label className={styles.label}>
                  Default workspace <span className={styles.requiredText}>Required</span>
                </Label>
                <Button type="button" className={styles.trigger}>
                  <SelectValue className={styles.value}>
                    {({ isPlaceholder, selectedText }) => (
                      <span className={isPlaceholder ? styles.placeholder : undefined}>
                        {selectedText || "Choose a workspace"}
                      </span>
                    )}
                  </SelectValue>
                  <span className={styles.chevron} aria-hidden="true" />
                </Button>
                <Text slot="description" className={styles.description}>
                  Used when you return to NOVA. Change it at any time.
                </Text>
                <FieldError className={styles.error} />
                <Popover className={styles.popover} placement="bottom start" offset={4}>
                  <ListBox aria-label="Workspaces" className={styles.listBox}>
                    {workspaces.map((workspace) => (
                      <ListBoxItem
                        key={workspace.id}
                        id={workspace.id}
                        textValue={workspace.label}
                        isDisabled={"disabled" in workspace && workspace.disabled}
                        className={styles.option}
                      >
                        <span className={styles.optionCopy}>
                          <span className={styles.optionLabel}>{workspace.label}</span>
                          <span className={styles.optionDetail}>{workspace.detail}</span>
                        </span>
                        <span className={styles.check} aria-hidden="true">✓</span>
                      </ListBoxItem>
                    ))}
                  </ListBox>
                </Popover>
              </Select>

              <div className={styles.actions}>
                <Button type="submit" className={styles.primaryButton}>Submit selection</Button>
                <Button type="button" className={styles.secondaryButton} onPress={resetSelection}>
                  Clear selection
                </Button>
              </div>
            </Form>

            <p className={styles.status} role="status" aria-live="polite">{formStatus}</p>
          </section>

          <aside className={styles.sideColumn} aria-label="Select behavior examples">
            <section className={styles.panel} aria-labelledby="disabled-heading">
              <h2 id="disabled-heading">Disabled control</h2>
              <p>Represents a preference controlled by workspace policy.</p>
              <Select className={styles.field} defaultValue="operations" isDisabled>
                <Label className={styles.label}>Managed workspace</Label>
                <Button type="button" className={styles.trigger}>
                  <SelectValue className={styles.value} />
                  <span className={styles.chevron} aria-hidden="true" />
                </Button>
                <Text slot="description" className={styles.description}>
                  Only an administrator can change this value.
                </Text>
                <Popover className={styles.popover}>
                  <ListBox aria-label="Managed workspace options" className={styles.listBox}>
                    {workspaces.map((workspace) => (
                      <ListBoxItem key={workspace.id} id={workspace.id} textValue={workspace.label}>
                        {workspace.label}
                      </ListBoxItem>
                    ))}
                  </ListBox>
                </Popover>
              </Select>
            </section>

            <section className={styles.panel} aria-labelledby="keyboard-heading">
              <h2 id="keyboard-heading">Keyboard path</h2>
              <dl className={styles.keyGuide}>
                <div><dt>Open</dt><dd>Space, Enter, or Arrow Down</dd></div>
                <div><dt>Move</dt><dd>Arrow keys or type to jump</dd></div>
                <div><dt>Choose</dt><dd>Enter or Space</dd></div>
                <div><dt>Close</dt><dd>Escape returns focus</dd></div>
              </dl>
              <p className={styles.caption}>Keyboard behavior is provided by React Aria and must still be checked with real desktop and mobile assistive technology.</p>
            </section>
          </aside>
        </div>

        <footer className={styles.footer}>
          <span>Local preview only</span>
          <span>Not a production Select or an accessibility sign-off</span>
        </footer>
      </div>
    </main>
  );
}
