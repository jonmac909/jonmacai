<#
Wake Video Editor when new raw footage lands in the footage folder: one raw_footage event per drop.
A drop is every new video or audio file under -Folder (copied, moved or saved there) until nothing has
changed for -QuietSeconds and no file is still being written. Files already there at start, or already
announced (same name, size and time, e.g. moved into a done\ subfolder), are not announced again.
short-form\ is skipped: it holds the Short-form bot's generated clips and QC audio, not raw footage.
Waits on file-system events (no polling) and runs until stopped. See HOOKS.md.
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
$maxTries = 10  # undelivered drop: retried every quiet spell, then given up (it's in the log)

function Note($text) {
  New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null
  Add-Content -LiteralPath $Log -Encoding UTF8 -Value ('{0:s} {1}' -f (Get-Date), $text)
}

function Fire($event, $data, $key) {
  $ErrorActionPreference = 'Continue'  # hook.py's stderr must not throw here
  $out = ($data | ConvertTo-Json -Compress -Depth 5) | & $Python -I $hook fire $event --data - --key $key 2>&1
  if ($LASTEXITCODE -ne 0) { Note "$event not delivered (exit $LASTEXITCODE): $out" }
  $LASTEXITCODE -eq 0
}

function Id($path) {  # survives a move between subfolders
  $f = Get-Item -LiteralPath $path -ErrorAction Ignore  # being deleted: no id, and Busy holds it back
  '{0}|{1}|{2}' -f $f.Name, $f.Length, $f.LastWriteTimeUtc.Ticks
}

function Media($path) {  # media files at $path, or under it if it is a folder
  # .NET checks, not Test-Path: a file or folder another program is deleting throws "Access is denied" there
  $(if ([IO.Directory]::Exists($path)) {
    Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction Ignore | Where-Object { $media -contains $_.Extension.ToLowerInvariant() } |
      ForEach-Object { $_.FullName }
  } elseif ($media -contains [IO.Path]::GetExtension($path).ToLowerInvariant()) { $path }) |
    Where-Object { -not $_.StartsWith($work, [StringComparison]::OrdinalIgnoreCase) }
}

function Busy($path) {  # still being written: a writer holds it open
  try { [IO.File]::Open($path, 'Open', 'Read', 'Read').Dispose(); $false } catch { $true }
}

function NextQuiet { [DateTime]::UtcNow.AddSeconds($QuietSeconds) }  # UTC: a clock change must not stretch the wait

try {
  $Folder = (New-Item -ItemType Directory -Force $Folder).FullName  # absolute, like the event paths the skip compares
  $work = Join-Path $Folder 'short-form\'
  $seen = @{}
  Media $Folder | ForEach-Object { $seen[(Id $_)] = $true }
  $w = New-Object IO.FileSystemWatcher $Folder
  $w.IncludeSubdirectories = $true
  $w.InternalBufferSize = 65536
  $w.NotifyFilter = [IO.NotifyFilters]'FileName, DirectoryName, Size, LastWrite'
  foreach ($name in 'Created', 'Changed', 'Renamed', 'Error') {
    Register-ObjectEvent $w $name -SourceIdentifier "footage.$name" | Out-Null
  }
  $w.EnableRaisingEvents = $true
  Note "watching $Folder"
  $pending = @{}
  $tries = 0
  $quietUntil = [DateTime]::UtcNow
  while ($true) {
    $left = [math]::Ceiling(($quietUntil - [DateTime]::UtcNow).TotalSeconds)
    $e = if (-not $pending.Count) { Wait-Event } elseif ($left -gt 0) { Wait-Event -Timeout $left }
    if ($e) {
      Remove-Event -EventIdentifier $e.EventIdentifier
      if ($e.SourceIdentifier -eq 'footage.Error') {
        if (-not (Test-Path -LiteralPath $Folder) -or -not $w.EnableRaisingEvents) {
          throw "lost $Folder ($($e.SourceEventArgs.GetException().Message))"
        }
        Note 'missed file events; rescanning'  # buffer overflow: trust the folder, not the events
        Media $Folder | ForEach-Object { $pending[$_] = $true }
        $quietUntil = NextQuiet
        continue
      }
      $path = $e.SourceEventArgs.FullPath
      Media $path | ForEach-Object { $pending[$_] = $true }
      # Any change outside short-form restarts the wait, even a .crdownload; busy short-form writes must not hold a drop back
      if (-not "$path\".StartsWith($work, [StringComparison]::OrdinalIgnoreCase)) { $quietUntil = NextQuiet }
      continue
    }
    $files = @($pending.Keys | Where-Object { [IO.File]::Exists($_) } | Where-Object { -not $seen[(Id $_)] } | Sort-Object)
    if (@($files | Where-Object { Busy $_ }).Count) { $quietUntil = NextQuiet; continue }  # still copying: wait another quiet spell
    if (-not $files.Count) { $pending.Clear(); continue }
    $list = @($files | ForEach-Object { @{ path = $_; bytes = (Get-Item -LiteralPath $_ -ErrorAction Ignore).Length } })
    $ids = @($files | ForEach-Object { Id $_ })
    $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($ids -join "`n"))
    $key = [BitConverter]::ToString($hash) -replace '-'
    if (Fire 'raw_footage' @{ folder = $Folder; count = $list.Count; files = $list } $key) {
      $ids | ForEach-Object { $seen[$_] = $true }
    } else {
      $tries++
      if ($tries -eq 1) {
        Fire 'script_failure' @{ script = 'watch_footage'; error = "raw_footage for $($list.Count) files not delivered; see $Log" } "undelivered-$key" | Out-Null
      }
      if ($tries -lt $maxTries) { $quietUntil = NextQuiet; continue }
    }
    $pending.Clear()
    $tries = 0
  }
} catch {
  $err = "$($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
  Note "stopped: $err"
  Fire 'script_failure' @{ script = 'watch_footage'; error = "stopped: $err" } "stop-$([DateTime]::UtcNow.Ticks)" | Out-Null
  exit 1
}
