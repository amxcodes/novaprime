/**
 * Own the notification inbox's read state and read-action flow.
 *
 * Authenticated transport, command protection, route/identity lifetime,
 * navigation resolution, and global feedback remain host responsibilities.
 */
export function createNotificationsRoute({
  readNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  runCommand,
  isCurrent,
  isCommandCurrent,
  isCommandIdentityCurrent,
  errorMessage = () => "Notifications could not load. Refresh this page to try again.",
  refreshUnreadCount = () => {},
  onSuccess = () => {},
  onChange = () => {},
} = {}) {
  if (typeof readNotifications !== "function") throw new TypeError("readNotifications must be a function");
  if (typeof runCommand !== "function") throw new TypeError("runCommand must be a function");
  if (typeof markNotificationRead !== "function") throw new TypeError("markNotificationRead must be a function");
  if (typeof markAllNotificationsRead !== "function") throw new TypeError("markAllNotificationsRead must be a function");
  for (const [name, callback] of Object.entries({ isCurrent, isCommandCurrent, isCommandIdentityCurrent })) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
  }

  let state = { status: "loading" };
  let readGeneration = 0;
  const publish = (next) => {
    state = next;
    onChange(state);
  };

  async function load() {
    if (!isCurrent()) return false;
    const generation = ++readGeneration;
    try {
      const result = await readNotifications();
      if (!isCurrent() || generation !== readGeneration) return false;
      if (!Array.isArray(result?.notifications)) throw new Error("Invalid notifications response");
      publish({ status: "ready", notifications: result.notifications });
      return true;
    } catch (error) {
      if (!isCurrent() || generation !== readGeneration) return false;
      publish({ status: "failed", message: safeErrorMessage(error) });
      return false;
    }
  }

  function safeErrorMessage(error) {
    try {
      const message = errorMessage(error);
      return typeof message === "string" && message.trim()
        ? message
        : "Notifications could not load. Refresh this page to try again.";
    } catch {
      return "Notifications could not load. Refresh this page to try again.";
    }
  }

  async function afterReadAction(kind, context) {
    if (!isCommandCurrent(context)) return;
    runEffect(refreshUnreadCount);
    if (!await load() || !isCommandIdentityCurrent(context) || !isCurrent()) return;
    runEffect(() => onSuccess(kind));
  }

  function runEffect(effect) {
    try {
      const result = effect();
      if (result && typeof result.catch === "function") void result.catch(() => {});
    } catch {
      // The command may already be committed; refresh/feedback failure cannot
      // turn that confirmed command into a retryable-looking command failure.
    }
  }

  return {
    getState: () => state,
    load,
    retry() {
      if (!isCurrent()) return Promise.resolve(false);
      publish({ status: "loading" });
      return load();
    },
    markRead(id, source) {
      return runCommand(source, async (context) => {
        await markNotificationRead(id);
        await afterReadAction("read", context);
      });
    },
    markAllRead(source) {
      return runCommand(source, async (context) => {
        await markAllNotificationsRead();
        await afterReadAction("all", context);
      });
    },
  };
}
