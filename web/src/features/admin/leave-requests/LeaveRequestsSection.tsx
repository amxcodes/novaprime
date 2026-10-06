import { Component, lazy, Suspense, type ReactElement, type ReactNode } from "react";
import type { LeaveRequestsProjectionInput } from "./projection";
import { LeaveRequestsFallback } from "./LeaveRequestsFallback";
import { projectLeaveRequestsProps } from "./projection";

const DeferredLeaveRequests = lazy(() =>
  import("./LeaveRequests").then(({ LeaveRequests }) => ({ default: LeaveRequests })),
);

class LeaveRequestsLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? <LeaveRequestsFallback /> : this.props.children;
  }
}

/** Lazy feature boundary for the independently grant-filtered Leave Review section. */
export function LeaveRequestsSection(props: LeaveRequestsProjectionInput): ReactElement {
  const featureProps = projectLeaveRequestsProps(props);
  return (
    <LeaveRequestsLoadBoundary>
      <Suspense fallback={<LeaveRequestsFallback loading />}>
        <DeferredLeaveRequests {...featureProps} />
      </Suspense>
    </LeaveRequestsLoadBoundary>
  );
}
