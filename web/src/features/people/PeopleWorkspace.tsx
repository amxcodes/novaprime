import { useEffect, useRef } from "react";
import { Button } from "../../design-system";
import type { PeopleDirectoryProps } from "./PeopleDirectory";
import { PeopleDirectory } from "./PeopleDirectory";
import type { PersonDirectoryRecord } from "./contracts";
import { PersonHistory, type PersonHistoryProps } from "./PersonHistory";
import { peopleWorkspaceFocusRecoveryTarget } from "./presentation";
import styles from "./PeopleWorkspace.module.css";

export interface PeopleWorkspaceSelection {
  /** The host's current ?person= URL value; selection is never stored locally. */
  personId: string;
  /** A record from an already-authorized directory page, or null for direct links. */
  person: PersonDirectoryRecord | null;
  /** Existing host-owned history read and commands for this exact person. */
  history: Omit<PersonHistoryProps, "person" | "onBack">;
}

export type PeopleWorkspaceProps =
  | {
      directory: PeopleDirectoryProps;
      /** Selection projected from the URL, with history state only for that target. */
      selected: PeopleWorkspaceSelection | null;
      onBackToDirectory: () => void;
    }
  | {
      /** Direct/deep-linked detail routes intentionally skip directory reads. */
      directory: null;
      selected: PeopleWorkspaceSelection;
      onBackToDirectory: () => void;
    };

/**
 * Responsive composition for already-authorized People reads.
 * The route host remains the authority for URL selection, directory scope, and history access.
 */
export function PeopleWorkspace({ directory, selected, onBackToDirectory }: PeopleWorkspaceProps) {
  const hasDirectory = directory !== null;
  const hasSelection = selected !== null;
  const selectedPerson = selected && selected.person?.id === selected.personId ? selected.person : null;
  const directoryPane = useRef<HTMLDivElement | null>(null);
  const detailPane = useRef<HTMLDivElement | null>(null);
  const previousPersonId = useRef(selected?.personId ?? null);
  const focusTransition = useRef<"select" | "back" | null>(null);

  useEffect(() => {
    const currentPersonId = selected?.personId ?? null;
    const target = peopleWorkspaceFocusRecoveryTarget(
      previousPersonId.current,
      currentPersonId,
      focusTransition.current,
    );
    const returningPersonId = previousPersonId.current;
    focusTransition.current = null;
    previousPersonId.current = currentPersonId;

    if (target === "history-heading") {
      detailPane.current?.querySelector<HTMLElement>("[data-people-history-heading]")?.focus();
    } else if (target === "directory-action") {
      const actions = directoryPane.current?.querySelectorAll<HTMLElement>("[data-person-history-action]");
      const action = Array.from(actions ?? []).find(
        (element) => element.dataset.personHistoryAction === returningPersonId,
      );
      (action ?? directoryPane.current?.querySelector<HTMLElement>("[data-people-directory-heading]"))?.focus();
    }
  }, [selected?.personId]);

  const handleBackToDirectory = () => {
    if (selected) focusTransition.current = "back";
    onBackToDirectory();
  };

  return (
    <div
      className={styles.feature}
      data-has-directory={hasDirectory ? "true" : "false"}
      data-has-selection={hasSelection ? "true" : "false"}
    >
      <div className={styles.workspace}>
        {directory ? (
          <div className={styles.directoryPane} data-people-directory-pane ref={directoryPane}>
            <PeopleDirectory
              {...directory}
              selectedPersonId={selected?.personId ?? null}
              onSelectPerson={(personId) => {
                if (personId !== selected?.personId) focusTransition.current = "select";
                directory.onSelectPerson(personId);
              }}
            />
          </div>
        ) : null}

        {selected ? (
          <div className={styles.detailPane} data-people-detail-pane ref={detailPane}>
            {directory ? (
              <div className={styles.detailToolbar}>
                <Button type="button" variant="quiet" onClick={handleBackToDirectory}>
                  Clear selected person
                </Button>
              </div>
            ) : null}
            <PersonHistory
              {...selected.history}
              person={selectedPerson}
              onBack={handleBackToDirectory}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
