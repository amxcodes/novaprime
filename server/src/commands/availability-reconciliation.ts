import type { PoolClient } from "pg";
import { enqueueNotification } from "./notifications.js";

export type OfficeAvailabilityChange = Readonly<{
  actorId: string;
  businessDate: string;
  code: string;
  details: Record<string, unknown>;
  officeId: string;
  organisationId: string;
}>;

export async function reconcileOfficeDate(
  transaction: PoolClient,
  change: OfficeAvailabilityChange,
): Promise<{ closedAttendance: number; exceptions: number }> {
  const attendance = await transaction.query<{
    id: string;
    person_id: string;
    checked_out_at: Date | null;
  }>(
    `SELECT attendance.id, attendance.person_id, attendance.checked_out_at
     FROM nova.attendance_days attendance
     WHERE attendance.organisation_id = $1
       AND attendance.office_id = $2
       AND attendance.business_date = $3::date
     FOR UPDATE`,
    [change.organisationId, change.officeId, change.businessDate],
  );
  let closedAttendance = 0;
  let exceptions = 0;
  for (const row of attendance.rows) {
    if (!row.checked_out_at) {
      await transaction.query(
        `UPDATE nova.attendance_days
         SET checked_out_at = clock_timestamp(), closure_reason = 'AVAILABILITY_RECONCILIATION'
         WHERE id = $1`,
        [row.id],
      );
      closedAttendance += 1;
    }
    const inserted = await transaction.query(
      `INSERT INTO nova.historical_exceptions (
        organisation_id, source_type, source_id, person_id, business_date, code, details
      ) VALUES ($1, 'attendance_day', $2, $3, $4::date, $5, $6::jsonb)
      ON CONFLICT (organisation_id, source_type, source_id, code) DO NOTHING`,
      [change.organisationId, row.id, row.person_id, change.businessDate, change.code, JSON.stringify(change.details)],
    );
    exceptions += inserted.rowCount ?? 0;
    await enqueueNotification(transaction, {
      organisationId: change.organisationId,
      recipientPersonId: row.person_id,
      eventKey: "attendance.recovery_required",
      title: "Attendance needs review",
      body: `Attendance on ${change.businessDate} was affected by an availability change and may need review.`,
      aggregateType: "attendance_day",
      aggregateId: row.id,
      deepLink: "/?view=today",
      idempotencyKey: `attendance.reconciliation:${row.id}:${change.code}`,
    });
  }
  if (attendance.rows.length) {
    await transaction.query(
      `INSERT INTO nova.audit_events (
        organisation_id, actor_person_id, action, target_type, target_id, details
      ) VALUES ($1, $2, 'availability.reconciled', 'office', $3, $4)`,
      [change.organisationId, change.actorId, change.officeId, JSON.stringify({
        business_date: change.businessDate,
        code: change.code,
        closed_attendance: closedAttendance,
        historical_exceptions: exceptions,
      })],
    );
  }
  return { closedAttendance, exceptions };
}
