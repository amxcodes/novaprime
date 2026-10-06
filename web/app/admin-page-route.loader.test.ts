import { describe, expect, it } from "bun:test";
import { loadAdminFeatureModule } from "./admin-page-route.js";

describe("Admin route feature import gate", () => {
  it("does not invoke a feature loader when the capability is denied", async () => {
    let loads = 0;
    const result = await loadAdminFeatureModule(false, async () => {
      loads += 1;
      return { feature: true };
    });

    expect(result).toBeNull();
    expect(loads).toBe(0);
  });

  it("invokes the loader for an allowed feature and converts import failures to the section fallback state", async () => {
    const loaded = await loadAdminFeatureModule(true, async () => ({ Feature: "authorized" }));
    const failed = await loadAdminFeatureModule(true, async () => {
      throw new Error("chunk unavailable");
    });

    expect(loaded).toEqual({ Feature: "authorized" });
    expect(failed).toBeNull();
  });
});
