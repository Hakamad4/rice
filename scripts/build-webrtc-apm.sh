#!/usr/bin/env bash
# Builds freedesktop webrtc-audio-processing (AEC3) as static arm64 libs into
# native/third_party/webrtc-apm/{include,lib}. Reproducible: pinned version + SHA-256.
set -euo pipefail

VERSION="2.1"
SHA256="ae9302824b2038d394f10213cab05312c564a038434269f11dbf68f511f9f9fe"
URL="https://freedesktop.org/software/pulseaudio/webrtc-audio-processing/webrtc-audio-processing-${VERSION}.tar.xz"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/native/third_party"
PREFIX="$OUT/webrtc-apm"
WORK="$OUT/build-work"

for t in meson ninja pkg-config; do
  command -v "$t" >/dev/null || { echo "installing $t via brew"; brew install meson ninja pkg-config; break; }
done

rm -rf "$WORK" "$PREFIX"
mkdir -p "$WORK" "$PREFIX"
cd "$WORK"
# O tarball vem junto com o código (native/vendor): o freedesktop.org bloqueia downloads de vez em quando (HTTP 418) e o build parava aí.
# O download só acontece se a cópia local não existir; a SHA-256 é conferida nos dois casos.
# The tarball ships with the source (native/vendor): freedesktop.org blocks downloads now and then (HTTP 418) and the build stopped there.
# The download only happens when the local copy is missing; the SHA-256 is checked either way.
VENDORED="$ROOT/native/vendor/webrtc-audio-processing-${VERSION}.tar.xz"
if [ -f "$VENDORED" ]; then
  echo "using vendored $VENDORED"
  cp "$VENDORED" src.tar.xz
else
  curl -fsSL -o src.tar.xz "$URL"
fi
echo "$SHA256  src.tar.xz" | shasum -a 256 -c -
mkdir src && tar -xf src.tar.xz -C src --strip-components=1

export MACOSX_DEPLOYMENT_TARGET=14.0
export CFLAGS="-arch arm64 -mmacosx-version-min=14.0" CXXFLAGS="-arch arm64 -mmacosx-version-min=14.0" LDFLAGS="-arch arm64"
meson setup build src --prefix="$PREFIX" --libdir=lib --buildtype=release \
  -Ddefault_library=static --wrap-mode=forcefallback -Dc_args="-arch arm64" -Dcpp_args="-arch arm64"
ninja -C build
ninja -C build install

echo "== static libs =="
find "$PREFIX/lib" -name '*.a' | sort
echo "== include path =="
ls -d "$PREFIX"/include/*
echo "pkg-config: $PREFIX/lib/pkgconfig"
