. (Join-Path $PSScriptRoot 'runtime.ps1')
if (-not (Test-Path -LiteralPath $taskPnpmPath)) { throw 'Install pnpm 11 before running setup.' }
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  & $taskPnpmPath install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
} finally { Pop-Location }
