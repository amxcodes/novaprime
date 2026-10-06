import type {
  OperationsAvailability,
  OperationsSources,
} from "./contracts";

export const OPERATIONS_AVAILABILITY_EXPORT_HEADERS = Object.freeze([
  "Type",
  "Date",
  "Name",
  "Office",
  "Effective date",
  "Start local time",
  "End local time",
  "Rules",
] as const);

export type OperationsAvailabilityExportRow = [
  type: "shift" | "calendar" | "holiday",
  date: string,
  name: string,
  office: string,
  effectiveDate: string,
  startLocalTime: string,
  endLocalTime: string,
  rules: string,
];

/** Build export rows only from the source families granted by the host. */
export function buildAvailabilityExportRows(
  availability: OperationsAvailability,
  sources: Partial<OperationsSources> | null | undefined,
): OperationsAvailabilityExportRow[] {
  const rows: OperationsAvailabilityExportRow[] = [];

  if (sources?.shifts === true) {
    for (const shift of availability.shifts) {
      rows.push([
        "shift",
        "",
        shift.name,
        "",
        "",
        shift.startLocalTime,
        shift.endLocalTime,
        "",
      ]);
    }
  }

  if (sources?.calendars === true) {
    for (const calendar of availability.calendars) {
      rows.push([
        "calendar",
        "",
        calendar.name,
        calendar.office?.name ?? "",
        calendar.effectiveOn,
        "",
        "",
        JSON.stringify(calendar.rules ?? []),
      ]);
    }
  }

  if (sources?.holidays === true) {
    for (const holiday of availability.holidays) {
      rows.push([
        "holiday",
        holiday.date,
        holiday.name,
        holiday.office?.name ?? "",
        "",
        "",
        "",
        "",
      ]);
    }
  }

  return rows;
}
