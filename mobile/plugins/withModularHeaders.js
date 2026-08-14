const { withPodfile } = require("@expo/config-plugins");

/** Google Sign-In pods need modular headers when linked as static libraries. */
module.exports = function withModularHeaders(config) {
  return withPodfile(config, (cfg) => {
    if (!cfg.modResults.contents.includes("use_modular_headers!")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        "prepare_react_native_project!",
        "use_modular_headers!\n\nprepare_react_native_project!",
      );
    }
    return cfg;
  });
};
