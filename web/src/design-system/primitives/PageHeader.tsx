import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export interface PageHeaderProps {
  title: ReactNode;
  /** Use level 2 when a page header is embedded within another page. */
  level?: 1 | 2;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  level = 1,
  eyebrow,
  description,
  actions,
  className,
}: PageHeaderProps) {
  const Heading = level === 2 ? "h2" : "h1";
  return (
    <header className={[styles.pageHeader, className].filter(Boolean).join(" ")}>
      <div className={styles.identity}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <Heading className={styles.title}>{title}</Heading>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}

export interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}

export function SectionHeading({
  title,
  description,
  actions,
  level = 2,
  className,
}: SectionHeadingProps) {
  const Heading = level === 3 ? "h3" : "h2";

  return (
    <header className={[styles.sectionHeading, className].filter(Boolean).join(" ")}>
      <div className={styles.sectionIdentity}>
        <Heading className={styles.sectionTitle}>{title}</Heading>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
    </header>
  );
}
