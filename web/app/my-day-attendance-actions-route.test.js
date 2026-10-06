import { describe, expect, test } from "bun:test";
import { createMyDayAttendanceActionRoute, readOfficeCoordinates } from "./my-day-attendance-actions-route.ts";

describe("My Day attendance action route", () => {
  test("keeps the existing command endpoints and payloads", async () => {
    const calls = [];
    const successes = [];
    const run = createMyDayAttendanceActionRoute({
      requestCommand: async (...args) => calls.push(args),
      isCurrentCommand: () => true,
      onSuccess: (action) => successes.push(action),
      getOfficeCoordinates: async () => ({ latitude: 12.9, longitude: 77.6, accuracyMeters: 8 }),
    });

    for (const action of ["check-in-office", "check-in-wfh", "check-out", "change-to-wfh", "change-to-office"]) {
      await run(action, { id: action });
    }

    expect(calls).toEqual([
      ["/api/attendance/check-in", { mode: "office", latitude: 12.9, longitude: 77.6, accuracyMeters: 8 }],
      ["/api/attendance/check-in", { mode: "wfh" }],
      ["/api/attendance/check-out", undefined],
      ["/api/attendance/change-mode", { mode: "wfh" }],
      ["/api/attendance/change-mode", { mode: "office" }],
    ]);
    expect(successes).toEqual(["check-in-office", "check-in-wfh", "check-out", "change-to-wfh", "change-to-office"]);
  });

  test("does not call protected commands for stale actions or stale location callbacks", async () => {
    const calls = [];
    let current = false;
    const run = createMyDayAttendanceActionRoute({
      requestCommand: async (...args) => calls.push(args),
      isCurrentCommand: () => current,
      onSuccess: () => calls.push("success"),
      getOfficeCoordinates: async () => ({ latitude: 1, longitude: 2, accuracyMeters: 3 }),
    });

    await run("check-in-wfh", {});
    expect(calls).toEqual([]);

    current = true;
    const pendingLocation = run("check-in-office", {});
    current = false;
    await pendingLocation;
    expect(calls).toEqual([]);
  });

  test("fails closed for actions outside the current attendance contract", async () => {
    const requestCommand = async () => { throw new Error("must not request"); };
    const run = createMyDayAttendanceActionRoute({
      requestCommand,
      isCurrentCommand: () => true,
      onSuccess: () => {},
    });

    await expect(run("delete-attendance", {})).rejects.toThrow("MY_DAY_ATTENDANCE_ACTION_INVALID");
    await expect(run("toString", {})).rejects.toThrow("MY_DAY_ATTENDANCE_ACTION_INVALID");
  });

  test("reads office location with the existing accuracy and timeout options", async () => {
    let receivedOptions;
    const coordinates = await readOfficeCoordinates({
      getCurrentPosition(success, _failure, options) {
        receivedOptions = options;
        success({ coords: { latitude: 12.9, longitude: 77.6, accuracy: 8 } });
      },
    });

    expect(coordinates).toEqual({ latitude: 12.9, longitude: 77.6, accuracyMeters: 8 });
    expect(receivedOptions).toEqual({ enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
  });

  test("maps denied geolocation to the existing location-required error", async () => {
    const denied = await readOfficeCoordinates({
      getCurrentPosition(_success, fail) { fail({ code: 1 }); },
    }).catch((error) => error);

    expect(denied).toMatchObject({ message: "ATTENDANCE_LOCATION_REQUIRED", code: "ATTENDANCE_LOCATION_REQUIRED" });
  });
});
