# Compila o webrtc-audio-processing 2.1 (WebRTC AEC3) com MSVC via meson, estático e com runtime /MT, em native/third_party/webrtc-apm-win.
# Fonte: o tarball oficial versionado em native/vendor/ (os servidores do freedesktop e do GitLab devolvem desafio anti-bot aos runners),
# conferido pelo SHA-256 abaixo. O resultado é linkado dentro do rice-audio.exe: não há DLL para distribuir.
# Pré-requisitos no PATH: python com meson e ninja (pip install meson==1.5.2 ninja==1.11.1.1) e as ferramentas C++ do Visual Studio
# (o meson usa --vsenv e acha o MSVC sozinho; num Developer PowerShell também funciona).
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
  if ($LASTEXITCODE -ne 0) { throw 'tar falhou ao extrair o webrtc-audio-processing' }
  meson setup build src --prefix="$Prefix" --libdir=lib --buildtype=release -Ddefault_library=static --wrap-mode=forcefallback -Dcpp_std=c++20 -Db_vscrt=mt -Dabseil-cpp:cpp_std=c++20 --vsenv
  if ($LASTEXITCODE -ne 0) { throw 'meson setup falhou' }
  ninja -C build
  if ($LASTEXITCODE -ne 0) { throw 'ninja falhou ao compilar o webrtc-audio-processing' }
  ninja -C build install
  if ($LASTEXITCODE -ne 0) { throw 'ninja install falhou' }
  Write-Host "ok: $Prefix"
} catch {
  Remove-Item -Recurse -Force $Prefix -ErrorAction SilentlyContinue  # nunca deixa um prefixo pela metade (o CMake o usaria)
  throw
} finally {
  Pop-Location
}
