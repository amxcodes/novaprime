type Scheduler = string | undefined;

const cron = {
  path: "/api/internal/background/tick",
  schedule: "*/5 * * * *",
};

export function createVercelConfig(scheduler: Scheduler) {
  return {
    buildCommand: "bun run build:web",
    crons: scheduler === "vercel" ? [cron] : [],
    headers: [
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      ...["/", "/accept-invite", "/accept-invite/", "/reset-password", "/reset-password/"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "no-store" }],
      })),
    ],
    rewrites: [
      { source: "/api/:path*", destination: "/api/[...path]" },
      { source: "/app.js", destination: "/web/app.js" },
      { source: "/admin-read-state.js", destination: "/web/admin-read-state.js" },
      { source: "/role-grants.js", destination: "/web/role-grants.js" },
      { source: "/deployment-guide.js", destination: "/web/deployment-guide.js" },
      { source: "/workspace-destinations.js", destination: "/web/workspace-destinations.js" },
      { source: "/notification-destinations.js", destination: "/web/notification-destinations.js" },
      { source: "/review-actions.js", destination: "/web/review-actions.js" },
      { source: "/ui-preferences.js", destination: "/web/ui-preferences.js" },
      { source: "/request-lifecycle.js", destination: "/web/request-lifecycle.js" },
      { source: "/app/:path*", destination: "/web/app/:path*" },
      { source: "/features/:path*", destination: "/web/features/:path*" },
      { source: "/assets/:path*", destination: "/web/dist/assets/:path*" },
      { source: "/accept-invite", destination: "/web/dist/accept-invite/index.html" },
      { source: "/accept-invite/", destination: "/web/dist/accept-invite/index.html" },
      { source: "/reset-password", destination: "/web/dist/reset-password/index.html" },
      { source: "/reset-password/", destination: "/web/dist/reset-password/index.html" },
      { source: "/", destination: "/web/dist/index.html" },
      { source: "/:path*", destination: "/web/dist/index.html" },
    ],
  };
}
