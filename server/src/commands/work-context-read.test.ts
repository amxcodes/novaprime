import { describe, expect, mock, test } from "bun:test";

const actorId = "00000000-0000-4000-8000-000000000001";
const organisationId = "00000000-0000-4000-8000-000000000002";
const queries: Array<{ sql: string; values: unknown[] }> = [];
let fixture = {
  clients: [] as Array<Record<string, unknown>>,
  clientWorkstreams: [] as Array<Record<string, unknown>>,
  organisationWorkstreams: [] as Array<Record<string, unknown>>,
  groups: [] as Array<Record<string, unknown>>,
};

mock.module("../auth-configuration.js", () => ({ authenticationConfiguration: () => ({}) }));
mock.module("../request-actor.js", () => ({
  requestActor: async () => ({ context: { userId: actorId, organisationId } }),
  isNormalOperationalActor: () => true,
}));
mock.module("../db.js", () => ({
  withDatabaseRequest: async (_context: unknown, operation: (transaction: unknown) => unknown) =>
    operation({
      query: async (sql: string, values: unknown[] = []) => {
        queries.push({ sql, values });
        if (sql.includes("AS eligible")) return { rows: [{ eligible: false }] };
        if (sql.includes("AS permitted")) return { rows: [{ permitted: false }] };
        if (sql.includes("FROM nova.clients clients")) return { rows: fixture.clients };
        if (sql.includes("FROM nova.client_workstreams workstreams")) return { rows: fixture.clientWorkstreams };
        if (sql.includes("FROM nova.organisation_workstreams workstreams")) {
          return { rows: fixture.organisationWorkstreams };
        }
        if (sql.includes("FROM nova.work_groups groups")) return { rows: fixture.groups };
        throw new Error(`Unexpected work-context query: ${sql}`);
      },
    }),
}));
mock.module("pg", () => ({ Pool: class Pool {}, Client: class Client {} }));

const { readWorkContext, workContextSearchPattern } = await import("./work-context.js");

function orgWorkstream(id: string, name: string) {
  return { id, name, can_view_workstream: true, can_create_group: false };
}

async function read(query: string) {
  queries.length = 0;
  const response = await readWorkContext(new Request(`https://nova.test/api/work-context?q=${encodeURIComponent(query)}`));
  return { response, result: await response.json() as Record<string, unknown> };
}

describe("database-side work-context search", () => {
  test("escapes SQL wildcard and escape characters as literal search text", () => {
    expect(workContextSearchPattern("  100%_off^  ")).toBe("%100^%^_off^^%");
    expect(workContextSearchPattern("%")).toBe("%^%%");
    expect(workContextSearchPattern("_")).toBe("%^_%");
    expect(workContextSearchPattern("^")).toBe("%^^%");
    expect(workContextSearchPattern("   ")).toBeNull();
  });

  test("binds escaped literal patterns to each permission-filtered query", async () => {
    fixture = {
      clients: [{ id: "client-1", name: "Acme %_ ^", can_view: true, can_create_workstream: false }],
      clientWorkstreams: [{
        id: "stream-1", client_id: "client-1", client_name: "Acme %_ ^", name: "Delivery %_ ^",
        billing_policy_class: "non_billable", billing_policy_revision: 1,
        can_manage_billing_policy: false, can_view_workstream: true, can_create_group: false, can_create_task: false,
      }],
      organisationWorkstreams: [],
      groups: [],
    };

    for (const [query, pattern] of [["%", "%^%%"], ["_", "%^_%"], ["^", "%^^%"]]) {
      const { response, result } = await read(query);
      expect(response.status).toBe(200);
      expect((result.clients as Array<{ id: string }>).map(({ id }) => id)).toEqual(["client-1"]);
      const protectedReads = queries.filter(({ sql }) =>
        sql.includes("FROM nova.clients clients") ||
        sql.includes("FROM nova.client_workstreams workstreams") ||
        sql.includes("FROM nova.organisation_workstreams workstreams") ||
        sql.includes("FROM nova.work_groups groups"));
      expect(protectedReads).toHaveLength(4);
      for (const { sql, values } of protectedReads) {
        expect(sql).toContain("ILIKE $3 ESCAPE '^'");
        expect(sql).toContain("active_grants AS MATERIALIZED");
        expect(values).toEqual([organisationId, actorId, pattern]);
      }
    }
  });

  test("keeps exact visible-ancestor/descendant search predicates in SQL", async () => {
    fixture = { clients: [], clientWorkstreams: [], organisationWorkstreams: [], groups: [] };
    await read("Launch");
    const sqlByEntity = new Map(queries.map(({ sql }) => [
      sql.includes("FROM nova.clients clients") ? "clients" :
        sql.includes("FROM nova.client_workstreams workstreams") ? "clientWorkstreams" :
          sql.includes("FROM nova.organisation_workstreams workstreams") ? "organisationWorkstreams" :
            sql.includes("FROM nova.work_groups groups") ? "groups" : "other",
      sql,
    ]));

    expect(sqlByEntity.get("clients")).toContain("JOIN nova.work_groups matched_group");
    expect(sqlByEntity.get("clientWorkstreams")).toContain("FROM nova.work_groups matched_group");
    expect(sqlByEntity.get("organisationWorkstreams")).toContain("FROM nova.work_groups matched_group");
    expect(sqlByEntity.get("groups")).toContain("client_workstreams.name ILIKE $3 ESCAPE '^'");
    expect(sqlByEntity.get("groups")).toContain("organisation_workstreams.name ILIKE $3 ESCAPE '^'");
    expect(sqlByEntity.get("clients")).toContain("grants.permission_key = 'groups.view'");
    expect(sqlByEntity.get("clientWorkstreams")).toContain("grants.permission_key = 'groups.view'");
    expect(sqlByEntity.get("clients")).toContain("grants.permission_key = 'workstreams.billing_policy.manage'");
    expect(sqlByEntity.get("groups")).toContain("grants.permission_key = 'workstreams.view'");
    expect(sqlByEntity.get("groups")).not.toContain("grants.permission_key = 'client_workstreams.view'");
    expect(sqlByEntity.get("groups")).not.toContain("grants.permission_key = 'organisation_workstreams.view'");
  });

  test("does not cap broad or empty-query organization results without pagination", async () => {
    fixture = {
      clients: [],
      clientWorkstreams: [],
      organisationWorkstreams: Array.from({ length: 500 }, (_unused, index) =>
        orgWorkstream(`stream-${index}`, `Operations ${index}`)),
      groups: [],
    };

    for (const query of ["Operations", ""]) {
      const { response, result } = await read(query);
      expect(response.status).toBe(200);
      expect((result.organisationWorkstreams as unknown[]).length).toBe(500);
      const orgQuery = queries.find(({ sql }) => sql.includes("FROM nova.organisation_workstreams workstreams"));
      expect(orgQuery).toBeDefined();
      expect(orgQuery?.sql).not.toMatch(/\bLIMIT\s+\$?\d+/i);
      expect(orgQuery?.values[2]).toBe(query ? `%${query}%` : null);
      expect(orgQuery?.sql).toContain("$3::text IS NULL");
    }
  });
});
