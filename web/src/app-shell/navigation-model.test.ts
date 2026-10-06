import { describe, expect, test } from "bun:test";
import { selectMobileNavigation } from "./navigation-model";
import type { AppNavigationGroup } from "./contracts";

const groups: AppNavigationGroup[] = [
  {
    id: "core",
    items: [
      { id: "home", label: "Home", href: "/", icon: null },
      { id: "work", label: "Work", href: "/work", icon: null },
    ],
  },
  {
    id: "admin",
    items: [{ id: "settings", label: "Settings", href: "/settings", icon: null }],
  },
];

describe("selectMobileNavigation", () => {
  test("keeps only host-approved destinations in the requested order", () => {
    expect(selectMobileNavigation(groups, ["work", "missing", "home"]).map(({ id }) => id)).toEqual([
      "work",
      "home",
    ]);
  });

  test("ignores duplicate IDs and caps the bar at four items", () => {
    const many: AppNavigationGroup[] = [
      {
        id: "all",
        items: Array.from({ length: 6 }, (_, index) => ({
          id: `item-${index}`,
          label: `Item ${index}`,
          href: `/item-${index}`,
          icon: null,
        })),
      },
    ];
    expect(
      selectMobileNavigation(many, ["item-0", "item-0", "item-1", "item-2", "item-3", "item-4"]),
    ).toHaveLength(4);
  });
});
