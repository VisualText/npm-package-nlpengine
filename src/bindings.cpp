// Node-API (node-addon-api) bindings for the NLP++ text-analysis engine.
//
// This is the Node.js peer of the Python package's `bindings.cpp` (which
// uses nanobind).  It wraps the same nlp-engine C++ library and exposes an
// `NLP_ENGINE` class plus an `engineVersion()` helper to JavaScript.  The
// higher-level ergonomic API (the `Engine`/`Results` classes, default
// working folder, bundled analyzers, cloud compile) lives in lib/index.js,
// exactly as `__init__.py` does on the Python side.

#include <cstring>
#include <cstdlib>
#include <sstream>
#include <string>

#include <napi.h>

#include "lite/nlp_engine.h"
#include "lite/vtrun.h"

#ifndef _WIN32 /* FIXME: not a great "not Windows" symbol, mirrors bindings.cpp */
#define _tcsdup strdup
#endif

namespace {

// Wrap the engine's analyze() to deal with C++ friction.
//
// Takes an analyzer name (presumed to exist in the "analyzers"
// subdirectory of the working folder) and a string, returns a string.
// Note that few analyzers actually return a string, but instead generally
// write stuff to the "output" directory in their working folder.  That
// gets handled by the JS code in lib/index.js.
//
// `compiled=true` tells the engine to dlopen the analyzer's bin/run.<ext>
// and bin/kb.<ext> shared libraries (produced by an earlier compile() call
// plus a cmake/cloud build step).  Without it, the engine runs interpreted
// from the .nlp source.
std::string analyze_impl(NLP_ENGINE &engine, const std::string &parser,
                         const std::string &input, bool develop,
                         bool compiled) {
  _TCHAR *_parser = _tcsdup(parser.c_str());
  std::istringstream instream(input);
  std::ostringstream outstream;
  engine.analyze(_parser, &instream, &outstream, develop, /*silent*/ false,
                 /*compile*/ false, compiled, /*compileKB*/ false);
  free(_parser);
  return outstream.str();
}

// Trigger the engine's -COMPILE mode for the named analyzer.
//
// Generates the C++ source files for the analyzer (under <analyzer>/run/)
// and the knowledge base (under <analyzer>/kb/).  Those still need to be
// built into a shared library by an external step -- either cmake locally
// or the nlp-compile-service in the cloud -- before they can be loaded via
// analyze(..., compiled=true).
//
// `kbOnly=true` switches to KB-only codegen (-COMPILEKB).
// `analyzerOnly=true` switches to analyzer-only codegen (-COMPILEANA),
// emitting just <analyzer>/run/ and leaving the KB alone.  Mutually
// exclusive with kbOnly.
void compile_impl(NLP_ENGINE &engine, const std::string &analyzer,
                  bool develop, bool kbOnly, bool analyzerOnly) {
  _TCHAR *_analyzer = _tcsdup(analyzer.c_str());
  engine.init(_analyzer, develop, /*silent*/ false,
              /*compile*/ (!kbOnly && !analyzerOnly), /*compiled*/ false,
              /*compileKB*/ kbOnly, /*compileAna*/ analyzerOnly);
  free(_analyzer);
}

// Return the bundled nlp-engine version string (e.g. "3.1.55").
//
// cloudCompile() in lib/cloud.js uses this to populate the manifest sent to
// the nlp-compile-service dispatcher.  NLP_ENGINE_VERSION is the
// compile-time string baked into nlp/main.cpp and forwarded by
// CMakeLists.txt; if unset we fall back to "unknown".
std::string engine_version() {
#ifdef NLP_ENGINE_VERSION
  return NLP_ENGINE_VERSION;
#else
  return "unknown";
#endif
}

// JS-visible wrapper class around NLP_ENGINE.
class Engine : public Napi::ObjectWrap<Engine> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(
        env, "NLP_ENGINE",
        {
            InstanceMethod("analyze", &Engine::Analyze),
            InstanceMethod("compile", &Engine::Compile),
            InstanceMethod("close", &Engine::Close),
        });
    auto *ctor = new Napi::FunctionReference();
    *ctor = Napi::Persistent(func);
    env.SetInstanceData(ctor);
    exports.Set("NLP_ENGINE", func);
    return exports;
  }

  // new NLP_ENGINE(workingFolder = ".", silent = true)
  explicit Engine(const Napi::CallbackInfo &info)
      : Napi::ObjectWrap<Engine>(info) {
    Napi::Env env = info.Env();
    std::string workingFolder =
        info.Length() > 0 && info[0].IsString()
            ? info[0].As<Napi::String>().Utf8Value()
            : std::string(".");
    bool silent = info.Length() > 1 && info[1].IsBoolean()
                      ? info[1].As<Napi::Boolean>().Value()
                      : true;
    try {
      engine_ = new NLP_ENGINE(workingFolder, silent);
    } catch (const std::exception &e) {
      Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    }
  }

  ~Engine() override { Teardown(); }

 private:
  NLP_ENGINE *engine_ = nullptr;

  void Teardown() {
    if (engine_ != nullptr) {
      // NLP_ENGINE has two close() overloads; the nullary one does the
      // global teardown (releases the cgerr.log handle, etc.).
      engine_->close();
      delete engine_;
      engine_ = nullptr;
    }
  }

  bool EnsureOpen(Napi::Env env) {
    if (engine_ == nullptr) {
      Napi::Error::New(env, "engine has been closed")
          .ThrowAsJavaScriptException();
      return false;
    }
    return true;
  }

  // analyze(parser, input, develop = false, compiled = false): string
  Napi::Value Analyze(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (!EnsureOpen(env)) return env.Undefined();
    std::string parser = info[0].As<Napi::String>().Utf8Value();
    std::string input = info[1].As<Napi::String>().Utf8Value();
    bool develop = info.Length() > 2 && info[2].IsBoolean()
                       ? info[2].As<Napi::Boolean>().Value()
                       : false;
    bool compiled = info.Length() > 3 && info[3].IsBoolean()
                        ? info[3].As<Napi::Boolean>().Value()
                        : false;
    try {
      std::string out = analyze_impl(*engine_, parser, input, develop, compiled);
      return Napi::String::New(env, out);
    } catch (const std::exception &e) {
      Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
      return env.Undefined();
    }
  }

  // compile(analyzer, develop = false, kbOnly = false, analyzerOnly = false): void
  Napi::Value Compile(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (!EnsureOpen(env)) return env.Undefined();
    std::string analyzer = info[0].As<Napi::String>().Utf8Value();
    bool develop = info.Length() > 1 && info[1].IsBoolean()
                       ? info[1].As<Napi::Boolean>().Value()
                       : false;
    bool kbOnly = info.Length() > 2 && info[2].IsBoolean()
                      ? info[2].As<Napi::Boolean>().Value()
                      : false;
    bool analyzerOnly = info.Length() > 3 && info[3].IsBoolean()
                      ? info[3].As<Napi::Boolean>().Value()
                      : false;
    try {
      compile_impl(*engine_, analyzer, develop, kbOnly, analyzerOnly);
    } catch (const std::exception &e) {
      Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    }
    return env.Undefined();
  }

  // close(): void -- idempotent global teardown.
  Napi::Value Close(const Napi::CallbackInfo &info) {
    Teardown();
    return info.Env().Undefined();
  }
};

Napi::Value EngineVersion(const Napi::CallbackInfo &info) {
  return Napi::String::New(info.Env(), engine_version());
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set("engineVersion",
              Napi::Function::New(env, EngineVersion, "engineVersion"));
  return Engine::Init(env, exports);
}

}  // namespace

NODE_API_MODULE(bindings, InitAll)
