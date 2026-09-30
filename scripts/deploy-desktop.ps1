param([string]$Version = '0.2.0')
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$source = Join-Path $projectRoot 'desktop/release/win-unpacked'
$appHome = Join-Path $env:LOCALAPPDATA 'Programs/Dayu'
$destination = Join-Path $appHome "versions/$Version"
$userDesktop = [Environment]::GetFolderPath('DesktopDirectory')
$releaseFolder = Join-Path $userDesktop '大肥鱼管家-发布包'
New-Item -ItemType Directory -Path $releaseFolder -Force | Out-Null
$shortcutPath = Join-Path $userDesktop '大肥鱼管家.lnk'
$appExecutable = Get-ChildItem -LiteralPath $source -Filter '*.exe' -File | Select-Object -First 1
if (-not $appExecutable) { throw 'Build the release first' }
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot "desktop/release/release-$Version.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw 'Release version mismatch' }
$installer = Join-Path $projectRoot "desktop/release/$($manifest.file)"
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $manifest.sha256) { throw 'Release checksum mismatch' }
Copy-Item -LiteralPath $installer -Destination (Join-Path $releaseFolder "大肥鱼管家安装包-$Version.exe") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "desktop/release/release-$Version.json") -Destination (Join-Path $releaseFolder "大肥鱼管家版本-$Version.json") -Force
if (Test-Path -LiteralPath $destination) { throw 'Version directory exists. Preserve it and choose a new version.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
& robocopy $source $destination /E /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw 'Release copy failed; current shortcut unchanged' }
$verificationRoot = Join-Path $projectRoot "work/deploy-check-$Version-$([guid]::NewGuid().ToString('N'))"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
try {
  $check = Start-Process -FilePath (Join-Path $destination $appExecutable.Name) -ArgumentList "`"--dayu-verify=$verificationRoot`"" -WindowStyle Hidden -PassThru
  if (-not $check.WaitForExit(45000)) { throw 'Release verification timed out; current shortcut unchanged' }
  $resultFile = Get-ChildItem -LiteralPath $verificationRoot -Recurse -Filter result.json | Select-Object -First 1
  if (-not $resultFile) { throw 'No verification report; current shortcut unchanged' }
  $result = Get-Content -LiteralPath $resultFile.FullName -Raw | ConvertFrom-Json
  if (-not $result.ok -or $result.version -ne $Version) { throw 'Release verification failed; current shortcut unchanged' }
} catch {
  Write-Warning 'New version did not pass startup verification. The old shortcut and personal data have not been modified.'
  throw
}
# Only switch the launch target after the isolated verification has passed.
$ws = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
  $previousTarget = $ws.CreateShortcut($shortcutPath).TargetPath
  if ($previousTarget -and (Test-Path -LiteralPath $previousTarget)) {
    $previous = $ws.CreateShortcut((Join-Path $userDesktop '大肥鱼管家-上一版本.lnk'))
    $previous.TargetPath = $previousTarget
    $previous.WorkingDirectory = Split-Path $previousTarget
    $previous.Save()
  }
}
$link = $ws.CreateShortcut($shortcutPath)
$link.TargetPath = Join-Path $destination $appExecutable.Name
$link.WorkingDirectory = $destination
$link.IconLocation = "$destination\大肥鱼管家.exe,0"
$link.Description = "大肥鱼管家 v$Version"
$link.Save()
Write-Output "Deployed $Version. Previous executable and user data preserved."
