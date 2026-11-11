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
$dep = npx --yes wrangler@4.160.0 deployments list --json | ConvertFrom-Json | Select-Object -Last 1
$full = @($dep.versions | Where-Object { $_.percentage -eq 100 })
if ($full.Count -ne 1) { throw 'no single version has 100% traffic; not deploying' }
$prev = $full[0].version_id
if (-not $prev) { throw 'no previous version to roll back to' }
npx --yes wrangler@4.160.0 deploy --tag $sha --message "main $sha"; if ($LASTEXITCODE) { throw 'deploy failed' }
python -I D:\AgentTeam\tools\dash_version_check.py $Base $sha
if ($LASTEXITCODE) {
  npx --yes wrangler@4.160.0 rollback $prev --message "auto rollback: /dash/version did not show $sha" -y
  if ($LASTEXITCODE) { throw "ROLLBACK FAILED, $sha may be live (wanted $prev)" }
  throw "live check failed, rolled back to $prev"
}
