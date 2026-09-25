import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { quoteBundleScript } = require('../apps/native/plugins/with-quoted-ios-bundle.cjs');

test('iOS bundle launcher quotes the resolved path and remains idempotent', () => {
  const line = '`"$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'"`';
  const fixed = quoteBundleScript(`before\n${line}\nafter`);
  assert.equal(fixed, `before\n"$(${line.slice(1, -1)})"\nafter`);
  assert.equal(quoteBundleScript(fixed), fixed);
});
