import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./Field.module.css";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  required?: boolean;
}

export interface FieldProps {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (controlProps: FieldControlProps) => ReactNode;
  className?: string;
}

/**
 * Labeled field wrapper that wires its hint and error to the single control.
 * Example: <Field label="Search">{(control) => <Input {...control} />}</Field>
 */
export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  children,
  className,
}: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const controlProps: FieldControlProps = {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    required: required || undefined,
  };

  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label className={styles.label} htmlFor={controlId}>
        <span>{label}</span>
        {required ? <span className={styles.required} aria-hidden="true">*</span> : null}
      </label>
      {children(controlProps)}
      {hint ? <div className={styles.hint} id={hintId}>{hint}</div> : null}
      {error ? <div className={styles.error} id={errorId}>{error}</div> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...inputProps },
  ref,
) {
  return (
    <input
      {...inputProps}
      ref={ref}
      className={[styles.control, className].filter(Boolean).join(" ")}
    />
  );
});
