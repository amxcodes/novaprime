import { describe, expect, it } from "bun:test";
import { parseOfficeGeofenceDraft } from "./office-geofence-model";

describe("office geofence draft validation", () => {
  it("accepts coordinate boundaries and the full supported radius range", () => {
    expect(parseOfficeGeofenceDraft({ latitude: "-90", longitude: "180", radiusMeters: "10" }).input)
      .toEqual({ latitude: -90, longitude: 180, geofenceRadiusMeters: 10 });
    expect(parseOfficeGeofenceDraft({ latitude: "90", longitude: "-180", radiusMeters: "100000" }).input)
      .toEqual({ latitude: 90, longitude: -180, geofenceRadiusMeters: 100000 });
  });

  it("rejects coordinates outside geographic limits or beyond the existing five-decimal step", () => {
    const result = parseOfficeGeofenceDraft({ latitude: "90.00001", longitude: "181", radiusMeters: "150" });
    expect(result.input).toBeUndefined();
    expect(result.errors.latitude).toContain("between -90 and 90");
    expect(result.errors.longitude).toContain("between -180 and 180");

    const precisionResult = parseOfficeGeofenceDraft({ latitude: "12.123456", longitude: "77.5", radiusMeters: "150" });
    expect(precisionResult.input).toBeUndefined();
    expect(precisionResult.errors.latitude).toContain("at most five decimal places");
  });

  it("requires an integer radius from 10 to 100,000 metres", () => {
    for (const radiusMeters of ["", "9", "100001", "150.5"]) {
      const result = parseOfficeGeofenceDraft({ latitude: "12.5", longitude: "77.5", radiusMeters });
      expect(result.input).toBeUndefined();
      expect(result.errors.radiusMeters).toContain("whole-number radius from 10 to 100,000");
    }
  });
});
