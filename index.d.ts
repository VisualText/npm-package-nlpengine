// Type definitions for nlpplus
// Node.js bindings for the NLP++ text-analysis engine (peer of the Python
// package NLPPlus).

/** Various results produced by an NLP++ analyzer run. */
export class Results {
  constructor(outputText: string, outdir: string);
  /** The raw output text returned by the engine (often empty). */
  readonly outputText: string;
  /** The analyzer's output directory. */
  readonly outdir: string;
  /** The final parse tree, if any was produced. */
  readonly finalTree: string | null;
  /** The raw output.json text, if any was produced. */
  readonly outputJson: string | null;
  /** The parsed output JSON object, if any was produced. */
  readonly output: unknown | null;
}

export class EngineException extends Error {}

export interface EngineOptions {
  /**
   * Working folder. If omitted, a temp directory is created and
   * initialized with the bundled analyzers/data. Otherwise it must contain
   * `analyzers` and `data` folders, unless `initialize` is true.
   */
  workingFolder?: string | null;
  /** Be more verbose. */
  verbose?: boolean;
  /** Initialize the working folder with the bundled analyzers and data. */
  initialize?: boolean;
}

export interface CloudCompileOptions {
  /** Override the public dispatcher endpoint. */
  dispatcherUrl?: string;
  /** Compile only the knowledge base. */
  kbOnly?: boolean;
  /** Forwarded to the local -COMPILE step. */
  develop?: boolean;
  /** Seconds between job-status checks. */
  pollInterval?: number;
  /** Max seconds to wait for the runner build. */
  timeout?: number;
  /** Assume run/ and kb/ already exist under the analyzer dir. */
  skipLocalCompile?: boolean;
}

/** NLP++ Engine for a given working folder. */
export class Engine {
  constructor(opts?: EngineOptions);
  readonly workingFolder: string;
  analyzerPath: string | null;
  /** Tear down the engine and release the (temp) working folder. Idempotent. */
  close(): void;
  /** Analyze `text` with the named analyzer. */
  analyze(
    text: string,
    analyzerName: string,
    develop?: boolean,
    compiled?: boolean,
  ): Results;
  /** Generate C++ source files for the named analyzer (-COMPILE mode). */
  compile(analyzerName: string, develop?: boolean, kbOnly?: boolean): string;
  /** End-to-end compile via the nlp-compile-service cloud. Returns the bin/ dir. */
  cloudCompile(analyzerName: string, opts?: CloudCompileOptions): Promise<string>;
  /** Return the text from a file in the analyzer's input directory. */
  inputText(analyzerName: string, fileName: string): string;
  /** Set the analyzers directory path used by analyze()/compile(). */
  setAnalyzersFolder(analyzerPath: string): void;
  /** Copy the bundled library analyzers into a writable directory. */
  copyLibraryAnalyzers(toDir: string, overwrite?: boolean): void;
}

/** Return the bundled nlp-engine version string (e.g. "3.1.55"). */
export function engineVersion(): string;

/** The module-level default engine. */
export let engine: Engine;

/** Reinitialize the default engine with a different working folder. */
export function setWorkingFolder(
  workingFolder?: string | null,
  initialize?: boolean,
): void;

export function setAnalyzersFolder(analyzerFolderPath: string): void;

export function copyLibraryAnalyzers(toDir: string, overwrite?: boolean): void;

/**
 * Run the named analyzer on the input string and return its output text.
 * Defaults to the bundled `parse-en-us` analyzer.
 */
export function analyze(
  text: string,
  parser?: string,
  develop?: boolean,
  compiled?: boolean,
): string;

/** Generate C++ source files for the named analyzer. */
export function compile(
  analyzer?: string,
  develop?: boolean,
  kbOnly?: boolean,
): string;

/** Compile an analyzer end-to-end via the nlp-compile-service cloud. */
export function cloudCompile(
  analyzer?: string,
  opts?: CloudCompileOptions,
): Promise<string>;

/** Return the text from a file in the analyzer's input directory. */
export function inputText(analyzerName: string, fileName: string): string;
