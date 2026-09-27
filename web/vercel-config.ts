type Scheduler = string | undefined;

const cron = {
  path: "/api/internal/background/tick",
  schedule: "*/5 * * * *",
};

export function createVercelConfig(scheduler: Scheduler) {
  return {
    crons: scheduler === "vercel" ? [cron] : [],
    rewrites: [
      { source: "/api/:path*", destination: "/api/[...path]" },
      { source: "/app.js", destination: "/web/app.js" },
      { source: "/admin-read-state.js", destination: "/web/admin-read-state.js" },
      { source: "/role-grants.js", destination: "/web/role-grants.js" },
      { source: "/styles.css", destination: "/web/styles.css" },
      { source: "/accept-invite", destination: "/web/accept-invite/index.html" },
      { source: "/reset-password", destination: "/web/reset-password/index.html" },
      { source: "/:path*", destination: "/web/index.html" },
    ],
  };
}
