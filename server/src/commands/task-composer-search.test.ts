import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseTaskComposerSearchInput, taskComposerSearchPattern } from "./task-composer-search-model.js";

const target = "00000000-0000-4000-8000-000000000001";
const group = "00000000-0000-4000-8000-000000000002";
const commandSource = readFileSync(new URL("./task-composer-search.ts", import.meta.url), "utf8");

describe("task composer search input", () => {
  test("requires one bounded target context and accepts only one bounded query", () => {
    const parsed = parseTaskComposerSearchInput(new Request(
      `https://nova.test/api/task-composer/catalog?workstreamKind=client&workstreamId=${target}&groupId=${group}&q=review`,
    ));
    expect(parsed).toEqual({ kind: "client", id: target, groupId: group, search: "review" });
    expect(parseTaskComposerSearchInput(new Request("https://nova.test/api/task-composer/catalog"))).toBeNull();
    expect(parseTaskComposerSearchInput(new Request(
      `https://nova.test/api/task-composer/catalog?workstreamKind=client&workstreamId=${target}&q=one&q=two`,
    ))).toBeNull();
    expect(parseTaskComposerSearchInput(new Request(
      `https://nova.test/api/task-composer/catalog?workstreamKind=other&workstreamId=${target}`,
    ))).toBeNull();
    expect(parseTaskComposerSearchInput(new Request(
      `https://nova.test/api/task-composer/catalog?workstreamKind=client&workstreamId=${target}&q=${"x".repeat(121)}`,
    ))).toBeNull();
  });

  test("escapes SQL wildcard syntax as literal title text", () => {
    expect(taskComposerSearchPattern("  R&D_50%\\  ")).toBe("%R&D^_50^%^\\%");
    expect(taskComposerSearchPattern("   ")).toBeNull();
  });
});

describe("correction source search SQL", () => {
  test("bounds matches to completed non-correction tasks and applies current task visibility grants", () => {
    expect(commandSource).toContain("tasks.status IN ('approved', 'done')");
    expect(commandSource).toContain("tasks.correction_of_task_id IS NULL");
    expect(commandSource).toContain("tasks.organisation_id = $1");
    expect(commandSource).toContain("tasks.client_workstream_id = $4::uuid");
    expect(commandSource).toContain("tasks.organisation_workstream_id = $4::uuid");
    expect(commandSource).toContain("tasks.title ILIKE $5 ESCAPE '^'");
    expect(commandSource).toContain("nova.person_business_date($2)");
    expect(commandSource).toContain("permissionKey: \"'tasks.view'\"");
    expect(commandSource).toContain("LIMIT $6");
    expect(commandSource).not.toContain("actor_assignments.person_id");
    expect(commandSource).not.toContain("reviewer_person_id");
  });
});

describe("task definition search projection", () => {
  test("returns only bounded active definitions with the grant flags the client requires", () => {
    expect(commandSource).toContain("tasks.catalog.view");
    expect(commandSource).toContain("tasks.catalog.manage");
    expect(commandSource).toContain("FROM nova.task_catalog_entries");
    expect(commandSource).toContain("archived_at IS NULL");
    expect(commandSource).toContain("LIMIT $3");
    expect(commandSource).toContain("permissions: { view: canViewCatalog, manage: canManageCatalog }");
  });

  test("checks task-create target scope before exposing department choices", () => {
    expect(commandSource).toContain('"organisation.settings.manage"');
    expect(commandSource).toContain('"tasks.create"');
    expect(commandSource).toContain("FROM nova.organisation_departments");
    expect(commandSource).toContain("archived_at IS NULL");
  });
});
