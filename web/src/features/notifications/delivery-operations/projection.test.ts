import { describe, expect, it } from "bun:test";
import { projectNotificationDeliveryReadState } from "./projection";

describe("projectNotificationDeliveryReadState", () => {
  it("keeps only the safe delivery fields and a bounded limit", () => {
    const result = projectNotificationDeliveryReadState({
      deliveries: [{
        id: "delivery-1",
        eventKey: "task.assigned",
        status: "failed",
        attempts: 3,
        availableAt: "2026-10-03T08:00:00.000Z",
        createdAt: "2026-10-03T07:00:00.000Z",
        sentAt: null,
        recipientPersonId: "person-private",
        providerMessageId: "provider-private",
        lastError: "raw-provider-error",
        payload: { secret: "payload-private" },
      }],
      total: 400,
      limit: 500,
    });

    expect(result).toEqual({
      status: "ready",
      limit: 50,
      deliveries: [{
        id: "delivery-1",
        eventKey: "task.assigned",
        status: "failed",
        attempts: 3,
        availableAt: "2026-10-03T08:00:00.000Z",
        createdAt: "2026-10-03T07:00:00.000Z",
        sentAt: null,
      }],
    });
  });

  it("fails closed for malformed responses and drops rows without a usable ID", () => {
    expect(projectNotificationDeliveryReadState(null)).toEqual({
      status: "failed",
      message: "The delivery response could not be read. Refresh Admin to try again.",
    });
    expect(projectNotificationDeliveryReadState({ deliveries: "not-an-array" })).toMatchObject({
      status: "failed",
    });

    const result = projectNotificationDeliveryReadState({
      deliveries: [null, [], { id: "" }, { id: 42 }, {
        id: "delivery-valid-id",
        eventKey: 8,
        status: null,
        attempts: 1.5,
        availableAt: 42,
        createdAt: null,
        sentAt: {},
      }],
    });

    expect(result).toEqual({
      status: "ready",
      limit: 50,
      deliveries: [{
        id: "delivery-valid-id",
        eventKey: "unknown.event",
        status: "unknown",
        attempts: -1,
        availableAt: null,
        createdAt: "",
        sentAt: null,
      }],
    });
  });

  it("maps a failed authorized read to a safe feature state", () => {
    expect(projectNotificationDeliveryReadState(
      { deliveries: [{ id: "must-not-render" }] },
      { status: "unavailable", message: "Delivery access is unavailable." },
    )).toEqual({
      status: "failed",
      message: "Delivery access is unavailable.",
    });
  });
});
