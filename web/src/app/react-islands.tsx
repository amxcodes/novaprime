import { createElement, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

const roots = new Map<Element, Root>();

/**
 * Mount a typed feature-owned React surface inside the legacy route host.
 * The host remains the only owner of routing, identity, permissions, and reads.
 */
export function mountReactIsland<Props extends object>(
  target: Element,
  Component: ComponentType<Props>,
  props: Props,
): void {
  // Page/feature mounts can finish after their host has been removed. Do not
  // retain a React root (and its captured props) on a detached DOM node.
  if (target.isConnected === false) return;
  let root = roots.get(target);
  if (!root) {
    root = createRoot(target);
    roots.set(target, root);
  }
  flushSync(() => root?.render(createElement(Component, props)));
}

/** Unmount feature roots owned by a legacy route container before it replaces their hosts. */
export function unmountReactIslandsWithin(container: Element): void {
  unmountReactIslands(container, false);
}

/** Unmount roots on a feature mount target and any nested island targets. */
export function unmountReactIslandsInTree(container: Element): void {
  unmountReactIslands(container, true);
}

function unmountReactIslands(container: Element, includeContainer: boolean): void {
  const descendants = [...roots.entries()].filter(([target]) =>
    target === container ? includeContainer : container.contains(target),
  );
  for (const [target, root] of descendants.reverse()) {
    if (roots.get(target) !== root) continue;
    roots.delete(target);
    root.unmount();
  }
}

/** Unmount feature roots before the existing router replaces their containers. */
export function clearReactIslands(): void {
  for (const [target, root] of [...roots.entries()].reverse()) {
    if (roots.get(target) !== root) continue;
    // A parent route's cleanup may also unmount nested islands. Remove each
    // entry first so it cannot be unmounted twice by that nested cleanup.
    roots.delete(target);
    root.unmount();
  }
}
