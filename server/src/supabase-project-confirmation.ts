export function validateSupabaseProjectConfirmation(projectRef: string, confirmation: string | undefined): void {
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("NOVA_SUPABASE_PROJECT_REF_INVALID");
  if (confirmation === undefined) throw new Error("SUPABASE_PROJECT_REF_CONFIRMATION_REQUIRED");
  if (confirmation !== projectRef) throw new Error("SUPABASE_PROJECT_REF_CONFIRMATION_MISMATCH");
}

export async function confirmSupabaseProject(projectRef: string, operation: string): Promise<void> {
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("NOVA_SUPABASE_PROJECT_REF_INVALID");
  const confirmation = process.env.NOVA_SUPABASE_PROJECT_REF_CONFIRM;
  if (confirmation !== undefined) {
    validateSupabaseProjectConfirmation(projectRef, confirmation);
    return;
  }
  if (!process.stdin.isTTY) {
    throw new Error("SUPABASE_PROJECT_REF_CONFIRMATION_REQUIRED_NONINTERACTIVE: set NOVA_SUPABASE_PROJECT_REF_CONFIRM to the exact target project ref");
  }

  const readline = await import("node:readline/promises");
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(
      `This will ${operation} in Supabase project ${projectRef}. Type the exact project ref to continue: `,
    )).trim();
    validateSupabaseProjectConfirmation(projectRef, answer);
  } finally {
    prompt.close();
  }
}
