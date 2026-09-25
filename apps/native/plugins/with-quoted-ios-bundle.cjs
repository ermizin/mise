/* eslint-disable @typescript-eslint/no-require-imports */
const { withXcodeProject } = require('expo/config-plugins');

// Expo's template executes an unquoted command substitution. Quote the resulting
// script path so checkouts with spaces (including the Mise workspace) can build.
function quoteBundleScript(script) {
  return script.replace(/^`([^\n]*react-native-xcode\.sh[^\n]*)`$/m, (_line, command) => `"$(${command})"`);
}

module.exports = function withQuotedIosBundle(config) {
  return withXcodeProject(config, config => {
    const phases = config.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    for (const phase of Object.values(phases)) {
      if (!phase || typeof phase !== 'object' || !phase.shellScript) continue;
      const original = JSON.parse(phase.shellScript);
      if (!original.includes('react-native-xcode.sh')) continue;
      phase.shellScript = JSON.stringify(quoteBundleScript(original));
    }
    return config;
  });
};
module.exports.quoteBundleScript = quoteBundleScript;
