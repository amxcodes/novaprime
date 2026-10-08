import type { DeploymentAssistantProps } from "./contracts";
import { Button } from "../../../design-system/primitives/Button";
import { DEPLOYMENT_PATHS, DEPLOYMENT_STAGES } from "./catalog";
import { deploymentCanSelectStage } from "./flow";
import {
  projectDeploymentPresentation,
  type DeploymentSchedulerPresentation,
  type DeploymentWiringPresentation,
} from "./presentation";
import styles from "./DeploymentAssistant.module.css";

function FormattedText({ children }: { children: string }) {
  const segments = children.split(/`([^`]+)`/g);
  return <>{segments.map((segment, index) => index % 2 === 1
    ? <code key={index}>{segment}</code>
    : segment)}</>;
}

function WiringPanel({ wiring }: { wiring: DeploymentWiringPresentation }) {
  return (
    <section className="deployment-places" aria-label="How deployment services connect">
      <h3>How your services connect</h3>
      <p className="small"><FormattedText>{wiring.summary}</FormattedText></p>
      <div className="deployment-architecture" aria-label="NOVA deployment connection">
        <span>{wiring.source}</span><span aria-hidden="true">→</span><span>{wiring.runtime}</span><span aria-hidden="true">↔</span><span>{wiring.database}</span>
        <span className="deployment-architecture-scheduler"><FormattedText>{wiring.scheduler}</FormattedText></span>
      </div>
      <p className="deployment-provider-boundary"><strong>Important:</strong> This checklist does not log in to or change provider accounts. Follow the current step to apply the change there, then use its confirmation instructions.</p>
      <details className="deployment-map-details">
        <summary>See where each part is configured</summary>
        <div className="deployment-places-grid">
          {wiring.places.map((place) => <article className="deployment-place" key={place.label}>
            <span>{place.label}</span><strong>{place.title}</strong>
            <p><b>You do:</b> <FormattedText>{place.action}</FormattedText></p>
            <p><b>Then:</b> <FormattedText>{place.automatic}</FormattedText></p>
            <p><b>Confirm:</b> <FormattedText>{place.check}</FormattedText></p>
          </article>)}
        </div>
        <details className="deployment-wiring">
          <summary>Full action map: what you do and what it changes</summary>
          <h3>Your action → what happens next</h3>
          <div className="deployment-action-scroll" role="region" aria-label="Deployment action map" tabIndex={0}>
            <table className="deployment-action-map">
              <thead><tr><th scope="col">Part</th><th scope="col">Your action / where</th><th scope="col">What happens</th></tr></thead>
              <tbody>{wiring.rows.map((row) => <tr key={row.part}>
                <th scope="row">{row.part}</th><td data-label="Your action"><FormattedText>{row.action}</FormattedText></td><td data-label="What happens"><FormattedText>{row.result}</FormattedText></td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      </details>
    </section>
  );
}

function SchedulerPanel({ panel }: { panel: DeploymentSchedulerPresentation }) {
  return (
    <section className="deployment-scheduler-grid" aria-label="Review the profile scheduler">
      <h3>{panel.title}</h3>
      <p className="small"><FormattedText>{panel.description}</FormattedText></p>
      <p className="deployment-scheduler-default" role="status">Profile default: {panel.schedulerLabel}</p>
      {panel.outcome ? <div className="deployment-scheduler-outcome" role="note">
        <h4>How the profile scheduler runs</h4>
        <dl>
          <div><dt>Where you change it</dt><dd><FormattedText>{panel.outcome.where}</FormattedText></dd></div>
          <div><dt>What switches it on</dt><dd><FormattedText>{panel.outcome.activates}</FormattedText></dd></div>
          <div><dt>Where you confirm</dt><dd><FormattedText>{panel.outcome.check}</FormattedText></dd></div>
        </dl>
      </div> : null}
      {panel.file ? <details className="deployment-scheduler-plan" open={panel.expanded}>
        <summary>Show the exact provider settings and steps</summary>
        <div className="deployment-scheduler-plan-body">
          <p><strong>Repository files:</strong> <FormattedText>{panel.file}</FormattedText></p>
          {panel.actions.length ? <>
            <p><strong>{panel.actionLead}</strong></p>
            <ol>{panel.actions.map((action, index) => <li key={`${action.phase}-${index}`}>
              <p><strong>Where:</strong> <FormattedText>{action.where}</FormattedText></p>
              <p><FormattedText>{action.change}</FormattedText></p>
              <p><strong>What that does:</strong> <FormattedText>{action.result}</FormattedText></p>
            </li>)}</ol>
          </> : <p className="notice" role="note"><FormattedText>{panel.emptyMessage}</FormattedText></p>}
          <p><strong>How to verify:</strong> <FormattedText>{panel.verify}</FormattedText></p>
          {panel.warning ? <p className="notice warning" role="note"><FormattedText>{panel.warning}</FormattedText></p> : null}
        </div>
      </details> : <p className="small">Select a profile to see its exact scheduled-work configuration and verification steps.</p>}
    </section>
  );
}

export function DeploymentAssistant(props: DeploymentAssistantProps) {
  const presentation = projectDeploymentPresentation(props);
  const {
    selectedPath,
    current,
    needsProbe,
    probePassed,
    probeWarning,
    wiring,
    schedulerPanel,
    nextDisabled,
    completionDisabled,
  } = presentation;

  return (
    <section className={styles.root}>
      <div className={styles.header}>
        <div>
          <p className="eyebrow">Guided deployment</p>
          <h1 className={styles.title}>Follow the exact setup for your host.</h1>
          <p className="lede">This guide will not change your GitHub, hosting, or database accounts. For every part, it shows where you make the change, what happens automatically afterward, and where to confirm it.</p>
        </div>
        <Button className={styles.publicAction} variant="secondary" size="compact" data-deployment-reset onClick={props.onReset}>Reset checklist</Button>
      </div>
      <p id="feedback" className="notice" role="status" hidden />
      {!selectedPath ? (
        <>
          <h2>1. Choose the runtime shape</h2>
          <p className="small">This selects a deployment recipe. It does not change NOVA’s PostgreSQL schema, permissions, authentication, RLS, or domain behaviour.</p>
          <div className="deployment-path-grid">
            {presentationPathCards(props, props.onSelectPath)}
          </div>
        </>
      ) : (
        <div className="deployment-layout">
          <aside className="deployment-steps" aria-label="Deployment progress">
            {DEPLOYMENT_STAGES.map((stage, index) => <button
              className={`deployment-stage${index === props.stage ? " active" : ""}${props.completed[index] ? " complete" : ""}`}
              type="button" data-deployment-stage={index} key={stage.title}
              aria-current={index === props.stage ? "step" : undefined}
              disabled={!deploymentCanSelectStage({ path: props.pathId, stage: props.stage, scheduler: props.scheduler, completed: props.completed }, index, props.probe)}
              onClick={() => props.onSelectStage(index)}
            >
              <span className="deployment-stage-number">{props.completed[index] ? "✓" : String(index + 1)}</span>
              <span><strong>{stage.title}</strong><small>{stage.summary}</small></span>
            </button>)}
          </aside>
          <div className="deployment-content">
            <div className="deployment-selected"><span className="eyebrow">Selected path</span><strong>{selectedPath.title}</strong><span>{selectedPath.text}</span></div>
            {wiring ? <WiringPanel wiring={wiring} /> : null}
            <h2 id="deployment-current-heading" aria-live="polite" aria-atomic="true">{current.title}</h2>
            <p className="deployment-location"><strong>Where this happens:</strong> <FormattedText>{current.where}</FormattedText></p>
            <p className="lede"><FormattedText>{current.body}</FormattedText></p>
            <ul className="deployment-checklist">{current.items.map((item, index) => <li key={`${props.stage}-${index}`}><FormattedText>{item}</FormattedText></li>)}</ul>
            {needsProbe ? <section className="deployment-scheduler-grid" aria-label="Live deployment checks">
              <p className="small">Read-only check against this NOVA deployment. It sends no credentials. Rerun after changing runtime or database configuration.</p>
              {props.probe?.checking
                ? <p className="notice" role="status" aria-live="polite">Checking API and database readiness…</p>
                : props.probe
                  ? <div className={`notice${probeWarning ? " warning" : ""}`} role="status" aria-live="polite">
                    <p>API health: {props.probe.health ? "ready" : "unavailable"}</p>
                    <p>Database/runtime readiness: {props.probe.ready ? "ready" : "not ready"}</p>
                    {props.stage === 4 ? <><p>Selected scheduler: {props.scheduler || "not selected"}</p><p>Runtime selector: {props.probe.scheduler || "not configured"}</p></> : null}
                    <p className="small">Checked at {props.probe.checkedAt} UTC. Readiness checks core tables and the profile scheduler setting; it does not verify the full migration ledger, database-role privileges, or the live provider trigger.</p>
                  </div>
                  : <p className="small" role="status" aria-live="polite">Not checked in this browser session.</p>}
              <Button className={styles.publicAction} variant="secondary" data-deployment-probe disabled={props.probe?.checking === true} onClick={props.onProbe}>Check API and database</Button>
            </section> : null}
            {schedulerPanel ? <SchedulerPanel panel={schedulerPanel} /> : null}
            <label className="check deployment-confirm"><input type="checkbox" data-deployment-complete checked={presentation.completed} disabled={completionDisabled} onChange={(event) => props.onCompleteChange(event.currentTarget.checked)} /> I applied these steps and verified them at the provider.</label>
            <div className={styles.formActions}>
              <Button className={styles.publicAction} variant="secondary" data-deployment-back disabled={props.stage === 0} onClick={props.onBack}>Back</Button>
              <Button className={styles.publicAction} data-deployment-next disabled={nextDisabled} onClick={props.onNext}>{props.stage === DEPLOYMENT_STAGES.length - 1 ? "Open NOVA setup" : "Continue"}</Button>
            </div>
            <p className="small"><button className="link-button" type="button" data-nav="home" onClick={props.onNavigateHome}>Return to NOVA home</button></p>
          </div>
        </div>
      )}
    </section>
  );
}

function presentationPathCards(props: DeploymentAssistantProps, onSelectPath: DeploymentAssistantProps["onSelectPath"]) {
  // The catalog is intentionally feature-owned so this screen and the host
  // share the same supported path list without duplicating provider rules.
  return DEPLOYMENT_PATHS.map((path) => <button
    className={`deployment-path${path.id === props.pathId ? " selected" : ""}`}
    type="button" data-deployment-path={path.id} key={path.id} onClick={() => onSelectPath(path.id)}
  >
    <span className="status">{path.badge}</span><strong>{path.title}</strong><span>{path.text}</span>
  </button>);
}
