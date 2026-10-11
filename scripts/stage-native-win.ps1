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
Write-Host "ok: $((Get-ChildItem $dest).Name -join ' ')"
