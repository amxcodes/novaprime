/** Navigation stays in the public-route host; the landing feature has no router dependency. */
export interface LandingProps {
  onSetup: () => void;
  onSignIn: () => void;
  onAcceptInvitation: () => void;
  onDeploymentGuide: () => void;
}
