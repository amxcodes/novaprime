import { describe, expect, it } from "bun:test";
import type { OrganizationStructureProjectionInput } from "./projection";
import { projectOrganizationStructureProps } from "./projection";

function baseInput(overrides: Partial<OrganizationStructureProjectionInput> = {}): OrganizationStructureProjectionInput {
  return {
    canView: true,
    canManageOrganization: true,
    canManageOfficeGeofence: true,
    offices: {
      result: { offices: [{
        id: "office-1",
        name: "Bengaluru HQ",
        location: "Bengaluru, India",
        timezone: "Asia/Kolkata",
        latitude: 12.9716,
        longitude: 77.5946,
        geofenceRadiusMeters: 150,
        archivedAt: "private status not returned by the API",
        internalNotes: "must not reach the component",
      }] },
    },
    departments: {
      result: { departments: [{
        id: "department-1",
        name: "Engineering",
        internalNotes: "must not reach the component",
      }] },
    },
    onCreateOffice() {},
    onCreateDepartment() {},
    ...overrides,
  };
}

describe("organization structure feature projection", () => {
  it("projects only office and department summary fields", () => {
    const props = projectOrganizationStructureProps(baseInput());
    expect(props.offices).toEqual({ status: "ready", items: [{
      id: "office-1",
      name: "Bengaluru HQ",
      location: "Bengaluru, India",
      timezone: "Asia/Kolkata",
      latitude: 12.9716,
      longitude: 77.5946,
      geofenceRadiusMeters: 150,
    }] });
    expect(props.departments).toEqual({
      status: "ready", items: [{ id: "department-1", name: "Engineering" }],
    });
    expect(JSON.stringify(props)).not.toMatch(/archivedAt|internalNotes|private status/);
  });

  it("preserves independent unavailable, error, loading, and ready-empty reads", () => {
    const props = projectOrganizationStructureProps(baseInput({
      offices: {
        result: { readError: "PREREQUISITE_PERMISSION_REQUIRED", offices: [] },
        issue: { message: "Organization settings access is required." },
      },
      departments: { result: { departments: [] } },
    }));
    expect(props.offices).toEqual({
      status: "unavailable", items: [], message: "Organization settings access is required.",
    });
    expect(props.departments).toEqual({ status: "ready", items: [] });

    const failed = projectOrganizationStructureProps(baseInput({
      offices: { result: { readError: "REQUEST_FAILED" }, issue: { message: "Office request failed." } },
      departments: { result: { readState: "loading" } },
    }));
    expect(failed.offices).toEqual({ status: "error", items: [], message: "Office request failed." });
    expect(failed.departments).toEqual({ status: "loading", items: [] });
  });

  it("fails closed for malformed collection and rows instead of rendering partial or empty data", () => {
    const malformed = projectOrganizationStructureProps(baseInput({
      offices: { result: { offices: [{ id: "office-bad", name: "Incomplete" }] } },
      departments: { result: { departments: "not-a-list" } },
    }));
    expect(malformed.offices.status).toBe("error");
    expect(malformed.offices.items).toEqual([]);
    expect(malformed.departments.status).toBe("error");
    expect(malformed.departments.items).toEqual([]);
  });

  it("does not forward protected reads or management affordances when the feature is hidden", () => {
    const props = projectOrganizationStructureProps(baseInput({ canView: false }));
    expect(props.canManageOrganization).toBe(false);
    expect(props.canManageOfficeGeofence).toBe(false);
    expect(props.offices).toEqual({
      status: "unavailable", items: [], message: "The office list is not available for this access.",
    });
    expect(props.departments.items).toEqual([]);
  });
});
