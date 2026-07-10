/**
 * nlpplus - Node.js bindings for the NLP++ text-analysis engine.
 *
 * This is the Node peer of the Python package NLPPlus.  It mirrors that
 * package's API surface: an `Engine` class backed by the native addon, a
 * `Results` helper that reads the analyzer's output files, a module-level
 * default engine, and the convenience functions `analyze`, `compile`,
 * `cloudCompile`, `setWorkingFolder`, etc.
 *
 * Basic usage:
 *
 *     const nlpplus = require('nlpplus');
 *     const xml = nlpplus.analyze('This is some text to be parsed');
 *     console.log(xml);
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// The compiled Node-API addon (built by cmake-js).  Resolved via a small
// loader so prebuilt binaries and source builds both work.
const native = require('./load-binding');

const PACKAGE_ROOT = path.join(__dirname, '..');
const BUNDLED_ANALYZERS = path.join(PACKAGE_ROOT, 'analyzers');
const BUNDLED_DATA = path.join(PACKAGE_ROOT, 'data');

/** Return the bundled nlp-engine version string (e.g. "3.1.55"). */
function engineVersion() {
  return native.engineVersion();
}

class EngineException extends Error {}

function maybeReadFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Various results produced by an NLP++ analyzer run. */
class Results {
  constructor(outputText, outdir) {
    this.outputText = outputText;
    this.outdir = outdir;
  }

  /** The final parse tree, if any was produced. */
  get finalTree() {
    return maybeReadFile(path.join(this.outdir, 'final.tree'));
  }

  /** The raw output.json text, if any was produced. */
  get outputJson() {
    return maybeReadFile(path.join(this.outdir, 'output.json'));
  }

  /** The parsed output JSON object, if any was produced. */
  get output() {
    const text = this.outputJson;
    return text === null ? null : JSON.parse(text);
  }
}

// VCS metadata that lives in the analyzers submodule (and its nested
// submodules) but must never be staged into the engine's working folder.
const VCS_ARTIFACTS = new Set(['.git', '.gitmodules', '.github', '.gitattributes']);

function copyDir(src, dst) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (s) => !VCS_ARTIFACTS.has(path.basename(s)),
  });
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * NLP++ Engine for a given working folder.
 *
 * @param {object} [opts]
 * @param {string} [opts.workingFolder] Working folder. If omitted, a temp
 *   directory is created and initialized with the bundled analyzers/data.
 *   Otherwise it must contain `analyzers` and `data` folders, unless
 *   `initialize` is true.
 * @param {boolean} [opts.verbose=false] Be more verbose.
 * @param {boolean} [opts.initialize=false] Initialize the working folder
 *   with the bundled analyzers and data.
 */
class Engine {
  constructor(opts = {}) {
    let { workingFolder = null, verbose = false, initialize = false } = opts;

    this._closed = false;
    this.analyzerPath = null;

    if (workingFolder === null) {
      // Auto-created temp working folder, cleaned up on close().
      this.tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nlpplus-'));
      this.workingFolder = this.tmpdir;
      initialize = true;
    } else {
      this.tmpdir = null;
      this.workingFolder = workingFolder;
    }

    if (initialize) {
      copyDir(BUNDLED_ANALYZERS, path.join(this.workingFolder, 'analyzers'));
      copyDir(BUNDLED_DATA, path.join(this.workingFolder, 'data'));
    }
    if (!fs.existsSync(path.join(this.workingFolder, 'analyzers'))) {
      throw new EngineException(
        `analyzers directory not found in folder '${workingFolder}'`,
      );
    }
    if (!fs.existsSync(path.join(this.workingFolder, 'data'))) {
      throw new EngineException(
        `data directory not found in folder '${workingFolder}'`,
      );
    }

    this.engine = new native.NLP_ENGINE(String(this.workingFolder), !verbose);
  }

  /**
   * Tear down the underlying engine and release the working folder.
   * Idempotent. After close(), any further analyze/compile is undefined.
   * On Windows, calling close() (or using the engine via a `using`-style
   * try/finally) is what lets the auto-created temp folder delete cleanly,
   * because the engine holds a handle on <workfolder>/logs/cgerr.log.
   */
  close() {
    if (this._closed) return;
    this._closed = true;
    try {
      this.engine.close();
    } catch (_) {
      /* older binding without close(): fall through to dir cleanup */
    }
    if (this.tmpdir !== null) {
      rmrf(this.tmpdir);
      this.tmpdir = null;
    }
  }

  /**
   * Analyze `text` with the named analyzer.
   *
   * @param {string} text Input text.
   * @param {string} analyzerName Analyzer under the working folder.
   * @param {boolean} [develop=false] Emit intermediate log/tree files.
   * @param {boolean} [compiled=false] Load the analyzer's compiled shared
   *   libraries (bin/run.<ext> + bin/kb.<ext>) instead of running
   *   interpreted from the .nlp source. See compile()/cloudCompile().
   * @returns {Results}
   */
  analyze(text, analyzerName, develop = false, compiled = false) {
    let outdir = path.join(
      this.workingFolder, 'analyzers', analyzerName, 'output',
    );
    let engineArg = analyzerName;
    if (this.analyzerPath) {
      engineArg = path.join(this.analyzerPath, analyzerName);
      outdir = path.join(this.analyzerPath, 'analyzers', analyzerName, 'output');
    }
    // Clear the output dir so stale files don't leak into Results.
    if (fs.existsSync(outdir)) {
      for (const f of fs.readdirSync(outdir)) {
        try {
          fs.rmSync(path.join(outdir, f), { force: true });
        } catch (_) {
          /* directories or locked files: ignore, mirror Python's os.remove */
        }
      }
    }
    const outText = this.engine.analyze(
      String(engineArg), text, develop, compiled,
    );
    return new Results(outText, outdir);
  }

  /**
   * Generate C++ source files for the named analyzer (-COMPILE mode).
   * Emits <analyzer>/run/*.cpp and <analyzer>/kb/*.cpp (or only kb/ when
   * kbOnly=true). The generated C++ still needs to be built into shared
   * libraries before analyze(..., true) can load them; use cloudCompile()
   * for the one-call end-to-end path.
   *
   * @returns {string} the analyzer directory containing the generated trees.
   */
  compile(analyzerName, develop = false, kbOnly = false, analyzerOnly = false) {
    if (kbOnly && analyzerOnly) {
      throw new Error('compile: kbOnly and analyzerOnly are mutually exclusive');
    }
    let analyzerDir;
    let engineArg;
    if (this.analyzerPath) {
      analyzerDir = path.join(this.analyzerPath, 'analyzers', analyzerName);
      engineArg = path.join(this.analyzerPath, analyzerName);
    } else {
      analyzerDir = path.join(this.workingFolder, 'analyzers', analyzerName);
      engineArg = analyzerName;
    }
    this.engine.compile(String(engineArg), develop, kbOnly, analyzerOnly);
    return analyzerDir;
  }

  /**
   * End-to-end compile via the public nlp-compile-service cloud build.
   * See lib/cloud.js for the full flow. Returns the analyzer's bin/ dir.
   */
  async cloudCompile(analyzerName, opts = {}) {
    const cloud = require('./cloud');
    return cloud.cloudCompile(this, analyzerName, opts);
  }

  /** Return the text from a file in the analyzer's input directory. */
  inputText(analyzerName, fileName) {
    const base = this.analyzerPath || path.join(this.workingFolder, 'analyzers');
    const filePath = path.join(base, analyzerName, 'input', fileName);
    if (!fs.existsSync(filePath)) {
      throw new EngineException(
        `File not found in input directory '${filePath}'`,
      );
    }
    return fs.readFileSync(filePath, 'utf8');
  }

  /** Set the analyzers directory path used by analyze()/compile(). */
  setAnalyzersFolder(analyzerPath) {
    this.analyzerPath = analyzerPath;
  }

  /**
   * The analyzer's `kb/user` directory, created if missing. This is where
   * JSON is dropped for the analyzer's `json2kbb` python pass to convert into
   * a `.kbb` knowledge base on the next run.
   */
  _kbUserDir(analyzerName) {
    const analyzerDir = this.analyzerPath
      ? path.join(this.analyzerPath, analyzerName)
      : path.join(this.workingFolder, 'analyzers', analyzerName);
    const kbdir = path.join(analyzerDir, 'kb', 'user');
    fs.mkdirSync(kbdir, { recursive: true });
    return kbdir;
  }

  /**
   * Place a JSON file in the analyzer's `kb/user` directory so its `json2kbb`
   * pass converts it to a KBB on the next run. The file is copied to
   * `<analyzer>/kb/user/<name>.json` (name defaults to the source file's own
   * name; a `.json` extension is appended if missing). Returns the
   * destination path.
   *
   * @param {string} analyzerName analyzer under the working / analyzers folder.
   * @param {string} jsonPath path to a JSON file to copy in.
   * @param {string|null} [name] optional output file name.
   * @returns {string} the destination path.
   */
  putJsonFile(analyzerName, jsonPath, name = null) {
    if (!fs.existsSync(jsonPath) || !fs.statSync(jsonPath).isFile()) {
      throw new EngineException(`JSON file not found: ${jsonPath}`);
    }
    JSON.parse(fs.readFileSync(jsonPath, 'utf8')); // validate it is JSON
    let target = name || path.basename(jsonPath);
    if (!target.toLowerCase().endsWith('.json')) target += '.json';
    const dest = path.join(this._kbUserDir(analyzerName), target);
    fs.copyFileSync(jsonPath, dest);
    return dest;
  }

  /**
   * Write a JSON-serializable value to the analyzer's `kb/user` directory so
   * its `json2kbb` pass converts it to a KBB on the next run. Serialized to
   * `<analyzer>/kb/user/<name>.json` (a `.json` extension is appended if
   * missing). Returns the destination path.
   *
   * @param {string} analyzerName analyzer under the working / analyzers folder.
   * @param {*} obj any JSON-serializable value (object, array, string, ...).
   * @param {string} name output file name.
   * @returns {string} the destination path.
   */
  putJsonObject(analyzerName, obj, name) {
    const target = name.toLowerCase().endsWith('.json') ? name : name + '.json';
    const dest = path.join(this._kbUserDir(analyzerName), target);
    fs.writeFileSync(dest, JSON.stringify(obj, null, 2), 'utf8');
    return dest;
  }

  /**
   * Copy the bundled library analyzers into a writable directory so they
   * can be edited without being overwritten by a package upgrade. Points
   * this engine's analyzerPath at the copy.
   */
  copyLibraryAnalyzers(toDir, overwrite = true) {
    let copyIt = true;
    if (fs.existsSync(toDir)) {
      if (overwrite) rmrf(toDir);
      else copyIt = false;
    }
    if (copyIt) copyDir(BUNDLED_ANALYZERS, toDir);
    this.analyzerPath = String(toDir);
  }
}

// --- Module-level default engine + convenience functions ----------------
// Mirrors the Python module: a single default Engine plus thin wrappers.

let engine = new Engine();

/** Reinitialize the default engine with a different working folder. */
function setWorkingFolder(workingFolder = null, initialize = false) {
  if (engine) engine.close();
  engine = new Engine({
    workingFolder: workingFolder === null ? process.cwd() : workingFolder,
    initialize,
  });
  module.exports.engine = engine;
}

function setAnalyzersFolder(analyzerFolderPath) {
  engine.setAnalyzersFolder(analyzerFolderPath);
}

function copyLibraryAnalyzers(toDir, overwrite = true) {
  engine.copyLibraryAnalyzers(toDir, overwrite);
}

/**
 * Run the named analyzer on the input string and return its output text.
 * If compiled=true, the engine loads the analyzer's compiled shared
 * libraries instead of running interpreted. See compile().
 */
function analyze(text, parser = 'parse-en-us', develop = false, compiled = false) {
  return engine.analyze(text, parser, develop, compiled).outputText;
}

/** Generate C++ source files for the named analyzer. See Engine.compile. */
function compile(analyzer = 'parse-en-us', develop = false, kbOnly = false, analyzerOnly = false) {
  return engine.compile(analyzer, develop, kbOnly, analyzerOnly);
}

/** Compile an analyzer end-to-end via the nlp-compile-service cloud. */
function cloudCompile(analyzer = 'parse-en-us', opts = {}) {
  return engine.cloudCompile(analyzer, opts);
}

/** Return the text from a file in the analyzer's input directory. */
function inputText(analyzerName, fileName) {
  return engine.inputText(analyzerName, fileName);
}

/**
 * Place a JSON file in the analyzer's kb/user directory so its json2kbb pass
 * converts it to a KBB. See Engine.putJsonFile.
 */
function putJsonFile(analyzerName, jsonPath, name = null) {
  return engine.putJsonFile(analyzerName, jsonPath, name);
}

/**
 * Write a JSON-serializable value to the analyzer's kb/user directory so its
 * json2kbb pass converts it to a KBB. See Engine.putJsonObject.
 */
function putJsonObject(analyzerName, obj, name) {
  return engine.putJsonObject(analyzerName, obj, name);
}

module.exports = {
  Engine,
  Results,
  EngineException,
  engineVersion,
  engine,
  setWorkingFolder,
  setAnalyzersFolder,
  copyLibraryAnalyzers,
  analyze,
  compile,
  cloudCompile,
  inputText,
  putJsonFile,
  putJsonObject,
};
