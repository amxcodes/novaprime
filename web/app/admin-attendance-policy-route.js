/** @typedef {import('../src/features/admin/attendance-policy/contracts').AttendancePolicySettingsProps} AttendancePolicySettingsProps */

/**
 * Keep the organisation response inside the Admin host and pass only the
 * policy snapshot needed by AttendancePolicySettings.
 * @param {object} input
 * @param {Record<string, unknown>} [input.organisationRead]
 * @param {{status: string, message: string} | null} [input.readFailure]
 * @param {boolean} [input.canManage]
 * @param {AttendancePolicySettingsProps['onSchedule']} [input.onSchedule]
 * @returns {AttendancePolicySettingsProps}
 */
export function projectAttendancePolicySettingsProps({
  organisationRead,
  readFailure,
  canManage = false,
  onSchedule,
} = {}) {
  const organisation = organisationRead?.organisation;
  const failure = readFailure || (!organisation
    ? { status: "error", message: "The organisation settings response could not be read. Refresh Admin to try again." }
    : null);
  const policy = organisation?.attendancePolicy;

  return {
    access: { status: "visible", manage: canManage === true ? "allowed" : "denied" },
    read: failure
      ? { status: failure.status === "unavailable" ? "unavailable" : "error", message: failure.message }
      : { status: "ready", policy: policy ? {
        mode: policy.mode,
        requiredAttendanceMinutes: policy.requiredAttendanceMinutes,
        effectiveOn: policy.effectiveOn,
      } : null },
    onSchedule,
  };
}
