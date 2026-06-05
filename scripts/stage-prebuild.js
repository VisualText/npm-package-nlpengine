'use strict';

// Stage the freshly built native addon (and any sibling runtime DLLs the
// CMake post-build copied next to it, e.g. ICU on Windows) into
//   prebuilds/<platform>-<arch>/
// which is exactly where lib/load-binding.js looks for a shipped binary.
//
// Used by the publish workflow after `npm run build`. Keeping this in JS
// (rather than per-OS shell) makes the layout identical across runners.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

// Find the built addon across the possible cmake-js output locations.
const addonCandidates = [
  path.join(BUILD, 'Release', 'bindings.node'),
  path.join(BUILD, 'bindings.node'),
  path.join(BUILD, 'Debug', 'bindings.node'),
];
const addon = addonCandidates.find((p) => fs.existsSync(p));
if (!addon) {
  console.error('stage-prebuild: no bindings.node found in', BUILD);
  process.exit(1);
}

const destDir = path.join(ROOT, 'prebuilds', `${process.platform}-${process.arch}`);
fs.mkdirSync(destDir, { recursive: true });

fs.copyFileSync(addon, path.join(destDir, 'bindings.node'));
console.log(`staged ${path.relative(ROOT, addon)} -> ${path.relative(ROOT, path.join(destDir, 'bindings.node'))}`);

// Copy any runtime libraries the build staged next to the addon (ICU DLLs on
// Windows; .dylib/.so are usually resolved via rpath, so this is mainly a
// Windows concern but harmless elsewhere).
const addonSrcDir = path.dirname(addon);
const runtimeLibs = fs
  .readdirSync(addonSrcDir)
  .filter((f) => /\.(dll)$/i.test(f));
for (const lib of runtimeLibs) {
  fs.copyFileSync(path.join(addonSrcDir, lib), path.join(destDir, lib));
  console.log(`staged runtime lib ${lib}`);
}
