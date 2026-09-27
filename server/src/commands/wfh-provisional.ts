import type { PoolClient } from "pg";

type EvidenceScope = Readonly<{ evidenceId: string } | { requestId: string }>;
type CloseResult = Readonly<{
  resolvedAt: string;
  checkedOutAt?: string;
  evidenceCount: number;
  sessionCount: number;
}>;

function predicate(scope: EvidenceScope): { sql: string; value: string } {
  return "evidenceId" in scope
    ? { sql: "evidence.id = $2", value: scope.evidenceId }
    : { sql: "evidence.request_id = $2", value: scope.requestId };
}

/** Close timers admitted by this evidence and optionally discard its attendance credit. */
async function closeWfhProvisionalInterval(
  transaction: PoolClient,
  scope: EvidenceScope,
  reason: string,
  effectiveAt?: string,
  discard = true,
): Promise<CloseResult> {
  const match = predicate(scope);
  const clock = effectiveAt ? undefined : await transaction.query<{ resolved_at: string }>(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS resolved_at`,
  );
  const resolvedAt = effectiveAt ?? clock?.rows[0]?.resolved_at;
  if (!resolvedAt) throw new Error("WFH_PROVISIONAL_CLOCK_MISSING");

  const sessions = await transaction.query(
    `UPDATE nova.work_sessions sessions
     SET ended_at = GREATEST(
           LEAST(
             $1::timestamptz,
             ((evidence.business_date + 1)::timestamp AT TIME ZONE evidence.office_timezone_snapshot),
             COALESCE(
               ((sessions.started_at AT TIME ZONE COALESCE(
                  sessions.office_timezone_snapshot,
                  (SELECT office.timezone FROM nova.offices office WHERE office.id = sessions.office_id)
                ))::date + 1)::timestamp
                 AT TIME ZONE COALESCE(
                   sessions.office_timezone_snapshot,
                   (SELECT office.timezone FROM nova.offices office WHERE office.id = sessions.office_id)
                 ),
               $1::timestamptz
             )
           ),
           sessions.started_at + interval '1 microsecond'
         ),
         state = CASE WHEN $4
           THEN 'auto_closed'::nova.work_session_state
           ELSE 'completed'::nova.work_session_state
         END,
         closure_reason = left(CASE WHEN $4 THEN $3 ELSE 'WFH_PROVISIONAL_USER_CHECKOUT' END, 120)
     FROM nova.wfh_provisional_attendance evidence
     WHERE sessions.provisional_wfh_attendance_id = evidence.id
       AND evidence.status = 'pending'
       AND ${match.sql}
       AND sessions.ended_at IS NULL`,
    [resolvedAt, match.value, reason, discard],
  );
  const evidence = await transaction.query<{ checked_out_at: string }>(
    `UPDATE nova.wfh_provisional_attendance evidence
     SET checked_out_at = COALESCE(
           evidence.checked_out_at,
           GREATEST(
             LEAST(
               $1::timestamptz,
               ((evidence.business_date + 1)::timestamp AT TIME ZONE evidence.office_timezone_snapshot)
             ),
             evidence.checked_in_at + interval '1 microsecond'
           )
         ),
         status = CASE WHEN $4 THEN 'discarded'::nova.wfh_provisional_attendance_status ELSE evidence.status END,
         resolved_at = CASE WHEN $4 THEN $1::timestamptz ELSE evidence.resolved_at END,
         resolution_reason = CASE WHEN $4 THEN $3 ELSE evidence.resolution_reason END
     WHERE evidence.status = 'pending' AND ${match.sql}
     RETURNING to_char(evidence.checked_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || 'Z' AS checked_out_at`,
    [resolvedAt, match.value, reason, discard],
  );
  return Object.freeze({
    resolvedAt,
    ...(evidence.rows[0]?.checked_out_at ? { checkedOutAt: evidence.rows[0].checked_out_at } : {}),
    evidenceCount: evidence.rowCount ?? 0,
    sessionCount: sessions.rowCount ?? 0,
  });
}

export function discardWfhProvisionalEvidence(
  transaction: PoolClient,
  scope: EvidenceScope,
  reason: string,
  effectiveAt?: string,
): Promise<CloseResult> {
  return closeWfhProvisionalInterval(transaction, scope, reason, effectiveAt, true);
}

export function checkOutWfhProvisionalEvidence(
  transaction: PoolClient,
  evidenceId: string,
): Promise<CloseResult> {
  return closeWfhProvisionalInterval(transaction, { evidenceId }, "USER_CHECKOUT", undefined, false);
}
