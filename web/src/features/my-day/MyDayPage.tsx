import { Button } from "../../design-system/primitives/Button";
import { EmptyState } from "../../design-system/primitives/EmptyState";
import type { MyDayModule, MyDayPageProps } from "./contracts";
import styles from "./MyDayPage.module.css";

function ModuleSlot({ module }: { module: MyDayModule }) {
  if (module.presentation === "island") {
    // The host mounts an independent React root in this stable, empty slot.
    return <div className={styles.islandSlot} data-my-day-slot={module.id} data-my-day-module={module.id} />;
  }

  const titleId = `my-day-${module.id}-heading`;
  return (
    <section
      className={[styles.module, module.wide ? styles.wideModule : ""].filter(Boolean).join(" ")}
      data-my-day-module={module.id}
      aria-labelledby={titleId}
    >
      <header className={styles.moduleHeader}>
        <h2 id={titleId}>{module.title}</h2>
        <p>{module.description}</p>
      </header>
      <div className={styles.moduleContent}>
        <div className={styles.contentSlot} data-my-day-slot={module.id}>
          <p role="status">Loading…</p>
        </div>
      </div>
    </section>
  );
}

export function MyDayPage({ modules, destinations, onNavigate, onCustomize }: MyDayPageProps) {
  const hasShortcuts = destinations.length > 0;
  return (
    <section className={styles.page} aria-labelledby="my-day-page-title">
      <div className={styles.content}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Your workspace</p>
          <h1 id="my-day-page-title">My Day</h1>
          <p className={styles.lede}>Attendance, work, and requests available to you today.</p>
        </header>

        <p id="feedback" className="notice" role="status" hidden />

        <div className={[styles.layout, hasShortcuts ? "" : styles.layoutSingleColumn].filter(Boolean).join(" ")}>
          <section className={styles.main} aria-label="My Day modules">
            {modules.length ? (
              <div className={styles.moduleGrid}>
                {modules.map((module) => <ModuleSlot key={module.id} module={module} />)}
              </div>
            ) : (
              <EmptyState
                className={styles.emptyState}
                title="Your My Day modules are hidden."
                description="Choose the modules you want in Settings."
                action={<Button variant="secondary" onClick={onCustomize}>Customize My Day</Button>}
              />
            )}
          </section>

          {hasShortcuts ? (
            <aside className={styles.shortcuts} aria-labelledby="my-day-shortcuts-heading">
              <header className={styles.shortcutsHeader}>
                <h2 id="my-day-shortcuts-heading">Quick access</h2>
                <p>Only workspace pages available to your account are listed.</p>
              </header>
              <div className={styles.shortcutGrid} role="group" aria-label="Available workspace pages">
                {destinations.map((destination) => (
                  <button
                    className={styles.shortcut}
                    key={destination.id}
                    type="button"
                    onClick={() => onNavigate(destination.id)}
                  >
                    <strong className={styles.shortcutTitle}>{destination.label}</strong>
                    <span className={styles.shortcutSummary}>{destination.summary}</span>
                  </button>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </section>
  );
}
