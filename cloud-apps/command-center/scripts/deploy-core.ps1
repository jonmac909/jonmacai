# Deploy core: read current version, deploy, live check, roll back on failure.
# Wrangler warnings on stderr are NOT errors (2026-11-11): only a nonzero exit code or a missing version id fails.
# $Wrangler = executable plus fixed leading args (tests pass a fake). $Check = scriptblock taking ($Base,$Sha), returns exit code.
function Invoke-Native {
  param([string[]]$Cmd, [string[]]$Rest, [switch]$Capture)
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $errFile = [IO.Path]::GetTempFileName()
  try {
    $global:LASTEXITCODE = $null
    $fixed = if ($Cmd.Count -gt 1) { $Cmd[1..($Cmd.Count - 1)] } else { @() }
    if ($Capture) { $out = (& $Cmd[0] @fixed @Rest 2>$errFile | Out-String) }
    else { & $Cmd[0] @fixed @Rest 2>$errFile | Out-Host; $out = '' }
    $code = $LASTEXITCODE; if ($null -eq $code) { $code = 127 }
    $warn = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue)
    if ($warn) { Write-Host "stderr (exit $code): $($warn.Trim())" }
    return [pscustomobject]@{ Code = $code; Out = $out }
  } finally { $ErrorActionPreference = $old; Remove-Item $errFile -ErrorAction SilentlyContinue }
}
function Invoke-WranglerDeploy {
  param([string[]]$Wrangler, [scriptblock]$Check, [string]$Base, [string]$Sha)
  $r = Invoke-Native $Wrangler @('deployments', 'list', '--json') -Capture
  if ($r.Code) { throw 'could not read deployments' }
  $json = $r.Out; $i = $json.IndexOf('['); if ($i -gt 0) { $json = $json.Substring($i) }
  $deps = @($json | ConvertFrom-Json | ForEach-Object { $_ })
  if ($deps.Count -eq 0) { throw 'could not read deployments' }
  $dep = $deps | Sort-Object { [datetime]$_.created_on } | Select-Object -Last 1
  $full = @($dep.versions | Where-Object { $_.percentage -eq 100 })
  if ($full.Count -ne 1) { throw 'no single version has 100% traffic; not deploying' }
  $prev = $full[0].version_id
  if (-not $prev) { throw 'no previous version to roll back to' }
  $d = Invoke-Native $Wrangler @('deploy', '--tag', $Sha, '--message', "main $Sha")
  if ($d.Code) { throw "deploy failed (exit $($d.Code))" }
  $bad = $null
  try { $c = @(& $Check $Base $Sha)[-1]; if ($null -eq $c -or [int]$c -ne 0) { $bad = "exit $c" } } catch { $bad = "$_" }
  if ($bad) {
    $rb = Invoke-Native $Wrangler @('rollback', $prev, '--message', "auto rollback: /dash/version did not show $Sha", '-y')
    if ($rb.Code) { throw "ROLLBACK FAILED, $Sha may be live (wanted $prev)" }
    throw "live check failed ($bad), rolled back to $prev"
  }
  Write-Host "live check passed: $Sha is live"
}

