export interface WfhRequestReadRow {
  id: string;
  person_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  reviewer_person_id: string | null;
  reviewed_at: Date | null;
  review_reason: string | null;
  can_review?: boolean;
  can_cancel?: boolean;
}

export function presentWfhRequest(row: WfhRequestReadRow) {
  return {
    id: row.id,
    personId: row.person_id,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status,
    reviewerPersonId: row.reviewer_person_id,
    reviewedAt: row.reviewed_at,
    reviewReason: row.review_reason,
    ...(typeof row.can_review === "boolean" ? { canReview: row.can_review } : {}),
    ...(typeof row.can_cancel === "boolean" ? { canCancel: row.can_cancel } : {}),
  };
}

/** Keep the read hint and atomic cancel command on the same SQL predicate. */
export function cancellableWfhPredicate(requestAlias: string, todayParameter: string): string {
  return `${requestAlias}.status IN ('pending', 'approved')
    AND ${requestAlias}.end_date >= ${todayParameter}::date
    AND NOT EXISTS (
      SELECT 1
      FROM nova.attendance_days attendance
      WHERE attendance.person_id = ${requestAlias}.person_id
        AND attendance.mode = 'wfh'
        AND attendance.business_date BETWEEN ${requestAlias}.start_date
          AND ${requestAlias}.end_date
    )`;
}

export const wfhMineReadSql = `SELECT requests.id, requests.person_id, requests.start_date, requests.end_date,
       requests.reason, requests.status, requests.reviewer_person_id, requests.reviewed_at, requests.review_reason,
       (${cancellableWfhPredicate("requests", "$3")}) AS can_cancel
FROM nova.wfh_requests requests
WHERE requests.organisation_id = $1 AND requests.person_id = $2
ORDER BY requests.start_date DESC, requests.created_at DESC`;
