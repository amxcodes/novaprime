import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../design-system";
import type {
  WorkContextClientDepartmentCreation,
  WorkContextClientSummary,
  WorkContextExplorerProps,
  WorkContextGroupSummary,
  WorkContextOrganisationWorkstreamSummary,
  WorkContextTaskCreationTargetSummary,
} from "./explorer-contracts";
import { ClientDepartmentCreate } from "./ClientDepartmentCreate";
import { formatWorkContextSearchSummary, summarizeWorkContextProjection, type WorkContextSearchSummary } from "./search";
import styles from "./WorkContextExplorer.module.css";

export type {
  WorkContextClientSummary,
  WorkContextClientDepartmentCreation,
  WorkContextClientWorkstreamSummary,
  WorkContextExplorerProjection,
  WorkContextExplorerProps,
  WorkContextExplorerReadState,
  WorkContextGroupSummary,
  WorkContextOrganisationWorkstreamSummary,
  WorkContextTaskCreationTargetSummary,
} from "./explorer-contracts";

function ContextGroup({ group }: { group: WorkContextGroupSummary }) {
  if (!group.canViewGroup) return null;

  return (
    <li className={styles.groupItem}>
      <span className={styles.groupName}>{group.name}</span>
      {group.canCreateTask ? <span className={styles.taskTarget}>Task target</span> : null}
    </li>
  );
}

function GroupList({ groups, label }: { groups: readonly WorkContextGroupSummary[]; label: string }) {
  const visibleGroups = groups.filter((group) => group.canViewGroup);
  if (!visibleGroups.length) return null;

  return (
    <ul className={styles.groupList} aria-label={label}>
      {visibleGroups.map((group) => <ContextGroup key={group.id} group={group} />)}
    </ul>
  );
}

function TaskTargetList({
  groups,
  workstreamTargets,
}: {
  groups: readonly WorkContextGroupSummary[];
  workstreamTargets: readonly WorkContextTaskCreationTargetSummary[];
}) {
  const id = useId();
  const groupTargets = groups.filter((group) => group.canCreateTask && !group.canViewGroup);
  if (!groupTargets.length && !workstreamTargets.length) return null;

  return (
    <section className={styles.taskTargetPanel} aria-labelledby={`${id}-title`}>
      <header className={styles.branchHeader}>
        <h3 id={`${id}-title`}>Eligible task creation targets</h3>
        <p>These server-authorized targets are available for task creation. They are not links into the browse hierarchy.</p>
      </header>
      <ul className={styles.taskTargetList} aria-label="Eligible task creation targets">
        {workstreamTargets.map((target) => (
          <li className={styles.taskTargetItem} key={`${target.kind}:${target.id}`}>
            <span className={styles.groupName}>{target.name}</span>
            <span className={styles.taskTarget}>Task target</span>
            <span className={styles.contextLabel}>
              {target.kind === "client"
                ? target.clientName ? `${target.clientName} · Client workstream target` : "Client workstream target"
                : "Organisation workstream target"}
            </span>
          </li>
        ))}
        {groupTargets.map((group) => (
          <li className={styles.taskTargetItem} key={`group:${group.id}`}>
            <span className={styles.groupName}>{group.name}</span>
            <span className={styles.taskTarget}>Task target</span>
            <span className={styles.contextLabel}>
              {group.clientWorkstreamId ? "Client workstream target" : "Organisation workstream target"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClientBranch({
  client,
  workstreams,
  groupsByWorkstream,
  isWorkstreamContextOnly,
  departmentCreation,
}: {
  client: WorkContextClientSummary;
  workstreams: readonly { id: string; name: string }[];
  groupsByWorkstream: ReadonlyMap<string, readonly WorkContextGroupSummary[]>;
  isWorkstreamContextOnly: boolean;
  departmentCreation?: WorkContextClientDepartmentCreation;
}) {
  const canCreateDepartment = !isWorkstreamContextOnly &&
    departmentCreation?.authorizedClientIds.includes(client.id) === true;
  const createDepartment = canCreateDepartment && departmentCreation
    ? (name: string) => departmentCreation.onCreate(client.id, name)
    : undefined;
  return (
    <li className={styles.clientItem}>
      <article className={styles.clientCard}>
        <h4 className={styles.clientName}>{client.name}</h4>
        <p className={styles.contextLabel}>
          {isWorkstreamContextOnly ? "Client context from visible workstream" : "Client"}
        </p>
        {createDepartment ? (
          <ClientDepartmentCreate
            clientId={client.id}
            onCreate={createDepartment}
          />
        ) : null}
        {workstreams.length ? (
          <ul className={styles.workstreamList} aria-label={`Workstreams for ${client.name}`}>
            {workstreams.map((workstream) => {
              const groups = groupsByWorkstream.get(workstream.id) ?? [];
              return (
                <li className={styles.workstreamItem} key={workstream.id}>
                  <div className={styles.workstreamHeading}>
                    <h5>{workstream.name}</h5>
                    <span className={styles.contextLabel}>Client workstream</span>
                  </div>
                  <GroupList groups={groups} label={`Groups in ${workstream.name}`} />
                </li>
              );
            })}
          </ul>
        ) : null}
      </article>
    </li>
  );
}

function OrganisationWorkstream({
  workstream,
  groups,
}: {
  workstream: WorkContextOrganisationWorkstreamSummary;
  groups: readonly WorkContextGroupSummary[];
}) {
  return (
    <li className={styles.organisationItem}>
      <article className={styles.workstreamCard}>
        <div className={styles.workstreamHeading}>
          <h4>{workstream.name}</h4>
          <span className={styles.contextLabel}>Organisation workstream</span>
        </div>
        <GroupList groups={groups} label={`Groups in ${workstream.name}`} />
      </article>
    </li>
  );
}

function UnattachedGroups({
  groups,
  kind,
  headingId,
}: {
  groups: readonly WorkContextGroupSummary[];
  kind: "client" | "organisation";
  headingId: string;
}) {
  if (!groups.length) return null;
  const context = kind === "client" ? "Client workstream" : "Organisation workstream";

  return (
    <section className={styles.unattached} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.unattachedTitle}>Groups without a visible workstream</h4>
      <p className={styles.scopeNote}>The parent {context.toLowerCase()} is not included in this response.</p>
      <GroupList groups={groups} label={`${context} groups without visible parent`} />
    </section>
  );
}

function ReadyContext({
  projection,
  departmentCreation,
  searchActive,
}: {
  projection: NonNullable<Extract<WorkContextExplorerProps["readState"], { status: "ready" }>["projection"]>;
  departmentCreation?: WorkContextClientDepartmentCreation;
  searchActive: boolean;
}) {
  const id = useId();
  const clientWorkstreamsByClient = new Map<string, typeof projection.clientWorkstreams[number][]>();
  for (const workstream of projection.clientWorkstreams) {
    const current = clientWorkstreamsByClient.get(workstream.clientId) ?? [];
    current.push(workstream);
    clientWorkstreamsByClient.set(workstream.clientId, current);
  }

  const clientsById = new Map<string, { client: WorkContextClientSummary; contextOnly: boolean }>();
  for (const client of projection.clients) clientsById.set(client.id, { client, contextOnly: false });
  for (const workstream of projection.clientWorkstreams) {
    if (!clientsById.has(workstream.clientId)) {
      clientsById.set(workstream.clientId, {
        client: { id: workstream.clientId, name: workstream.clientName || "Client context" },
        contextOnly: true,
      });
    }
  }

  const groups = projection.groups.filter((group) => group.canViewGroup);
  const createOnlyGroups = projection.groups.filter((group) => group.canCreateTask && !group.canViewGroup);
  const clientWorkstreamIds = new Set(projection.clientWorkstreams.map((workstream) => workstream.id));
  const organisationWorkstreamIds = new Set(projection.organisationWorkstreams.map((workstream) => workstream.id));
  const clientGroups = new Map<string, WorkContextGroupSummary[]>();
  const organisationGroups = new Map<string, WorkContextGroupSummary[]>();
  const unattachedClientGroups: WorkContextGroupSummary[] = [];
  const unattachedOrganisationGroups: WorkContextGroupSummary[] = [];

  for (const group of groups) {
    if (group.clientWorkstreamId && clientWorkstreamIds.has(group.clientWorkstreamId)) {
      const attached = clientGroups.get(group.clientWorkstreamId) ?? [];
      attached.push(group);
      clientGroups.set(group.clientWorkstreamId, attached);
    } else if (group.organisationWorkstreamId && organisationWorkstreamIds.has(group.organisationWorkstreamId)) {
      const attached = organisationGroups.get(group.organisationWorkstreamId) ?? [];
      attached.push(group);
      organisationGroups.set(group.organisationWorkstreamId, attached);
    } else if (group.clientWorkstreamId) {
      unattachedClientGroups.push(group);
    } else if (group.organisationWorkstreamId) {
      unattachedOrganisationGroups.push(group);
    }
  }

  const hasBrowseContext = clientsById.size > 0 || projection.organisationWorkstreams.length > 0 || groups.length > 0;
  const hasContext = hasBrowseContext || createOnlyGroups.length > 0 || projection.workstreamTaskTargets.length > 0;
  if (!hasContext) {
    return (
      <div className={styles.emptyState} role="status">
        <h3>{searchActive ? "No matches in this authorized response" : "No visible work context"}</h3>
        <p>{searchActive
          ? "Clear the search to restore the records returned for your current access."
          : "No clients, workstreams, or groups were included in this response."}</p>
      </div>
    );
  }

  const clientTitleId = `${id}-client-heading`;
  const organisationTitleId = `${id}-organisation-heading`;

  return (
    <>
      {hasBrowseContext ? (
        <>
          <p className={styles.scopeNote}>Only records included in this authorized response are shown; this is not a complete directory.</p>
          <div className={styles.branches}>
            <section className={styles.branch} aria-labelledby={clientTitleId}>
              <header className={styles.branchHeader}>
                <h3 id={clientTitleId}>Client work</h3>
                <p>Client context with the workstreams and groups present in this view.</p>
              </header>
              {clientsById.size ? (
                <ul className={styles.clientList} aria-label="Visible client contexts">
                  {[...clientsById.values()].map(({ client, contextOnly }) => (
                    <ClientBranch
                      key={client.id}
                      client={client}
                      isWorkstreamContextOnly={contextOnly}
                      workstreams={clientWorkstreamsByClient.get(client.id) ?? []}
                      groupsByWorkstream={clientGroups}
                      departmentCreation={departmentCreation}
                    />
                  ))}
                </ul>
              ) : (
                <p className={styles.branchEmpty}>No client context was included in this response.</p>
              )}
              <UnattachedGroups groups={unattachedClientGroups} kind="client" headingId={`${id}-client-unattached`} />
            </section>

            <section className={styles.branch} aria-labelledby={organisationTitleId}>
              <header className={styles.branchHeader}>
                <h3 id={organisationTitleId}>Organisation work</h3>
                <p>Organisation workstreams and their visible groups.</p>
              </header>
              {projection.organisationWorkstreams.length ? (
                <ul className={styles.organisationList} aria-label="Visible organisation workstreams">
                  {projection.organisationWorkstreams.map((workstream) => (
                    <OrganisationWorkstream
                      key={workstream.id}
                      workstream={workstream}
                      groups={organisationGroups.get(workstream.id) ?? []}
                    />
                  ))}
                </ul>
              ) : (
                <p className={styles.branchEmpty}>No organisation workstreams were included in this response.</p>
              )}
              <UnattachedGroups groups={unattachedOrganisationGroups} kind="organisation" headingId={`${id}-organisation-unattached`} />
            </section>
          </div>
        </>
      ) : (
        <p className={styles.scopeNote}>Browseable work context is not included in this response. Eligible task destinations appear separately according to your access.</p>
      )}
      <TaskTargetList groups={createOnlyGroups} workstreamTargets={projection.workstreamTaskTargets} />
    </>
  );
}

export function WorkContextExplorer({ readState, departmentCreation, onSearch }: WorkContextExplorerProps) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [announcedSearch, setAnnouncedSearch] = useState<{ query: string; summary: WorkContextSearchSummary } | null>(null);
  const [searchRead, setSearchRead] = useState<{
    query: string;
    status: "loading" | "ready" | "error";
    result?: WorkContextExplorerProps["readState"];
    message?: string;
  } | null>(null);
  const searchGeneration = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim();
  const searchActive = query.length > 0;
  const activeSearch = searchActive && searchRead?.query === query ? searchRead : null;
  const searchResult = activeSearch?.status === "ready" && activeSearch.result?.status === "ready"
    ? activeSearch.result
    : null;
  const searchSummary = searchResult ? summarizeWorkContextProjection(searchResult.projection) : null;

  useEffect(() => {
    const generation = ++searchGeneration.current;
    if (!query) {
      setSearchRead(null);
      setAnnouncedSearch(null);
      return;
    }

    setSearchRead({ query, status: "loading" });
    setAnnouncedSearch(null);
    const timer = window.setTimeout(() => {
      void onSearch(query).then((result) => {
        if (generation !== searchGeneration.current) return;
        setSearchRead({ query, status: "ready", result });
      }).catch((error: unknown) => {
        if (generation !== searchGeneration.current) return;
        const message = error instanceof Error ? error.message.trim() : "";
        setSearchRead({
          query,
          status: "error",
          message: message || "Work-context search could not be completed. Try again.",
        });
      });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      searchGeneration.current += 1;
    };
  }, [onSearch, query]);

  useEffect(() => {
    if (!searchActive || !searchResult || !searchSummary) {
      setAnnouncedSearch(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setAnnouncedSearch({ query: search.trim(), summary: searchSummary });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, searchActive, searchSummary?.clientContexts,
    searchSummary?.workstreams, searchSummary?.visibleGroups, searchSummary?.taskTargets]);

  const preventSearchSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault();

  return (
    <div className={styles.frame}>
      <section className={styles.explorer} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>WORK CONTEXT</p>
          <h2 id={`${id}-title`} className={styles.title}>Work context</h2>
          <p className={styles.description}>Explore the client and organisation work included in your current access.</p>
        </header>

        {readState.status === "ready" ? (
          <form className={styles.searchForm} role="search" aria-label="Work context" onSubmit={preventSearchSubmit}>
            <Field
              className={styles.searchField}
              label="Search work context"
              hint="Search client, workstream, visible group and eligible task-target names on the server."
            >
              {(control) => (
                <Input
                  {...control}
                  ref={searchInput}
                  type="search"
                  maxLength={120}
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
              )}
            </Field>
            <Button
              className={styles.clearSearch}
              variant="quiet"
              disabled={!searchActive}
              onClick={() => { setSearch(""); searchInput.current?.focus(); }}
            >
              Clear search
            </Button>
            <p className={styles.searchScope}>
              Search runs on NOVA and returns only the work context allowed by your current access.
            </p>
            {announcedSearch?.query === search.trim() ? (
              <p className={styles.searchResultSummary} role="status" aria-live="polite" aria-atomic="true">
                {formatWorkContextSearchSummary(announcedSearch.summary)}
              </p>
            ) : null}
          </form>
        ) : null}

        {readState.status === "loading" ? (
          <div className={styles.status} role="status" aria-live="polite" aria-busy="true">
            <span className={styles.spinner} aria-hidden="true" /> Loading work context…
          </div>
        ) : null}
        {readState.status === "denied" ? (
          <div className={`${styles.status} ${styles.statusCopy}`} role="status">
            <h3>Work context is unavailable</h3>
            <p>{readState.message || "Your current access does not include this view."}</p>
          </div>
        ) : null}
        {readState.status === "error" ? (
          <div className={styles.error} role="alert" aria-live="assertive">
            <h3>Work context could not be loaded</h3>
            <p>{readState.message}</p>
          </div>
        ) : null}
        {searchActive && (!activeSearch || activeSearch.status === "loading") ? (
          <div className={styles.status} role="status" aria-live="polite" aria-busy="true">
            <span className={styles.spinner} aria-hidden="true" /> Searching authorized work context…
          </div>
        ) : null}
        {activeSearch?.status === "error" ? (
          <StateMessage kind="error" title="Work-context search could not be completed">
            {activeSearch.message}
          </StateMessage>
        ) : null}
        {readState.status === "empty" ? (
          <div className={styles.emptyState} role="status">
            <h3>No visible work context</h3>
            <p>No clients, workstreams, or groups were included in this response.</p>
          </div>
        ) : null}
        {readState.status === "ready" && (!searchActive || searchResult) ? (
          <ReadyContext
            projection={searchResult?.projection ?? readState.projection}
            departmentCreation={departmentCreation}
            searchActive={searchActive}
          />
        ) : null}
      </section>
    </div>
  );
}
