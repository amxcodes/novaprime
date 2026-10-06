import type { FormEvent, ReactNode } from "react";
import { Button, EmptyState, StateMessage } from "../../design-system";
import type { WorkPageNotice, WorkPageSection, WorkPageSectionContent } from "./page-contracts";
import styles from "./WorkPage.module.css";

export interface WorkPageProps {
  title: string;
  description?: string;
  sections: ReadonlyArray<WorkPageSection>;
  sectionContent?: WorkPageSectionContent;
  state?: "loading" | "ready" | "error";
  message?: string;
  notices?: ReadonlyArray<WorkPageNotice>;
  timelineDate?: string;
  showTimelineDate?: boolean;
  timelineDateUnavailable?: boolean;
  onLoadTimelineDate?: (date: string) => void;
}

export function WorkFeatureMessage({ title, message }: { title: string; message: string }) {
  return <StateMessage kind="error" title={title}>{message}</StateMessage>;
}

function WorkSection({
  section,
  content,
  hasContent,
}: {
  section: WorkPageSection;
  content?: ReactNode;
  hasContent: boolean;
}) {
  const body = hasContent
    ? content
    : <div className={styles.featureSlot} data-work-slot={section.id} />;
  if (!section.heading) {
    return <div className={styles.section} data-section={section.id}>{body}</div>;
  }

  return (
    <section
      className={styles.section}
      data-section={section.id}
      aria-labelledby={`work-${section.id}-heading`}
    >
      <header className={styles.sectionHeader}>
        <h2 id={`work-${section.id}-heading`}>{section.heading}</h2>
        {section.description ? <p>{section.description}</p> : null}
      </header>
      {body}
    </section>
  );
}

function TimelineDateControl({
  date,
  hidden,
  onLoad,
}: {
  date?: string;
  hidden: boolean;
  onLoad?: (date: string) => void;
}) {
  if (!onLoad) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form).get("date");
    if (typeof value === "string" && value) onLoad(value);
  };

  return (
    <form className={styles.timelineControl} onSubmit={submit} hidden={hidden}>
      <label htmlFor="work-timeline-date">Timeline date</label>
      <input id="work-timeline-date" name="date" type="date" required defaultValue={date} />
      <Button type="submit" variant="secondary" size="compact">Load day</Button>
    </form>
  );
}

export function WorkPage({
  title,
  description,
  sections,
  sectionContent,
  state = "ready",
  message,
  notices = [],
  timelineDate,
  showTimelineDate = false,
  timelineDateUnavailable = false,
  onLoadTimelineDate,
}: WorkPageProps) {
  return (
    <section className={styles.page} aria-labelledby="work-page-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Work</p>
        <h1 id="work-page-title">{title}</h1>
        {description ? <p className={styles.lede}>{description}</p> : null}
      </header>

      <p id="feedback" className="notice" role="status" hidden />

      {state === "loading" ? (
        <StateMessage kind="loading" title={title === "Task details" ? "Task details are loading" : title === "Pending review" ? "Review is loading" : "Work is loading"}>
          {message ?? "Loading the work features available to you."}
        </StateMessage>
      ) : null}
      {state === "error" ? (
        <StateMessage kind="error" title="Work is unavailable">
          {message ?? "Refresh the page to try again."}
        </StateMessage>
      ) : null}

      {state === "ready" ? (
        <div className={styles.board}>
          {showTimelineDate ? (
            <TimelineDateControl
              date={timelineDate}
              hidden={timelineDateUnavailable}
              onLoad={onLoadTimelineDate}
            />
          ) : null}
          {notices.map((notice) => (
            <StateMessage key={notice.id} kind={notice.kind} className={styles.notice}>
              {notice.message}
            </StateMessage>
          ))}
          {sections.length ? (
            <div className={styles.sections}>
              {sections.map((section) => {
                const hasContent = Boolean(sectionContent) &&
                  Object.prototype.hasOwnProperty.call(sectionContent, section.id);
                return (
                  <WorkSection
                    key={section.id}
                    section={section}
                    hasContent={hasContent}
                    content={hasContent ? sectionContent?.[section.id] : undefined}
                  />
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No Work features are available here."
              description="Available work features appear here when your access includes them."
            />
          )}
        </div>
      ) : null}
    </section>
  );
}
