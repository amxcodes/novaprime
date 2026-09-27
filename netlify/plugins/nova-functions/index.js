const { selectFunctionsDirectory } = require("./selection.cjs");

module.exports = {
  onBuild({ netlifyConfig, utils }) {
    let directory;
    try {
      directory = selectFunctionsDirectory({
        scheduler: process.env.NOVA_BACKGROUND_SCHEDULER,
        context: process.env.CONTEXT ?? "production",
      });
    } catch (error) {
      utils.build.failBuild(error instanceof Error ? error.message : "Invalid NOVA Netlify scheduler configuration.");
      return;
    }

    netlifyConfig.functions ??= {};
    netlifyConfig.functions.directory = directory;
    utils.status.show({
      title: "NOVA function set selected",
      summary: `Using ${directory}; non-production builds never register a scheduled function.`,
    });
  },
};
