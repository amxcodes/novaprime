import { expect, test } from "bun:test";
import { confirmSupabaseProject, validateSupabaseProjectConfirmation } from "./supabase-project-confirmation.js";

const projectRef = "ytfuwtlioxggccbarmdz";

test("Supabase writes require an exact project-ref confirmation", async () => {
  const prior = process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM;
  try {
    process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM = "hrlvietbqvkdovulzcie";
    await expect(confirmSupabaseProject(projectRef, "apply migrations"))
      .rejects.toThrow("SUPABASE_PROJECT_REF_CONFIRMATION_MISMATCH");

    process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM = projectRef;
    await expect(confirmSupabaseProject(projectRef, "apply migrations")).resolves.toBeUndefined();
  } finally {
    if (prior === undefined) delete process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM;
    else process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM = prior;
  }
});

test("Supabase project confirmation rejects malformed refs", async () => {
  expect(() => validateSupabaseProjectConfirmation(projectRef, undefined))
    .toThrow("SUPABASE_PROJECT_REF_CONFIRMATION_REQUIRED");
  expect(() => validateSupabaseProjectConfirmation(projectRef, "hrlvietbqvkdovulzcie"))
    .toThrow("SUPABASE_PROJECT_REF_CONFIRMATION_MISMATCH");
  expect(() => validateSupabaseProjectConfirmation("bad-ref", "bad-ref"))
    .toThrow("NOVA_SUPABASE_PROJECT_REF_INVALID");

  const prior = process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM;
  try {
    process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM = "not-a-project";
    await expect(confirmSupabaseProject("bad-ref", "apply migrations"))
      .rejects.toThrow("NOVA_SUPABASE_PROJECT_REF_INVALID");
  } finally {
    if (prior === undefined) delete process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM;
    else process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM = prior;
  }
});
