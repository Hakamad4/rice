#!/usr/bin/env bash
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; T="$D/../third_party/webrtc-apm"
clang++ -std=c++17 -arch arm64 -DWEBRTC_LIBRARY_IMPL -DWEBRTC_POSIX \
  -I"$T/include/webrtc-audio-processing-2" -I"$T/include" "$D/smoke.cpp" \
  -L"$T/lib" -lwebrtc-audio-processing-2 -framework CoreFoundation -framework Foundation \
  -o "${TMPDIR:-/tmp}/apm-smoke" && "${TMPDIR:-/tmp}/apm-smoke"
