import type { AvailabilityAgendaProps } from "../../features/availability/contracts";
import { AvailabilityAgenda } from "../../features/availability/AvailabilityAgenda";
import { PageHeader } from "../../design-system";
import styles from "./AvailabilityPage.module.css";

export interface AvailabilityPageProps {
  agenda: AvailabilityAgendaProps;
}

/** Route-level frame for the Availability feature; agenda state stays feature-owned. */
export function AvailabilityPage({ agenda }: AvailabilityPageProps) {
  return (
    <section className={styles.page} aria-label="Availability">
      <div className={styles.content}>
        <PageHeader
          className={styles.header}
          eyebrow="Availability"
          title="People and office calendar"
          description="Review only the schedule, holiday, attendance, leave, and work-from-home records your current grants allow. Dates are business dates; each event carries its office timezone where applicable."
        />

        <p id="feedback" className={`notice ${styles.feedback}`} role="status" hidden />

        <AvailabilityAgenda {...agenda} />
      </div>
    </section>
  );
}
