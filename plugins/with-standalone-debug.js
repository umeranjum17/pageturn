// Config plugin: make `assembleDebug` produce a phone-ready APK.
// - arm64-v8a only, and native libraries stored compressed, to keep the APK small
// - the JS bundle is embedded in the debug APK, so it runs without a dev server
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

function setProperty(props, key, value) {
  const existing = props.find((p) => p.type === 'property' && p.key === key);
  if (existing) existing.value = value;
  else props.push({ type: 'property', key, value });
}

module.exports = function withStandaloneDebug(config) {
  config = withGradleProperties(config, (c) => {
    setProperty(c.modResults, 'reactNativeArchitectures', 'arm64-v8a');
    setProperty(c.modResults, 'expo.useLegacyPackaging', 'true');
    return c;
  });
  config = withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes('debuggableVariants = []')) {
      c.modResults.contents = c.modResults.contents.replace(
        /react\s*\{/,
        'react {\n    // pageturn: embed the JS bundle in debug builds too\n    debuggableVariants = []',
      );
    }
    return c;
  });
  return config;
};
