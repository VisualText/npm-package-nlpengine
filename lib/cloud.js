/**
 * Cloud-compile orchestration for NLP++ analyzers.
 *
 * Node port of the Python package's `cloud.py`.  Same flow, same wire
 * protocol, same default dispatcher (the Cloudflare Worker the vscode-nlp
 * extension talks to):
 *
 *   1. Run the engine's -COMPILE step locally to produce run/ + kb/ C++
 *      trees under the analyzer directory.
 *   2. Stage those trees plus an auto-generated StdAfx.h stub into a tarball.
 *   3. POST the tarball to ${dispatcherUrl}/build as multipart/form-data.
 *   4. Poll ${dispatcherUrl}/jobs/<id> until the runner build finishes.
 *   5. Download the resulting shared library and stage it under
 *      <analyzer>/bin/ so analyze(text, name, true) finds it.
 *
 * Uses Node's built-in fetch (Node 18+) and the `tar` package for gzip
 * tarballs (the only piece Node's stdlib doesn't provide, unlike Python's
 * tarfile).
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DISPATCHER_URL =
  'https://nlp-compile-dispatcher.dehilster.workers.dev';

// Cloudflare's browser-integrity check rejects unidentified UAs with 403 /
// code 1010, so identify ourselves clearly (and include the engine version).
function userAgent() {
  try {
    const { engineVersion } = require('./load-binding');
    return `nlpplus/${engineVersion()} (Node)`;
  } catch (_) {
    return 'nlpplus (Node)';
  }
}

// Auto-generated header the engine's -COMPILE output expects: each generated
// pass*.cpp begins with `#include "StdAfx.h"`, and the runner's cmake
// force-includes this stub. Same content vscode-nlp / NLPPlus write.
const STDAFX_STUB =
  '// Auto-generated stub. Engine-generated .cpp files include ' +
  '"StdAfx.h" by convention.\n' +
  '#pragma once\n' +
  '#ifdef _WIN32\n' +
  '#ifndef WIN32_LEAN_AND_MEAN\n' +
  '#define WIN32_LEAN_AND_MEAN\n' +
  '#endif\n' +
  '#ifndef NOMINMAX\n' +
  '#define NOMINMAX\n' +
  '#endif\n' +
  '#include <windows.h>\n' +
  '#include <tchar.h>\n' +
  '#endif\n' +
  '#include "my_tchar.h"\n';

class CloudCompileError extends Error {}

/** Return the runner label the dispatcher routes to for this host. */
function cloudPlatformKey() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'macos-arm64' : 'macos-x86_64';
  }
  if (process.platform === 'linux') {
    try {
      const osr = fs.readFileSync('/etc/os-release', 'utf8');
      for (const line of osr.split('\n')) {
        if (line.startsWith('VERSION_ID=')) {
          const v = line.slice('VERSION_ID='.length).trim().replace(/"/g, '');
          if (v === '20.04') return 'linux-20.04';
          if (v === '22.04') return 'linux-22.04';
          break;
        }
      }
    } catch (_) {
      /* fall through */
    }
    return 'linux-latest';
  }
  throw new CloudCompileError(
    `Unsupported platform for cloud compile: ${process.platform}`,
  );
}

/** File extension the dispatcher's artifact comes back as. */
function sharedLibraryExt() {
  if (process.platform === 'win32') return '.dll';
  if (process.platform === 'darwin') return '.dylib';
  return '.so';
}

/**
 * Copy run/ + kb/ trees and write the StdAfx.h stub into stageDir.
 * Skips run/ when kbOnly. Only .cpp and .h files are copied.
 */
function stagePayload(analyzerDir, stageDir, kbOnly) {
  const subdirs = kbOnly ? ['kb'] : ['run', 'kb'];
  let anySource = false;
  for (const sub of subdirs) {
    const src = path.join(analyzerDir, sub);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
    const dst = path.join(stageDir, sub);
    fs.mkdirSync(dst, { recursive: true });
    for (const fname of fs.readdirSync(src)) {
      const low = fname.toLowerCase();
      if (!low.endsWith('.cpp') && !low.endsWith('.h')) continue;
      fs.copyFileSync(path.join(src, fname), path.join(dst, fname));
      anySource = true;
    }
  }
  if (!anySource) {
    throw new CloudCompileError(
      `No generated .cpp/.h files found under ${analyzerDir}. ` +
        'Did you call engine.compile() first?',
    );
  }
  fs.writeFileSync(path.join(stageDir, 'StdAfx.h'), STDAFX_STUB, 'utf8');
}

/** Pack stageDir contents (without stageDir itself) into a tar.gz. */
async function makeTarball(stageDir, tarPath) {
  let tar;
  try {
    tar = require('tar');
  } catch (_) {
    throw new CloudCompileError(
      "cloud compile needs the 'tar' package: run `npm install tar`",
    );
  }
  const entries = fs.readdirSync(stageDir).sort();
  await tar.create({ gzip: true, file: tarPath, cwd: stageDir }, entries);
}

function sha256File(p) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(p));
  return hash.digest('hex');
}

/** POST a manifest + payload pair as multipart/form-data. */
async function postMultipart(url, manifest, tarPath) {
  const form = new FormData();
  // `manifest` must be a plain string field (not a Blob/file): the dispatcher
  // validates it as a string and rejects a file part with HTTP 400. Only
  // `payload` is a file part (a Blob with a filename).
  form.append('manifest', JSON.stringify(manifest));
  form.append(
    'payload',
    new Blob([fs.readFileSync(tarPath)], { type: 'application/gzip' }),
    'payload.tar.gz',
  );
  const resp = await fetch(url, {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': userAgent() },
  });
  const body = await resp.text();
  return { status: resp.status, body };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET /jobs/<id> until status is 'done' or 'failed' (or timeout). */
async function pollJob(dispatcherUrl, jobId, pollInterval, timeout) {
  const deadline = Date.now() + timeout * 1000;
  const url = dispatcherUrl.replace(/\/+$/, '') + '/jobs/' + jobId;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const resp = await fetch(url, { headers: { 'User-Agent': userAgent() } });
    if (!resp.ok) {
      throw new CloudCompileError(
        `Polling /jobs/${jobId} returned HTTP ${resp.status}: ` +
          `${await resp.text()}`,
      );
    }
    const payload = await resp.json();
    const status = payload.status;
    if (status !== lastStatus) {
      // eslint-disable-next-line no-console
      console.error(`cloud-compile job ${jobId}: ${status}`);
      lastStatus = status;
    }
    if (status === 'done') return payload;
    if (status === 'failed') {
      const errors = payload.errors || payload.error || payload;
      throw new CloudCompileError(
        `Cloud build failed for job ${jobId}: ${JSON.stringify(errors)}`,
      );
    }
    await sleep(pollInterval * 1000);
  }
  throw new CloudCompileError(
    `Cloud build for job ${jobId} did not finish within ${timeout}s`,
  );
}

/** Stream-download `url` to `dest` (overwriting if it exists). */
async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const resp = await fetch(url, { headers: { 'User-Agent': userAgent() } });
  if (!resp.ok) {
    throw new CloudCompileError(
      `Downloading ${url} returned HTTP ${resp.status}`,
    );
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

/**
 * Download the cloud artifact and stage it as the bin/ shared libs.
 * The dispatcher returns ONE shared library per build; we mirror the
 * vscode-nlp staging: drop it into <analyzer>/bin/ as both run.<ext> and
 * kb.<ext> (plus the "u" unicode variants) for a full build, or kb.<ext>
 * alone for kbOnly. Returns the bin/ directory path.
 */
async function stageArtifact(artifactUrl, analyzerDir, kbOnly) {
  const ext = sharedLibraryExt();
  const binDir = path.join(analyzerDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const tmpArtifact = path.join(
    binDir, `_artifact_${crypto.randomBytes(8).toString('hex')}${ext}`,
  );
  try {
    await download(artifactUrl, tmpArtifact);
    const targets = kbOnly
      ? [`kb${ext}`]
      : [`run${ext}`, `runu${ext}`, `kb${ext}`, `kbu${ext}`];
    for (const name of targets) {
      fs.copyFileSync(tmpArtifact, path.join(binDir, name));
    }
  } finally {
    try {
      fs.rmSync(tmpArtifact, { force: true });
    } catch (_) {
      /* ignore */
    }
  }
  return binDir;
}

/**
 * Compile an analyzer end-to-end via the nlp-compile-service cloud.
 * Returns the analyzer's bin/ directory containing the staged libraries.
 *
 * @param {import('./index').Engine} engine
 * @param {string} analyzerName
 * @param {import('../index').CloudCompileOptions} [opts]
 */
async function cloudCompile(engine, analyzerName, opts = {}) {
  const {
    dispatcherUrl = DEFAULT_DISPATCHER_URL,
    kbOnly = false,
    develop = false,
    pollInterval = 2.0,
    timeout = 30 * 60,
    skipLocalCompile = false,
  } = opts;

  let analyzerDir;
  if (!skipLocalCompile) {
    analyzerDir = engine.compile(analyzerName, develop, kbOnly);
  } else {
    const base =
      engine.analyzerPath || path.join(engine.workingFolder, 'analyzers');
    analyzerDir = path.join(base, analyzerName);
  }
  if (!fs.existsSync(analyzerDir)) {
    throw new CloudCompileError(`Analyzer directory not found: ${analyzerDir}`);
  }

  const { engineVersion } = require('./load-binding');
  const engineVer = engineVersion();
  const platformKey = cloudPlatformKey();

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nlpplus-cloud-'));
  let artifactUrl;
  try {
    stagePayload(analyzerDir, stageDir, kbOnly);
    const tarPath = path.join(stageDir, '_payload.tar.gz');
    await makeTarball(stageDir, tarPath);
    const sourcesHash = sha256File(tarPath);
    const manifest = {
      schemaVersion: 1,
      engineVersion: engineVer,
      platform: platformKey,
      analyzerName,
      kbOnly,
      sourcesHash: 'sha256:' + sourcesHash,
      client: 'nlpplus',
    };
    // eslint-disable-next-line no-console
    console.error(
      `Uploading ${analyzerName} to ${dispatcherUrl} ` +
        `(engine=${engineVer} platform=${platformKey} kbOnly=${kbOnly})`,
    );
    const { status, body } = await postMultipart(
      dispatcherUrl.replace(/\/+$/, '') + '/build', manifest, tarPath,
    );
    if (status >= 400) {
      throw new CloudCompileError(
        `Dispatcher /build returned HTTP ${status}: ${body}`,
      );
    }
    const submitted = JSON.parse(body);
    artifactUrl = submitted.artifactUrl;
    if (submitted.cached && artifactUrl) {
      // eslint-disable-next-line no-console
      console.error('Cache hit for sourcesHash; reusing prior artifact');
    } else {
      const jobId = submitted.jobId;
      if (!jobId) {
        throw new CloudCompileError(
          `Dispatcher did not return a jobId: ${body}`,
        );
      }
      const polled = await pollJob(dispatcherUrl, jobId, pollInterval, timeout);
      artifactUrl = polled.artifactUrl;
      if (!artifactUrl) {
        throw new CloudCompileError(
          `Job ${jobId} reported done but produced no artifactUrl`,
        );
      }
    }
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  const binDir = await stageArtifact(artifactUrl, analyzerDir, kbOnly);
  // eslint-disable-next-line no-console
  console.error(`Cloud compile output staged into ${binDir}`);
  return binDir;
}

module.exports = {
  DEFAULT_DISPATCHER_URL,
  CloudCompileError,
  cloudPlatformKey,
  sharedLibraryExt,
  cloudCompile,
};
