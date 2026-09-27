import { createVercelConfig } from "./web/vercel-config";

// Vercel evaluates this configuration for each deployment. An absent or
// non-Vercel selector deliberately creates no Cron job.
export const config = createVercelConfig(process.env.NOVA_BACKGROUND_SCHEDULER);
