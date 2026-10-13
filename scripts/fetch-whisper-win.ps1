# Baixa o whisper-server.exe do release OFICIAL do whisper.cpp (ggml-org) para resources\win, conferindo o SHA-256 fixado abaixo.
# Downloads whisper-server.exe from the OFFICIAL whisper.cpp release (ggml-org) into resources\win, checking the SHA-256 pinned below.
# Para atualizar: troque a versão e o hash (o GitHub mostra o SHA-256 de cada arquivo do release) / To update: change the version and hash.
$ErrorActionPreference = 'Stop'
$Version = 'v1.9.2'
$Asset = 'whisper-bin-x64.zip'
$Sha256 = '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a'
Set-Location (Join-Path $PSScriptRoot '..')
$dest = 'resources\win'
if ((Test-Path "$dest\whisper-server.exe") -and (Test-Path "$dest\.version") -and ((Get-Content "$dest\.version") -eq "$Version $Sha256")) { Write-Host "whisper-server ${Version}: ok (já baixado / already there)"; exit 0 }
$tmp = Join-Path ([IO.Path]::GetTempPath()) "rice-whisper-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  $zip = Join-Path $tmp $Asset
  # .NET direto (sem cmdlets de módulos): funciona também quando o PSModulePath vem de outro PowerShell, como no CI
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  (New-Object System.Net.WebClient).DownloadFile("https://github.com/ggml-org/whisper.cpp/releases/download/$Version/$Asset", $zip)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($zip)
  try { $got = ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLowerInvariant() } finally { $stream.Dispose() }
  if ($got -ne $Sha256) { throw "SHA-256 diferente do esperado / SHA-256 mismatch: $got" }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Force $dest | Out-Null
  # o servidor e as DLLs de que ele depende (whisper, ggml e as variantes de CPU escolhidas em tempo de execução)
  $rel = Join-Path $tmp 'Release'
  Copy-Item "$rel\whisper-server.exe", "$rel\whisper.dll" $dest
  Copy-Item "$rel\ggml*.dll" $dest
  Set-Content -NoNewline -Path "$dest\.version" -Value "$Version $Sha256"
  Write-Host "ok: whisper-server $Version ($((Get-ChildItem $dest -Filter *.dll).Count) DLLs)"
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
