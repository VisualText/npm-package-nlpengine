'use strict';

// Runs a SINGLE test case in its own process, then hard-exits.
//
// Why a process per case: the NLP++ engine keeps process-global state, so on
// some platforms (Linux) running a second, different analyzer in one process
// — or letting the global teardown run at native shutdown — segfaults. One
// analyzer per process plus an explicit process.exit() before teardown keeps
// each case isolated and deterministic. The parent runner (engine.test.js)
// spawns one of these per case and checks the exit code.

const assert = require('node:assert');
const nlpplus = require('..');

const which = process.argv[2];

switch (which) {
  case 'version': {
    const v = nlpplus.engineVersion();
    assert.strictEqual(typeof v, 'string');
    assert.ok(v.length > 0, 'engineVersion should be non-empty');
    break;
  }
  case 'default-analyze': {
    const out = nlpplus.analyze('Hello world.');
    assert.strictEqual(typeof out, 'string');
    break;
  }
  case 'emailaddress': {
    const r = nlpplus.engine.analyze(
      'Reach me at hello@example.com',
      'emailaddress',
    );
    assert.strictEqual(typeof r.outputText, 'string');
    assert.ok(
      r.output && Array.isArray(r.output.email_address),
      'expected output.email_address to be an array',
    );
    assert.strictEqual(r.output.email_address[0].domainname, 'example');
    break;
  }
  default:
    console.error('unknown case:', which);
    process.exit(2);
}

// Hard-exit before the engine's process-global teardown runs.
process.exit(0);
