import { Component, lazy, Suspense, type ReactElement, type ReactNode } from "react";
import type { WfhRequestsReviewProjectionInput } from "./projection";
import { WfhRequestsReviewFallback } from "./WfhRequestsReviewFallback";
import { projectWfhRequestsReviewProps } from "./projection";

const DeferredWfhRequestsReview = lazy(() =>
  import("./WfhRequestsReview").then(({ WfhRequestsReview }) => ({ default: WfhRequestsReview })),
);

class WfhRequestsReviewLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? <WfhRequestsReviewFallback /> : this.props.children;
  }
}

/** Lazy feature boundary for the independently grant-filtered WFH Review section. */
export function WfhRequestsReviewSection(props: WfhRequestsReviewProjectionInput): ReactElement {
  const featureProps = projectWfhRequestsReviewProps(props);
  return (
    <WfhRequestsReviewLoadBoundary>
      <Suspense fallback={<WfhRequestsReviewFallback loading />}>
        <DeferredWfhRequestsReview {...featureProps} />
      </Suspense>
    </WfhRequestsReviewLoadBoundary>
  );
}
