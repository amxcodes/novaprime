import { useId, type ReactElement, type ReactNode } from "react";
import { EmptyState } from "../../../design-system/primitives/EmptyState";
import { SectionHeading } from "../../../design-system/primitives/PageHeader";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import styles from "./AdminWorkSection.module.css";

export interface AdminWorkSectionProps {
  contextCreation?: ReactNode;
  taskComposer?: ReactNode;
  taskOperations?: ReactNode;
  membershipTargets?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
}

type WorkSlotName = "context-creation" | "task-composer" | "task-operations" | "membership-targets";

function hasContent(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false && node !== true;
}

/** Route-level composition only; work capabilities, reads, and commands stay host-owned. */
export function AdminWorkSection({
  contextCreation,
  taskComposer,
  taskOperations,
  membershipTargets,
  title = "Client work and task operations",
  description = "Create work context, compose and manage tasks, and review client access within your current authorization.",
}: AdminWorkSectionProps): ReactElement {
  const titleId = useId();
  const slots: ReadonlyArray<readonly [WorkSlotName, ReactNode]> = [
    ["context-creation", contextCreation],
    ["task-composer", taskComposer],
    ["task-operations", taskOperations],
    ["membership-targets", membershipTargets],
  ];
  const visibleSlots = slots.filter(([, content]) => hasContent(content));

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <SectionHeading
        title={<span id={titleId}>{title}</span>}
        description={description}
      />
      {visibleSlots.length ? (
        <div className={styles.slots}>
          {visibleSlots.map(([name, content]) => (
            <div className={styles.slot} data-admin-work-slot={name} key={name}>
              {content}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No Work tools are available" description="Work features appear here when they are available to your current access." />
      )}
    </section>
  );
}

export interface AdminWorkFeatureFailureProps {
  title: string;
  message: string;
}

/** Local failure state for one lazy Work responsibility; sibling slots stay mounted. */
export function AdminWorkFeatureFailure({ title, message }: AdminWorkFeatureFailureProps): ReactElement {
  const titleId = useId();
  return (
    <section className={styles.failure} aria-labelledby={titleId}>
      <SectionHeading title={<span id={titleId}>{title}</span>} />
      <StateMessage kind="error" title={`${title} could not load`}>{message}</StateMessage>
    </section>
  );
}
