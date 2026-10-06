export interface SearchableSelectPopupGeometry {
  left: number;
  width: number;
  top: number;
  maxHeight: number;
  placement: "above" | "below";
}

export interface SearchableSelectModelOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function isSearchableSelectTouchScroll(
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = 8,
): boolean {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  return deltaX * deltaX + deltaY * deltaY >= threshold * threshold;
}

export function getSearchableSelectOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

export function isSearchableSelectOptionSelectable(option: SearchableSelectModelOption): boolean {
  return option.disabled !== true;
}

/** Keep an IME's Enter key for committing its text candidate, not the active option. */
export function shouldCommitSearchableSelectSelection(
  key: string,
  isComposing: boolean,
  keyCode: number,
): boolean {
  return key === "Enter" && !isComposing && keyCode !== 229;
}

/** Preserve normal text-caret editing while the searchable combobox has a query. */
export function shouldUseSearchableSelectBoundaryNavigation(
  key: string,
  query: string,
  isComposing = false,
): boolean {
  return !isComposing && query.length === 0 && (key === "Home" || key === "End");
}

export function getSearchableSelectAriaState(
  listboxId: string,
  optionCount: number,
  activeIndex: number,
  open: boolean,
): { controls?: string; activeDescendant?: string } {
  if (!open) return {};
  return {
    controls: listboxId,
    ...(optionCount > 0 && activeIndex >= 0 ? {
      activeDescendant: getSearchableSelectOptionId(listboxId, Math.min(Math.max(0, activeIndex), optionCount - 1)),
    } : {}),
  };
}

export function filterSearchableSelectOptions<T extends SearchableSelectModelOption>(
  options: readonly T[],
  query: string,
): readonly T[] {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized
    ? options.filter((option) => `${option.label} ${option.description || ""}`.toLocaleLowerCase().includes(normalized))
    : options;
}

export function findSearchableSelectActiveIndex(
  options: readonly SearchableSelectModelOption[],
  selectedValue: string,
): number {
  const selectedIndex = options.findIndex((option) =>
    option.value === selectedValue && isSearchableSelectOptionSelectable(option),
  );
  return selectedIndex >= 0 ? selectedIndex : findSearchableSelectBoundaryIndex(options, "first");
}

export function findSearchableSelectBoundaryIndex(
  options: readonly SearchableSelectModelOption[],
  boundary: "first" | "last",
): number {
  if (boundary === "first") {
    return options.findIndex(isSearchableSelectOptionSelectable);
  }
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (isSearchableSelectOptionSelectable(options[index])) return index;
  }
  return -1;
}

export function isSearchableSelectPointerOutside(
  target: EventTarget | null,
  control: { contains(node: Node): boolean } | null,
  popup: { contains(node: Node): boolean } | null,
): boolean {
  if (!target) return false;
  const node = target as Node;
  return !control?.contains(node) && !popup?.contains(node);
}

export function stepSearchableSelectActiveIndex(
  currentIndex: number,
  optionCount: number,
  direction: "next" | "previous",
  disabledOptions: readonly boolean[] = [],
): number {
  if (optionCount <= 0) return -1;
  const start = currentIndex < 0
    ? (direction === "next" ? -1 : optionCount)
    : currentIndex >= optionCount
      ? (direction === "next" ? optionCount - 1 : optionCount)
      : currentIndex;
  let index = start;
  const firstEnabled = disabledOptions.findIndex((disabled) => !disabled);
  let lastEnabled = -1;
  for (let optionIndex = optionCount - 1; optionIndex >= 0; optionIndex -= 1) {
    if (!disabledOptions[optionIndex]) {
      lastEnabled = optionIndex;
      break;
    }
  }
  const boundaryIndex = direction === "next" && currentIndex < optionCount ? firstEnabled : lastEnabled;
  const fallback = currentIndex >= 0 && currentIndex < optionCount && !disabledOptions[currentIndex]
    ? currentIndex
    : boundaryIndex;
  for (let steps = 0; steps < optionCount; steps += 1) {
    const next = direction === "next" ? Math.min(index + 1, optionCount - 1) : Math.max(index - 1, 0);
    if (next === index) return fallback;
    index = next;
    if (!disabledOptions[index]) return index;
  }
  return fallback;
}

/** Place an anchored choice list inside the currently visible viewport, including mobile keyboards. */
export function calculateSearchableSelectPopupGeometry(
  anchor: { top: number; bottom: number; left: number; width: number },
  viewport: { top: number; bottom: number; left: number; right: number },
  maxHeight = 304,
  gap = 8,
  padding = 8,
): SearchableSelectPopupGeometry {
  const innerTop = Math.min(viewport.bottom, viewport.top + padding);
  const innerBottom = Math.max(innerTop, viewport.bottom - padding);
  const innerLeft = Math.min(viewport.right, viewport.left + padding);
  const innerRight = Math.max(innerLeft, viewport.right - padding);
  const availableBelow = Math.max(0, innerBottom - anchor.bottom - gap);
  const availableAbove = Math.max(0, anchor.top - gap - innerTop);
  const safeMaxHeight = Math.max(0, maxHeight);
  const placement = availableBelow >= Math.min(176, safeMaxHeight) || availableBelow >= availableAbove
    ? "below" : "above";
  const available = placement === "below" ? availableBelow : availableAbove;
  const height = Math.min(safeMaxHeight, available);
  const width = Math.min(Math.max(0, anchor.width), innerRight - innerLeft);
  const left = Math.max(innerLeft, Math.min(anchor.left, innerRight - width));
  const latestTop = Math.max(innerTop, innerBottom - height);
  const preferredTop = placement === "below" ? anchor.bottom + gap : anchor.top - gap - height;
  const top = Math.max(innerTop, Math.min(preferredTop, latestTop));
  return { left, width, top, maxHeight: height, placement };
}
