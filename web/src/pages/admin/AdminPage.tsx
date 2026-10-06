import { EmptyState, StateMessage } from "../../design-system";
import type { ReactElement } from "react";
import styles from "./AdminPage.module.css";

/** Stable identities for the Admin feature slots the route host may supply. */
export type AdminPageSectionId =
  | "organization-structure"
  | "geofence"
  | "attendance-policy"
  | "availability-configuration"
  | "wfh-overrides"
  | "roles"
  | "work"
  | "people"
  | "owner-transfer"
  | "leave-review"
  | "wfh-review"
  | "historical-exceptions"
  | "audit"
  | "notification-delivery";

export interface AuthorizedAdminPageSection {
  /** Stable feature identity supplied by the route host. */
  id: AdminPageSectionId;
  /** Feature-owned React composition, built only after authorization planning. */
  content: ReactElement;
}

export type AdminPageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

export interface AdminPageProps {
  state: AdminPageState;
  /** Already-authorized sections in the order selected by the route host. */
  sections: ReadonlyArray<AuthorizedAdminPageSection>;
  /** Optional organization/count context projected by the route host. */
  summary?: string;
  /** Partial grant-read warning; feature sections remain independently planned. */
  routeWarning?: string;
}

/**
 * Admin route composition only. The host owns grants, reads, lifetimes and
 * commands; it supplies only feature slots that it has already authorized.
 * Feature components retain their own headings, landmarks, styles and states.
 */
export function AdminPage({ state, sections, summary, routeWarning }: AdminPageProps) {
  return (
    <section className={styles.page} aria-labelledby="admin-page-title">
      <div className={styles.content}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Organisation administration</p>
          <h1 id="admin-page-title" tabIndex={-1}>Admin console</h1>
          <p className={styles.lede}>
            Manage the real NOVA organisation, role, people, onboarding, and audit records.
          </p>
          {state.status === "ready" && summary?.trim() ? (
            <p className={styles.summary}>{summary.trim()}</p>
          ) : null}
        </header>

        {/* Stable route-level feedback seam for the existing host message adapter. */}
        <p id="feedback" className="notice" role="status" hidden />

        {state.status === "ready" && routeWarning?.trim() ? (
          <StateMessage className={styles.routeState} kind="warning" title="Current access could not be confirmed">
            {routeWarning.trim()}
          </StateMessage>
        ) : null}

        {state.status === "loading" ? (
          <StateMessage className={styles.routeState} kind="loading" title="Loading organisation data">
            Admin sections will appear when their authorized reads finish.
          </StateMessage>
        ) : null}

        {state.status === "error" ? (
          <StateMessage className={styles.routeState} kind="error" title="Admin could not load">
            {state.message}
          </StateMessage>
        ) : null}

        {state.status === "ready" ? (
          sections.length ? (
            <div className={styles.sections}>
              {sections.map((section) => (
                <div className={styles.slot} data-admin-section-slot={section.id} key={section.id}>
                  {section.content}
                </div>
              ))}
            </div>
          ) : routeWarning?.trim() ? null : (
            <EmptyState
              className={styles.emptyState}
              title="No Admin features are available for your current permissions."
            />
          )
        ) : null}
      </div>
    </section>
  );
}
