import { expect, test } from "bun:test";
import { geofenceOfficeOptions } from "./admin-read";

test("geofence office options expose only selector identity and editable geofence values", () => {
  const payload = geofenceOfficeOptions([
    {
      id: "office-1",
      name: "Bengaluru",
      latitude: "12.9716000",
      longitude: "77.5946000",
      attendance_geofence_radius_meters: 150,
    },
    {
      id: "office-2",
      name: "Remote Hub",
      latitude: null,
      longitude: null,
      attendance_geofence_radius_meters: 150,
    },
  ]);

  expect(payload).toEqual({
    offices: [
      {
        id: "office-1",
        name: "Bengaluru",
        latitude: 12.9716,
        longitude: 77.5946,
        geofenceRadiusMeters: 150,
      },
      {
        id: "office-2",
        name: "Remote Hub",
        latitude: null,
        longitude: null,
        geofenceRadiusMeters: 150,
      },
    ],
  });
});
