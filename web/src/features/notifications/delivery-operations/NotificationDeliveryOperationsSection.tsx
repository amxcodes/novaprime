import { Component, lazy, Suspense, type ReactNode } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import type { NotificationDeliveryOperationsProps } from "./contracts";

const DeferredNotificationDeliveryOperations = lazy(() =>
  import("./NotificationDeliveryOperations").then(({ NotificationDeliveryOperations }) => ({
    default: NotificationDeliveryOperations,
  })),
);

interface LoadBoundaryProps {
  children: ReactNode;
}

interface LoadBoundaryState {
  failed: boolean;
}

class NotificationDeliveryLoadBoundary extends Component<LoadBoundaryProps, LoadBoundaryState> {
  state: LoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): LoadBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <StateMessage kind="error" title="Notification delivery could not load">
          The delivery feature could not be downloaded. Reload Admin to try again.
        </StateMessage>
      );
    }
    return this.props.children;
  }
}

/** Typed Admin slot that keeps the delivery feature in its own lazy chunk. */
export function NotificationDeliveryOperationsSection(props: NotificationDeliveryOperationsProps) {
  return (
    <NotificationDeliveryLoadBoundary>
      <Suspense fallback={<StateMessage kind="loading" title="Loading notification delivery operations" />}>
        <DeferredNotificationDeliveryOperations {...props} />
      </Suspense>
    </NotificationDeliveryLoadBoundary>
  );
}
