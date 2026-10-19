# Copia os helpers do Windows (rice-audio.exe, rice-detector.exe) para native-bin\win, que o empacotador inclui no app.
# Compile antes: cmake -S native/win -B build/win -G Ninja -DCMAKE_BUILD_TYPE=Release ; cmake --build build/win
# Copies the Windows helpers to native-bin\win, which the packager includes in the app. Build them first (see above).
param([string]$BuildDir = 'build\win')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$dest = 'native-bin\win'
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($name in 'rice-audio.exe', 'rice-detector.exe') {
  $src = @("$BuildDir\$name", "$BuildDir\Release\$name", "native\win\build\Release\$name") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $src) { throw "falta $name em $BuildDir / missing $name in $BuildDir (compile os helpers primeiro / build the helpers first)" }
  Copy-Item $src "$dest\$name"
}
# Tradução offline: só entra com a chave habilitada (src/main/translate/flags.ts; RICE_OFFLINE_TRANSLATION=1|0 sobrepõe).
# Habilitada, com RICE_RELEASE=1 a falta do rice-translate.exe aborta.
$flag = $env:RICE_OFFLINE_TRANSLATION
$offline = if ($flag -eq '1') { $true } elseif ($flag -eq '0') { $false } else { [bool](Select-String -Path 'src\main\translate\flags.ts' -Pattern '^export const OFFLINE_TRANSLATION = true;' -Quiet) }
if (-not $offline) {
  Write-Host 'tradução offline desabilitada: app sem rice-translate.exe / offline translation disabled: app without rice-translate.exe'
} else {
  $tr = @('native\translate\build\rice-translate.exe', 'native\translate\build\Release\rice-translate.exe', "$BuildDir\rice-translate.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($tr) { Copy-Item $tr "$dest\rice-translate.exe" }
  elseif ($env:RICE_RELEASE -and $env:RICE_RELEASE -ne '0') { throw 'falta rice-translate.exe e RICE_RELEASE=1: o app de release não sai sem o motor de tradução offline / rice-translate.exe is missing and RICE_RELEASE=1: a release must ship the offline translation engine' }
  else { Write-Warning 'sem rice-translate.exe: o app sai sem o motor de tradução offline / no rice-translate.exe, the app ships without the offline translation engine' }
}
Write-Host "ok: $((Get-ChildItem $dest).Name -join ' ')"
