import { Component, lazy, Suspense, type ReactElement, type ReactNode } from "react";
import { OrganizationStructureFallback } from "./OrganizationStructureFallback";
import { projectOrganizationStructureProps, type OrganizationStructureProjectionInput } from "./projection";

interface OrganizationStructureLoadBoundaryProps {
  children: ReactNode;
}

interface OrganizationStructureLoadBoundaryState {
  failed: boolean;
}

export class OrganizationStructureLoadBoundary extends Component<
  OrganizationStructureLoadBoundaryProps,
  OrganizationStructureLoadBoundaryState
> {
  state: OrganizationStructureLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): OrganizationStructureLoadBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <OrganizationStructureFallback state="error" />;
    }
    return this.props.children;
  }
}

const DeferredOrganizationStructure = lazy(() =>
  import("./OrganizationStructure").then(({ OrganizationStructure }) => ({
    default: OrganizationStructure,
  })),
);

function OrganizationStructureContent(props: OrganizationStructureProjectionInput): ReactElement {
  const featureProps = projectOrganizationStructureProps(props);
  return (
    <Suspense fallback={<OrganizationStructureFallback state="loading" />}>
      <DeferredOrganizationStructure {...featureProps} />
    </Suspense>
  );
}

/** Lazy feature boundary; the live component and its load states each own one heading. */
export function OrganizationStructureSection(props: OrganizationStructureProjectionInput): ReactElement {
  return (
    <OrganizationStructureLoadBoundary>
      <OrganizationStructureContent {...props} />
    </OrganizationStructureLoadBoundary>
  );
}
