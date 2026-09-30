import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schedulerSql = readFileSync(
  resolve(import.meta.dir, "../../scripts/supabase-background-scheduler.sql"),
  "utf8",
);

test("Supabase Cron uses one pg_net request with an explicit bounded timeout", () => {
  expect(schedulerSql.match(/net\.http_post\(/g)).toHaveLength(1);
  expect(schedulerSql).toContain("timeout_milliseconds := 55000");
  expect(schedulerSql).toContain("'*/5 * * * *'");
});
