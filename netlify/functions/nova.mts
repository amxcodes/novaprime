import { handleRequest } from "../../server/src/app";

// Netlify controls the edge forwarding headers for this function runtime.
process.env.NOVA_TRUST_PROXY_HEADERS ??= "true";

export default handleRequest;

export const config = { path: "/api/*" };
