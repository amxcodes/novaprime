import { Button, EmptyState } from "../../design-system";
import { ReadFailure, ReportPanel } from "./OperationsReportPanel";
import styles from "./OperationsOverview.module.css";
import type { OperationsAvailability, OperationsOverviewProps, OperationsReadState } from "./contracts";

export function AvailabilityReportPanel({
  read,
  sources,
  canExport,
  onExport,
  onRetry,
}: {
  read: OperationsReadState<OperationsAvailability>;
  sources: OperationsOverviewProps["availabilitySources"];
  canExport: boolean;
  onExport?: () => void;
  onRetry: () => void;
}) {
  const hasSource = Boolean(sources?.shifts || sources?.calendars || sources?.holidays);
  return (
    <ReportPanel
      id="operations-availability-title"
      title="Availability configuration"
      description="Configuration records are shown only for their respective availability grants."
      className={styles.halfPanel}
      actions={read.status === "ready" && canExport && Boolean(sources?.calendars || sources?.holidays) ? (
        <Button variant="secondary" size="compact" onClick={onExport}>Download calendar CSV</Button>
      ) : undefined}
    >
      {read.status !== "ready" ? <ReadFailure read={read} title="Availability configuration unavailable" onRetry={onRetry} /> : !hasSource ? (
        <EmptyState title="No configuration sources are visible" description="Each source requires its own availability grant." />
      ) : (
        <div className={styles.availabilityList}>
          {sources?.shifts ? (
            <section className={styles.availabilitySource} aria-labelledby="operations-shifts-title">
              <h3 id="operations-shifts-title">Shifts</h3>
              {read.data.shifts.length ? (
                <ul>{read.data.shifts.map((shift, index) => <li key={`${shift.name}-${index}`}>
                  <strong>{shift.name}</strong><span>{shift.startLocalTime}–{shift.endLocalTime}</span>
                </li>)}</ul>
              ) : <p className={styles.emptyLine}>No shift records returned.</p>}
            </section>
          ) : null}
          {sources?.calendars ? (
            <section className={styles.availabilitySource} aria-labelledby="operations-calendars-title">
              <h3 id="operations-calendars-title">Working calendars</h3>
              {read.data.calendars.length ? (
                <ul>{read.data.calendars.map((calendar, index) => <li key={`${calendar.name}-${index}`}>
                  <strong>{calendar.name}</strong><span>{calendar.office?.name || "Office not recorded"} · effective {calendar.effectiveOn}</span>
                </li>)}</ul>
              ) : <p className={styles.emptyLine}>No calendar records returned.</p>}
            </section>
          ) : null}
          {sources?.holidays ? (
            <section className={styles.availabilitySource} aria-labelledby="operations-holidays-title">
              <h3 id="operations-holidays-title">Holidays</h3>
              {read.data.holidays.length ? (
                <>
                  <ul>{read.data.holidays.slice(0, 20).map((holiday, index) => <li key={`${holiday.date}-${index}`}>
                    <strong>{holiday.date} · {holiday.name}</strong><span>{holiday.office?.name || "Office not recorded"}</span>
                  </li>)}</ul>
                  {read.data.holidays.length > 20 ? (
                    <p className={styles.emptyLine}>Displaying 20 of {read.data.holidays.length} holiday records returned. The export uses the full returned set.</p>
                  ) : null}
                </>
              ) : <p className={styles.emptyLine}>No holiday records returned.</p>}
            </section>
          ) : null}
        </div>
      )}
    </ReportPanel>
  );
}
