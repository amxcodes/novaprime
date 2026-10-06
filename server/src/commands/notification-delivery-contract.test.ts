import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const commandSource = readFileSync(new URL("./notifications.ts", import.meta.url), "utf8");
const deliveryMigration = readFileSync(
  new URL("../../../database/migrations/0036_notification_delivery_operations.sql", import.meta.url),
  "utf8",
);
const permissionCatalogue = readFileSync(
  new URL("../../../database/migrations/0024_permission_scope_catalogue.sql", import.meta.url),
  "utf8",
);

function functionSource(name: string, nextName: string): string {
  const start = commandSource.indexOf(`export async function ${name}(`);
  const end = commandSource.indexOf(`export async function ${nextName}(`, start + 1);
  if (start < 0 || end < 0) throw new Error(`Could not locate ${name} command boundary`);
  return commandSource.slice(start, end);
}

const readDelivery = functionSource("readNotificationDelivery", "requeueNotificationDelivery");
const requeueDelivery = commandSource.slice(commandSource.indexOf("export async function requeueNotificationDelivery("));

describe("notification delivery API authorization contract", () => {
  test("reads require the exact organization-scoped delivery-view grant before reading the outbox", () => {
    const permission = readDelivery.indexOf('hasOrganisationPermission(transaction, actor.context.userId, "notifications.delivery.view")');
    const read = readDelivery.indexOf("nova.read_notification_delivery($1)");

    expect(permission).toBeGreaterThan(-1);
    expect(permission).toBeLessThan(read);
    expect(readDelivery).toContain('if (result === "PERMISSION_DENIED") return json({ error: result }, 403)');
    expect(readDelivery).not.toContain('"notifications.manage"');
    expect(readDelivery).not.toContain("hasOfficePermission");
  });

  test("requeue requires its independent organization-scoped manage grant and hides denied or stale rows", () => {
    const permission = requeueDelivery.indexOf('hasOrganisationPermission(transaction, actor.context.userId, "notifications.manage")');
    const update = requeueDelivery.indexOf("nova.requeue_notification_delivery($1)");

    expect(permission).toBeGreaterThan(-1);
    expect(permission).toBeLessThan(update);
    expect(requeueDelivery).toContain('if (result === "PERMISSION_DENIED") return json({ error: result }, 403)');
    expect(requeueDelivery).toContain('if (!result) return json({ error: "NOTIFICATION_DELIVERY_NOT_FOUND" }, 404)');
    expect(requeueDelivery).toContain("const validId = notificationId(id)");
    expect(requeueDelivery).toContain('if (!validId) return json({ error: "NOTIFICATION_DELIVERY_NOT_FOUND" }, 404)');
    expect(requeueDelivery).not.toContain('"notifications.delivery.view"');
  });

  test("organization scope is the only grant scope supported for both permissions", () => {
    expect(permissionCatalogue).toMatch(/\('notifications\.manage',\s*ARRAY\['organisation'\]::nova\.permission_scope\[\]\)/);
    expect(permissionCatalogue).toMatch(/\('notifications\.delivery\.view',\s*ARRAY\['organisation'\]::nova\.permission_scope\[\]\)/);
    expect(commandSource).toContain("AND grants.scope = 'organisation'");
  });

  test("database replay only changes same-organization failed or dead-letter deliveries", () => {
    const replay = deliveryMigration.slice(deliveryMigration.indexOf("CREATE FUNCTION nova.requeue_notification_delivery"));
    expect(replay).toContain("AND organisation_id = nova.request_organisation_id()");
    expect(replay).toContain("AND status IN ('failed', 'dead_letter')");
    expect(replay).toContain("SELECT EXISTS (SELECT 1 FROM updated)");
    expect(replay).not.toMatch(/status\s+IN\s*\([^)]*pending/i);

    const read = deliveryMigration.slice(0, deliveryMigration.indexOf("CREATE FUNCTION nova.requeue_notification_delivery"));
    expect(read).toContain("WHERE outbox.organisation_id = nova.request_organisation_id()");
    expect(read).toContain("LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)");
  });
});
