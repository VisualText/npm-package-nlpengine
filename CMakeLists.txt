# CMake build for the nlpplus native addon, driven by cmake-js.
#
# This is the Node.js peer of the Python package's CMakeLists.txt: it builds
# the bundled nlp-engine C++ libraries and links them into a Node-API addon
# (bindings.node) instead of a Python extension.  cmake-js supplies
# CMAKE_JS_INC / CMAKE_JS_LIB / CMAKE_JS_SRC and the node-addon-api include
# dir is discovered from node via package.json's build script.

cmake_minimum_required(VERSION 3.15)
cmake_policy(SET CMP0091 NEW)  # MSVC runtime selection via CMAKE_MSVC_RUNTIME_LIBRARY
project(nlpplus LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/nlp-engine)
  message(FATAL_ERROR "Could not find nlp-engine in source directory. Did you run `git submodule update --init`?")
endif()

add_subdirectory(nlp-engine)
include_directories(nlp-engine/cs/include)
include_directories(nlp-engine/include)
include_directories(nlp-engine/include/Api)
include_directories(nlp-engine/include/Api/lite)
include_directories(${ICU_INCLUDE_DIR})

if(WIN32)
  add_definitions(-DMSVC_VERSION=${MSVC_VERSION} -D_CRT_SECURE_NO_WARNINGS)
else()
  # Not the greatest way to define "not Windows"!
  add_definitions(-DLINUX -Wno-write-strings -Wno-deprecated)
endif()

# The engine static libs must be position-independent to link into the
# shared addon.
set_property(TARGET prim PROPERTY POSITION_INDEPENDENT_CODE ON)
set_property(TARGET kbm PROPERTY POSITION_INDEPENDENT_CODE ON)
set_property(TARGET consh PROPERTY POSITION_INDEPENDENT_CODE ON)
set_property(TARGET words PROPERTY POSITION_INDEPENDENT_CODE ON)
set_property(TARGET lite PROPERTY POSITION_INDEPENDENT_CODE ON)

# --- Node-API addon target ----------------------------------------------
add_library(bindings SHARED src/bindings.cpp ${CMAKE_JS_SRC})
set_target_properties(bindings PROPERTIES PREFIX "" SUFFIX ".node")

# Node + N-API headers from cmake-js.
target_include_directories(bindings PRIVATE ${CMAKE_JS_INC})
# node-addon-api headers (location passed in by the npm build script).
if(DEFINED NODE_ADDON_API_DIR)
  target_include_directories(bindings PRIVATE ${NODE_ADDON_API_DIR})
endif()
# C++ exceptions are used by node-addon-api wrappers.
target_compile_definitions(bindings PRIVATE NAPI_CPP_EXCEPTIONS)

if(WIN32)
  # delayimp.lib provides __delayLoadHelper2, required because the Node addon
  # links node.lib with /DELAYLOAD:NODE.EXE (set up by cmake-js).
  target_link_libraries(bindings PRIVATE prim kbm consh words lite ${CMAKE_JS_LIB} delayimp)
else()
  target_link_libraries(bindings PRIVATE prim kbm consh words lite dl pthread ${CMAKE_JS_LIB})
endif()

# Generate node.lib delay-load hook on Windows (cmake-js convention).
if(MSVC AND CMAKE_JS_NODELIB_DEF AND CMAKE_JS_NODELIB_TARGET)
  execute_process(COMMAND ${CMAKE_AR} /def:${CMAKE_JS_NODELIB_DEF} /out:${CMAKE_JS_NODELIB_TARGET} ${CMAKE_STATIC_LINKER_FLAGS})
endif()

# Forward the engine version (parsed from nlp-engine/nlp/main.cpp) to the
# binding as a compile-time string, so engineVersion() can report it for the
# cloud-compile manifest.
file(READ ${CMAKE_CURRENT_SOURCE_DIR}/nlp-engine/nlp/main.cpp _engine_main)
string(REGEX MATCH "#define NLP_ENGINE_VERSION \"([^\"]+)\"" _ ${_engine_main})
if(CMAKE_MATCH_1)
  target_compile_definitions(bindings PRIVATE NLP_ENGINE_VERSION="${CMAKE_MATCH_1}")
  message(STATUS "Bundled nlp-engine version: ${CMAKE_MATCH_1}")
else()
  message(WARNING "Could not parse NLP_ENGINE_VERSION from nlp-engine/nlp/main.cpp; engineVersion() will return 'unknown'")
endif()
unset(_engine_main)
