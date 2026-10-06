import { Component, lazy, Suspense, type ReactElement, type ReactNode } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import type { RolePermissionsProjectionInput } from "./projection";
import styles from "./RolePermissionsSection.module.css";

const DeferredRolePermissionsEditor = lazy(() =>
  import("./RolePermissionsEditorContent").then(({ RolePermissionsEditorContent }) => ({
    default: RolePermissionsEditorContent,
  })),
);

interface RolePermissionsLoadBoundaryProps {
  children: ReactNode;
}

interface RolePermissionsLoadBoundaryState {
  failed: boolean;
}

class RolePermissionsLoadBoundary extends Component<RolePermissionsLoadBoundaryProps, RolePermissionsLoadBoundaryState> {
  state: RolePermissionsLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): RolePermissionsLoadBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <StateMessage kind="error" title="Role and permission controls could not load">
          Role and permission controls could not load. Reload Admin to try again.
        </StateMessage>
      );
    }
    return this.props.children;
  }
}

/** Typed Admin section with a lazy feature-owned projection/editor boundary. */
export function RolePermissionsSection(props: RolePermissionsProjectionInput): ReactElement {
  return (
    <section className={styles.section} aria-labelledby="admin-role-permissions-title">
      <header className={styles.header}>
        <h2 className={styles.title} id="admin-role-permissions-title">Roles and permissions</h2>
        <p className={styles.description}>
          Build configurable roles from the canonical permission catalogue. Protected Super Admin cannot be edited.
        </p>
      </header>
      <RolePermissionsLoadBoundary>
        <Suspense fallback={<StateMessage kind="loading" title="Loading role and permission controls" />}>
          <DeferredRolePermissionsEditor {...props} />
        </Suspense>
      </RolePermissionsLoadBoundary>
    </section>
  );
}
