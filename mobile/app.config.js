const fs = require("fs");
const path = require("path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

const LOCAL_NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`;

function withLocalQaNetworkSecurity(config) {
  let next = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return cfg;
  });

  next = withDangerousMod(next, [
    "android",
    async (cfg) => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      await fs.promises.mkdir(xmlDir, { recursive: true });
      await fs.promises.writeFile(path.join(xmlDir, "network_security_config.xml"), LOCAL_NETWORK_SECURITY_CONFIG);
      return cfg;
    },
  ]);

  return next;
}

module.exports = ({ config }) => {
  if (process.env.FITORA_NATIVE_QA !== "1") return config;

  return withLocalQaNetworkSecurity({
    ...config,
    android: {
      ...config.android,
      googleServicesFile: undefined,
    },
  });
};
