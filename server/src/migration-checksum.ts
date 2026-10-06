import { createHash } from "node:crypto";

/**
 * Hash SQL content independently of the checkout's Windows/macOS/Linux line endings.
 * Git and PostgreSQL treat CRLF and LF as the same migration source.
 */
export function migrationSha256(source: string | Uint8Array): string {
  const text = typeof source === "string"
    ? source
    : new TextDecoder("utf-8", { fatal: true }).decode(source);
  const canonicalText = text.replace(/\r\n?/g, "\n");
  return createHash("sha256").update(canonicalText, "utf8").digest("hex");
}
