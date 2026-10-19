#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Sidecar da tradução offline (scripts/build-translate.sh): primeiro, para falhar logo no modo release se faltar o cmake; opcional, mas com RICE_RELEASE=1 a falha aborta o build
scripts/build-translate.sh
[ -f native/third_party/webrtc-apm/lib/libwebrtc-audio-processing-2.a ] || scripts/build-webrtc-apm.sh
swift build -c release --package-path native/rice-audio
swift build -c release --package-path native/rice-detector
echo "ok: $(ls native/rice-audio/.build/release/rice-audio native/rice-detector/.build/release/rice-detector | tr '\n' ' ')"
