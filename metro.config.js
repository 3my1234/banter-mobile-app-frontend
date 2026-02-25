const { getDefaultConfig } = require("@expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  crypto: require.resolve("react-native-quick-crypto"),
};

// Prefer react-native/browser exports to avoid Node-only modules (e.g. jose/zlib).
config.resolver.mainFields = ["react-native", "browser", "main"];
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ["react-native", "browser", "default"];

module.exports = config;
