'use strict';

// Basic engine smoke tests. Mirrors tests/test_engine.py from the Python
// package. These require the native addon to be built (`npm run build`);
// if it isn't, the whole suite is skipped rather than failing, so a clean
// checkout doesn't error before the first build.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let nlpplus = null;
let loadError = null;
try {
  nlpplus = require('..');
} catch (err) {
  loadError = err;
}

const maybe = (name, fn) =>
  test(name, { skip: nlpplus ? false : `native addon not built: ${loadError && loadError.message}` }, fn);

maybe('engineVersion returns a non-empty string', () => {
  const v = nlpplus.engineVersion();
  assert.strictEqual(typeof v, 'string');
  assert.ok(v.length > 0);
});

maybe('analyze returns a string for the default parser', () => {
  const out = nlpplus.analyze('Hello world.');
  assert.strictEqual(typeof out, 'string');
});

maybe('Engine can be created with an explicit working folder and closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nlpplus-test-'));
  const engine = new nlpplus.Engine({ workingFolder: dir, initialize: true });
  try {
    const results = engine.analyze('Reach me at hello@example.com', 'emailaddress');
    assert.ok(results);
    // Most analyzers write files rather than returning text.
    assert.strictEqual(typeof results.outputText, 'string');
  } finally {
    engine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

maybe('close() is idempotent', () => {
  const engine = new nlpplus.Engine();
  engine.close();
  engine.close(); // must not throw
});
