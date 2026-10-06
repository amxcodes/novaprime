function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Create the My Day route launchpad from destinations already filtered by the
 * current grant read. The shell remains the authority for route entry checks.
 */
export function createWorkspaceShortcutPanel(destinations = []) {
  const shortcuts = destinations.filter((destination) =>
    destination && destination.view !== "today" &&
    typeof destination.label === "string" && typeof destination.summary === "string",
  );
  if (!shortcuts.length) return null;

  const panel = element("aside", "my-day-shortcuts");
  panel.setAttribute("aria-labelledby", "my-day-shortcuts-heading");
  const header = element("header", "my-day-shortcuts-header");
  const title = element("h2", "", "Quick access");
  title.id = "my-day-shortcuts-heading";
  const description = element("p", "small", "Only workspace pages available to your account are listed.");
  header.append(title, description);

  const list = element("div", "workspace-shortcut-grid");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Available workspace pages");
  shortcuts.forEach(({ view, label, summary }) => {
    const button = element("button", "workspace-shortcut");
    button.type = "button";
    button.dataset.nav = view;
    const name = element("strong", "workspace-shortcut-title", label);
    const detail = element("span", "workspace-shortcut-summary", summary);
    button.append(name, detail);
    list.append(button);
  });
  panel.append(header, list);
  return panel;
}
