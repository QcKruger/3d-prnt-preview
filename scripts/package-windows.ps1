[CmdletBinding()]
param([string]$OutputDirectory = 'azure-package')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = [System.IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
if (!$target.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package output must be inside the repository.'
}
if (Test-Path -LiteralPath $target) { throw 'Package output already exists; use a clean checkout or a new output directory.' }
$platform = & node -p "process.platform + ':' + process.arch + ':' + process.versions.node.split('.')[0]"
if ($LASTEXITCODE -ne 0 -or $platform -ne 'win32:x64:24') { throw 'Package on Windows x64 with Node.js 24.' }
if (!(Test-Path -LiteralPath (Join-Path $root 'dist/index.html'))) { throw 'Build the app before packaging.' }
$null = New-Item -ItemType Directory -Path $target
foreach ($name in @('dist', 'server', 'package.json', 'package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination $target -Recurse
}
$null = New-Item -ItemType Directory -Path (Join-Path $target 'src/data') -Force
Copy-Item -LiteralPath (Join-Path $root 'src/data/catalogue.ts') -Destination (Join-Path $target 'src/data/catalogue.ts')
Copy-Item -LiteralPath (Join-Path $root 'src/types.ts') -Destination (Join-Path $target 'src/types.ts')
foreach ($name in @('iisnode.cjs', 'web.config')) {
    Copy-Item -LiteralPath (Join-Path $root "deployment/$name") -Destination $target
}
$null = New-Item -ItemType Directory -Path (Join-Path $target 'runtime')
Copy-Item -LiteralPath (Get-Command node -CommandType Application).Source -Destination (Join-Path $target 'runtime/node.exe')
& (Get-Command npm.cmd -CommandType Application).Source ci --omit=dev --ignore-scripts --prefix $target
if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }
Write-Host "Windows deployment package ready at $target"
