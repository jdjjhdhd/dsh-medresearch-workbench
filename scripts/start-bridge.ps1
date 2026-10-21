param(
  [int]$Port = 8765,
  [switch]$Stop,
  [switch]$Status
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $Root "runtime\bridge.pid"
$LogDir = Join-Path $Root "logs"
$OutLog = Join-Path $LogDir "bridge.log"
$ErrLog = Join-Path $LogDir "bridge.err.log"
$HealthUrl = "http://127.0.0.1:$Port/health"
New-Item -ItemType Directory -Force (Split-Path $PidFile), $LogDir | Out-Null

function Get-Health {
  try {
    return Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
  } catch {
    return $null
  }
}

function Get-PortOwner {
  try {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if (-not $c) { return $null }
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    return [pscustomobject]@{ Pid = $c.OwningProcess; Name = $p.ProcessName; Path = $p.Path; CommandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue).CommandLine }
  } catch {
    return $null
  }
}

function Test-OurService($h) {
  return $h -and $h.ok -eq $true -and $h.service -eq "medresearch-workbench-bridge" -and $h.projectRoot -eq $Root
}

$health = Get-Health
if (Test-OurService $health) {
  Write-Host "[OK] 医学研究工作台服务已在运行，复用现有进程。" -ForegroundColor Green
  Write-Host ("     地址: " + $HealthUrl)
  Write-Host ("     数据: " + $health.dataFile)
  if ($health.zotero) { Write-Host ("     Zotero: " + $(if ($health.zotero.connected) { "已连接" } else { "未连接" })) }
  $bm = $health.search.biomcp
  if ($bm) { Write-Host ("     BioMCP: " + $(if ($bm.installed) { $bm.version } else { "未安装" })) }
  if ($Stop) {
    if (Test-Path $PidFile) {
      $rec = Get-Content $PidFile -Raw | ConvertFrom-Json
      $proc = Get-Process -Id $rec.pid -ErrorAction SilentlyContinue
      if ($proc) {
        Stop-Process -Id $rec.pid -Force
        Write-Host "[OK] 已停止受管服务 PID $($rec.pid)" -ForegroundColor Yellow
      } else {
        Write-Host "[WARN] PID 文件存在但进程已退出；未停止其他进程。" -ForegroundColor Yellow
      }
      Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    } else {
      Write-Host "[WARN] 服务在运行，但没有本项目 PID 文件；未自动停止，避免误杀其他进程。" -ForegroundColor Yellow
    }
  }
  exit 0
}

if ($Status) {
  Write-Host "[DOWN] 未检测到本项目服务。" -ForegroundColor Yellow
  $owner = Get-PortOwner
  if ($owner) { Write-Host ("[PORT] 端口 $Port 被 PID $($owner.Pid) ($($owner.Name)) 占用。") -ForegroundColor Red }
  exit 1
}

if ($Stop) {
  if (Test-Path $PidFile) {
    $rec = Get-Content $PidFile -Raw | ConvertFrom-Json
    $proc = Get-Process -Id $rec.pid -ErrorAction SilentlyContinue
    if ($proc) { Stop-Process -Id $rec.pid -Force; Write-Host "[OK] 已停止 PID $($rec.pid)" -ForegroundColor Yellow }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "[INFO] 没有 PID 文件，服务未运行。" -ForegroundColor Yellow
  }
  exit 0
}

# 端口被其他程序占用：明确报错，不杀进程、不复用错误服务
$owner = Get-PortOwner
if ($owner) {
  Write-Host "[ERROR] 端口 $Port 已被占用，但不是本项目服务。" -ForegroundColor Red
  Write-Host ("        PID: " + $owner.Pid + "  进程: " + $owner.Name)
  Write-Host ("        命令: " + $owner.CommandLine)
  Write-Host "        请关闭占用程序，或设置 MEDWB_PORT 使用其他端口后重新启动。" -ForegroundColor Yellow
  exit 2
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node -and (Test-Path "C:\Program Files\nodejs\node.exe")) { $node = "C:\Program Files\nodejs\node.exe" }
if (-not $node) {
  Write-Host "[ERROR] 未找到 node.exe，请安装 Node.js 20+ 并加入 PATH。" -ForegroundColor Red
  exit 3
}
$nodeVersion = & $node -p "process.versions.node" 2>$null
$nodeMajor = 0
if ($nodeVersion) {
  try { $nodeMajor = [int]([string]$nodeVersion).Split('.')[0] } catch { $nodeMajor = 0 }
}
if ($nodeMajor -lt 20) {
  Write-Host "[ERROR] 需要 Node.js 20+（当前 $nodeVersion）。Node.js 用于运行插件安装器及本地桥接服务。" -ForegroundColor Red
  exit 3
}

$server = Join-Path $Root "bridge\server.mjs"
if (-not (Test-Path $server)) {
  Write-Host "[ERROR] 找不到 $server" -ForegroundColor Red
  exit 4
}

Write-Host "[START] 启动医学研究工作台后台服务..." -ForegroundColor Cyan
$p = Start-Process -FilePath $node -ArgumentList @("`"$server`"") -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
@{ pid = $p.Id; port = $Port; projectRoot = $Root; startedAt = (Get-Date).ToString("o"); node = $node } |
  ConvertTo-Json | Set-Content $PidFile -Encoding UTF8

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  $h = Get-Health
  if (Test-OurService $h) { $health = $h; $ok = $true; break }
  if ($p.HasExited) { break }
}

if (-not $ok) {
  Write-Host "[ERROR] 服务未能在 15 秒内通过健康检查。" -ForegroundColor Red
  if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow } }
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  exit 5
}

Write-Host "[OK] 服务已在后台启动，关闭本窗口不会停止服务。" -ForegroundColor Green
Write-Host ("     PID: " + $p.Id)
Write-Host ("     地址: " + $HealthUrl)
Write-Host ("     数据: " + $health.dataFile)
if ($health.zotero) { Write-Host ("     Zotero: " + $(if ($health.zotero.connected) { "已连接" } else { "未连接：" + $health.zotero.error })) }
$bm = $health.search.biomcp
if ($bm) { Write-Host ("     BioMCP: " + $(if ($bm.installed) { $bm.version } else { "未安装" })) }
Write-Host ("     停止: powershell -File scripts\start-bridge.ps1 -Stop") -ForegroundColor DarkGray
exit 0
