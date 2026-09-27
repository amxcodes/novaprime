import { expect, test } from "bun:test";
import { distanceMeters } from "./attendance.js";

test("geofence distance uses the shortest path across the antimeridian", () => {
  expect(distanceMeters(0, 179.999, 0, -179.999)).toBeLessThan(250);
});
