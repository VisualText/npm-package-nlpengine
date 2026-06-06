# nlpplus

**NLP++ lets you build fully customized text analyzers using the [NLP++ VSCode language extension](https://vscode.visualtext.org), giving you 100% visibility into — and complete control over — every rule and decision your analyzer makes. Unlike other NLP packages that are statistical black boxes you cannot inspect or change, every NLP++ analyzer is glass-box code you own and can tailor to your exact needs.**

[![NLP++ Textbook](https://github.com/VisualText/npm-package-nlpengine/raw/main/assets/TextbookLaunch01_LinkedIn%20Banner.png)](https://book.visualtext.org)

## First Textbook on the NLP++ Programming Language

The first textbook on NLP++ is now available world-wide by [BPB Online](https://book.visualtext.org). NLP++ can replace LLMs when used in agentic flows. The code must be written by a human like any other programming language and this book will facilitate this process. NLP++ is no a statistical system that needs training. It relies on the ingenuity of the programmer to create a program that can parse text and extract information in a deterministic way.

## The nlpplus Node.js Package

[![Test](https://github.com/VisualText/npm-package-nlpengine/actions/workflows/test.yml/badge.svg)](https://github.com/VisualText/npm-package-nlpengine/actions/workflows/test.yml)
[![Build prebuilds](https://github.com/VisualText/npm-package-nlpengine/actions/workflows/publish.yml/badge.svg)](https://github.com/VisualText/npm-package-nlpengine/actions/workflows/publish.yml)

Node.js bindings for the [NLP++](https://visualtext.org) text-analysis
engine — the Node peer of the Python package
[NLPPlus](https://github.com/VisualText/py-package-nlpengine).

`nlpplus` lets Node scripts call text and NLP analyzers written in
[NLP++](https://visualtext.org). It links the C++ libraries of the
[NLP Engine](https://github.com/VisualText/nlp-engine) directly into a
native Node-API addon, so calls run in-process — far more efficient than
shelling out to the command-line `nlp.exe` (which is what
[ts-nlp-engine](https://github.com/VisualText/ts-nlp-engine) does).

The major advantage of NLP++ over other NLP packages is that it is 100%
rule-based and modifiable: any non-linguistic programmer can build text
analyzers 100% tailored to their needs, and every analyzer is human-readable
glass-box code — no training, no statistical black box.

Analyzers can be run in two modes: **interpreted** (the default, runs
straight from the `.nlp` source) or **compiled** (analyzer code is compiled
to a native shared library once and loaded at runtime). See
[Compiled mode](#compiled-mode) below for the `cloudCompile()` one-call
build path.

## Requirements

- Node.js 18 or newer
- For building from source (no prebuilt binary for your platform): a working
  C++ compiler and the ICU libraries — see [Building from source](#building-from-source).

## Installation

```sh
npm install nlpplus
```

When a prebuilt binary exists for your platform/Node-API version it is used
directly. Otherwise the package builds from source on install (this requires
a C++ toolchain and ICU).

## Usage

Very basic usage — run the default US-English parser and get the parsing
results as XML:

```js
const nlpplus = require('nlpplus');

const xml = nlpplus.analyze('Hello world.');
console.log(xml);
```

Domain-specific analyzers are bundled too. These generally don't return text
— they write a parse tree and `output.json` into the analyzer's output dir,
which you read via the `Results` object from the `Engine` API:

```js
const { Engine } = require('nlpplus');

const engine = new Engine();
try {
  const results = engine.analyze('Reach me at hello@example.com', 'emailaddress');
  console.log(results.output);     // parsed output.json as an object
  console.log(results.finalTree);  // the NLP++ parse tree
} finally {
  engine.close();
}
```

Bundled analyzers:

- `parse-en-us` — full English parser (default)
- `address-parser` — extract addresses from text
- `emailaddress` — extract email addresses
- `links` — extract hyperlinks
- `telephone` — extract telephone numbers

Because NLP++ is glass-box, every bundled analyzer can be edited with the
[NLP++ VSCode extension](https://vscode.visualtext.org). Copy them somewhere
writable first with `copyLibraryAnalyzers()` so a package upgrade won't
overwrite your edits.

## API

### Module-level functions

| Function | Description |
|---|---|
| `analyze(text, parser = 'parse-en-us', develop = false, compiled = false)` | Run an analyzer on `text`, return its output text. |
| `compile(analyzer = 'parse-en-us', develop = false, kbOnly = false)` | Generate the analyzer's C++ source trees (`-COMPILE`). |
| `cloudCompile(analyzer = 'parse-en-us', opts?)` | End-to-end compile via the cloud build service (async). |
| `setWorkingFolder(folder?, initialize = false)` | Re-point the default engine at another working folder. |
| `setAnalyzersFolder(path)` | Set the analyzers directory used by the default engine. |
| `copyLibraryAnalyzers(toDir, overwrite = true)` | Copy bundled analyzers somewhere writable. |
| `inputText(analyzer, fileName)` | Read a file from the analyzer's `input/` dir. |
| `engineVersion()` | Bundled nlp-engine version string (e.g. `"3.1.55"`). |

These are thin wrappers over a module-level default `Engine`, exported as
`nlpplus.engine`.

### `Engine`

```js
const engine = new Engine({ workingFolder, verbose, initialize });
```

- `workingFolder` *(string, optional)* — working folder. If omitted, a temp
  directory is created and initialized with the bundled analyzers/data, and
  is removed on `close()`. Otherwise it must contain `analyzers` and `data`
  folders (unless `initialize: true`).
- `verbose` *(bool, default false)* — more engine logging.
- `initialize` *(bool, default false)* — populate `workingFolder` with the
  bundled analyzers and data.

Methods: `analyze`, `compile`, `cloudCompile`, `inputText`,
`setAnalyzersFolder`, `copyLibraryAnalyzers`, `close`.

> **Always call `engine.close()`** (e.g. in a `finally`) when you create an
> `Engine` explicitly. On Windows the engine holds a handle on
> `<workfolder>/logs/cgerr.log`, and `close()` is what lets the auto-created
> temp working folder be removed. `close()` is idempotent.

### `Results`

Returned by `engine.analyze()`:

- `outputText` — the raw string the engine returned (often empty).
- `finalTree` — the NLP++ parse tree (`final.tree`), or `null`.
- `outputJson` — the raw `output.json` text, or `null`.
- `output` — `output.json` parsed into an object, or `null`.

## Compiled mode

Analyzers normally run **interpreted** from their `.nlp` source — fine for
development, slower on large inputs. **Compiled mode** builds native shared
libraries from the analyzer's `.nlp` files once, then loads them at analyze
time.

The simplest path is one call to `cloudCompile()`, which uses the public
[nlp-compile-service](https://github.com/VisualText/nlp-compile-service) to
build the right shared library for your platform:

```js
const nlpplus = require('nlpplus');

// Generate run/*.cpp + kb/*.cpp, ship to the cloud builder, download the
// .so/.dylib/.dll, stage it into <analyzer>/bin/.
await nlpplus.cloudCompile('parse-en-us');

// Now run with the compiled artifacts instead of the interpreter.
const xml = nlpplus.analyze('Hello world.', 'parse-en-us', false, true);
```

`cloudCompile()` options: `dispatcherUrl`, `kbOnly`, `develop`,
`pollInterval`, `timeout` (default 30 min), `skipLocalCompile`. The cloud
build takes ~1 min (small analyzer, cache hit) up to ~10 min (`parse-en-us`,
cold Windows runner queue).

If you'd rather build the C++ trees yourself, use `compile()` for the
codegen step and run `cmake` against the engine's
[published compile-libs](https://github.com/VisualText/nlp-engine/releases),
then stage the result as `<analyzer>/bin/run.<ext>` and
`<analyzer>/bin/kb.<ext>`.

## Building from source

```sh
git clone --recurse-submodules https://github.com/VisualText/npm-package-nlpengine.git
cd npm-package-nlpengine
npm install
```

The native addon is built with [cmake-js](https://github.com/cmake-js/cmake-js)
and [node-addon-api](https://github.com/nodejs/node-addon-api), driving the
same CMake build the engine uses.

### Linux

```sh
# Ubuntu / Debian
sudo apt install libicu-dev
# CentOS / RHEL
sudo yum install libicu-devel

npm run build
```

### macOS / other Unix

ICU usually isn't available system-wide, so use vcpkg:

```sh
git clone --depth 1 https://github.com/Microsoft/vcpkg.git
./vcpkg/bootstrap-vcpkg.sh
brew install autoconf-archive autoconf automake pkg-config

CMAKE_TOOLCHAIN_FILE=$PWD/vcpkg/scripts/buildsystems/vcpkg.cmake npm run build
```

### Windows

ICU ships as DLLs that must be bundled with the addon. Use vcpkg
(`x64-windows-release`) for ICU and build with the toolchain file as above.
The `vcpkg.json` manifest in this repo declares the ICU dependency.

### Testing

```sh
npm test
```

The suite skips itself if the native addon hasn't been built yet.

## Making a release

Releases are managed by GitHub Actions. Bump the `version` in
`package.json`, then push an annotated tag of the form `vX.Y.Z`:

```sh
git tag -m 'Release 0.1.0' -a v0.1.0
git push --follow-tags
```

The `publish` workflow builds prebuilds for Linux/macOS/Windows and publishes
to npm (needs the `NPM_TOKEN` secret).

## Learn more about NLP++

- [VisualText website](https://visualtext.org)
- [NLP++ VSCode extension](https://vscode.visualtext.org)
- [Lectures on NLP++](http://talks.visualtext.org)
- [YouTube tutorials](http://tutorials.visualtext.org)
- [NLU Global Initiative](https://nluglob.org)

## License

MIT — see [LICENSE](LICENSE).
