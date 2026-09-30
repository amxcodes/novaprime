import { expect, test } from "bun:test";
import { buildNotificationMessage, runBounded } from "./notification-worker";

test("notification deep links stay on NOVA's approved public origin", () => {
  const message = buildNotificationMessage({
    title: "Review requested",
    body: "A task is ready.",
    deepLink: "/?view=today&task=123",
  }, "https://work.example.test");

  expect(message.text).toContain("https://work.example.test/?view=today&task=123");
  expect(() => buildNotificationMessage({
    title: "Review requested",
    body: "A task is ready.",
    deepLink: "//attacker.example/collect",
  }, "https://work.example.test")).toThrow("PUBLIC_URL_INVALID");
});

test("absolute notification links are rebased, not sent to their stored host", () => {
  const message = buildNotificationMessage({
    title: "Password reset",
    body: "Continue securely.",
    deepLink: "https://old-host.example/reset?token=private",
  }, "https://work.example.test");

  expect(message.text).toContain("https://work.example.test/reset?token=private");
  expect(message.text).not.toContain("old-host.example");
});

test("notification work never exceeds its configured concurrency", async () => {
  let active = 0;
  let peak = 0;
  const completed: number[] = [];
  await runBounded([0, 1, 2, 3, 4, 5, 6], 3, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    completed.push(item);
    active -= 1;
  });

  expect(peak).toBe(3);
  expect(completed.sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

test("notification worker rejects unsafe batch and concurrency values", async () => {
  await expect(runBounded([1], 0, async () => {})).rejects.toThrow("NOTIFICATION_WORKER_INPUT_INVALID");
  await expect(runBounded([1], 11, async () => {})).rejects.toThrow("NOTIFICATION_WORKER_INPUT_INVALID");
});
