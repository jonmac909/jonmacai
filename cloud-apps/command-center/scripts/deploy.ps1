# Production deploy of jonmac-command-center from a clean checkout of current origin/main.
# Sets the version tag to the commit, then checks https://jonmac.ai/dash/version shows that commit; rolls back if not.
# Needs CLOUDFLARE_API_TOKEN in the environment. Run from cloud-apps\command-center.
param([string]$Base = 'https://jonmac.ai')
$ErrorActionPreference = 'Stop'
git fetch origin main -q
if ($LASTEXITCODE) { throw 'git fetch failed: not deploying a possibly stale origin/main' }
$sha = (git rev-parse --short=9 origin/main).Trim()
if ((git rev-parse HEAD).Trim() -ne (git rev-parse origin/main).Trim()) { throw "HEAD is not origin/main ($sha). Deploy only from current main." }
if (git status --porcelain) { throw 'Working tree not clean.' }
npm test; if ($LASTEXITCODE) { throw 'tests failed' }
$check = 'D:\AgentTeam\tools\dash_version_check.py'
if (-not (Get-Command python -ErrorAction SilentlyContinue) -or -not (Test-Path $check)) { throw 'python or dash_version_check.py missing; not deploying' }
. (Join-Path $PSScriptRoot 'deploy-core.ps1')
Invoke-WranglerDeploy -Wrangler @('npx', '--yes', 'wrangler@4.160.0') -Base $Base -Sha $sha -Check { param($b, $s) (Invoke-Native @('python', '-I', $check) @($b, $s)).Code }

