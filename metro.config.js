// Metro must treat the bundled reader engine as an asset, not source.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('html')) config.resolver.assetExts.push('html');

module.exports = config;
