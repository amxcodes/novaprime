import { Component, lazy, Suspense, type ReactNode } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import type { AuditEventsProps } from "./contracts";

const DeferredAuditEvents = lazy(() =>
  import("./AuditEvents").then(({ AuditEvents }) => ({ default: AuditEvents })),
);

interface LoadBoundaryProps {
  children: ReactNode;
}

interface LoadBoundaryState {
  failed: boolean;
}

class AuditEventsLoadBoundary extends Component<LoadBoundaryProps, LoadBoundaryState> {
  state: LoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LoadBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <StateMessage kind="error" title="Audit history could not load">
          The audit feature could not be downloaded. Reload Admin to try again.
        </StateMessage>
      );
    }
    return this.props.children;
  }
}

/** Keep Admin's route composition typed while deferring the audit feature chunk. */
export function AuditEventsSection(props: AuditEventsProps) {
  return (
    <AuditEventsLoadBoundary>
      <Suspense fallback={<StateMessage kind="loading" title="Loading recent audit activity" />}>
        <DeferredAuditEvents {...props} />
      </Suspense>
    </AuditEventsLoadBoundary>
  );
}
