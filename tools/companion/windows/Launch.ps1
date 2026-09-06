param([string]$Uri = '')
$ErrorActionPreference = 'Stop'
# Protocol input is data, never PowerShell or a shell command.
if ($Uri -and ($Uri.Length -gt 2048 -or $Uri -match '["\r\n]' -or $Uri -notmatch '^joblit://connect\?')) {
    throw 'Invalid Joblit activation link.'
}
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = Join-Path $PSScriptRoot 'node.exe'
$startInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'app\app.mjs') + '"'
if ($Uri) { $startInfo.Arguments += ' --activate "' + $Uri + '"' }
$startInfo.WorkingDirectory = $PSScriptRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
[void][System.Diagnostics.Process]::Start($startInfo)
