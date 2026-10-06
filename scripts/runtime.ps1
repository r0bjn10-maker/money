$ErrorActionPreference = 'Stop'
$taskRuntimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$taskNodePath = if ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $taskRuntimeRoot 'node\bin\node.exe' }
$taskPnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$taskPnpmPath = if ($taskPnpmCommand) { $taskPnpmCommand.Source } else { Join-Path $taskRuntimeRoot 'bin\fallback\pnpm.cmd' }
if (-not (Test-Path -LiteralPath $taskNodePath)) { throw 'Install Node.js 22+ before running this script.' }
