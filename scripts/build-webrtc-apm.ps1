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
  # freedesktop.org barra downloads de runners (desafio anti-bot devolve HTML): tenta o tarball oficial e, se o SHA-256 não
  # bater, o archive da mesma tag no GitLab (hash próprio, também fixado).
  $sources = @(
    @{ Url = $Url; Sha = $Sha256; File = 'src.tar.xz' },
    @{ Url = "https://gitlab.freedesktop.org/pulseaudio/webrtc-audio-processing/-/archive/v$Version/webrtc-audio-processing-v$Version.tar.gz"; Sha = '2358883a8551711f3b6169f6799c003dc1a6efd37bdb24a135a015cc9e3d7713'; File = 'src.tar.gz' }
  )
  $archive = $null
  foreach ($source in $sources) {
    curl.exe -fsSL --retry 3 -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' -o $source.File $source.Url
    if ($LASTEXITCODE -eq 0 -and (Test-Path $source.File) -and ((Get-FileHash $source.File -Algorithm SHA256).Hash.ToLower() -eq $source.Sha)) { $archive = $source.File; break }
    Write-Host "download/SHA-256 falhou para $($source.Url)"
  }
  if (-not $archive) { throw 'não foi possível baixar o webrtc-audio-processing com o SHA-256 esperado' }
  New-Item -ItemType Directory src | Out-Null
  tar -xf $archive -C src --strip-components=1
  meson setup build src --prefix="$Prefix" --libdir=lib --buildtype=release -Ddefault_library=static --wrap-mode=forcefallback --vsenv
  ninja -C build
  ninja -C build install
  Write-Host "ok: $Prefix"
} finally {
  Pop-Location
}
