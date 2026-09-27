// Local development keeps the API and static client on one origin. This is
// intentionally an opt-in runner; Netlify and Vercel continue using adapters.
process.env.NOVA_SERVE_WEB = "true";
await import("./index.js");

export {};
