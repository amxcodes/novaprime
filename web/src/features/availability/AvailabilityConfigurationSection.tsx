import { Component, lazy, Suspense, type ReactElement, type ReactNode } from "react";
import { AvailabilityConfigurationFallback } from "./AvailabilityConfigurationFallback";
import {
  projectAvailabilityConfigurationProps,
  type AvailabilityConfigurationProjectionInput,
} from "./admin-configuration-projection";

const DeferredAvailabilityConfiguration = lazy(() =>
  import("./AdminAvailabilityConfiguration").then(({ AdminAvailabilityConfiguration }) => ({
    default: AdminAvailabilityConfiguration,
  })),
);

class AvailabilityConfigurationLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return <AvailabilityConfigurationFallback state="error" />;
    return this.props.children;
  }
}

/** Typed, feature-owned boundary between the Admin host and configuration editor. */
export function AvailabilityConfigurationSection(props: AvailabilityConfigurationProjectionInput): ReactElement {
  const featureProps = projectAvailabilityConfigurationProps(props);
  return (
    <AvailabilityConfigurationLoadBoundary>
      <Suspense fallback={<AvailabilityConfigurationFallback state="loading" />}>
        <DeferredAvailabilityConfiguration {...featureProps} />
      </Suspense>
    </AvailabilityConfigurationLoadBoundary>
  );
}
