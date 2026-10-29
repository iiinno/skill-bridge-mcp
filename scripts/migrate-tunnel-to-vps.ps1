<#
.SYNOPSIS
  Secure interactive cutover of a dedicated Skill Bridge Tunnel to a Linux VPS.
.DESCRIPTION
  No API key in chat, command arguments, logs, or this repository. The key is
  entered on the VPS through SSH with input echo disabled. Does not change CoS.
.EXAMPLE
  .\scripts\migrate-tunnel-to-vps.ps1 -SshTarget user@tailnet-vps-ip
#>
param([Parameter(Mandatory=$true)][string]$SshTarget)
$ErrorActionPreference = 'Stop'
if ($SshTarget -notmatch '^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$') {
  throw 'SSH target must have the form user@hostname (no shell arguments).'
}
$windows = Join-Path $PSScriptRoot 'skill-bridge-tunnel.ps1'
$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source

function Remote-Bash([string]$code) {
  $code | & $ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $SshTarget 'bash -s'
  if ($LASTEXITCODE -ne 0) { throw "Remote command failed (code $LASTEXITCODE)" }
}

Write-Output '=== Secure Skill Bridge VPS cutover ==='
Write-Output 'Paste your dedicated Tunnels Read+Use API key in the hidden SSH prompt.'
Write-Output 'Do not paste it in ChatGPT or a command line argument.'
& $ssh -tt -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $SshTarget 'bash ~/services/skill-bridge-mcp/deploy/linux/enter-runtime-key.sh'
if ($LASTEXITCODE -ne 0) { throw 'Private key entry did not complete; Windows tunnel is unchanged.' }

Write-Output 'Validating VPS runtime key and profile before switching...'
Remote-Bash @'
set -eu
base="$HOME/services/skill-bridge-mcp/bin/tunnel-client"
profile="$HOME/.config/skill-bridge-mcp/profiles"
test -s "$HOME/.config/skill-bridge-mcp/runtime-key"
test -f "$profile/skill-bridge.yaml"
"$base" doctor --profile skill-bridge --profile-dir "$profile" --explain
'@

Write-Output 'VPS doctor passed. Stopping ONLY the Windows Skill Bridge tunnel...'
$windowsStopped = $false
try {
  & $windows stop
  $windowsStopped = $true
  Write-Output 'Starting VPS tunnel and inspecting auth...'
  Remote-Bash @'
set -eu
systemctl --user enable --now skill-bridge-tunnel.service
sleep 6
systemctl --user is-active --quiet skill-bridge-tunnel.service
test -s "$HOME/.local/state/skill-bridge-mcp/health.url"
base="$(cat "$HOME/.local/state/skill-bridge-mcp/health.url")"
curl -fsS --max-time 5 "$base/readyz" >/dev/null
if journalctl --user -u skill-bridge-tunnel.service --since "-30 seconds" --no-pager -o cat 2>/dev/null | grep -Eq 'invalid_api_key|401 Unauthorized'; then
  echo 'VPS authentication rejected (401); refusing cutover' >&2
  exit 21
fi
echo 'VPS tunnel client running; no recent 401 error detected.'
'@
  & $windows unregister-startup
  Write-Output 'VPS cutover provisionally successful. Verify list_skills in ChatGPT.'
  Write-Output 'CoS tunnels were not modified.'
} catch {
  Write-Warning 'VPS cutover failed. Stopping the VPS client first, then restoring Windows.'
  try {
    Remote-Bash @'
systemctl --user disable --now skill-bridge-tunnel.service
'@
  } catch { Write-Warning 'Could not confirm VPS stop; check it manually BEFORE starting the same ID elsewhere.'; throw }
  if ($windowsStopped) {
    & $windows start
    & $windows register-startup
  }
  throw
}
