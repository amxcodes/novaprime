import { PageHeader } from "../../design-system";
import styles from "./PeoplePage.module.css";

export type PeoplePageMode = "directory" | "history";

export interface PeoplePageProps {
  mode: PeoplePageMode;
}

const description = "Current people context and effective-dated employment, status, office, department, and role history, limited by your active people permissions.";

/** Route-level frame; People features and their reads remain separately owned. */
export function PeoplePage({ mode }: PeoplePageProps) {
  const title = mode === "history" ? "Person history" : "People";

  return (
    <section className={styles.page} aria-labelledby="people-page-title">
      <div className={styles.content}>
        <PageHeader
          className={styles.header}
          eyebrow="People"
          title={<span id="people-page-title">{title}</span>}
          description={description}
        />

        <p id="feedback" className={`notice ${styles.feedback}`} role="status" hidden />

        <div id="people-content" className={styles.feature}>
          <p className={styles.loading} role="status">
            {mode === "history" ? "Loading person history…" : "Loading people…"}
          </p>
        </div>
      </div>
    </section>
  );
}
