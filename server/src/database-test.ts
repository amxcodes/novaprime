import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const testDirectory = fileURLToPath(
  new URL("../../database/tests/", import.meta.url),
);
const migrationUrl = process.env.MIGRATOR_DATABASE_URL;

if (!migrationUrl) {
  throw new Error("MIGRATOR_DATABASE_URL_REQUIRED");
}

const database = new Pool({ connectionString: migrationUrl });
try {
  const filenames = (await readdir(testDirectory))
    .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename))
    .sort();

  for (const filename of filenames) {
    await database.query(await readFile(join(testDirectory, filename), "utf8"));
    console.info(`PostgreSQL test passed: ${filename}`);
  }
} finally {
  await database.end();
}
