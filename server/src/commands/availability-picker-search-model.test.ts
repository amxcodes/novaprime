import { describe, expect, test } from "bun:test";
import {
  availabilityOfficePickerSql,
  availabilityPickerMaximumResults,
  availabilityPickerPermissionsSql,
  availabilityShiftPickerSql,
  parseAvailabilityConfigurationPicker,
  parseWfhPolicyPicker,
  wfhDepartmentPickerSql,
  wfhOfficePickerSql,
  wfhOrganisationTargetWriteSql,
  wfhOfficeTargetWriteSql,
  wfhDepartmentTargetWriteSql,
  wfhPersonPickerSql,
  wfhPersonTargetWritePermissionSql,
  wfhPersonViewAccessSql,
} from "./availability-picker-search-model.js";

const base = "https://nova.test/api/availability/picker-options";

describe("availability picker search contracts", () => {
  test("availability picker parsing accepts only supported kind and purpose pairs and bounds q", () => {
    expect(parseAvailabilityConfigurationPicker(new Request(`${base}?kind=office&purpose=calendar&q=%20Central%20`))).toEqual({
      kind: "office", purpose: "calendar", query: "central", limit: availabilityPickerMaximumResults,
    });
    expect(parseAvailabilityConfigurationPicker(new Request(`${base}?kind=shift&purpose=calendar`))).toMatchObject({
      kind: "shift", purpose: "calendar", query: "", limit: 30,
    });
    for (const query of [
      "?kind=office", "?kind=office&purpose=calendar&purpose=holiday", "?kind=shift&purpose=holiday",
      "?kind=person&purpose=calendar", "?kind=office&purpose=calendar&kind=shift", "?kind=office&purpose=calendar&q=a&q=b",
      `?kind=office&purpose=calendar&q=${"x".repeat(101)}`,
    ]) expect(parseAvailabilityConfigurationPicker(new Request(base + query))).toBeUndefined();
  });

  test("WFH picker parsing rejects repeated or unsupported kinds and bounds normalized search", () => {
    expect(parseWfhPolicyPicker(new Request(`${base}?kind=organisation_department&q=%20People%20`))).toEqual({
      kind: "organisation_department", query: "people", limit: 30,
    });
    for (const query of [
      "", "?kind=other", "?kind=person&kind=office", "?kind=person&q=a&q=b", `?kind=person&q=${"x".repeat(101)}`,
    ]) expect(parseWfhPolicyPicker(new Request(base + query))).toBeUndefined();
  });

  test("availability pickers are permission checked, bounded, active-only, and return minimal names", () => {
    const grants = availabilityPickerPermissionsSql.toUpperCase();
    expect(grants).toContain("GRANTS.PERMISSION_KEY = ANY($3::TEXT[])");
    expect(grants).toContain("GRANTS.SCOPE = 'ORGANISATION'");
    expect(grants).toContain("ASSIGNMENTS.EFFECTIVE_ON <= NOVA.PERSON_BUSINESS_DATE($1)");
    expect(grants).toContain("ROLES.ORGANISATION_ID = $2");

    for (const sql of [availabilityOfficePickerSql, wfhOfficePickerSql]) {
      const upper = sql.toUpperCase();
      expect(upper).toContain("OFFICES.ORGANISATION_ID = $1");
      expect(upper).toContain("OFFICES.ARCHIVED_AT IS NULL");
      expect(upper).toContain("POSITION($2 IN LOWER(OFFICES.NAME))");
      expect(upper).toContain("LIMIT $3");
      expect(upper).not.toContain("SELECT *");
    }
    const shifts = availabilityShiftPickerSql.toUpperCase();
    expect(shifts).toContain("SHIFTS.ORGANISATION_ID = $1");
    expect(shifts).toContain("SHIFTS.ARCHIVED_AT IS NULL");
    expect(shifts).toContain("LIMIT $3");
  });

  test("WFH target queries preserve people-view scope and the writer rechecks the selected person", () => {
    const department = wfhDepartmentPickerSql.toUpperCase();
    expect(department).toContain("DEPARTMENTS.ORGANISATION_ID = $1");
    expect(department).toContain("DEPARTMENTS.ARCHIVED_AT IS NULL");
    expect(department).toContain("POSITION($2 IN LOWER(DEPARTMENTS.NAME))");
    expect(department).toContain("LIMIT $3");

    const people = wfhPersonPickerSql.toUpperCase();
    expect(people).toContain("PEOPLE.ORGANISATION_ID = $1");
    expect(people).toContain("ACTOR_GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
    expect(people).toContain("ACTOR_GRANTS.SCOPE = 'ORGANISATION'");
    expect(people).toContain("ACTOR_GRANTS.SCOPE = 'OWN_RECORD'");
    expect(people).toContain("ACTOR_GRANTS.SCOPE = 'OFFICE'");
    expect(people).toContain("ACTOR_GRANTS.SCOPE = 'ORGANISATION_DEPARTMENT'");
    expect(people).toContain("POSITION($3 IN LOWER(COALESCE(PEOPLE.DISPLAY_NAME");
    expect(people).toContain("LIMIT $4");
    expect(people).not.toContain("SELECT *");

    const anyPeopleView = wfhPersonViewAccessSql.toUpperCase();
    expect(anyPeopleView).toContain("GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
    expect(anyPeopleView).toContain("GRANTS.SCOPE IN ('ORGANISATION', 'OWN_RECORD', 'OFFICE', 'ORGANISATION_DEPARTMENT')");
    const writeGuard = wfhPersonTargetWritePermissionSql.toUpperCase();
    expect(writeGuard).toContain("PEOPLE.ID = $3 AND PEOPLE.ORGANISATION_ID = $2");
    expect(writeGuard).toContain("ACTOR_GRANTS.PERMISSION_KEY = 'PEOPLE.VIEW'");
    expect(writeGuard).toContain("ACTOR_GRANTS.SCOPE = 'OFFICE'");
    expect(writeGuard).toContain("ACTOR_GRANTS.SCOPE = 'ORGANISATION_DEPARTMENT'");

    for (const sql of [wfhOfficeTargetWriteSql, wfhDepartmentTargetWriteSql]) {
      const upper = sql.toUpperCase();
      expect(upper).toContain("WHERE ID = $1 AND ORGANISATION_ID = $2 AND ARCHIVED_AT IS NULL");
    }
    expect(wfhOrganisationTargetWriteSql("office")).toBe(wfhOfficeTargetWriteSql);
    expect(wfhOrganisationTargetWriteSql("organisation_department")).toBe(wfhDepartmentTargetWriteSql);
  });
});
