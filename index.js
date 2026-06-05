'use strict';

// Package entry point. The implementation lives in lib/ to keep the native
// addon loader, the cloud-compile port, and the ergonomic API cleanly
// separated (mirrors NLPPlus/__init__.py + NLPPlus/cloud.py on the Python
// side).
module.exports = require('./lib/index');
