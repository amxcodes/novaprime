import type { PoolClient } from "pg";

/**
 * Serialize availability decisions for one person and business date.
 * The key format intentionally matches nova.ensure_leave_request_no_overlap.
 */
export async function lockAvailabilityDates(
  transaction: PoolClient,
  personId: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  await transaction.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || dates.business_date::text, 0))
     FROM generate_series($2::date, $3::date, interval '1 day') AS dates(business_date)`,
    [personId, startDate, endDate],
  );
}
