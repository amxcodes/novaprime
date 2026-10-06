import { useEffect, useState, type ReactElement } from "react";
import { Button, StateMessage } from "../../design-system";
import type { ClientMembershipFeatureProps } from "./ClientMemberships";
import styles from "./AdminClientMembershipEditor.module.css";

type ClientMembershipFeature = (props: ClientMembershipFeatureProps) => ReactElement;

/** Loads the client-membership controller only after its disclosure is opened. */
export function AdminClientMembershipEditor(props: ClientMembershipFeatureProps): ReactElement {
  const [Feature, setFeature] = useState<ClientMembershipFeature | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setFeature(null);
    setFailure(null);
    import("./ClientMemberships")
      .then((module) => {
        if (current) setFeature(() => module.ClientMemberships);
      })
      .catch(() => {
        if (current) setFailure("Client membership controls could not load. Try again or reload Admin.");
      });
    return () => { current = false; };
  }, [attempt]);

  if (failure) {
    return (
      <div className={styles.state}>
        <StateMessage kind="error" title="Membership controls could not load">{failure}</StateMessage>
        <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry controls</Button>
      </div>
    );
  }
  if (!Feature) {
    return (
      <div className={styles.state}>
        <StateMessage kind="loading" title="Loading membership controls">Preparing this client’s membership controls.</StateMessage>
      </div>
    );
  }
  return <Feature {...props} />;
}
