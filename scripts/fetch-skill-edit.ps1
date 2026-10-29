param(
  [Parameter(Mandatory=$true)]
  [string]$ProposalId,
  [Parameter(Mandatory=$true)]
  [string]$SshTarget
)
$ErrorActionPreference = 'Stop'
if ($ProposalId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
  throw 'Invalid proposal UUID'
}
if ($SshTarget -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$') {
  throw 'Invalid SSH destination'
}
$directory = Join-Path $env:USERPROFILE '.skills-manager\skill-bridge-edit-proposals'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$destination = Join-Path $directory ($ProposalId + '.json')
if (Test-Path -LiteralPath $destination) { throw 'Proposal already downloaded; refusing to overwrite' }
$remote = $SshTarget + ':~/.local/state/skill-bridge-mcp/proposals/' + $ProposalId + '.json'
& scp.exe -o BatchMode=yes -o StrictHostKeyChecking=yes -- $remote $destination
if ($LASTEXITCODE -ne 0) { throw 'Could not download proposal from private VPS over SSH' }
Write-Output ('Saved proposal to ' + $destination)
Write-Output ('Review locally before applying: node scripts\apply-skill-edit.mjs "' + $destination + '"')
