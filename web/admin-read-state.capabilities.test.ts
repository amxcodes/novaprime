import { describe, expect, it } from "bun:test";
import {
  planMyDayReads,
  planTodayFeatures,
  TODAY_ACTION_CAPABILITIES,
} from "./admin-read-state.js";

describe("My Day action capability descriptors", () => {
  it("maps the existing self-applicable grants to the five action affordances", () => {
    expect(Object.fromEntries(Object.entries(TODAY_ACTION_CAPABILITIES).map(([key, value]) => [key, value.permissionKey]))).toEqual({
      checkIn: "attendance.check_in",
      checkOut: "attendance.check_out",
      changeMode: "attendance.change_mode",
      leaveRequest: "leave.request",
      wfhRequest: "availability.wfh.request",
    });

    const grants = Object.values(TODAY_ACTION_CAPABILITIES).map(({ permissionKey }) => ({
      permissionKey,
      selfApplicable: true,
      // The pre-existing selfApplicable contract is authoritative for these
      // flags; scope is intentionally not reinterpreted by the UI planner.
      scope: "organisation",
    }));
    expect(planTodayFeatures({ actorPersonId: "actor-1", grants })).toEqual({
      checkIn: true,
      checkOut: true,
      changeMode: true,
      leaveRequest: true,
      wfhRequest: true,
    });
  });

  it("does not infer actions from grants that are not marked self-applicable", () => {
    const grants = Object.values(TODAY_ACTION_CAPABILITIES).map(({ permissionKey }) => ({
      permissionKey,
      selfApplicable: false,
    }));
    expect(planTodayFeatures({ grants })).toEqual({
      checkIn: false,
      checkOut: false,
      changeMode: false,
      leaveRequest: false,
      wfhRequest: false,
    });
    expect(planMyDayReads({ grants }).attendanceActionContext).toBe(false);
  });

  it("fails closed when the grant read is missing or failed", () => {
    const denied = {
      checkIn: false,
      checkOut: false,
      changeMode: false,
      leaveRequest: false,
      wfhRequest: false,
    };
    expect(planTodayFeatures(undefined)).toEqual(denied);
    expect(planTodayFeatures({ readError: "REQUEST_FAILED", grants: [] })).toEqual(denied);
    expect(planTodayFeatures({ grants: null })).toEqual(denied);
  });

  it("keeps Super Admin route/read semantics separate from My Day grants", () => {
    const read = { isSuperAdmin: true, grants: [] };
    expect(planTodayFeatures(read)).toEqual({
      checkIn: false,
      checkOut: false,
      changeMode: false,
      leaveRequest: false,
      wfhRequest: false,
    });
    expect(planMyDayReads(read)).toMatchObject({
      attendance: false,
      assignments: false,
      attendanceActionContext: false,
      leaveRequest: false,
      wfhRequest: false,
      hasAny: false,
    });
  });

  it("shares attendance action eligibility with the request-planning context", () => {
    const read = {
      grants: [{ permissionKey: TODAY_ACTION_CAPABILITIES.checkOut.permissionKey, selfApplicable: true }],
    };
    expect(planMyDayReads(read)).toMatchObject({
      attendanceActionContext: true,
      leaveRequest: false,
      wfhRequest: false,
    });
  });
});
