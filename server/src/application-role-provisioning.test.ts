import { expect, test } from "bun:test";
import { applicationRoleProvisioningSql } from "./application-role-provisioning.js";

test("routine bootstrap creates the restricted role without changing an existing password", () => {
  const sql = applicationRoleProvisioningSql("local-password");

  expect(sql).toContain("CREATE ROLE nova_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  expect(sql).toContain("PASSWORD 'local-password'");
  expect(sql).not.toContain("ALTER ROLE nova_app LOGIN PASSWORD");
  expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nova TO nova_app");
});

test("password rotation is included only when explicitly requested", () => {
  const sql = applicationRoleProvisioningSql("new-password", { rotateExistingPassword: true });

  expect(sql).toContain("ELSE\n    ALTER ROLE nova_app LOGIN PASSWORD 'new-password';");
});

test("role password SQL literal escapes quotes and rejects NUL bytes", () => {
  expect(applicationRoleProvisioningSql("operator's-password")).toContain("PASSWORD 'operator''s-password'");
  expect(() => applicationRoleProvisioningSql("bad\0password")).toThrow("NOVA_APP_PASSWORD_INVALID");
});
