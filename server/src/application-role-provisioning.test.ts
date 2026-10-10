import { expect, test } from "bun:test";
import {
  applicationRoleProvisioningSql,
  applicationRoleTableGrantsSql,
} from "./application-role-provisioning.js";

test("routine bootstrap creates the restricted role without changing an existing password", () => {
  const sql = applicationRoleProvisioningSql("local-password");

  expect(sql).toContain("CREATE ROLE nova_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  expect(sql).toContain("PASSWORD 'local-password'");
  expect(sql).not.toContain("ALTER ROLE nova_app LOGIN PASSWORD");
  expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nova TO nova_app");
  expect(sql).toContain("IF to_regclass('nova.background_tick_lease') IS NOT NULL THEN");
  expect(sql).toContain("REVOKE ALL ON TABLE nova.background_tick_lease FROM nova_app");
  expect(sql.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nova TO nova_app")).toBeLessThan(
    sql.indexOf("REVOKE ALL ON TABLE nova.background_tick_lease FROM nova_app"),
  );
});

test("schema-wide app grants conditionally restore the private maintenance lease ACL", () => {
  const sql = applicationRoleTableGrantsSql("nova_app");

  expect(sql).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA nova");
  expect(sql).toContain("IF to_regclass('nova.background_tick_lease') IS NOT NULL THEN");
  expect(sql).toContain("EXECUTE 'REVOKE ALL ON TABLE nova.background_tick_lease FROM nova_app'");
  expect(() => applicationRoleTableGrantsSql("nova_app; DROP TABLE nova.people")).toThrow("APPLICATION_DATABASE_ROLE_INVALID");
});

test("password rotation is included only when explicitly requested", () => {
  const sql = applicationRoleProvisioningSql("new-password", { rotateExistingPassword: true });

  expect(sql).toContain("ELSE\n    ALTER ROLE nova_app LOGIN PASSWORD 'new-password';");
});

test("role password SQL literal escapes quotes and rejects NUL bytes", () => {
  expect(applicationRoleProvisioningSql("operator's-password")).toContain("PASSWORD 'operator''s-password'");
  expect(() => applicationRoleProvisioningSql("bad\0password")).toThrow("NOVA_APP_PASSWORD_INVALID");
});
