const directories = {
  netlify: "netlify/entrypoints/with-netlify-cron",
  supabase: "netlify/entrypoints/without-native-cron",
};

function selectFunctionsDirectory({ scheduler, context = "production" }) {
  if (scheduler && !Object.hasOwn(directories, scheduler)) {
    throw new Error("NOVA_BACKGROUND_SCHEDULER must be `netlify` or `supabase`.");
  }

  // Preview and branch builds must never register a production schedule.
  if (context !== "production") return directories.supabase;

  if (!scheduler) {
    throw new Error("Set NOVA_BACKGROUND_SCHEDULER to `netlify` or `supabase` for the production build.");
  }

  return directories[scheduler];
}

module.exports = { selectFunctionsDirectory };
