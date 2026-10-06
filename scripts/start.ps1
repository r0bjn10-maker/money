. (Join-Path $PSScriptRoot 'runtime.ps1')
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  if (-not (Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) { throw 'Run scripts/setup.ps1 first.' }
  & $taskNodePath node_modules/typescript/bin/tsc -b
  if ($LASTEXITCODE -ne 0) { throw 'Type checking failed.' }
  & $taskNodePath node_modules/vite/bin/vite.js build
  if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
  Write-Host 'Moc: http://localhost:4173  (Ctrl+C to stop)'
  & $taskNodePath node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort
} finally { Pop-Location }
