import { authenticationConfiguration } from "./auth-configuration.js";
import { database } from "./db.js";

/**
 * Public origin is deployment configuration, not a tenant-controlled URL.
 * Tenant settings may select only an origin that the operator has explicitly
 * allowed through NOVA_ALLOWED_ORIGINS.
 */
export function normalizePublicOrigin(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate) return undefined;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function configuredPublicOrigins(environment = process.env): readonly string[] {
  const configuration = authenticationConfiguration(environment);
  const configured = (environment.NOVA_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizePublicOrigin(value));

  if (configured.some((origin) => !origin)) {
    throw new Error("AUTHENTICATION_CONFIGURATION_REQUIRED");
  }

  return Object.freeze([...new Set([configuration.baseUrl, ...configured as string[]])]);
}

export function configuredPublicHosts(environment = process.env): readonly string[] {
  return Object.freeze(configuredPublicOrigins(environment).map((origin) => new URL(origin).host));
}

export function publicUrl(origin: string, path: string): string {
  const normalized = normalizePublicOrigin(origin);
  if (!normalized || !path.startsWith('/')) {
    throw new Error("PUBLIC_URL_INVALID");
  }
  try {
    const target = new URL(path, normalized);
    // URL treats network-path references (//host/path, and backslash
    // equivalents for HTTP(S)) as a new authority. Keep generated NOVA links
    // on the operator-approved public origin.
    if (target.origin !== normalized) throw new Error("PUBLIC_URL_INVALID");
    return target.toString();
  } catch {
    throw new Error("PUBLIC_URL_INVALID");
  }
}

/** Rebase a Better Auth-generated absolute link onto the selected origin. */
export function rebasePublicUrl(rawUrl: string, origin: string): string {
  const source = new URL(rawUrl);
  const target = new URL(origin);
  target.pathname = source.pathname;
  target.search = source.search;
  target.hash = source.hash;
  return target.toString();
}

function fallbackOrigin(): string {
  return authenticationConfiguration().baseUrl;
}

function safeConfiguredOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizePublicOrigin(value);
  if (!normalized) return undefined;
  return configuredPublicOrigins().includes(normalized) ? normalized : undefined;
}

export async function publicOriginForOrganisation(
  organisationId: string,
): Promise<string> {
  const fallback = fallbackOrigin();
  try {
    const result = await database().query<{ origin: string | null }>(
      "SELECT nova.public_origin_for_organisation($1) AS origin",
      [organisationId],
    );
    return safeConfiguredOrigin(result.rows[0]?.origin) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Returns the explicitly selected origin, if one exists.  Callers that send
 * links must use this rather than the deployment fallback: a fallback is
 * useful for trusted-origin bootstrapping, but it is not safe for a customer
 * link or callback before the first-run origin has been selected.
 */
export async function configuredPublicOriginForOrganisation(
  organisationId: string,
): Promise<string | undefined> {
  try {
    const result = await database().query<{ origin: string | null }>(
      "SELECT nova.public_origin_for_organisation($1) AS origin",
      [organisationId],
    );
    return safeConfiguredOrigin(result.rows[0]?.origin);
  } catch {
    return undefined;
  }
}

/** Used by Better Auth callbacks before a normal request actor exists. */
export async function publicOriginForIdentity(identitySubject: string): Promise<string> {
  const fallback = fallbackOrigin();
  try {
    const result = await database().query<{ origin: string | null }>(
      "SELECT nova.public_origin_for_identity($1) AS origin",
      [identitySubject],
    );
    return safeConfiguredOrigin(result.rows[0]?.origin) ?? fallback;
  } catch {
    return fallback;
  }
}

/** See configuredPublicOriginForOrganisation; identity form for auth callbacks. */
export async function configuredPublicOriginForIdentity(
  identitySubject: string,
): Promise<string | undefined> {
  try {
    const result = await database().query<{ origin: string | null }>(
      "SELECT nova.public_origin_for_identity($1) AS origin",
      [identitySubject],
    );
    return safeConfiguredOrigin(result.rows[0]?.origin);
  } catch {
    return undefined;
  }
}

export function requestPublicOrigin(request: Request): string {
  const requestOrigin = normalizePublicOrigin(new URL(request.url).origin);
  return requestOrigin && configuredPublicOrigins().includes(requestOrigin)
    ? requestOrigin
    : fallbackOrigin();
}
