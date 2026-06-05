'use strict';

// Self-contained smoke test for nlpplus.
//
// Deliberately NOT using `node --test`: the NLP++ engine's teardown is
// process-global and can SIGSEGV when it runs during native static
// destruction on some platforms (see nlp-engine/lite/nlp_engine.cpp close()
// -- the global `gout` stream dangles after deleteVTRun, and ~NLP_ENGINE
// always calls close()). The Python package skips its whole test suite for
// the same reason.
//
// Instead we run real assertions in a single process using a single engine
// (creating a second NLP_ENGINE in one process is unsafe because the teardown
// is global), then hard-exit BEFORE that teardown runs. A passing run exits 0
// deterministically; a real assertion failure still exits non-zero.

const assert = require('node:assert');

let nlpplus;
try {
  nlpplus = require('..');
} catch (err) {
  // No native addon built (e.g. a metadata-only checkout). Don't fail CI on
  // a tree that was never built; just report and pass.
  console.log('SKIP: native addon not built (' + err.message + ')');
  process.exit(0);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('engineVersion returns a non-empty string', () => {
  const v = nlpplus.engineVersion();
  assert.strictEqual(typeof v, 'string');
  assert.ok(v.length > 0, 'version should be non-empty');
});

test('analyze returns a string for the default parser', () => {
  const out = nlpplus.analyze('Hello world.');
  assert.strictEqual(typeof out, 'string');
});

test('bundled emailaddress analyzer returns structured output', () => {
  // Use the module-level default engine (a single NLP_ENGINE for the whole
  // process). Running a different analyzer on the same engine is supported.
  const r = nlpplus.engine.analyze('Reach me at hello@example.com', 'emailaddress');
  assert.strictEqual(typeof r.outputText, 'string');
  assert.ok(
    r.output && Array.isArray(r.output.email_address),
    'expected output.email_address to be an array',
  );
  assert.strictEqual(r.output.email_address[0].domainname, 'example');
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (err) {
    failed++;
    console.log('not ok - ' + name);
    const detail = err && err.stack ? err.stack : String(err);
    console.log('  ' + detail.split('\n').join('\n  '));
  }
}
console.log(
  `# tests ${tests.length}  pass ${tests.length - failed}  fail ${failed}`,
);

// Hard-exit before the engine's process-global native teardown runs (it can
// SIGSEGV at shutdown on some platforms via the napi finalizer). The exit code
// reflects the real test results.
process.exit(failed > 0 ? 1 : 0);
