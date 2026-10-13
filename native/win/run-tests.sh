#!/bin/bash
# Compila e roda os testes da parte portável com o compilador do sistema (clang no macOS, g++ no Linux).
# No Windows o CMake faz o mesmo (ctest). Uso: native/win/run-tests.sh [--keep]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${TMPDIR:-/tmp}/rice-win-tests"
mkdir -p "$out"
cxx="${CXX:-c++}"
"$cxx" -std=c++17 -O1 -Wall -Wextra -Wno-unused-parameter -pthread \
  "$here"/common/*.cpp "$here"/audio/{echo_canceller,recorder,selftests,sinks,simulated_platform,output_classify}.cpp \
  "$here"/detector/{app_matcher,mic_watcher,mic_monitor}.cpp "$here"/tests/*.cpp -o "$out/rice_tests"
RICE_FIXTURES="$here/../../tests/fixtures" "$out/rice_tests"
