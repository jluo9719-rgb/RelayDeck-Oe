<#
.SYNOPSIS
  RelayDeck Windows CC Switch -> AWS 云端模型与密钥同步脚本
.DESCRIPTION
  读取本机 Windows 的 Claude Code (~/.claude/settings.json) 和 Codex CLI (~/.codex/config.toml, ~/.codex/auth.json)，
  通过 Cloudflare Access Service Token + RelayDeck 同步密钥安全推送到 24 小时云端服务器。
  云端后端会自动过滤 Windows 专属路径（如 C:\... / .exe / node_repl），确保 Linux 端直接可用。
.EXAMPLE
  # 立即手动同步一次（首次运行会自动引导填入凭证）
  powershell -ExecutionPolicy Bypass -File .\scripts\sync-ccswitch-to-cloud.ps1
.EXAMPLE
  # 持续监听 CC Switch 变动，切换模型后 2 秒内自动同步到云端
  powershell -ExecutionPolicy Bypass -File .\scripts\sync-ccswitch-to-cloud.ps1 -Watch
.EXAMPLE
  # 重新填写云端地址或密钥
  powershell -ExecutionPolicy Bypass -File .\scripts\sync-ccswitch-to-cloud.ps1 -Reconfigure
#>
param(
  [switch]$Watch,
  [switch]$Reconfigure
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ConfigFile = Join-Path $env:USERPROFILE '.relaydeck-sync.json'
$ClaudeSettingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'
$CodexConfigPath = Join-Path $env:USERPROFILE '.codex\config.toml'
$CodexAuthPath = Join-Path $env:USERPROFILE '.codex\auth.json'

function Read-Utf8FileIfExists([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  }
  return $null
}

function Run-SetupWizard {
  Write-Host ''
  Write-Host '==================================================' -ForegroundColor Cyan
  Write-Host '  RelayDeck 电脑 -> 云端配置同步 首次配置向导' -ForegroundColor Cyan
  Write-Host '==================================================' -ForegroundColor Cyan
  Write-Host '凭证只会保存在你本机用户目录：' -ForegroundColor DarkGray
  Write-Host "  $ConfigFile" -ForegroundColor DarkGray
  Write-Host '不会进入 Git 仓库，安全放心。' -ForegroundColor DarkGray
  Write-Host ''

  $defaultUrl = 'https://cloud.example.com'
  $cloudUrl = Read-Host "1) 云端 RelayDeck 地址（直接回车默认 $defaultUrl）"
  if ([string]::IsNullOrWhiteSpace($cloudUrl)) { $cloudUrl = $defaultUrl }
  $cloudUrl = $cloudUrl.Trim().TrimEnd('/')

  $cfClientId = (Read-Host '2) Cloudflare Access Client ID (CF-Access-Client-Id，如未开启 Access 可直接回车)').Trim()
  $cfClientSecret = ''
  if (-not [string]::IsNullOrWhiteSpace($cfClientId)) {
    $cfClientSecret = (Read-Host '3) Cloudflare Access Client Secret (CF-Access-Client-Secret)').Trim()
  }

  $syncSecret = (Read-Host '4) 云端同步密钥 (AWS 上的 BRIDGE_SYNC_SECRET)').Trim()
  if ([string]::IsNullOrWhiteSpace($syncSecret)) {
    throw 'BRIDGE_SYNC_SECRET 不能为空，请先在 AWS 服务器上生成并配置该密钥。'
  }

  $cfg = [ordered]@{
    cloudUrl       = $cloudUrl
    cfClientId     = $cfClientId
    cfClientSecret = $cfClientSecret
    syncSecret     = $syncSecret
  }

  $json = $cfg | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($ConfigFile, $json, [System.Text.Encoding]::UTF8)
  Write-Host ''
  Write-Host "[OK] 已保存同步配置到 $ConfigFile" -ForegroundColor Green
  return $cfg
}

function Load-SyncConfig {
  if ($Reconfigure -or -not (Test-Path -LiteralPath $ConfigFile)) {
    return Run-SetupWizard
  }
  $raw = [System.IO.File]::ReadAllText($ConfigFile, [System.Text.Encoding]::UTF8)
  return $raw | ConvertFrom-Json
}

function Invoke-RelayDeckSync($Config) {
  $claudeSettings = Read-Utf8FileIfExists $ClaudeSettingsPath
  $codexConfig = Read-Utf8FileIfExists $CodexConfigPath
  $codexAuth = Read-Utf8FileIfExists $CodexAuthPath

  $payload = [ordered]@{
    sourceHost = $env:COMPUTERNAME
  }

  if (-not [string]::IsNullOrWhiteSpace($claudeSettings)) { $payload.claudeSettings = $claudeSettings }
  if (-not [string]::IsNullOrWhiteSpace($codexConfig)) { $payload.codexConfig = $codexConfig }
  if (-not [string]::IsNullOrWhiteSpace($codexAuth)) { $payload.codexAuth = $codexAuth }

  if ($payload.Count -le 1) {
    Write-Host '[警告] 本机未找到 ~/.claude/settings.json 或 ~/.codex/ 配置文件，跳过本次同步。' -ForegroundColor Yellow
    return $false
  }

  $headers = @{
    'X-RelayDeck-Sync-Secret' = $Config.syncSecret
  }
  if (-not [string]::IsNullOrWhiteSpace($Config.cfClientId)) {
    $headers['CF-Access-Client-Id'] = $Config.cfClientId
    $headers['CF-Access-Client-Secret'] = $Config.cfClientSecret
  }

  $endpoint = "$($Config.cloudUrl.TrimEnd('/'))/api/sync-config"
  $bodyJson = $payload | ConvertTo-Json -Depth 6 -Compress
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)

  $ts = (Get-Date).ToString('HH:mm:ss')
  Write-Host "[$ts] 正在同步 CC Switch 配置到 $($Config.cloudUrl) ..." -ForegroundColor Cyan

  try {
    $resp = Invoke-RestMethod `
      -Uri $endpoint `
      -Method Post `
      -Headers $headers `
      -Body $bodyBytes `
      -ContentType 'application/json; charset=utf-8' `
      -TimeoutSec 20

    if ($resp.ok -ne $true) {
      Write-Host "[$ts] 同步未成功，服务器返回了非预期结果（请检查 Cloudflare Access Service Token 策略是否放行）。" -ForegroundColor Red
      return $false
    }

    Write-Host "[$ts] 同步成功！云端已立即生效（无需重启服务）：" -ForegroundColor Green
    if ($resp.receipt.claude) {
      $c = $resp.receipt.claude
      Write-Host "  - Claude 模型: $($c.model) | 接口: $($c.baseUrl) | 密钥已同步: $($c.hasAuthToken)" -ForegroundColor Magenta
    }
    if ($resp.receipt.codexConfig) {
      $x = $resp.receipt.codexConfig
      $strippedTotal = @($x.strippedKeys).Count + @($x.strippedSections).Count
      Write-Host "  - Codex  模型: $($x.model) | Provider: $($x.provider) | 接口: $($x.baseUrl)" -ForegroundColor Cyan
      if ($strippedTotal -gt 0) {
        Write-Host "    (已自动清理 $strippedTotal 项 Windows 专属路径，Linux 可直接运行)" -ForegroundColor DarkGray
      }
    }
    if ($resp.receipt.codexAuth) {
      Write-Host "  - Codex  密钥文件: 已更新（包含 OPENAI_API_KEY: $($resp.receipt.codexAuth.hasOpenAiKey)）" -ForegroundColor Cyan
    }
    return $true
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) {
      try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
    }
    Write-Host "[$ts] 同步失败 (HTTP $statusCode)：$($_.Exception.Message)" -ForegroundColor Red
    if ($statusCode -eq 401 -or $statusCode -eq 403) {
      Write-Host '  提示：请核对 BRIDGE_SYNC_SECRET 或 Cloudflare Access Service Token 是否正确。' -ForegroundColor Yellow
      Write-Host '  如需重填，请运行：powershell -ExecutionPolicy Bypass -File .\scripts\sync-ccswitch-to-cloud.ps1 -Reconfigure' -ForegroundColor Yellow
    } elseif ($statusCode -eq 503) {
      Write-Host '  提示：AWS 服务器尚未在 ~/relaydeck/.env 或 relaydeck.service 中配置 BRIDGE_SYNC_SECRET。' -ForegroundColor Yellow
    }
    return $false
  }
}

$config = Load-SyncConfig
$ok = Invoke-RelayDeckSync $config

if (-not $Watch) {
  exit $(if ($ok) { 0 } else { 1 })
}

Write-Host ''
Write-Host '==================================================' -ForegroundColor DarkCyan
Write-Host '  自动监听模式已启动（按 Ctrl+C 退出）' -ForegroundColor DarkCyan
Write-Host '  每当你在 CC Switch 切换模型或密钥，2 秒内自动同步到云端！' -ForegroundColor DarkCyan
Write-Host '==================================================' -ForegroundColor DarkCyan

$watchDirs = @(
  (Join-Path $env:USERPROFILE '.claude'),
  (Join-Path $env:USERPROFILE '.codex')
)

$watchers = @()
$script:pendingChangeAt = $null

foreach ($dir in $watchDirs) {
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $fsw = New-Object System.IO.FileSystemWatcher
  $fsw.Path = $dir
  $fsw.Filter = '*.*'
  $fsw.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::Size
  $fsw.EnableRaisingEvents = $true

  $action = {
    $name = $Event.SourceEventArgs.Name
    if ($name -in @('settings.json', 'config.toml', 'auth.json')) {
      $script:pendingChangeAt = Get-Date
    }
  }

  Register-ObjectEvent -InputObject $fsw -EventName Changed -Action $action | Out-Null
  Register-ObjectEvent -InputObject $fsw -EventName Created -Action $action | Out-Null
  Register-ObjectEvent -InputObject $fsw -EventName Renamed -Action $action | Out-Null
  $watchers += $fsw
}

try {
  while ($true) {
    Start-Sleep -Milliseconds 500
    if ($null -ne $script:pendingChangeAt) {
      $elapsed = ((Get-Date) - $script:pendingChangeAt).TotalSeconds
      if ($elapsed -ge 2.0) {
        $script:pendingChangeAt = $null
        Invoke-RelayDeckSync $config | Out-Null
      }
    }
  }
} finally {
  foreach ($w in $watchers) {
    $w.EnableRaisingEvents = $false
    $w.Dispose()
  }
  Get-EventSubscriber | Unregister-Event -ErrorAction SilentlyContinue
}
