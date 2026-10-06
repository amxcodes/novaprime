import { Component, lazy, Suspense, type ReactNode } from "react";
import { StateMessage } from "../../design-system/primitives/StateMessage";
import type { OfficeGeofenceSettingsProps } from "./office-geofence-contracts";
import styles from "./OfficeGeofenceSettingsSection.module.css";

const DeferredOfficeGeofenceSettings = lazy(() =>
  import("./OfficeGeofenceSettings").then(({ OfficeGeofenceSettings }) => ({
    default: OfficeGeofenceSettings,
  })),
);

interface LoadBoundaryProps {
  children: ReactNode;
}

interface LoadBoundaryState {
  failed: boolean;
}

class OfficeGeofenceLoadBoundary extends Component<LoadBoundaryProps, LoadBoundaryState> {
  state: LoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LoadBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <StateMessage kind="error" title="Attendance geofences could not load">
          Geofence controls could not be downloaded. Reload Admin to try again.
        </StateMessage>
      );
    }
    return this.props.children;
  }
}

/** Typed Admin slot that keeps office geofence controls in a lazy feature chunk. */
export function OfficeGeofenceSettingsSection(props: OfficeGeofenceSettingsProps) {
  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>Attendance geofences</h2>
        <p className={styles.description}>Set the office coordinates and radius used to validate office check-ins.</p>
      </header>
      <OfficeGeofenceLoadBoundary>
        <Suspense fallback={<StateMessage kind="loading" title="Loading attendance geofences" />}>
          <DeferredOfficeGeofenceSettings {...props} />
        </Suspense>
      </OfficeGeofenceLoadBoundary>
    </>
  );
}
