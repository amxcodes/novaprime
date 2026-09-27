export type AuthenticationSession = Readonly<{
  identitySubject: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}>;

export async function authenticationSession(
  request: Request,
): Promise<AuthenticationSession | undefined> {
  const { auth } = await import("./auth.js");
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return undefined;
  }

  return Object.freeze({
    identitySubject: session.user.id,
    email: session.user.email.toLowerCase(),
    emailVerified: session.user.emailVerified,
    displayName: session.user.name,
  });
}
