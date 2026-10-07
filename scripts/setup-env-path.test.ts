import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSetupEnvironmentPath } from "./setup-env-path";

const directories: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "nova-setup-env-"));
  directories.push(root);
  return root;
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("resolveSetupEnvironmentPath", () => {
  test("defaults to the root env file and accepts an isolated file inside the checkout", () => {
    const root = makeRoot();
    mkdirSync(join(root, "private"));

    expect(resolveSetupEnvironmentPath(root)).toBe(join(root, ".env"));
    expect(resolveSetupEnvironmentPath(root, "private/.env.qa-supabase")).toBe(
      join(root, "private", ".env.qa-supabase"),
    );
  });

  test("rejects parent traversal, absolute paths, and empty arguments", () => {
    const root = makeRoot();

    expect(() => resolveSetupEnvironmentPath(root, "../outside.env")).toThrow("SETUP_ENV_FILE_OUTSIDE_REPOSITORY");
    expect(() => resolveSetupEnvironmentPath(root, join(tmpdir(), "outside.env"))).toThrow("SETUP_ENV_FILE_OUTSIDE_REPOSITORY");
    expect(() => resolveSetupEnvironmentPath(root, "   ")).toThrow("SETUP_ENV_FILE_INVALID");
  });

  test("rejects an env file symlinked outside the checkout", () => {
    const root = makeRoot();
    const outside = join(tmpdir(), `nova-outside-${Date.now()}.env`);
    writeFileSync(outside, "DATABASE_URL=private\n");
    directories.push(outside);
    try {
      symlinkSync(outside, join(root, ".env.qa-supabase"), "file");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))) {
        return;
      }
      throw error;
    }

    expect(() => resolveSetupEnvironmentPath(root, ".env.qa-supabase")).toThrow("SETUP_ENV_FILE_SYMLINK_UNSUPPORTED");
  });

  test("rejects a dangling env-file symlink instead of writing through it", () => {
    const root = makeRoot();
    const outside = join(tmpdir(), `nova-missing-${Date.now()}.env`);
    try {
      symlinkSync(outside, join(root, ".env.qa-supabase"), "file");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))) {
        return;
      }
      throw error;
    }

    expect(() => resolveSetupEnvironmentPath(root, ".env.qa-supabase")).toThrow("SETUP_ENV_FILE_SYMLINK_UNSUPPORTED");
  });

  test("rejects a parent directory symlinked outside the checkout", () => {
    const root = makeRoot();
    const outside = join(tmpdir(), `nova-outside-dir-${Date.now()}`);
    mkdirSync(outside);
    directories.push(outside);
    symlinkSync(outside, join(root, "private"), "junction");

    expect(() => resolveSetupEnvironmentPath(root, "private/.env.qa-supabase")).toThrow("SETUP_ENV_FILE_OUTSIDE_REPOSITORY");
  });
});
