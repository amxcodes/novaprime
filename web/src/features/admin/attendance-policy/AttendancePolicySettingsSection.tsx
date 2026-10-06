import { Component, lazy, Suspense, type ReactNode } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import type { AttendancePolicySettingsProps } from "./contracts";

const DeferredAttendancePolicySettings = lazy(() =>
  import("./AttendancePolicySettings").then(({ AttendancePolicySettings }) => ({
    default: AttendancePolicySettings,
  })),
);

interface LoadBoundaryProps {
  children: ReactNode;
}

interface LoadBoundaryState {
  failed: boolean;
}

class AttendancePolicyLoadBoundary extends Component<LoadBoundaryProps, LoadBoundaryState> {
  state: LoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LoadBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <StateMessage kind="error" title="Attendance policy settings could not load">
          The attendance policy feature could not be downloaded. Reload Admin to try again.
        </StateMessage>
      );
    }
    return this.props.children;
  }
}

/** Typed Admin slot that keeps attendance policy controls in a lazy feature chunk. */
export function AttendancePolicySettingsSection(props: AttendancePolicySettingsProps) {
  return (
    <AttendancePolicyLoadBoundary>
      <Suspense fallback={<StateMessage kind="loading" title="Loading attendance policy settings" />}>
        <DeferredAttendancePolicySettings {...props} />
      </Suspense>
    </AttendancePolicyLoadBoundary>
  );
}
