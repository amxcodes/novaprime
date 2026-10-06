/** UI hint only. Review commands repeat effective-permission and self-review checks. */
export function canReviewRequest(
  actorPersonId: string,
  requestPersonId: string,
  hasEffectivePermission: boolean,
): boolean {
  return hasEffectivePermission && actorPersonId !== requestPersonId;
}
