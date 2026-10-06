import { Button } from "../../design-system/primitives/Button";
import { PageHeader } from "../../design-system/primitives/PageHeader";
import styles from "./RouteUnavailablePage.module.css";

export interface RouteUnavailablePageProps {
  label: string;
  accessUnresolved: boolean;
  onReturnToWorkspace: () => void;
}

/** Presents a host-decided route access state without owning the access check. */
export function RouteUnavailablePage({ label, accessUnresolved, onReturnToWorkspace }: RouteUnavailablePageProps) {
  const title = accessUnresolved
    ? "Access could not be checked."
    : "This feature is not available to your account.";
  const description = accessUnresolved
    ? "NOVA could not confirm your current access. Refresh the page after your connection is restored."
    : "Your current permissions do not include a useful destination here. Ask an authorized workspace administrator if you need access.";

  return (
    <section className={styles.page} aria-labelledby="unavailable-page-title">
      <div className={styles.content}>
        <PageHeader
          className={styles.header}
          eyebrow={label}
          title={<span id="unavailable-page-title">{title}</span>}
          description={description}
          actions={(
            <Button variant="secondary" onClick={onReturnToWorkspace}>
              Go to your workspace
            </Button>
          )}
        />
        <p id="feedback" className={`notice ${styles.feedback}`} role="status" hidden />
      </div>
    </section>
  );
}
