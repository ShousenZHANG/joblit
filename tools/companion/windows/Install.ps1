param(
    [switch]$Worker,
    [switch]$AutoStart,
    [string]$ProgressPath,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Joblit\companion-app'),
    # Isolated installer verification: no downloads, real protocol, or user shortcuts.
    [switch]$SmokeTest,
    [string]$NodeExecutable
)
$ErrorActionPreference = 'Stop'
# PowerShell 7 can pass its module path to this Windows PowerShell process.
# Load the Windows security cmdlets from this host, not an inherited module.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Force
$nodeVersion = '24.15.0'
$hermesCommit = '63279301bcbdc185c1b07b98a9312eb0c862f26d'
$hermesInstallerHash = '226c70a90ad47e8a4d34cb11aca4ecbeb649e2f9b67fbd009ea49791de2d56f5'

function Set-Progress([string]$Message, [string]$State = 'working') {
    if ($ProgressPath) {
        @{ message = $Message; state = $State } | ConvertTo-Json -Compress | Set-Content -LiteralPath $ProgressPath -Encoding UTF8
    }
}

function Find-Hermes {
    $hermesRoot = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
    $candidates = @(
        $env:HERMES_EXE,
        (Join-Path $hermesRoot 'bin\hermes.exe'),
        (Join-Path $hermesRoot 'hermes-agent\venv\Scripts\hermes.exe'),
        (Join-Path $env:LOCALAPPDATA 'hermes\bin\hermes.exe'),
        (Join-Path $env:LOCALAPPDATA 'hermes\hermes-agent\venv\Scripts\hermes.exe')
    )
    $onPath = Get-Command hermes.exe -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }
    foreach ($candidate in $candidates) {
        if ($candidate -and [IO.Path]::GetExtension($candidate) -eq '.exe' -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    return $null
}

function Install-Assistant {
    $resolvedRoot = [IO.Path]::GetFullPath($InstallRoot)
    $expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Joblit\companion-app'))
    if (-not $SmokeTest -and $resolvedRoot -ne $expectedRoot) { throw 'Use the per-user Joblit installation directory.' }
    if ($SmokeTest -and (-not $NodeExecutable -or -not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf))) { throw 'Smoke test requires a Node executable.' }
    New-Item -ItemType Directory -Path $resolvedRoot -Force | Out-Null
    $staging = Join-Path $resolvedRoot ('setup-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging | Out-Null
    try {
        $currentNode = Join-Path $resolvedRoot 'node.exe'
        $currentApp = Join-Path $resolvedRoot 'app\app.mjs'
        if (-not $SmokeTest -and (Test-Path -LiteralPath $currentNode) -and (Test-Path -LiteralPath $currentApp)) {
            Set-Progress 'Checking for active Joblit tasks...'
            & $currentNode $currentApp --stop 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Finish or cancel active tasks in Tailor, then run setup again.' }
            Start-Sleep -Milliseconds 500
        }
        Set-Progress 'Preparing the private Joblit runtime...'
        if ($SmokeTest) {
            Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $staging 'node.exe')
        } else {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
            $hashes = @{
                x64 = 'cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62'
                arm64 = 'c9eb7402eda26e2ba7e44b6727fc85a8de56c5095b1f71ebd3062892211aa116'
            }
            $archiveName = "node-v$nodeVersion-win-$architecture"
            $archive = Join-Path $staging 'node.zip'
            Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$archiveName.zip" -OutFile $archive
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashes[$architecture]) { throw 'Node download integrity check failed. Please retry setup.' }
            Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $staging 'node')
            Copy-Item -LiteralPath (Join-Path $staging "node\$archiveName\node.exe") -Destination (Join-Path $staging 'node.exe')
            Copy-Item -LiteralPath (Join-Path $staging "node\$archiveName\LICENSE") -Destination (Join-Path $resolvedRoot 'NODE-LICENSE.txt')
        }
        if (-not $SmokeTest -and -not (Find-Hermes)) {
            Set-Progress 'Installing Hermes and its dependencies. This can take several minutes...'
            $hermesScript = Join-Path $staging 'hermes-install.ps1'
            Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/NousResearch/hermes-agent/$hermesCommit/scripts/install.ps1" -OutFile $hermesScript
            if ((Get-FileHash -LiteralPath $hermesScript -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hermesInstallerHash) { throw 'Hermes download integrity check failed. Please retry setup.' }
            $hermesLog = Join-Path $resolvedRoot 'setup-hermes.log'
            # Windows PowerShell treats native stderr as an error record. Git
            # and installers also use stderr for normal progress; the process
            # exit code, not the stream, determines whether setup succeeded.
            $previousErrorPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $hermesScript -Commit $hermesCommit -SkipSetup -SkipComputerUse -NonInteractive *> $hermesLog
                $hermesExitCode = $LASTEXITCODE
            } finally { $ErrorActionPreference = $previousErrorPreference }
            if ($hermesExitCode -ne 0 -or -not (Find-Hermes)) { throw 'Hermes installation did not finish. Check setup-hermes.log in the Joblit installation folder, then retry.' }
        }
        Set-Progress 'Installing the assistant and browser connection...'
        $appDir = Join-Path $resolvedRoot 'app'
        New-Item -ItemType Directory -Path $appDir -Force | Out-Null
        foreach ($name in @('app.mjs', 'runtime.mjs', 'hermes.mjs', 'storage.mjs')) {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot "app\$name") -Destination (Join-Path $appDir $name) -Force
        }
        Copy-Item -LiteralPath (Join-Path $staging 'node.exe') -Destination $currentNode -Force
        foreach ($name in @('Launch.ps1', 'Manage.ps1', 'Uninstall.ps1')) {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $resolvedRoot $name) -Force
        }
        # These directories contain this user's task material and pairing secrets.
        $dataDir = if ($SmokeTest) { Join-Path $resolvedRoot 'data' } else { Join-Path $env:LOCALAPPDATA 'Joblit\companion' }
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
        foreach ($privateDir in @($resolvedRoot, $dataDir)) {
            $acl = Get-Acl -LiteralPath $privateDir
            $acl.SetAccessRuleProtection($true, $false)
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.SetAccessRule($rule)
            Set-Acl -LiteralPath $privateDir -AclObject $acl
        }
        $registryBase = if ($SmokeTest) { 'HKCU:\Software\Joblit\InstallerTests\' + [IO.Path]::GetFileName($resolvedRoot) } else { 'HKCU:\Software\Classes' }
        $protocolKey = Join-Path $registryBase 'joblit'
        New-Item -Path $protocolKey -Force | Out-Null
        Set-Item -LiteralPath $protocolKey -Value 'URL:Joblit local assistant'
        New-ItemProperty -LiteralPath $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
        $commandKey = Join-Path $protocolKey 'shell\open\command'
        New-Item -Path $commandKey -Force | Out-Null
        $launchPath = Join-Path $resolvedRoot 'Launch.ps1'
        $launchCommand = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launchPath + '"'
        Set-Item -LiteralPath $commandKey -Value ($launchCommand + ' -Uri "%1"')
        if (-not $SmokeTest) {
            if ($AutoStart) {
                New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name JoblitCompanion -Value $launchCommand -PropertyType String -Force | Out-Null
            } else {
                Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name JoblitCompanion -ErrorAction SilentlyContinue
            }
            $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Joblit'
            New-Item -ItemType Directory -Path $menu -Force | Out-Null
            $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $menu 'Joblit local assistant.lnk'))
            $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
            $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "' + (Join-Path $resolvedRoot 'Manage.ps1') + '"'
            $shortcut.WorkingDirectory = $resolvedRoot
            $shortcut.Save()
            $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JoblitCompanion'
            New-Item -Path $uninstallKey -Force | Out-Null
            $properties = @{
                DisplayName = 'Joblit local assistant'; DisplayVersion = '1.0.0'; Publisher = 'Joblit'
                UninstallString = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "' + (Join-Path $resolvedRoot 'Uninstall.ps1') + '"'
            }
            foreach ($property in $properties.GetEnumerator()) { New-ItemProperty -LiteralPath $uninstallKey -Name $property.Key -Value $property.Value -PropertyType String -Force | Out-Null }
        }
        @{ version = 1; nodeVersion = $nodeVersion; installedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resolvedRoot 'installation.json') -Encoding UTF8
        Set-Progress 'Installed. Return to Tailor and click Start & connect.' 'done'
    } finally {
        # Only remove the staging child created by this invocation.
        $resolvedStaging = [IO.Path]::GetFullPath($staging)
        if ($resolvedStaging.StartsWith($resolvedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStaging)) {
            Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
        }
    }
}

if ($Worker -or $SmokeTest) {
    try { Install-Assistant; exit 0 }
    catch { Set-Progress $_.Exception.Message 'error'; Write-Error $_.Exception.Message; exit 1 }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Set up Joblit'
$form.Size = New-Object System.Drawing.Size(555, 365)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$heading = New-Object System.Windows.Forms.Label
$heading.Text = 'Your workspace. Your model account.'
$heading.Font = New-Object System.Drawing.Font('Segoe UI', 16, [Drawing.FontStyle]::Bold)
$heading.SetBounds(24, 22, 490, 45)
$form.Controls.Add($heading)
$description = New-Object System.Windows.Forms.Label
$description.Text = 'Install the local assistant for your Windows account. Setup downloads a private Node runtime and installs Hermes if needed. Your existing Hermes account is preserved. Model login happens after you connect in Tailor.'
$description.SetBounds(26, 76, 475, 85)
$form.Controls.Add($description)
$auto = New-Object System.Windows.Forms.CheckBox
$auto.Text = 'Start when I sign in to Windows (optional)'
$auto.Checked = $null -ne (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name JoblitCompanion -ErrorAction SilentlyContinue)
$auto.SetBounds(26, 165, 475, 28)
$form.Controls.Add($auto)
$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = 'No administrator access required.'
$statusLabel.SetBounds(26, 205, 475, 42)
$form.Controls.Add($statusLabel)
$installButton = New-Object System.Windows.Forms.Button
$installButton.Text = 'Install assistant'
$installButton.SetBounds(26, 265, 220, 42)
$form.Controls.Add($installButton)
$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = 'Close'
$closeButton.SetBounds(272, 265, 220, 42)
$closeButton.Add_Click({ $form.Close() })
$form.Controls.Add($closeButton)
$script:workerProcess = $null
$script:installerFile = $PSCommandPath
$script:progressFile = Join-Path ([IO.Path]::GetTempPath()) ('joblit-setup-' + [Guid]::NewGuid().ToString('N') + '.json')
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
    if (Test-Path -LiteralPath $script:progressFile) {
        try {
            $progress = Get-Content -LiteralPath $script:progressFile -Raw | ConvertFrom-Json
            $statusLabel.Text = $progress.message
            if ($progress.state -in @('done', 'error')) {
                $timer.Stop()
                $closeButton.Enabled = $true
                $installButton.Text = if ($progress.state -eq 'done') { 'Installed' } else { 'Retry installation' }
                $installButton.Enabled = $progress.state -eq 'error'
            }
        } catch { }
    }
    if ($script:workerProcess -and $script:workerProcess.HasExited -and $timer.Enabled) {
        $timer.Stop()
        $statusLabel.Text = 'Setup stopped. Please retry installation.'
        $closeButton.Enabled = $true
        $installButton.Enabled = $true
    }
})
$installButton.Add_Click({
    $installButton.Enabled = $false
    $closeButton.Enabled = $false
    $auto.Enabled = $false
    $statusLabel.Text = 'Preparing setup...'
    Set-Progress 'Preparing setup...'
    if (Test-Path -LiteralPath $script:progressFile) { Remove-Item -LiteralPath $script:progressFile -Force }
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $info.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script:installerFile + '" -Worker -ProgressPath "' + $script:progressFile + '"'
    if ($auto.Checked) { $info.Arguments += ' -AutoStart' }
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $script:workerProcess = [Diagnostics.Process]::Start($info)
    $timer.Start()
})
$form.Add_FormClosing({ param($sender, $eventArgs) if ($script:workerProcess -and -not $script:workerProcess.HasExited) { $eventArgs.Cancel = $true } })
[void]$form.ShowDialog()
$timer.Dispose()
if (Test-Path -LiteralPath $script:progressFile) { Remove-Item -LiteralPath $script:progressFile -Force }
