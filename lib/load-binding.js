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
  path.join(ROOT, 'prebuilds', `${process.platform}-${process.arch}`, 'bindings.node'),
];

let lastErr = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
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
