import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import styles from "./ResponsiveDisclosure.module.css";

export interface ResponsiveDisclosureProps {
  label: string;
  compact: boolean;
  activeCount?: number;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}

const useResponsiveLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const disclosureControlSelector =
  "a[href], button:not(:disabled), input:not(:disabled):not([type='hidden']), " +
  "select:not(:disabled), textarea:not(:disabled), [contenteditable='true'], " +
  "[tabindex]:not([tabindex='-1'])";

const disclosureStatusSelector = "[role='alert'], [role='status'], h1, h2, h3, h4, h5, h6";

function focusDisclosureContent(element: HTMLDetailsElement): void {
  const panel = element.querySelector<HTMLElement>("." + styles.panel);
  const firstControl = panel?.querySelector<HTMLElement>(disclosureControlSelector);
  if (firstControl) {
    firstControl.focus({ preventScroll: true });
    return;
  }

  const statusOrHeading = panel?.querySelector<HTMLElement>(disclosureStatusSelector);
  if (!statusOrHeading) return;

  const hadTabIndex = statusOrHeading.hasAttribute("tabindex");
  if (!hadTabIndex) statusOrHeading.tabIndex = -1;
  statusOrHeading.focus({ preventScroll: true });
  if (!hadTabIndex) {
    statusOrHeading.addEventListener("blur", () => statusOrHeading.removeAttribute("tabindex"), { once: true });
  }
}

/** A native disclosure on compact screens; its same content stays inline when expanded. */
export function ResponsiveDisclosure({
  label,
  compact,
  activeCount = 0,
  className,
  panelClassName,
  children,
}: ResponsiveDisclosureProps) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const previousCompact = useRef(compact);
  const [compactOpen, setCompactOpen] = useState(false);

  useResponsiveLayoutEffect(() => {
    const element = disclosure.current;
    if (!element || previousCompact.current === compact) return;
    previousCompact.current = compact;

    const summary = element.querySelector("summary");
    const activeElement = document.activeElement;
    if (compact) {
      setCompactOpen(activeElement !== summary && activeElement instanceof Node && element.contains(activeElement));
      return;
    }

    setCompactOpen(true);
    if (activeElement === summary) {
      focusDisclosureContent(element);
    }
  }, [compact]);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (compact) setCompactOpen(event.currentTarget.open);
  };
  const classes = [styles.disclosure, className].filter(Boolean).join(" ");
  const panelClasses = [styles.panel, panelClassName].filter(Boolean).join(" ");

  return (
    <details
      ref={disclosure}
      className={classes}
      aria-label={label}
      open={!compact || compactOpen}
      onToggle={handleToggle}
    >
      <summary className={styles.summary}>
        <span>{label}</span>
        {activeCount > 0 ? <span className={styles.count}>{activeCount} active</span> : null}
      </summary>
      <div className={panelClasses}>{children}</div>
    </details>
  );
}
