import { describe, expect, it } from "bun:test";
import { updatePinnedDestinations } from "./workspace-pins";

const authorized = ["today", "people", "settings"];

describe("updatePinnedDestinations", () => {
  it("reclaims only the minimum hidden pins needed to fit a newly pinned visible destination", () => {
    const stored = ["hidden-a", "today", "hidden-b", "hidden-c"];

    const next = updatePinnedDestinations(stored, authorized, "people", true);

    expect(next).toEqual(["hidden-a", "today", "hidden-b", "people"]);
    expect(next).toHaveLength(4);
    expect(next.filter((id) => authorized.includes(id))).toHaveLength(2);
  });

  it("preserves every hidden pin when storage has room", () => {
    const stored = ["hidden-a", "today", "hidden-b"];

    expect(updatePinnedDestinations(stored, authorized, "people", true)).toEqual([
      "hidden-a", "today", "hidden-b", "people",
    ]);
  });

  it("retains hidden pins when unpinning a visible destination", () => {
    const stored = ["hidden-a", "today", "hidden-b"];

    expect(updatePinnedDestinations(stored, authorized, "today", false)).toEqual([
      "hidden-a", "hidden-b",
    ]);
  });

  it("does not add a fifth visible pin", () => {
    const visible = ["today", "people", "settings", "work"];
    const stored = [...visible];

    expect(updatePinnedDestinations(stored, [...visible, "availability"], "availability", true)).toBe(stored);
  });

  it("does not mutate for unauthorized, unchanged, or invalid requests", () => {
    const stored = ["hidden-a", "today"];

    expect(updatePinnedDestinations(stored, authorized, "hidden-a", true)).toBe(stored);
    expect(updatePinnedDestinations(stored, authorized, "people", false)).toBe(stored);
    expect(updatePinnedDestinations(stored, authorized, "people", true, -1)).toBe(stored);
  });
});
