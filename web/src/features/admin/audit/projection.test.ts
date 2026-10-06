import { describe, expect, it } from "bun:test";
import { projectAuditEventsReadState } from "./projection";

describe("audit read projection", () => {
  it("limits the response to 50 and forwards only safe summary fields", () => {
    const rows = Array.from({ length: 55 }, (_, index) => ({
      id: `event-${index}`,
      action: index === 0 ? null : "person.invited",
      occurredAt: index === 1 ? 42 : "2026-10-02T10:00:00.000Z",
      actorName: index === 2 ? 42 : "Aman",
      targetId: "private-target",
      details: { credential: "private-payload" },
    }));

    const projected = projectAuditEventsReadState({ events: rows });
    expect(projected.status).toBe("ready");
    if (projected.status !== "ready") throw new Error("Expected ready audit state");
    expect(projected.events).toHaveLength(50);
    expect(projected.events[0]).toEqual({
      id: "event-0",
      action: "Action unavailable",
      occurredAt: "2026-10-02T10:00:00.000Z",
      actorName: "Aman",
    });
    expect(projected.events[1].occurredAt).toBe("");
    expect(projected.events[2].actorName).toBeNull();
    expect(JSON.stringify(projected)).not.toMatch(/private-target|private-payload|credential/);
  });

  it("maps denied and failed planned reads without changing their safe messages", () => {
    expect(projectAuditEventsReadState({}, { status: "unavailable", message: "Access unavailable." }))
      .toEqual({ status: "denied", message: "Access unavailable." });
    expect(projectAuditEventsReadState({}, { status: "error", message: "Try again." }))
      .toEqual({ status: "error", message: "Try again." });
  });

  it("returns an honest empty state for empty or malformed rows and an error for a malformed response", () => {
    expect(projectAuditEventsReadState({ events: [] })).toEqual({ status: "empty", requestLimit: 50 });
    expect(projectAuditEventsReadState({ events: [{ details: "not an event" }] }))
      .toEqual({ status: "empty", requestLimit: 50 });
    expect(projectAuditEventsReadState({ events: "not-an-array" })).toEqual({
      status: "error",
      message: "The audit response could not be read. Refresh Admin to try again.",
    });
  });
});
