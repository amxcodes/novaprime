export type AuthenticationConfiguration = Readonly<{
  baseUrl: string;
  databaseUrl: string;
  secret: string;
}>;

function required(name: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[name];

  if (!value) {
    throw new Error("AUTHENTICATION_CONFIGURATION_REQUIRED");
  }

  return value;
}

export function authenticationConfiguration(
  environment = process.env,
): AuthenticationConfiguration {
  const secret = required("BETTER_AUTH_SECRET", environment);
  const baseUrl = required("BETTER_AUTH_URL", environment);
  const databaseUrl = required("DATABASE_URL", environment);

  if (secret.length < 32) {
    throw new Error("AUTHENTICATION_CONFIGURATION_REQUIRED");
  }

  const parsedBaseUrl = new URL(baseUrl);
  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
    throw new Error("AUTHENTICATION_CONFIGURATION_REQUIRED");
  }

  return Object.freeze({ baseUrl: parsedBaseUrl.origin, databaseUrl, secret });
}

export function bootstrapToken(environment = process.env): string {
  return required("NOVA_BOOTSTRAP_TOKEN", environment);
}
