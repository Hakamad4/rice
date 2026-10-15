# Instala o Rice no Windows pela ultima release: baixa o Rice-Setup-*.exe do GitHub, confere o hash pelo latest.yml e roda o instalador.
# Installs Rice on Windows from the latest release: downloads Rice-Setup-*.exe from GitHub, verifies its hash with latest.yml and runs the installer.
# Uso / Usage:   irm https://raw.githubusercontent.com/WalissonCF/rice/main/install-win.ps1 | iex
# (nao confundir com install.ps1, que compila o Rice a partir do codigo, para quem desenvolve / not to be confused with install.ps1, which builds Rice from source, for developers)
# O arquivo e so ASCII de proposito: `irm | iex` no Windows PowerShell 5.1 pode ler o texto com a codificacao errada. / ASCII on purpose: `irm | iex` on Windows PowerShell 5.1 may decode the text wrongly.
# Variaveis de ambiente so para testes / test-only environment variables: RICE_INSTALL_API (URL da API no lugar do GitHub), RICE_INSTALL_NORUN=1 (nao roda o instalador),
# RICE_INSTALL_OUTDIR (onde baixar), RICE_INSTALL_SILENT=1 (instalacao silenciosa, /S). Sem bloco param: `iex` recebe so o texto.

function Install-Rice {
  param([string]$Api, [switch]$NoRun, [string]$OutDir, [switch]$Silent)
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # o progresso do Invoke-WebRequest deixa o download muito mais lento no PowerShell 5.1
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
  $repo = 'WalissonCF/rice'
  if (-not $Api) { $Api = "https://api.github.com/repos/$repo" }
  $pt = (Get-UICulture).Name -like 'pt*'
  function T($p, $e) { if ($pt) { [regex]::Unescape($p) } else { $e } }
  function Say($p, $e) { Write-Host (T $p $e) }
  function Fail($p, $e) { Write-Host ("ERRO: " + [regex]::Unescape($p) + "`nERROR: " + $e) -ForegroundColor Red; $script:failed = $true }
  $script:failed = $false

  # 1) Windows de 64 bits (x64)
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    Fail 'o Rice precisa do Windows x64 (64 bits; o ARM64 ainda n\u00e3o \u00e9 suportado).' 'Rice needs Windows x64 (64-bit; ARM64 is not supported yet).'
    return
  }

  # 2) a ultima release
  Say 'procurando a \u00faltima vers\u00e3o do Rice...' 'looking for the latest Rice release...'
  try {
    $release = Invoke-RestMethod -Uri "$Api/releases/latest" -Headers @{ 'User-Agent' = 'rice-install-win'; 'Accept' = 'application/vnd.github+json' }
  } catch {
    Fail 'n\u00e3o consegui consultar as releases do GitHub (sem internet?). Baixe o instalador em https://github.com/WalissonCF/rice/releases' 'could not query the GitHub releases (no internet?). Download the installer from https://github.com/WalissonCF/rice/releases'
    return
  }
  $exeAsset = @($release.assets | Where-Object { $_.name -match '^Rice-Setup-.*-x64\.exe$' }) | Select-Object -First 1
  $ymlAsset = @($release.assets | Where-Object { $_.name -eq 'latest.yml' }) | Select-Object -First 1
  if (-not $exeAsset) { Fail 'a \u00faltima release n\u00e3o tem o instalador (Rice-Setup-*-x64.exe).' 'the latest release has no installer (Rice-Setup-*-x64.exe).'; return }
  if (-not $ymlAsset) { Fail 'a \u00faltima release n\u00e3o tem o latest.yml; sem ele n\u00e3o d\u00e1 para conferir o instalador, ent\u00e3o nada ser\u00e1 instalado.' 'the latest release has no latest.yml; without it the installer cannot be verified, so nothing will be installed.'; return }
  $tag = [string]$release.tag_name
  Say "vers\u00e3o $tag" "version $tag"

  # 3) o hash esperado, pelo latest.yml (o electron-builder grava o SHA-512 em base64)
  try {
    $yml = [string](Invoke-RestMethod -Uri $ymlAsset.browser_download_url -Headers @{ 'User-Agent' = 'rice-install-win' })
  } catch {
    Fail 'n\u00e3o consegui baixar o latest.yml.' 'could not download latest.yml.'
    return
  }
  $wantName = [regex]::Match($yml, '(?m)^path:\s*[''"]?([^''"\r\n]+?)[''"]?\s*$').Groups[1].Value
  $want = [regex]::Match($yml, '(?m)^sha512:\s*[''"]?([A-Za-z0-9+/=]+)[''"]?\s*$').Groups[1].Value
  if (-not $want) { Fail 'o latest.yml n\u00e3o traz o hash do instalador; nada ser\u00e1 instalado.' 'latest.yml has no installer hash; nothing will be installed.'; return }
  if ($wantName -and $wantName -ne $exeAsset.name) { Fail "o latest.yml fala de $wantName, mas a release traz $($exeAsset.name); nada ser\u00e1 instalado." "latest.yml describes $wantName, but the release has $($exeAsset.name); nothing will be installed."; return }

  # 4) baixa o instalador
  if (-not $OutDir) { $OutDir = Join-Path ([IO.Path]::GetTempPath()) ('rice-install-' + [Guid]::NewGuid().ToString('N')) }
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $file = Join-Path $OutDir $exeAsset.name
  Say "baixando $($exeAsset.name)..." "downloading $($exeAsset.name)..."
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $exeAsset.browser_download_url -OutFile $file -Headers @{ 'User-Agent' = 'rice-install-win' }
  } catch {
    Remove-Item -Force -ErrorAction SilentlyContinue $file
    Fail 'o download do instalador falhou.' 'the installer download failed.'
    return
  }

  # 5) confere o SHA-512 (latest.yml) e, se a release informar, o SHA-256 (digest do GitHub); apaga o arquivo se nao bater
  $sha512 = [Security.Cryptography.SHA512]::Create()
  $sha256 = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($file)
  try { $got512 = [Convert]::ToBase64String($sha512.ComputeHash($stream)); $stream.Position = 0; $got256 = ([BitConverter]::ToString($sha256.ComputeHash($stream)) -replace '-', '').ToLower() } finally { $stream.Dispose() }
  if ($got512 -ne $want) {
    Remove-Item -Force -ErrorAction SilentlyContinue $file
    Fail 'o instalador baixado N\u00c3O confere com o latest.yml (hash diferente); foi apagado e nada foi instalado.' 'the downloaded installer does NOT match latest.yml (different hash); it was deleted and nothing was installed.'
    return
  }
  $digest = [string]$exeAsset.digest
  if ($digest -match '^sha256:([0-9a-fA-F]{64})$' -and $Matches[1].ToLower() -ne $got256) {
    Remove-Item -Force -ErrorAction SilentlyContinue $file
    Fail 'o SHA-256 do instalador n\u00e3o confere com o informado pelo GitHub; foi apagado e nada foi instalado.' 'the installer SHA-256 does not match the one reported by GitHub; it was deleted and nothing was installed.'
    return
  }
  Say "hash conferido (SHA-512 do latest.yml; SHA-256 $got256)" "hash verified (SHA-512 from latest.yml; SHA-256 $got256)"

  # 6) roda o instalador
  if ($NoRun) { Say "instalador em $file (n\u00e3o executado: -NoRun)." "installer at $file (not run: -NoRun)."; return }
  Say 'abrindo o instalador (o Windows pode mostrar "O Windows protegeu o seu computador": Mais informa\u00e7\u00f5es > Executar assim mesmo)...' 'opening the installer (Windows may show "Windows protected your PC": More info > Run anyway)...'
  if ($Silent) { Start-Process -FilePath $file -ArgumentList '/S' -Wait } else { Start-Process -FilePath $file -Wait }
  Say 'pronto: o Rice est\u00e1 instalado. Daqui em diante ele se atualiza sozinho (Configura\u00e7\u00f5es > Atualiza\u00e7\u00f5es).' 'done: Rice is installed. From now on it updates itself (Settings > Updates).'
}

Install-Rice -Api $env:RICE_INSTALL_API -NoRun:($env:RICE_INSTALL_NORUN -eq '1') -OutDir $env:RICE_INSTALL_OUTDIR -Silent:($env:RICE_INSTALL_SILENT -eq '1')
