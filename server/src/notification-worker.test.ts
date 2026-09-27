import { expect, test } from "bun:test";
import { buildNotificationMessage } from "./notification-worker";

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
