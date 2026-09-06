$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$installRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Joblit\companion-app'))
if ($installRoot -ne $expectedRoot -or -not (Test-Path -LiteralPath (Join-Path $installRoot 'installation.json'))) { throw 'This is not a registered Joblit installation.' }
$answer = [Windows.Forms.MessageBox]::Show('Remove the Joblit assistant and its local task data? Your Hermes installation and model account will remain. Your documents in Joblit will remain.', 'Uninstall Joblit assistant', 'YesNo', 'Question')
if ($answer -ne 'Yes') { exit 0 }
& (Join-Path $installRoot 'node.exe') (Join-Path $installRoot 'app\app.mjs') --stop 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    [void][Windows.Forms.MessageBox]::Show('Finish or cancel active tasks in Tailor, then uninstall again.', 'Joblit')
    exit 1
}
Start-Sleep -Milliseconds 500
$commandKey = 'HKCU:\Software\Classes\joblit\shell\open\command'
$registered = if (Test-Path -LiteralPath $commandKey) { (Get-Item -LiteralPath $commandKey).GetValue('') } else { '' }
if ($registered.Contains((Join-Path $installRoot 'Launch.ps1'))) { Remove-Item -LiteralPath 'HKCU:\Software\Classes\joblit' -Recurse -Force }
Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name JoblitCompanion -ErrorAction SilentlyContinue
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JoblitCompanion'
if (Test-Path -LiteralPath $uninstallKey) { Remove-Item -LiteralPath $uninstallKey -Recurse -Force }
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Joblit\Joblit local assistant.lnk'
if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
$dataDir = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Joblit\companion'))
$joblitRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Joblit')) + [IO.Path]::DirectorySeparatorChar
# Only these two exact per-user product directories are removed.
foreach ($target in @($installRoot, $dataDir)) {
    if (-not $target.StartsWith($joblitRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe uninstall path.' }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
[void][Windows.Forms.MessageBox]::Show('Joblit local assistant has been removed.', 'Joblit')
