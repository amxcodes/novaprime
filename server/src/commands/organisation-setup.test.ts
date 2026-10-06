import { expect, test } from "bun:test";
import {
  completeOnboardingOfficeDateSql,
  completeOnboardingPersonSql,
  completeOnboardingRelationsSql,
  completeOnboardingInput,
  departmentInput,
  attendancePolicyInput,
  officeInput,
} from "./organisation-setup";

test("onboarding revalidates the person and every selected relationship inside the actor organization", () => {
  expect(completeOnboardingPersonSql.toUpperCase()).toContain("WHERE ID = $1 AND ORGANISATION_ID = $2 FOR UPDATE");

  const relations = completeOnboardingRelationsSql.toUpperCase();
  expect(relations).toContain("FROM NOVA.OFFICES\n    WHERE ID = $1 AND ORGANISATION_ID = $5 AND ARCHIVED_AT IS NULL");
  expect(relations).toContain("FROM NOVA.ORGANISATION_DEPARTMENTS\n    WHERE ID = $2 AND ORGANISATION_ID = $5 AND ARCHIVED_AT IS NULL");
  expect(relations).toContain("FROM NOVA.ROLES\n    WHERE ID = $3 AND ORGANISATION_ID = $5 AND ARCHIVED_AT IS NULL AND IS_PROTECTED = FALSE");
  expect(relations).toContain("MANAGERS.ORGANISATION_ID = $5");
  expect(relations).toContain("MANAGER_STATUS.STATUS IN ('ACTIVE', 'NOTICE')");
  expect(completeOnboardingOfficeDateSql.toUpperCase()).toContain(
    "WHERE ID = $1 AND ORGANISATION_ID = $2 AND ARCHIVED_AT IS NULL",
  );
});

test("accepts bounded office and organisation-department setup input", () => {
  expect(officeInput({
    location: "Kochi, Kerala",
    name: "Kochi",
    timezone: "Asia/Kolkata",
    latitude: 9.9312,
    longitude: 76.2673,
    geofenceRadiusMeters: 150,
  })).toEqual({
    location: "Kochi, Kerala",
    name: "Kochi",
    timezone: "Asia/Kolkata",
    latitude: 9.9312,
    longitude: 76.2673,
    geofenceRadiusMeters: 150,
  });
  expect(departmentInput({ name: " Creative " })).toEqual({ name: "Creative" });
});

test("rejects an invalid office timezone and incomplete onboarding input", () => {
  expect(officeInput({
    location: "Kochi",
    name: "Kochi",
    timezone: "not/a-timezone",
    latitude: 9.9312,
    longitude: 76.2673,
    geofenceRadiusMeters: 150,
  })).toBeUndefined();
  expect(completeOnboardingInput({
    designation: "Designer",
    employmentStartsOn: "2026-02-30",
    officeId: "a",
  })).toBeUndefined();
});

test("accepts an onboarding completion with server-validated identifiers", () => {
  expect(completeOnboardingInput({
    designation: "Designer",
    employmentStartsOn: "2026-09-19",
    managerPersonId: "11111111-1111-4111-8111-111111111111",
    officeId: "22222222-2222-4222-8222-222222222222",
    organisationDepartmentId: "33333333-3333-4333-8333-333333333333",
    personId: "44444444-4444-4444-8444-444444444444",
    roleId: "55555555-5555-4555-8555-555555555555",
  })).toEqual({
    designation: "Designer",
    employmentStartsOn: "2026-09-19",
    managerPersonId: "11111111-1111-4111-8111-111111111111",
    officeId: "22222222-2222-4222-8222-222222222222",
    organisationDepartmentId: "33333333-3333-4333-8333-333333333333",
    personId: "44444444-4444-4444-8444-444444444444",
    roleId: "55555555-5555-4555-8555-555555555555",
  });
  expect(completeOnboardingInput({
    designation: "Designer",
    employmentStartsOn: "2026-09-19",
    managerPersonId: null,
    officeId: "22222222-2222-4222-8222-222222222222",
    organisationDepartmentId: "33333333-3333-4333-8333-333333333333",
    personId: "44444444-4444-4444-8444-444444444444",
    roleId: "55555555-5555-4555-8555-555555555555",
  })).toEqual({
    designation: "Designer",
    employmentStartsOn: "2026-09-19",
    officeId: "22222222-2222-4222-8222-222222222222",
    organisationDepartmentId: "33333333-3333-4333-8333-333333333333",
    personId: "44444444-4444-4444-8444-444444444444",
    roleId: "55555555-5555-4555-8555-555555555555",
  });
});

test("accepts effective-dated attendance policy setup and rejects invalid duration", () => {
  expect(attendancePolicyInput({
    effectiveOn: "2026-09-22",
    mode: "scheduled",
    requiredAttendanceMinutes: 510,
  })).toEqual({
    effectiveOn: "2026-09-22",
    mode: "scheduled",
    requiredAttendanceMinutes: 510,
  });
  expect(attendancePolicyInput({
    effectiveOn: "2026-09-22",
    mode: "hour_based",
    requiredAttendanceMinutes: 0,
  })).toBeUndefined();
});
