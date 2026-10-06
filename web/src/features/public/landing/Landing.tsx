import { Button } from "../../../design-system";
import type { LandingProps } from "./contracts";
import styles from "./Landing.module.css";

const paths = [
  {
    intent: "I already have a NOVA account",
    description: "Sign in to continue to your workspace. What you can see depends on your role.",
    action: "Sign in",
    on: "onSignIn",
  },
  {
    intent: "I have an invitation",
    description: "Accept your invitation and choose your own password to join the team.",
    action: "Accept invitation",
    on: "onAcceptInvitation",
  },
  {
    intent: "I’m setting up a new organisation",
    description: "Create the founding account and organisation with your one-time setup token.",
    action: "Begin setup",
    on: "onSetup",
  },
  {
    intent: "I’m comparing deployment options",
    description: "Review hosted and self-managed paths before configuring NOVA.",
    action: "Read the deployment guide",
    on: "onDeploymentGuide",
  },
] as const;

export function Landing({ onSetup, onSignIn, onAcceptInvitation, onDeploymentGuide }: LandingProps) {
  const actions = { onSetup, onSignIn, onAcceptInvitation, onDeploymentGuide };

  return (
    <main className={styles.root} aria-labelledby="landing-title">
      <div className={styles.layout}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.eyebrowMark} aria-hidden="true" />People operations, built to move</p>
            <h1 id="landing-title">Start with a secure team foundation.</h1>
            <p className={styles.lede}>
              NOVA keeps organisation rules in PostgreSQL and presents the same workflow on hosted or direct deployments.
            </p>
          </div>

          <aside className={styles.principles} aria-labelledby="principles-title">
            <p className={styles.principlesLabel}>A clear foundation</p>
            <h2 id="principles-title">Built for how your team runs NOVA.</h2>
            <ul className={styles.principleList}>
              <li><span aria-hidden="true">01</span><span>Organisation rules stay in PostgreSQL.</span></li>
              <li><span aria-hidden="true">02</span><span>Hosted and direct deployments share one workflow.</span></li>
              <li><span aria-hidden="true">03</span><span>Each team member sets their own password.</span></li>
            </ul>
          </aside>
        </section>

        <section className={styles.paths} aria-labelledby="paths-title">
          <header className={styles.pathsHeader}>
            <div>
              <p className={styles.pathsEyebrow}>Choose your next step</p>
              <h2 id="paths-title">Where are you in your NOVA journey?</h2>
            </div>
            <p>Choose the option that matches what you came to do.</p>
          </header>

          <ol className={styles.pathList}>
            {paths.map((path, index) => (
              <li key={path.on}>
                <Button
                  type="button"
                  variant="quiet"
                  className={styles.pathAction}
                  onClick={actions[path.on]}
                  aria-labelledby={`landing-path-intent-${index} landing-path-action-${index}`}
                  aria-describedby={`landing-path-description-${index}`}
                >
                  <span className={styles.pathRow}>
                    <span className={styles.pathCopy}>
                      <span className={styles.pathIntent} id={`landing-path-intent-${index}`}>{path.intent}</span>
                      <span className={styles.pathDescription} id={`landing-path-description-${index}`}>{path.description}</span>
                    </span>
                    <span className={styles.pathActionLabel} id={`landing-path-action-${index}`}>{path.action}</span>
                    <span className={styles.pathArrow} aria-hidden="true">→</span>
                  </span>
                </Button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
