$ErrorActionPreference = "Stop"
$sourceDir = $PSScriptRoot
$publicDir = Join-Path $sourceDir "public"
$dataset = Join-Path (Split-Path $sourceDir -Parent) "youtube-gen\rows_data.js"

New-Item -ItemType Directory -Path $publicDir -Force | Out-Null

foreach ($name in @("index.html", "styles.css", "templates.js", "app.js")) {
  Copy-Item -LiteralPath (Join-Path $sourceDir $name) -Destination (Join-Path $publicDir $name) -Force
}

Copy-Item -LiteralPath $dataset -Destination (Join-Path $publicDir "rows_data.js") -Force

$publicIndex = Join-Path $publicDir "index.html"
$indexContent = Get-Content -LiteralPath $publicIndex -Raw
$indexContent = $indexContent.Replace('../youtube-gen/rows_data.js', './rows_data.js')
Set-Content -LiteralPath $publicIndex -Value $indexContent -NoNewline

$publicApp = Join-Path $publicDir "app.js"
$appContent = Get-Content -LiteralPath $publicApp -Raw
$appContent = $appContent.Replace('../youtube-gen/rows_data.js?refresh=', './rows_data.js?refresh=')
Set-Content -LiteralPath $publicApp -Value $appContent -NoNewline

Write-Output "Prepared V2 deployment assets in $publicDir"
