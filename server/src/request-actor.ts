import { authenticationSession, type AuthenticationSession } from "./authentication-session.js";
import { database, databaseRequestContext, type DatabaseRequestContext } from "./db.js";

export type RequestActor = Readonly<{
  context: DatabaseRequestContext;
  session: AuthenticationSession;
  status: "invited" | "onboarding" | "active" | "notice" | "offboarding" | "frozen" | "exited";
}>;

export async function requestActor(request: Request): Promise<RequestActor | undefined> {
  const session = await authenticationSession(request);
  if (!session) {
    return undefined;
  }

  const result = await database().query<{
    user_id: string;
    organisation_id: string;
    status: RequestActor["status"];
  }>(
    "SELECT user_id, organisation_id, status FROM nova.resolve_authenticated_actor_state($1)",
    [session.identitySubject],
  );
  const actor = result.rows[0];

  if (!actor) {
    return undefined;
  }

  return Object.freeze({
    context: databaseRequestContext(actor.user_id, actor.organisation_id),
    session,
    status: actor.status,
  });
}

export function isNormalOperationalActor(actor: RequestActor): boolean {
  return actor.session.emailVerified &&
    (actor.status === "active" || actor.status === "notice");
}
