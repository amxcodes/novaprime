/** Effective-grant fields used by My Day's self-service action discovery. */
export interface TodayActionGrantRead {
  readError?: string | null;
  grants?: readonly {
    permissionKey: string;
    selfApplicable?: boolean;
  }[];
}

export interface TodayActionCapability {
  permissionKey: string;
  applicability: "self";
}

/**
 * These are display/read-planning hints over the server's effective grants.
 * The server remains authoritative for every request and mutation.
 */
export const TODAY_ACTION_CAPABILITIES = Object.freeze({
  checkIn: Object.freeze({ permissionKey: "attendance.check_in", applicability: "self" }),
  checkOut: Object.freeze({ permissionKey: "attendance.check_out", applicability: "self" }),
  changeMode: Object.freeze({ permissionKey: "attendance.change_mode", applicability: "self" }),
  leaveRequest: Object.freeze({ permissionKey: "leave.request", applicability: "self" }),
  wfhRequest: Object.freeze({ permissionKey: "availability.wfh.request", applicability: "self" }),
} satisfies Record<string, TodayActionCapability>);

export type TodayActionCapabilityId = keyof typeof TODAY_ACTION_CAPABILITIES;
export type TodayActionCapabilityState = Record<TodayActionCapabilityId, boolean>;

function hasSelfApplicableGrant(
  read: TodayActionGrantRead,
  capability: TodayActionCapability,
): boolean {
  return read.grants?.some((grant) =>
    grant.permissionKey === capability.permissionKey && grant.selfApplicable === true,
  ) === true;
}

/** Evaluate only the explicit self-applicable bit; do not infer access from scope or role. */
export function evaluateTodayActionCapabilities(
  read: TodayActionGrantRead | null | undefined,
): Readonly<TodayActionCapabilityState> {
  if (read?.readError || !Array.isArray(read?.grants)) {
    return Object.freeze({
      checkIn: false,
      checkOut: false,
      changeMode: false,
      leaveRequest: false,
      wfhRequest: false,
    });
  }

  return Object.freeze(Object.fromEntries(
    Object.entries(TODAY_ACTION_CAPABILITIES).map(([id, capability]) => [
      id,
      capability.applicability === "self" && hasSelfApplicableGrant(read, capability),
    ]),
  ) as TodayActionCapabilityState);
}
