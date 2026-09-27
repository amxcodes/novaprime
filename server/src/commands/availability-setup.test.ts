import { expect, test } from "bun:test";
import { calendarInput, holidayInput, shiftInput } from "./availability-setup";

const officeId = "11111111-1111-4111-8111-111111111111";
const shiftId = "22222222-2222-4222-8222-222222222222";

function weeklyRules() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    ordinal: 0,
    isWorking: weekday > 0 && weekday < 6,
    ...(weekday > 0 && weekday < 6 ? { shiftId } : {}),
  }));
}

test("accepts a fixed shift with an in-shift break", () => {
  expect(shiftInput({
    name: "Standard",
    startLocalTime: "09:30",
    endLocalTime: "18:30",
    breakStartLocalTime: "13:00",
    breakEndLocalTime: "14:00",
    graceMinutes: 10,
    overtimeEnabled: false,
    spansMidnight: false,
  })).toEqual({
    name: "Standard",
    startLocalTime: "09:30",
    endLocalTime: "18:30",
    breakStartLocalTime: "13:00",
    breakEndLocalTime: "14:00",
    graceMinutes: 10,
    overtimeEnabled: false,
    spansMidnight: false,
  });
});

test("rejects invalid shift and calendar rules", () => {
  expect(shiftInput({
    name: "Overnight",
    startLocalTime: "18:00",
    endLocalTime: "09:00",
    spansMidnight: true,
  })).toMatchObject({ spansMidnight: true });
  expect(shiftInput({
    name: "Invalid reverse",
    startLocalTime: "18:00",
    endLocalTime: "09:00",
    spansMidnight: false,
  })).toBeUndefined();
  expect(shiftInput({
    name: "Break outside shift",
    startLocalTime: "09:00",
    endLocalTime: "17:00",
    breakStartLocalTime: "16:30",
    breakEndLocalTime: "17:30",
  })).toBeUndefined();
  expect(calendarInput({
    name: "Incomplete",
    officeId,
    effectiveOn: "2026-02-30",
    rules: weeklyRules(),
  })).toBeUndefined();
  expect(calendarInput({
    name: "No Sunday rule",
    officeId,
    effectiveOn: "2026-09-19",
    rules: weeklyRules().slice(1),
  })).toBeUndefined();
});

test("accepts weekly calendar and holiday inputs with bounded identifiers", () => {
  expect(calendarInput({
    name: "Office calendar",
    officeId,
    effectiveOn: "2026-09-19",
    rules: weeklyRules(),
  })).toEqual({
    name: "Office calendar",
    officeId,
    effectiveOn: "2026-09-19",
    rules: weeklyRules(),
  });
  expect(holidayInput({
    officeId,
    date: "2026-08-15",
    name: "Independence Day",
  })).toEqual({ officeId, date: "2026-08-15", name: "Independence Day" });
});
