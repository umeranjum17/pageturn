// Config plugin: make `assembleDebug` produce a phone-ready APK.
// - arm64-v8a only, and native libraries stored compressed, to keep the APK small
// - the JS bundle is embedded in the debug APK, so it runs without a dev server
// - the debug manifest no longer adds the dev-server overlay and cleartext
//   permissions: this debug build talks to nothing
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withAppBuildGradle, withDangerousMod, withGradleProperties } = require('expo/config-plugins');

const BLOCKED = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_LOCAL_NETWORK',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.WRITE_SETTINGS',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

const DEBUG_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
${BLOCKED.map((p) => `    <uses-permission android:name="${p}" tools:node="remove"/>`).join('\n')}
</manifest>
`;

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
  // Expo plugins add some of these back after blockedPermissions runs.
  config = withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest['uses-permission'] = (manifest['uses-permission'] || []).filter(
      (p) => !BLOCKED.includes(p.$['android:name']),
    );
    for (const name of BLOCKED) {
      manifest['uses-permission'].push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    }
    return c;
  });
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'app/src/debug/AndroidManifest.xml');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, DEBUG_MANIFEST);
      return c;
    },
  ]);
  return config;
};
