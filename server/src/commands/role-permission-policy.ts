export interface RolePermissionGrantPolicyInput {
  permissionKey: string;
  scope: string;
  officeId?: string | null;
  organisationDepartmentId?: string | null;
  clientId?: string | null;
  clientWorkstreamId?: string | null;
  groupId?: string | null;
}

export interface CustomerRolePermissionCatalogueEntry {
  key: string;
  allowed_scopes: readonly string[];
  customer_role_assignable: boolean;
}

function permissionGrantSignature(grant: RolePermissionGrantPolicyInput): string {
  return JSON.stringify([
    grant.permissionKey,
    grant.scope,
    grant.officeId ?? "",
    grant.organisationDepartmentId ?? "",
    grant.clientId ?? "",
    grant.clientWorkstreamId ?? "",
    grant.groupId ?? "",
  ]);
}

/** A disabled catalogue grant may survive an edit only in its exact saved form. */
export function preservesUnavailablePermissionGrants(
  currentGrants: readonly RolePermissionGrantPolicyInput[],
  nextGrants: readonly RolePermissionGrantPolicyInput[],
  assignability: ReadonlyMap<string, boolean>,
): boolean {
  const current = currentGrants.filter((grant) => assignability.get(grant.permissionKey) === false)
    .map(permissionGrantSignature).sort();
  const next = nextGrants.filter((grant) => assignability.get(grant.permissionKey) === false)
    .map(permissionGrantSignature).sort();
  return current.length === next.length && current.every((signature, index) => signature === next[index]);
}

/** Validate the persisted catalogue contract, including immutable legacy grants. */
export function customerRolePermissionGrantsAreValid(
  currentGrants: readonly RolePermissionGrantPolicyInput[],
  nextGrants: readonly RolePermissionGrantPolicyInput[],
  catalogue: readonly CustomerRolePermissionCatalogueEntry[],
): boolean {
  const permissions = new Map(catalogue.map((permission) => [permission.key, permission]));
  const requiredKeys = new Set([
    ...currentGrants.map((grant) => grant.permissionKey),
    ...nextGrants.map((grant) => grant.permissionKey),
  ]);
  if ([...requiredKeys].some((permissionKey) => !permissions.has(permissionKey))) return false;
  if (nextGrants.some((grant) => {
    const permission = permissions.get(grant.permissionKey);
    return !permission || !permission.allowed_scopes.includes(grant.scope);
  })) return false;
  return preservesUnavailablePermissionGrants(
    currentGrants,
    nextGrants,
    new Map(catalogue.map((permission) => [permission.key, permission.customer_role_assignable])),
  );
}
