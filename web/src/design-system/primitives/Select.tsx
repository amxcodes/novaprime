import { forwardRef, type ReactNode } from "react";
import {
  Button as AriaButton,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
  Text,
} from "react-aria-components";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  id?: string;
  name?: string;
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  value?: string | null;
  defaultValue?: string | null;
  placeholder?: string;
  options: readonly SelectOption[];
  onChange?: (value: string) => void;
}

/** A tokenized, accessible select whose popup is rendered by React Aria. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    id,
    name,
    label,
    hint,
    error,
    fieldClassName,
    className,
    required = false,
    disabled = false,
    value,
    defaultValue,
    placeholder = "Choose an option",
    options,
    onChange,
  },
  ref,
) {
  return (
    <AriaSelect
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={(key) => { if (key !== null) onChange?.(String(key)); }}
      isRequired={required}
      isDisabled={disabled}
      isInvalid={Boolean(error)}
      className={[styles.select, fieldClassName].filter(Boolean).join(" ")}
    >
      <Label className={styles.label}>
        <span>{label}</span>
        {required ? (
          <>
            <span className={styles.required} aria-hidden="true">*</span>
            <span className={styles.srOnly}>Required</span>
          </>
        ) : null}
      </Label>

      <AriaButton ref={ref} type="button" className={[styles.trigger, className].filter(Boolean).join(" ")}>
        <SelectValue className={styles.value}>
          {({ isPlaceholder, selectedText }) => (
            <span className={isPlaceholder ? styles.placeholder : undefined}>
              {selectedText || placeholder}
            </span>
          )}
        </SelectValue>
        <span className={styles.chevron} aria-hidden="true" />
      </AriaButton>

      {hint ? <Text slot="description" className={styles.description}>{hint}</Text> : null}
      {error ? <FieldError className={styles.error}>{error}</FieldError> : null}

      <Popover className={styles.popover} placement="bottom start" offset={4}>
        <ListBox aria-label={label} className={styles.listBox}>
          {options.map((option) => (
            <ListBoxItem
              key={option.value}
              id={option.value}
              textValue={option.label}
              isDisabled={option.disabled}
              className={styles.option}
            >
              <span className={styles.optionCopy}>
                <span className={styles.optionLabel}>{option.label}</span>
                {option.description ? <span className={styles.optionDetail}>{option.description}</span> : null}
              </span>
              <span className={styles.check} aria-hidden="true">✓</span>
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
});
