'use strict';

// Install hook: if a usable native addon is already present (a shipped
// prebuild or a prior build), do nothing. Otherwise build from source with
// cmake-js. Keeping this in JS (rather than a shell one-liner) makes the
// "use prebuild if available" decision portable across platforms.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const prebuilt = [
  path.join(ROOT, 'build', 'Release', 'bindings.node'),
  path.join(ROOT, 'prebuilds', `${process.platform}-${process.arch}`, 'bindings.node'),
];

if (prebuilt.some((p) => fs.existsSync(p))) {
  console.log('nlpplus: using existing native addon, skipping build.');
  process.exit(0);
}

if (!fs.existsSync(path.join(ROOT, 'nlp-engine', 'CMakeLists.txt'))) {
  console.error(
    'nlpplus: nlp-engine submodule is missing. If you cloned the repo, run:\n' +
      '  git submodule update --init --recursive\n' +
      'then `npm run build`.',
  );
  // Don't hard-fail npm install in case this is a metadata-only install.
  process.exit(0);
}

let addonApiInclude = '';
try {
  addonApiInclude = require('node-addon-api').include_dir;
} catch (_) {
  // node-addon-api should be a dependency; if it's not resolvable yet the
  // build will report a clearer error.
}

const args = ['compile'];
if (addonApiInclude) args.push(`--CDNODE_ADDON_API_DIR=${addonApiInclude}`);

console.log('nlpplus: building native addon with cmake-js...');
execFileSync(process.platform === 'win32' ? 'cmake-js.cmd' : 'cmake-js', args, {
  cwd: ROOT,
  stdio: 'inherit',
});
