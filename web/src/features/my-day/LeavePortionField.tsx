import { Select } from "../../design-system/primitives/Select";

const portionOptions = [
  { value: "1", label: "Full day" },
  { value: "0.5", label: "Half day" },
] as const;

/** Preserve the existing leave form name and payload values. */
export function LeavePortionField() {
  return (
    <Select
      name="portion"
      label="Portion"
      defaultValue="1"
      options={portionOptions}
    />
  );
}
