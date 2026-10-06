import { Component, lazy, Suspense, type ReactElement, type ReactNode } from "react";
import type { PeopleAdministrationProps } from "./people-contracts";
import { PeopleAdministrationFallback } from "./PeopleAdministrationFallback";

const DeferredPeopleAdministration = lazy(() =>
  import("./PeopleAdministration").then(({ PeopleAdministration }) => ({ default: PeopleAdministration })),
);

class PeopleAdministrationLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? <PeopleAdministrationFallback state="error" /> : this.props.children;
  }
}

/** Lazy boundary for the independently grant-filtered Admin People feature. */
export function PeopleAdministrationSection(props: PeopleAdministrationProps): ReactElement {
  return (
    <PeopleAdministrationLoadBoundary>
      <Suspense fallback={<PeopleAdministrationFallback state="loading" />}>
        <DeferredPeopleAdministration {...props} />
      </Suspense>
    </PeopleAdministrationLoadBoundary>
  );
}
