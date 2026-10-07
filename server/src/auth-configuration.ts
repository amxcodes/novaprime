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

/**
 * Select the source Better Auth uses for the client address. Netlify's native
 * request context is authoritative, so its adapter opts into the private
 * header that it overwrites on every request. Cloudflare keeps its trusted
 * edge headers, and a directly exposed Node server keeps the private socket-IP
 * header (or Better Auth's safe shared fallback when it is absent).
 */
export function authenticationIpAddressHeaders(
  environment = process.env,
): string[] {
  if (environment.NOVA_AUTH_IP_ADDRESS_HEADER === "x-nova-remote-ip") {
    return ["x-nova-remote-ip"];
  }

  return environment.NOVA_TRUST_PROXY_HEADERS === "true"
    ? ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]
    : ["x-nova-remote-ip"];
}

/**
 * Better Auth skips its origin/CSRF middleware for this read-only session
 * endpoint. Resolving tenant-specific origins there adds a serial database
 * round trip without protecting a state-changing request.
 */
export function canSkipDatabaseTrustedOrigins(request?: Request): boolean {
  if (!request || request.method !== "GET") return false;
  try {
    return new URL(request.url).pathname === "/api/auth/get-session";
  } catch {
    return false;
  }
}
