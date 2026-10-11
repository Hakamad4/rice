#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f native/third_party/webrtc-apm/lib/libwebrtc-audio-processing-2.a ] || scripts/build-webrtc-apm.sh
swift build -c release --package-path native/rice-audio
swift build -c release --package-path native/rice-detector
echo "ok: $(ls native/rice-audio/.build/release/rice-audio native/rice-detector/.build/release/rice-detector | tr '\n' ' ')"
