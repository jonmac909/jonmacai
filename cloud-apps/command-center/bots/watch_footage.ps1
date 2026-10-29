<#
Wake Video Editor when new raw footage lands in the footage folder: one raw_footage event per drop.
A drop is every new or changed video or audio file under -Folder until nothing has changed for
-QuietSeconds and no file is still being written. Waits on file-system events (no polling) and runs
until stopped. Failures go to Developer and Ana as script_failure. See HOOKS.md.
#>
param(
  [string]$Folder = 'D:\AgentTeam\footage',
  [int]$QuietSeconds = 60,
  [string]$Python = 'python',
  [string]$Log = 'D:\AgentTeam\logs\watch_footage.log'
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object Text.UTF8Encoding $false  # JSON piped to Python keeps non-ASCII paths
$hook = Join-Path $PSScriptRoot 'hook.py'
$media = '.mp4', '.mov', '.mkv', '.m4v', '.avi', '.webm', '.mxf', '.wav', '.mp3', '.m4a', '.aac'

function Note($text) {
  New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null
  Add-Content -LiteralPath $Log -Encoding UTF8 -Value ('{0:s} {1}' -f (Get-Date), $text)
}

function Fire($event, $data, $key) {
  $ErrorActionPreference = 'Continue'  # hook.py's stderr must not throw here
  $out =($data | ConvertTo-Json -Compress -Depth 5) | & $Python -I $hook fire $event --data - --key $key 2>&1
  if ($LASTEXITCODE -ne 0) { Note "$event not delivered (exit $LASTEXITCODE): $out" }
  $LASTEXITCODE -eq 0
}

function Busy($path) {
  try { [IO.File]::Open($path, 'Open', 'Read', 'None').Dispose(); $false } catch { $true }
}

try {
  New-Item -ItemType Directory -Force $Folder | Out-Null
  $w = New-Object IO.FileSystemWatcher $Folder
  $w.IncludeSubdirectories = $true
  $w.InternalBufferSize = 65536
  $w.NotifyFilter = [IO.NotifyFilters]'FileName, Size, LastWrite'
  foreach ($name in 'Created', 'Changed', 'Renamed', 'Error') {
    Register-ObjectEvent $w $name -SourceIdentifier "footage.$name" | Out-Null
  }
  $w.EnableRaisingEvents = $true
  Note "watching $Folder"
  $pending = @{}
  while ($true) {
    $e = if ($pending.Count) { Wait-Event -Timeout $QuietSeconds } else { Wait-Event }
    if ($e) {
      Remove-Event -EventIdentifier $e.EventIdentifier
      if ($e.SourceIdentifier -eq 'footage.Error') {
        # Buffer overflow: some names were missed. Say so; the next drop still wakes Video Editor.
        $msg = $e.SourceEventArgs.GetException().Message
        Note "watcher error: $msg"
        Fire 'script_failure' @{ script = 'watch_footage'; error = "missed file events in ${Folder}: $msg" } "fsw-$([DateTime]::UtcNow.Ticks)" | Out-Null
        continue
      }
      $path = $e.SourceEventArgs.FullPath
      if ($media -contains [IO.Path]::GetExtension($path).ToLowerInvariant()) { $pending[$path] = $true }
      continue
    }
    $files = @($pending.Keys | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Sort-Object)
    if (@($files | Where-Object { Busy $_ }).Count) { continue }  # still copying: wait another quiet spell
    $pending.Clear()
    if (-not $files.Count) { continue }
    $list = @($files | ForEach-Object { @{ path = $_; bytes = (Get-Item -LiteralPath $_).Length } })
    $id = [Text.Encoding]::UTF8.GetBytes((($list | ForEach-Object { "$($_.path)|$($_.bytes)" }) -join "`n"))
    $key = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($id)) -replace '-'
    Fire 'raw_footage' @{ folder = $Folder; count = $list.Count; files = $list } $key | Out-Null
  }
} catch {
  $err = "$($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
  Note "stopped: $err"
  Fire 'script_failure' @{ script = 'watch_footage'; error = "stopped: $err" } "stop-$([DateTime]::UtcNow.Ticks)" | Out-Null
  exit 1
}
