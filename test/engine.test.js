'use strict';

// nlpplus smoke tests.
//
// Each case runs in its own child process (test/_case.js) because the NLP++
// engine holds process-global state: running a second analyzer in one process,
// or letting its teardown run during native shutdown, can SIGSEGV on some
// platforms (the Python package skips its whole suite for the same reason).
// Isolating each analyzer in a fresh process — which hard-exits before
// teardown — gives real coverage that's stable across platforms. A genuine
// assertion failure (or a crash) in a case surfaces as a non-zero child exit
// and fails the run.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CASE_RUNNER = path.join(__dirname, '_case.js');

// If the native addon isn't built, don't fail CI on a never-built tree.
try {
  require('..');
} catch (err) {
  console.log('SKIP: native addon not built (' + err.message + ')');
  process.exit(0);
}

const cases = [
  ['engineVersion returns a non-empty string', 'version'],
  ['analyze returns a string for the default parser', 'default-analyze'],
  ['bundled emailaddress analyzer returns structured output', 'emailaddress'],
];

let failed = 0;
for (const [name, key] of cases) {
  const res = spawnSync(process.execPath, [CASE_RUNNER, key], {
    encoding: 'utf8',
  });
  if (res.status === 0) {
    console.log('ok - ' + name);
  } else {
    failed++;
    const how =
      res.signal ? `signal ${res.signal}` : `exit ${res.status}`;
    console.log(`not ok - ${name} (${how})`);
    const tail = (res.stderr || res.stdout || '')
      .trim()
      .split('\n')
      .slice(-6)
      .join('\n  ');
    if (tail) console.log('  ' + tail);
  }
}

console.log(`# cases ${cases.length}  pass ${cases.length - failed}  fail ${failed}`);
process.exit(failed > 0 ? 1 : 0);
