import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Button } from "../../design-system/primitives/Button";
import { EmptyState } from "../../design-system/primitives/EmptyState";
import { SectionHeading } from "../../design-system/primitives/PageHeader";
import { StateMessage } from "../../design-system/primitives/StateMessage";
import type { ClientMembershipClient } from "./contracts";
import styles from "./AdminClientMembershipTargets.module.css";

export { AdminClientMembershipEditor } from "./AdminClientMembershipEditor";

export type AdminClientMembershipTargetsReadState =
  | { status: "loading" }
  | { status: "unavailable" | "error"; message: string }
  | { status: "ready"; targets: readonly ClientMembershipClient[] };

export interface AdminClientMembershipTargetsProps {
  targets: AdminClientMembershipTargetsReadState;
  /** The host supplies the client-scoped editor; it is invoked on the first expand only. */
  renderMemberships(client: ClientMembershipClient, isClientTargetCurrent: () => boolean): ReactNode;
}

export interface ClientMembershipTargetDisclosureProps {
  client: ClientMembershipClient;
  controlsId: string;
  expanded: boolean;
  visited: boolean;
  membershipEditor: ReactNode;
  isClientTargetCurrent(): boolean;
  onToggle(): boolean;
  onFirstOpen(editor: ReactNode): void;
  renderMemberships(client: ClientMembershipClient, isClientTargetCurrent: () => boolean): ReactNode;
}

/** Controlled disclosure row exported for focused feature-level interaction tests. */
export function ClientMembershipTargetDisclosure({
  client,
  controlsId,
  expanded,
  visited,
  membershipEditor,
  isClientTargetCurrent,
  onToggle,
  onFirstOpen,
  renderMemberships,
}: ClientMembershipTargetDisclosureProps): ReactElement {
  const label = client.name.trim() || "Unnamed client";
  const triggerId = `${controlsId}-trigger`;
  const handleToggle = () => {
    if (!onToggle()) return;
    if (!expanded && !visited && isClientTargetCurrent()) {
      onFirstOpen(renderMemberships(client, isClientTargetCurrent));
    }
  };
  return (
    <li className={styles.target}>
      <h3 className={styles.targetHeading}>
        <Button
          id={triggerId}
          className={styles.disclosureButton}
          variant="quiet"
          aria-expanded={expanded}
          aria-controls={controlsId}
          onClick={handleToggle}
        >
          <span className={styles.clientName}>{label}</span>
          <span className={styles.chevron} data-expanded={expanded} aria-hidden="true" />
        </Button>
      </h3>
      <div
        className={styles.editorPanel}
        id={controlsId}
        role="region"
        aria-labelledby={triggerId}
        hidden={!expanded}
      >
        {visited ? membershipEditor : null}
      </div>
    </li>
  );
}

export function toggleExpandedClient(current: ReadonlySet<string>, clientId: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(clientId)) next.delete(clientId);
  else next.add(clientId);
  return next;
}

interface ClientMembershipDisclosureState {
  expandedTargets: ReadonlySet<string>;
  visitedTargets: ReadonlySet<string>;
  membershipEditors: ReadonlyMap<string, ReactNode>;
}

const EMPTY_DISCLOSURE_STATE: ClientMembershipDisclosureState = {
  expandedTargets: new Set(),
  visitedTargets: new Set(),
  membershipEditors: new Map(),
};

/** Drop cached editor trees as soon as their targets leave the host's projection. */
export function pruneClientMembershipDisclosureState(
  current: ClientMembershipDisclosureState,
  availableClientIds: ReadonlySet<string>,
): ClientMembershipDisclosureState {
  const expandedTargets = retainSet(current.expandedTargets, availableClientIds);
  const visitedTargets = retainSet(current.visitedTargets, availableClientIds);
  const membershipEditors = retainMap(current.membershipEditors, availableClientIds);
  if (
    expandedTargets === current.expandedTargets &&
    visitedTargets === current.visitedTargets &&
    membershipEditors === current.membershipEditors
  ) return current;
  return { expandedTargets, visitedTargets, membershipEditors };
}

function retainSet(current: ReadonlySet<string>, allowed: ReadonlySet<string>): ReadonlySet<string> {
  for (const value of current) if (!allowed.has(value)) return new Set([...current].filter((id) => allowed.has(id)));
  return current;
}

function retainMap<T>(current: ReadonlyMap<string, T>, allowed: ReadonlySet<string>): ReadonlyMap<string, T> {
  for (const key of current.keys()) if (!allowed.has(key)) {
    return new Map([...current].filter(([id]) => allowed.has(id)));
  }
  return current;
}

/** Renders only host-authorized client targets; no access policy is inferred here. */
export function AdminClientMembershipTargets({
  targets,
  renderMemberships,
}: AdminClientMembershipTargetsProps): ReactElement {
  const id = useId();
  const titleId = `${id}-title`;
  const [disclosureState, setDisclosureState] = useState(EMPTY_DISCLOSURE_STATE);
  const disclosureStateRef = useRef(disclosureState);
  const availableClientIds = new Set(targets.status === "ready" ? targets.targets.map(({ id: clientId }) => clientId) : []);
  const availableClientIdsRef = useRef(availableClientIds);
  availableClientIdsRef.current = availableClientIds;

  const updateDisclosureState = (next: ClientMembershipDisclosureState) => {
    disclosureStateRef.current = next;
    setDisclosureState(next);
  };

  useEffect(() => {
    const current = disclosureStateRef.current;
    const next = pruneClientMembershipDisclosureState(current, availableClientIdsRef.current);
    if (next !== current) {
      disclosureStateRef.current = next;
      setDisclosureState(next);
    }
  }, [targets]);

  const toggleClientTarget = (clientId: string): boolean => {
    if (!availableClientIdsRef.current.has(clientId)) return false;
    const next = toggleExpandedClient(disclosureStateRef.current.expandedTargets, clientId);
    updateDisclosureState({ ...disclosureStateRef.current, expandedTargets: next });
    return true;
  };

  const markClientVisited = (client: ClientMembershipClient, editor: ReactNode) => {
    if (!availableClientIdsRef.current.has(client.id)) return;
    const current = disclosureStateRef.current;
    if (current.visitedTargets.has(client.id)) return;
    updateDisclosureState({
      ...current,
      visitedTargets: new Set(current.visitedTargets).add(client.id),
      membershipEditors: new Map(current.membershipEditors).set(client.id, editor),
    });
  };

  return (
    <section className={styles.section} aria-labelledby={titleId} aria-busy={targets.status === "loading"}>
      <SectionHeading
        title={<span id={titleId}>Client memberships</span>}
        description="Select a client to review or change its effective-dated memberships."
      />
      {targets.status === "loading" ? (
        <StateMessage kind="loading" title="Loading client targets">Preparing the client list for membership management.</StateMessage>
      ) : null}
      {targets.status === "error" ? (
        <StateMessage kind="error" title="Client targets could not load">{targets.message}</StateMessage>
      ) : null}
      {targets.status === "unavailable" ? (
        <StateMessage kind="info" title="Client targets are unavailable">{targets.message}</StateMessage>
      ) : null}
      {targets.status === "ready" && targets.targets.length === 0 ? (
        <EmptyState title="No client targets are available" description="There are no clients you can manage memberships for with your current access." />
      ) : null}
      {targets.status === "ready" && targets.targets.length > 0 ? (
        <ul className={styles.targetList} aria-label="Client membership targets">
          {targets.targets.map((client, index) => (
            <ClientMembershipTargetDisclosure
              key={client.id}
              client={client}
              controlsId={`${id}-membership-target-${index}`}
              expanded={disclosureState.expandedTargets.has(client.id)}
              visited={disclosureState.visitedTargets.has(client.id)}
              membershipEditor={disclosureState.membershipEditors.get(client.id) ?? null}
              isClientTargetCurrent={() => availableClientIdsRef.current.has(client.id) && disclosureStateRef.current.expandedTargets.has(client.id)}
              onToggle={() => toggleClientTarget(client.id)}
              onFirstOpen={(editor) => markClientVisited(client, editor)}
              renderMemberships={renderMemberships}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
