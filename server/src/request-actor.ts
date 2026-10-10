import { AsyncLocalStorage } from "node:async_hooks";
import { authenticationSession, type AuthenticationSession } from "./authentication-session.js";
import { database, databaseRequestContext, type DatabaseRequestContext } from "./db.js";

export type RequestActor = Readonly<{
  context: DatabaseRequestContext;
  session: AuthenticationSession;
  status: "invited" | "onboarding" | "active" | "notice" | "offboarding" | "frozen" | "exited";
}>;

type RequestActorResolutionScope = {
  authenticationKey?: string;
  actor?: Promise<RequestActor | undefined>;
};

const requestActorResolutionScope = new AsyncLocalStorage<RequestActorResolutionScope>();

/** Share session and actor lookup only across one bounded, read-only request batch. */
export function withRequestActorResolutionCache<T>(operation: () => Promise<T>): Promise<T> {
  return requestActorResolutionScope.run({}, operation);
}

export function requestActor(request: Request): Promise<RequestActor | undefined> {
  const scope = requestActorResolutionScope.getStore();
  if (!scope) return resolveRequestActor(request);

  const authenticationKey = [
    request.headers.get("cookie") ?? "",
    request.headers.get("authorization") ?? "",
  ].join("\u0000");
  if (scope.actor && scope.authenticationKey !== authenticationKey) {
    return resolveRequestActor(request);
  }
  if (!scope.actor) {
    scope.authenticationKey = authenticationKey;
    scope.actor = resolveRequestActor(request);
  }
  return scope.actor;
}

async function resolveRequestActor(request: Request): Promise<RequestActor | undefined> {
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
