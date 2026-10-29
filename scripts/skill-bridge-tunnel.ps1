<#
.SYNOPSIS
  Independent private Secure MCP Tunnel for Skill Bridge (Windows).
.DESCRIPTION
  Uses CoS's bundled official tunnel-client binary, but NEVER modifies or
  stops any existing CoS tunnel. Store the runtime key DPAPI-encrypted under
  the current Windows user's LocalAppData, never in this repository or argv.
.EXAMPLE
  .\scripts\skill-bridge-tunnel.ps1 setup -TunnelId tunnel_your_new_id
  .\scripts\skill-bridge-tunnel.ps1 doctor
  .\scripts\skill-bridge-tunnel.ps1 start
  .\scripts\skill-bridge-tunnel.ps1 status
#>
param(
  [Parameter(Position=0)]
  [ValidateSet('setup','set-key','start','restart-mcp','stop','status','doctor','register-startup','unregister-startup')]
  [string]$Action = 'status',
  [string]$TunnelId
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$client = Join-Path $env:LOCALAPPDATA 'Programs\Chat On Steroids\resources\tunnel\tunnel-client.exe'
$runtimeHome = Join-Path $env:LOCALAPPDATA 'SkillBridgeTunnel'
$profilesDir = Join-Path $runtimeHome 'profiles'
$profileName = 'skill-bridge'
$profileFile = Join-Path $profilesDir 'skill-bridge.yaml'
$credentialFile = Join-Path $runtimeHome 'runtime-key.dpapi'
$clientPidFile = Join-Path $runtimeHome 'client.pid'
$mcpPidFile = Join-Path $runtimeHome 'mcp.pid'
$healthUrlFile = Join-Path $runtimeHome 'health.url'
$mcpUrl = 'http://127.0.0.1:8787/mcp'
$startupName = 'SkillBridgeTunnel'

function Require-Client {
  if (-not (Test-Path -LiteralPath $client -PathType Leaf)) {
    throw 'CoS-bundled tunnel-client.exe is missing. Reinstall CoS or update this script with the correct path.'
  }
}
function Ensure-Dirs {
  New-Item -ItemType Directory -Path $runtimeHome,$profilesDir -Force | Out-Null
}
function Get-OwnedPid([string]$pidFile, [string]$requiredSubstring) {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  $raw = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if ($raw -notmatch '^\d+$') { return $null }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$raw" -ErrorAction SilentlyContinue
  if (-not $proc) { return $null }
  if ($proc.CommandLine -notlike ('*' + $requiredSubstring + '*')) { return $null }
  if ($proc.ExecutablePath -notmatch '(?i)(node.exe|tunnel-client.exe)$') { return $null }
  return [int]$raw
}
function Local-McpHealthy {
  try {
    $result = Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 3
    return ($result.ok -eq $true -and $result.service -eq 'skill-bridge')
  } catch { return $false }
}
function Tunnel-Ready {
  if (-not (Test-Path -LiteralPath $healthUrlFile)) { return $false }
  try {
    $base = (Get-Content -LiteralPath $healthUrlFile -Raw).Trim().TrimEnd('/')
    if ($base -notmatch '^http://127\.0\.0\.1:\d+$') { return $false }
    $response = Invoke-WebRequest ($base + '/readyz') -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200)
  } catch { return $false }
}
function With-RuntimeKey([scriptblock]$body) {
  if (-not (Test-Path -LiteralPath $credentialFile)) {
    throw 'No runtime key stored. Run setup and provide the dedicated Tunnels Read + Use key.'
  }
  $original = [Environment]::GetEnvironmentVariable('CONTROL_PLANE_API_KEY', 'Process')
  $secure = ConvertTo-SecureString (Get-Content -LiteralPath $credentialFile -Raw).Trim()
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY', $secret, 'Process')
    $secret = $null
    & $body
  } finally {
    [Environment]::SetEnvironmentVariable('CONTROL_PLANE_API_KEY', $original, 'Process')
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}
function Save-RuntimeKey {
  Ensure-Dirs
  Write-Output 'Enter the dedicated runtime API key (Tunnels Read + Use). Input is hidden.'
  $key = Read-Host -Prompt 'Runtime API key' -AsSecureString
  if (-not $key -or $key.Length -lt 20) { throw 'No runtime key saved: empty or too short' }
  Set-Content -LiteralPath $credentialFile -Value (ConvertFrom-SecureString -SecureString $key) -Encoding UTF8
  $key = $null
  Write-Output 'Runtime key saved with Windows user-scoped DPAPI encryption.'
}
function Start-McpIfNeeded {
  if (Local-McpHealthy) {
    Write-Output 'Skill Bridge MCP: already healthy (127.0.0.1:8787)'
    return
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw 'Node.js is not installed/on PATH.' }
  $logOut = Join-Path $runtimeHome 'skill-bridge.out.log'
  $logErr = Join-Path $runtimeHome 'skill-bridge.err.log'
  # Skills Manager owns the library when installed. Preserve an explicit override.
  $originalLibrary = [Environment]::GetEnvironmentVariable('SKILL_BRIDGE_SKILLS_DIR', 'Process')
  $managerLibrary = Join-Path $env:USERPROFILE '.skills-manager\skills'
  try {
    if (-not $originalLibrary -and (Test-Path -LiteralPath $managerLibrary -PathType Container)) {
      [Environment]::SetEnvironmentVariable('SKILL_BRIDGE_SKILLS_DIR', $managerLibrary, 'Process')
    }
    $proc = Start-Process -FilePath $node.Source -ArgumentList 'server.mjs' -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr
  } finally {
    [Environment]::SetEnvironmentVariable('SKILL_BRIDGE_SKILLS_DIR', $originalLibrary, 'Process')
  }
  Set-Content -LiteralPath $mcpPidFile -Value $proc.Id
  Start-Sleep -Seconds 2
  if (-not (Local-McpHealthy)) { throw "Skill Bridge MCP did not become healthy. Inspect $logErr" }
  Write-Output "Skill Bridge MCP: running PID $($proc.Id)"
}
function Stop-OwnPid([string]$pidFile,[string]$requiredSubstring) {
  $id = Get-OwnedPid $pidFile $requiredSubstring
  if ($id) {
    Stop-Process -Id $id -Force
    Write-Output "Stopped managed process PID $id"
  }
  Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
}

switch ($Action) {
  'setup' {
    Require-Client
    if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]{8,160}$') {
      throw 'Specify a NEW Skill Bridge tunnel_id from OpenAI Platform. Do NOT reuse a CoS tunnel_id.'
    }
    Ensure-Dirs
    if (Test-Path -LiteralPath $profileFile) {
      throw "A Skill Bridge profile already exists ($profileFile). Refusing to overwrite; inspect it first."
    }
    & $client init --sample sample_mcp_remote_no_auth --profile $profileName --profile-dir $profilesDir --tunnel-id $TunnelId --mcp-server-url $mcpUrl --health-listen-addr '127.0.0.1:0'
    if ($LASTEXITCODE -ne 0) { throw 'tunnel-client init failed' }
    Save-RuntimeKey
    Write-Output "Created an isolated profile at $profileFile"
    Write-Output 'Next: run doctor, then start. No CoS configuration or tunnel was modified.'
  }
  'set-key' {
    if (-not (Test-Path -LiteralPath $profileFile)) { throw 'Run setup with the new tunnel ID first.' }
    Save-RuntimeKey
  }
  'doctor' {
    Require-Client
    if (-not (Test-Path -LiteralPath $profileFile)) { throw 'Run setup first.' }
    With-RuntimeKey {
      & $client doctor --profile $profileName --profile-dir $profilesDir --explain
      if ($LASTEXITCODE -ne 0) { throw 'tunnel-client doctor failed' }
    }
  }
  'start' {
    Require-Client
    Ensure-Dirs
    if (-not (Test-Path -LiteralPath $profileFile)) { throw 'Run setup with the dedicated tunnel_id first.' }
    Start-McpIfNeeded
    $existing = Get-OwnedPid $clientPidFile '--profile skill-bridge'
    if ($existing) {
      Write-Output "Skill Bridge tunnel client already running (PID $existing)"
      break
    }
    Remove-Item -LiteralPath $healthUrlFile -ErrorAction SilentlyContinue
    With-RuntimeKey {
      $logOut = Join-Path $runtimeHome 'tunnel.out.log'
      $logErr = Join-Path $runtimeHome 'tunnel.err.log'
      $arguments = @(
        'run','--profile',$profileName,'--profile-dir',('"' + $profilesDir + '"'),
        '--health.listen-addr','127.0.0.1:0','--health.url-file',('"' + $healthUrlFile + '"'),
        '--log.level','warn','--log.format','json'
      )
      $proc = Start-Process -FilePath $client -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr
      Set-Content -LiteralPath $clientPidFile -Value $proc.Id
      Write-Output "Skill Bridge tunnel client started (PID $($proc.Id))."
    }
    Start-Sleep -Seconds 3
    Write-Output ('Tunnel ready: ' + (Tunnel-Ready))
    Write-Output 'For full verification, use status and a real ChatGPT tool call.'
  }
  'restart-mcp' {
    Ensure-Dirs
    Stop-OwnPid $mcpPidFile 'server.mjs'
    Start-McpIfNeeded
    Write-Output 'Only the dedicated Skill Bridge MCP process was restarted; tunnel-client and CoS were preserved.'
  }
  'stop' {
    Stop-OwnPid $clientPidFile '--profile skill-bridge'
    # Leave the MCP server running for local testing; do not stop any CoS process.
    Write-Output 'Skill Bridge tunnel stopped. CoS tunnels and local Skill Bridge MCP were not stopped.'
  }
  'status' {
    $clientId = Get-OwnedPid $clientPidFile '--profile skill-bridge'
    Write-Output ('MCP healthy: ' + (Local-McpHealthy))
    Write-Output ('Dedicated tunnel profile exists: ' + (Test-Path -LiteralPath $profileFile))
    Write-Output ('Encrypted runtime key exists: ' + (Test-Path -LiteralPath $credentialFile))
    Write-Output ('Dedicated tunnel process: ' + $(if($clientId){"running PID $clientId"}else{'not running'}))
    Write-Output ('Tunnel ready: ' + (Tunnel-Ready))
  }
  'register-startup' {
    if (-not (Test-Path -LiteralPath $profileFile) -or -not (Test-Path -LiteralPath $credentialFile)) {
      throw 'Run setup first and verify doctor before enabling automatic startup.'
    }
    $file = $MyInvocation.MyCommand.Path
    $powershell = Join-Path $PSHOME 'powershell.exe'
    $command = '"' + $powershell + '" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $file + '" start'
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    Set-ItemProperty -Path $key -Name $startupName -Value $command
    Write-Output 'Startup registered for the current Windows user. No administrator privileges required.'
  }
  'unregister-startup' {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    Remove-ItemProperty -Path $key -Name $startupName -ErrorAction SilentlyContinue
    Write-Output 'Skill Bridge auto-start removed; no CoS startup entries changed.'
  }
}
