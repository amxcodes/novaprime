import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { confirmSupabaseProject } from "../server/src/supabase-project-confirmation.ts";

const root = resolve(import.meta.dir, "..");
const disabling = process.argv.includes("--disable");
const sqlPath = resolve(root, "scripts", disabling
  ? "supabase-background-scheduler-remove.sql"
  : "supabase-background-scheduler.sql");
const projectRef = process.env.NOVA_SUPABASE_PROJECT_REF;
let origin = process.env.NOVA_PUBLIC_ORIGIN ?? process.env.BETTER_AUTH_URL;
const secret = process.env.NOVA_BACKGROUND_JOB_SECRET;

if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("NOVA_SUPABASE_PROJECT_REF_REQUIRED");
if (!disabling && !secret) throw new Error("NOVA_BACKGROUND_JOB_SECRET_REQUIRED");
await confirmSupabaseProject(projectRef, disabling ? "remove NOVA's Supabase Cron job and Vault secrets" : "create NOVA's Supabase Cron job and Vault secrets");

if (!disabling && (!origin || !/^https:\/\//i.test(origin))) {
  if (!process.stdin.isTTY) throw new Error("NOVA_PUBLIC_ORIGIN_HTTPS_REQUIRED");
  const readline = await import("node:readline/promises");
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    origin = (await prompt.question("Enter NOVA's deployed HTTPS public origin (for example https://people.example.com): ")).trim();
  } finally {
    prompt.close();
  }
}
if (!disabling) {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin!);
  } catch {
    throw new Error("NOVA_PUBLIC_ORIGIN_HTTPS_REQUIRED");
  }
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
    throw new Error("NOVA_PUBLIC_ORIGIN_MUST_BE_HTTPS_ORIGIN_ONLY");
  }
  origin = parsedOrigin.origin;
}

async function promptAccessToken(): Promise<string> {
  const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (enabled: boolean) => void };
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("SUPABASE_ACCESS_TOKEN_REQUIRED: provide it in this operator shell for a non-interactive run");
  }
  process.stdout.write(`Supabase project ${projectRef}; enter its management token (input hidden): `);
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const restore = () => {
      input.off("data", onData);
      input.setRawMode!(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === "\u0003") {
          restore();
          reject(new Error("SUPABASE_SCHEDULER_CANCELLED"));
          return;
        }
        if (character === "\r" || character === "\n") {
          restore();
          if (!value.trim()) reject(new Error("SUPABASE_ACCESS_TOKEN_REQUIRED"));
          else resolve(value.trim());
          return;
        }
        if (character === "\u0008" || character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    input.setRawMode!(true);
    input.resume();
    input.on("data", onData);
  });
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN || await promptAccessToken();

function sqlLiteral(value: string): string {
  if (value.includes("\0")) throw new Error("SCHEDULER_VALUE_INVALID");
  return `'${value.replaceAll("'", "''")}'`;
}

const source = readFileSync(sqlPath, "utf8")
  .replace(/^\\set[^\r\n]*$/gm, "")
  .replaceAll(":'nova_public_origin'", sqlLiteral(origin ?? ""))
  .replaceAll(":'nova_background_job_secret'", sqlLiteral(secret ?? ""));

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  body: JSON.stringify({ query: source }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) {
  let responseText = (await response.text()).replaceAll(accessToken, "[REDACTED]");
  if (secret) responseText = responseText.replaceAll(secret, "[REDACTED]");
  const detail = responseText.replaceAll(/\s+/g, " ").slice(0, 500);
  throw new Error(`SUPABASE_SCHEDULER_FAILED_${response.status}: ${detail}`);
}
console.info(disabling
  ? "NOVA's Supabase Cron job and its Vault secrets were removed. The management token was used only for this operator action."
  : "Supabase Cron/pg_net background tick configured. After its first run, verify net._http_response and the API function logs; Cron success alone only confirms the HTTP request was queued. The management token was used only for this operator action.");
