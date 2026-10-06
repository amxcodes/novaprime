import type { AttendanceAction } from "../src/features/attendance/contracts";

type AttendanceCommand =
  | { path: "/api/attendance/check-in"; body: { mode: "office" }; requiresOfficeLocation: true }
  | { path: "/api/attendance/check-in"; body: { mode: "wfh" } }
  | { path: "/api/attendance/check-out" }
  | { path: "/api/attendance/change-mode"; body: { mode: "wfh" | "office" } };

interface OfficeCoordinates {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

type AttendanceRequestBody = { mode: "office" | "wfh" } & Partial<OfficeCoordinates>;

interface RouteServices<TContext> {
  requestCommand: (path: AttendanceCommand["path"], body?: AttendanceRequestBody) => Promise<unknown>;
  isCurrentCommand: (context: TContext) => boolean;
  onSuccess: (action: AttendanceAction) => void;
  getOfficeCoordinates?: () => Promise<OfficeCoordinates>;
}

const attendanceCommands: Record<AttendanceAction, AttendanceCommand> = {
  "check-in-office": { path: "/api/attendance/check-in", body: { mode: "office" }, requiresOfficeLocation: true },
  "check-in-wfh": { path: "/api/attendance/check-in", body: { mode: "wfh" } },
  "check-out": { path: "/api/attendance/check-out" },
  "change-to-wfh": { path: "/api/attendance/change-mode", body: { mode: "wfh" } },
  "change-to-office": { path: "/api/attendance/change-mode", body: { mode: "office" } },
};

function locationRequiredError(): Error & { code: "ATTENDANCE_LOCATION_REQUIRED" } {
  return Object.assign(new Error("ATTENDANCE_LOCATION_REQUIRED"), { code: "ATTENDANCE_LOCATION_REQUIRED" as const });
}

/** Read coordinates only after a current user action requests office check-in. */
export function readOfficeCoordinates(
  geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined = globalThis.navigator?.geolocation,
): Promise<OfficeCoordinates> {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
      reject(locationRequiredError());
      return;
    }

    geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 10000,
    });
  }).then((position) => ({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
  }), (error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 1) {
      throw locationRequiredError();
    }
    throw error;
  });
}

/**
 * Keep Attendance action-to-endpoint and location orchestration beside the
 * route boundary. The host still supplies authenticated transport and remains
 * responsible for server authorization, page/identity freshness, and feedback.
 */
export function createMyDayAttendanceActionRoute<TContext>({
  requestCommand,
  isCurrentCommand,
  onSuccess,
  getOfficeCoordinates = readOfficeCoordinates,
}: RouteServices<TContext>): (action: AttendanceAction, context: TContext) => Promise<void> {
  if (typeof requestCommand !== "function") throw new TypeError("requestCommand must be a function");
  if (typeof isCurrentCommand !== "function") throw new TypeError("isCurrentCommand must be a function");
  if (typeof onSuccess !== "function") throw new TypeError("onSuccess must be a function");
  if (typeof getOfficeCoordinates !== "function") throw new TypeError("getOfficeCoordinates must be a function");

  return async function runAttendanceAction(action, context) {
    if (!Object.prototype.hasOwnProperty.call(attendanceCommands, action)) {
      throw new TypeError("MY_DAY_ATTENDANCE_ACTION_INVALID");
    }
    const command = attendanceCommands[action];
    if (!isCurrentCommand(context)) return;

    let body: AttendanceRequestBody | undefined = command.path === "/api/attendance/check-out" ? undefined : command.body;
    if ("requiresOfficeLocation" in command && command.requiresOfficeLocation) {
      const coordinates = await getOfficeCoordinates();
      if (!isCurrentCommand(context)) return;
      body = { ...command.body, ...coordinates };
    }

    await requestCommand(command.path, body);
    if (!isCurrentCommand(context)) return;
    onSuccess(action);
  };
}
