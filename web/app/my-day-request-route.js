/**
 * Keep My Day's self-service leave and WFH request orchestration together,
 * while the application host remains the owner of authenticated transport,
 * page identity, and protected-command recovery.
 */
export function createMyDayRequestRoute(host) {
  const {
    getPageRequestLifetime,
    isCurrentPageRequest,
    mountReactIsland,
    api,
    pageApi,
    requestOptions,
    errorText,
    setMessage,
    render,
    withSubmitForm,
    runActionButton,
    isCurrentCommand,
    showFeedback,
    loadWfhPanel = () => import("../src/features/my-day/WfhRequestPanel.tsx"),
    loadLeavePanel = () => import("../src/features/my-day/LeaveRequestPanel.tsx"),
  } = host;
  const requiredFunctions = {
    getPageRequestLifetime, isCurrentPageRequest, mountReactIsland, api, pageApi,
    requestOptions, errorText, setMessage, render, withSubmitForm,
    runActionButton, isCurrentCommand, showFeedback,
  };
  for (const [name, service] of Object.entries(requiredFunctions)) {
    if (typeof service !== "function") throw new TypeError("My Day request route service " + name + " must be a function");
  }
  if (typeof loadWfhPanel !== "function" || typeof loadLeavePanel !== "function") {
    throw new TypeError("My Day request feature loaders must be functions");
  }

  function preparePanel(target, loadingMessage) {
    if (!target) return null;
    const lifetime = getPageRequestLifetime();
    const isCurrentPanel = () => target.isConnected && (!lifetime || isCurrentPageRequest(lifetime));
    target.setAttribute("role", "status");
    target.setAttribute("aria-live", "polite");
    target.setAttribute("aria-busy", "true");
    target.textContent = loadingMessage;

    return {
      target,
      lifetime,
      isCurrentPanel,
      mount(Component, props) {
        if (!Component || !isCurrentPanel()) return;
        target.removeAttribute("role");
        target.removeAttribute("aria-live");
        target.removeAttribute("aria-busy");
        mountReactIsland(target, Component, props);
      },
      showLoadFailure(message) {
        if (!isCurrentPanel()) return;
        target.removeAttribute("role");
        target.removeAttribute("aria-live");
        target.removeAttribute("aria-busy");
        const notice = document.createElement("p");
        notice.className = "small";
        notice.setAttribute("role", "alert");
        notice.textContent = message;
        target.replaceChildren(notice);
      },
    };
  }

  function renderWfhRequestPanel(target) {
    const panel = preparePanel(target, "Loading your WFH request panel…");
    if (!panel) return;
    const { isCurrentPanel, lifetime } = panel;
    let WfhRequestPanel;
    let read = { status: "loading" };
    let readGeneration = 0;

    function mount() {
      panel.mount(WfhRequestPanel, {
        read,
        onRetry: () => { void loadRequests(); },
        onSubmit: (values, form) => withSubmitForm(form, async () => {
          await api("/api/availability/wfh", requestOptions("POST", {
            startDate: values.startDate, endDate: values.endDate, reason: values.reason || undefined,
          }));
          setMessage("WFH request submitted for approval.");
          render();
        }),
        onCancel: (requestId, source) => runActionButton(source, async (context) => {
          await api("/api/availability/wfh/" + encodeURIComponent(requestId) + "/cancel", requestOptions("POST"));
          if (!isCurrentCommand(context)) return;
          setMessage("WFH request cancelled.");
          render();
        }),
      });
    }

    async function loadRequests() {
      if (!isCurrentPanel()) return;
      const generation = ++readGeneration;
      read = { status: "loading" };
      mount();
      try {
        const result = await pageApi("/api/availability/wfh/mine", lifetime);
        if (!isCurrentPanel() || generation !== readGeneration) return;
        read = { status: "ready", requests: result.requests.map((request) => ({
          id: request.id,
          startDate: request.startDate,
          endDate: request.endDate,
          status: request.status,
          reviewReason: request.reviewReason,
          canCancel: request.canCancel === true,
        })) };
      } catch (error) {
        if (!isCurrentPanel() || generation !== readGeneration) return;
        read = { status: "error", message: errorText(error) };
      }
      mount();
    }

    void loadWfhPanel().then((feature) => {
      if (!isCurrentPanel()) return;
      WfhRequestPanel = feature.WfhRequestPanel;
      mount();
      void loadRequests();
    }).catch(() => panel.showLoadFailure(
      "The WFH request panel could not load. Refresh My Day to try again.",
    ));
  }

  function renderLeaveRequestPanel(target) {
    const panel = preparePanel(target, "Loading your leave request panel…");
    if (!panel) return;
    const { isCurrentPanel, lifetime } = panel;
    let LeaveRequestPanel;
    let read = { status: "loading" };

    function mount() {
      panel.mount(LeaveRequestPanel, {
        read,
        onRetry: () => { void loadRequests(); },
        onSubmit: (values, form) => withSubmitForm(form, async () => {
          const start = new Date(values.startDate + "T00:00:00Z");
          const end = new Date(values.endDate + "T00:00:00Z");
          const days = [];
          for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
            days.push({ date: cursor.toISOString().slice(0, 10), portion: Number(values.portion) });
            if (days.length > 366) {
              throw Object.assign(new Error("LEAVE_REQUEST_INPUT_INVALID"), { code: "LEAVE_REQUEST_INPUT_INVALID" });
            }
          }
          await api("/api/leave", requestOptions("POST", {
            leaveType: values.leaveType, startDate: values.startDate, endDate: values.endDate,
            reason: values.reason || undefined, days,
          }));
          setMessage("Leave request submitted for review.");
          render();
        }),
        onCancel: (requestId, source) => runActionButton(source, async (context) => {
          await api("/api/leave/" + encodeURIComponent(requestId) + "/cancel", requestOptions("POST"));
          if (!isCurrentCommand(context)) return;
          setMessage("Leave request cancelled.");
          showFeedback();
          // Refresh after success: request state and attendance may have changed.
          await loadRequests();
        }),
      });
    }

    async function loadRequests() {
      if (!isCurrentPanel()) return;
      read = { status: "loading" };
      mount();
      try {
        const result = await pageApi("/api/leave/mine", lifetime);
        if (!isCurrentPanel()) return;
        read = { status: "ready", requests: result.requests.map((leave) => ({
          id: leave.id,
          leaveType: leave.leaveType,
          status: leave.status,
          startDate: leave.startDate,
          endDate: leave.endDate,
          canCancel: leave.canCancel === true,
        })) };
      } catch (error) {
        if (!isCurrentPanel()) return;
        read = { status: "error", message: errorText(error) };
      }
      mount();
    }

    void loadLeavePanel().then((feature) => {
      if (!isCurrentPanel()) return;
      LeaveRequestPanel = feature.LeaveRequestPanel;
      mount();
      void loadRequests();
    }).catch(() => panel.showLoadFailure(
      "The leave request panel could not load. Refresh My Day to try again.",
    ));
  }

  return { renderWfhRequestPanel, renderLeaveRequestPanel };
}
