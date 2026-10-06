import type { StatusTone } from "../../design-system";

const knownStatuses: Record<string, { label: string; tone: StatusTone }> = {
  assigned: { label: "Assigned", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  submitted: { label: "Submitted", tone: "warning" },
  awaiting_review: { label: "Awaiting review", tone: "warning" },
  changes_requested: { label: "Changes requested", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  canceled: { label: "Canceled", tone: "neutral" },
};

export function getAssignmentStatus(status: string): { label: string; tone: StatusTone } {
  return knownStatuses[status] ?? {
    label: status.replaceAll("_", " ").trim() || "Status unavailable",
    tone: "neutral",
  };
}

/** Format a date-only API value without shifting it across the viewer's time zone. */
export function formatAssignmentDueDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
