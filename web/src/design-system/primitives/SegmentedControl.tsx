import type { HTMLAttributes } from "react";
import styles from "./SegmentedControl.module.css";

export interface SegmentedControlOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "role" | "aria-label"> {
  "aria-label": string;
  appearance?: "action" | "quiet";
  options: ReadonlyArray<SegmentedControlOption>;
  value: string;
  onValueChange: (value: string) => void;
}

/** A compact, theme-aware choice group matching Orbit's selected-segment control. */
export function SegmentedControl({
  appearance = "action",
  options,
  value,
  onValueChange,
  "aria-label": accessibleName,
  className,
  ...groupProps
}: SegmentedControlProps) {
  return (
    <div
      {...groupProps}
      role="group"
      aria-label={accessibleName}
      data-appearance={appearance}
      className={[styles.group, className].filter(Boolean).join(" ")}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            className={styles.option}
            type="button"
            aria-pressed={selected}
            data-selected={selected || undefined}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
          >
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
