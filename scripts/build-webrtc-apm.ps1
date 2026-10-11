# Tenta compilar o webrtc-audio-processing 2.1 (AEC3) com MSVC via meson, em native/third_party/webrtc-apm-win.
# EXPERIMENTAL: ainda não foi executado numa máquina Windows. O CI roda isto em um job separado (continue-on-error)
# para descobrir se o build fecha; enquanto não fechar, o rice-audio.exe sai sem AEC (ver native/win/README.md).
# Pré-requisitos no PATH: meson, ninja, ambiente do MSVC (Developer PowerShell / ilammy/msvc-dev-cmd).
$ErrorActionPreference = 'Stop'
$Version = '2.1'
$Sha256 = 'ae9302824b2038d394f10213cab05312c564a038434269f11dbf68f511f9f9fe'
$Url = "https://freedesktop.org/software/pulseaudio/webrtc-audio-processing/webrtc-audio-processing-$Version.tar.xz"

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Out = Join-Path $Root 'native/third_party'
$Prefix = Join-Path $Out 'webrtc-apm-win'
$Work = Join-Path $Out 'build-work-win'

Remove-Item -Recurse -Force $Work, $Prefix -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Work, $Prefix | Out-Null
Push-Location $Work
try {
  # Os servidores do freedesktop (e o GitLab) devolvem desafio anti-bot (HTTP 418) aos runners do GitHub; por isso o tarball
  # oficial, com o SHA-256 fixado acima, vive em native/vendor/ (licença BSD-3 do WebRTC dentro dele).
  $archive = Join-Path $Root 'native/vendor/webrtc-audio-processing-2.1.tar.xz'
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $Sha256) { throw 'native/vendor/webrtc-audio-processing-2.1.tar.xz não bate com o SHA-256 esperado' }
  New-Item -ItemType Directory src | Out-Null
  tar -xf $archive -C src --strip-components=1
  meson setup build src --prefix="$Prefix" --libdir=lib --buildtype=release -Ddefault_library=static --wrap-mode=forcefallback --vsenv
  ninja -C build
  ninja -C build install
  Write-Host "ok: $Prefix"
} finally {
  Pop-Location
}
