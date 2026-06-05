/**
 * Locate and load the compiled native addon (bindings.node).
 *
 * Mirrors the resolution that node-gyp-build / prebuildify-style packages do:
 * check the common cmake-js output locations (Release first, then Debug),
 * and a prebuilds/ directory for shipped binaries.  Throws a helpful error
 * if none is found.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const candidates = [
  path.join(ROOT, 'build', 'Release', 'bindings.node'),
  path.join(ROOT, 'build', 'Debug', 'bindings.node'),
  path.join(ROOT, 'build', 'bindings.node'), // Ninja single-config output
  path.join(ROOT, 'prebuilds', `${process.platform}-${process.arch}`, 'bindings.node'),
];

// On Windows the addon depends on the ICU DLLs (icu*.dll), which the build
// stages next to bindings.node. Windows resolves a DLL's dependencies via the
// process PATH (among other dirs), so prepend the addon's directory before
// loading. No-op on other platforms (ICU is linked/located the usual way).
function ensureDllSearchPath(addonPath) {
  if (process.platform !== 'win32') return;
  const dir = path.dirname(addonPath);
  const sep = ';';
  const current = process.env.PATH || '';
  if (!current.split(sep).includes(dir)) {
    process.env.PATH = dir + sep + current;
  }
}

let lastErr = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    ensureDllSearchPath(candidate);
    module.exports = require(candidate);
    lastErr = undefined;
    break;
  }
}

if (lastErr === null) {
  throw new Error(
    'nlpplus: could not find the compiled native addon (bindings.node).\n' +
      'Looked in:\n  ' +
      candidates.join('\n  ') +
      '\n\nBuild it from source with:\n' +
      '  git submodule update --init --recursive\n' +
      '  npm run build\n',
  );
}
