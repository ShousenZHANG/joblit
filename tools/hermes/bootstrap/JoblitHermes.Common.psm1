Set-StrictMode -Version Latest

$script:MinimumHermesVersion = '0.18.2'
$script:ManagedProfileVersion = '0.2.0'
$script:ManagedEnvironmentKeys = @(
    'API_SERVER_ENABLED',
    'API_SERVER_HOST',
    'API_SERVER_PORT',
    'API_SERVER_KEY',
    'API_SERVER_MODEL_NAME',
    'API_SERVER_CORS_ORIGINS'
)
$script:VerifierScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\verify-package.mjs'))

function New-JoblitFailure {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute(
        'PSUseShouldProcessForStateChangingFunctions',
        '',
        Justification = 'Creates and returns an exception object; it does not mutate system state.'
    )]
    param([Parameter(Mandatory)][string] $Code, [Parameter(Mandatory)][string] $Message)
    return [InvalidOperationException]::new("${Code}: ${Message}")
}

function Protect-JoblitSecretText {
    [CmdletBinding()]
    param(
        [AllowNull()][string] $Text,
        [string[]] $Secrets = @()
    )
    if ($null -eq $Text) { return '' }
    $safe = $Text
    foreach ($secret in $Secrets) {
        if (-not [string]::IsNullOrEmpty($secret)) {
            $safe = $safe.Replace($secret, '[REDACTED]')
        }
    }
    $safe = $safe -replace '(?im)(API_SERVER_KEY\s*=\s*)[^\s\r\n]+', '$1[REDACTED]'
    $safe = $safe -replace '(?im)(Authorization\s*:\s*Bearer\s+)[^\s\r\n]+', '$1[REDACTED]'
    $safe = $safe -replace '(?im)(Bearer\s+)[A-Za-z0-9._~+\-/=]{16,}', '$1[REDACTED]'
    $safe = $safe -replace '(?im)((?:access|refresh|id|oauth)_token|client_secret)(["'']?\s*[:=]\s*["'']?)[^"''\s,}\r\n]+', '$1$2[REDACTED]'
    return $safe
}

function Write-JoblitStatus {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $State,
        [Parameter(Mandatory)][ValidateSet('Started', 'Passed', 'Skipped', 'Failed')][string] $Status,
        [Parameter(Mandatory)][string] $Message,
        [string[]] $Secrets = @()
    )
    $record = [ordered]@{
        state = $State
        status = $Status
        message = Protect-JoblitSecretText -Text $Message -Secrets $Secrets
    }
    [Console]::Out.WriteLine(($record | ConvertTo-Json -Compress))
}

function ConvertTo-JoblitVersion {
    param([Parameter(Mandatory)][string] $Value)
    if ($Value -notmatch '(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)') {
        throw (New-JoblitFailure -Code 'INVALID_HERMES_VERSION' -Message $Value)
    }
    return [version]::new(
        [int] $Matches.major,
        [int] $Matches.minor,
        [int] $Matches.patch
    )
}

function Test-JoblitVersionAtLeast {
    param(
        [Parameter(Mandatory)][string] $Actual,
        [Parameter(Mandatory)][string] $Minimum
    )
    return (ConvertTo-JoblitVersion $Actual) -ge (ConvertTo-JoblitVersion $Minimum)
}

function Resolve-JoblitExecutable {
    param([Parameter(Mandatory)][string] $Name)
    $command = Get-Command $Name -CommandType Application, ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $command) {
        throw (New-JoblitFailure -Code "MISSING_$($Name.ToUpperInvariant())" -Message "$Name is not available on PATH")
    }
    if ($command.PSObject.Properties.Name -contains 'Source' -and $command.Source) { return $command.Source }
    return $command.Path
}

function Invoke-JoblitProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [Parameter(Mandatory)][string[]] $Arguments,
        [string[]] $Secrets = @(),
        [switch] $AllowFailure
    )
    $raw = & $FilePath @Arguments 2>&1
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int] $LASTEXITCODE }
    $output = (($raw | ForEach-Object { [string] $_ }) -join [Environment]::NewLine)
    $safeOutput = Protect-JoblitSecretText -Text $output -Secrets $Secrets
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw (New-JoblitFailure -Code 'COMMAND_FAILED' -Message "$FilePath exited $exitCode. $safeOutput")
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $safeOutput }
}

function Invoke-JoblitNonInteractiveProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [Parameter(Mandatory)][string[]] $Arguments,
        [string[]] $Secrets = @(),
        [switch] $AllowFailure
    )
    $hadValue = Test-Path Env:HERMES_NONINTERACTIVE
    $previousValue = $env:HERMES_NONINTERACTIVE
    try {
        $env:HERMES_NONINTERACTIVE = '1'
        return Invoke-JoblitProcess `
            -FilePath $FilePath `
            -Arguments $Arguments `
            -Secrets $Secrets `
            -AllowFailure:$AllowFailure
    } finally {
        if ($hadValue) {
            $env:HERMES_NONINTERACTIVE = $previousValue
        } else {
            Remove-Item Env:HERMES_NONINTERACTIVE -ErrorAction SilentlyContinue
        }
    }
}

function Get-JoblitHermesVersion {
    param([Parameter(Mandatory)][string] $HermesPath)
    $result = Invoke-JoblitProcess -FilePath $HermesPath -Arguments @('--version')
    return (ConvertTo-JoblitVersion $result.Output).ToString(3)
}

function New-JoblitApiKey {
    [CmdletBinding()]
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute(
        'PSUseShouldProcessForStateChangingFunctions',
        '',
        Justification = 'Generates key material in memory; it does not persist or mutate system state.'
    )]
    param()
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Test-JoblitApiKeyStrength {
    param([AllowNull()][string] $ApiKey)
    if ([string]::IsNullOrWhiteSpace($ApiKey) -or $ApiKey -notmatch '^[A-Za-z0-9_-]{43,}$') { return $false }
    try {
        $value = $ApiKey.Replace('-', '+').Replace('_', '/')
        while (($value.Length % 4) -ne 0) { $value += '=' }
        return ([Convert]::FromBase64String($value).Length -ge 32)
    } catch { return $false }
}

function Get-JoblitKeyFingerprint {
    param([Parameter(Mandatory)][string] $ApiKey)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($ApiKey)
        $digest = $hasher.ComputeHash($bytes)
        return (($digest | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16)
    } finally { $hasher.Dispose() }
}

function Get-JoblitHermesHome {
    if (-not [string]::IsNullOrWhiteSpace($env:HERMES_HOME)) {
        return [IO.Path]::GetFullPath($env:HERMES_HOME)
    }
    return [IO.Path]::GetFullPath((Join-Path $HOME '.hermes'))
}

function Get-JoblitProfileRoot {
    param([Parameter(Mandatory)][string] $ProfileName)
    return [IO.Path]::GetFullPath((Join-Path (Get-JoblitHermesHome) (Join-Path 'profiles' $ProfileName)))
}

function Get-JoblitDistributionSourceRoot {
    param([Parameter(Mandatory)][string] $ProfileName)
    return [IO.Path]::GetFullPath((Join-Path (Get-JoblitHermesHome) (Join-Path 'joblit-distributions' (Join-Path $ProfileName 'current'))))
}

function Test-JoblitSamePath {
    param(
        [Parameter(Mandatory)][string] $Left,
        [Parameter(Mandatory)][string] $Right
    )
    return [IO.Path]::GetFullPath($Left).Equals(
        [IO.Path]::GetFullPath($Right),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Read-JoblitEnvFile {
    param([Parameter(Mandatory)][string] $Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw (New-JoblitFailure -Code 'UNSAFE_ENV_FILE' -Message $Path)
    }
    $values = [ordered]@{}
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -notmatch '^(?<key>[A-Z][A-Z0-9_]*)=(?<value>.*)$') {
            throw (New-JoblitFailure -Code 'UNKNOWN_ENV_FORMAT' -Message "Unsupported line in $Path")
        }
        if ($values.Contains($Matches.key)) {
            throw (New-JoblitFailure -Code 'DUPLICATE_ENV_KEY' -Message $Matches.key)
        }
        $values[$Matches.key] = $Matches.value
    }
    return $values
}

function Test-JoblitPrivateAcl {
    param(
        [Parameter(Mandatory)][Security.AccessControl.FileSecurity] $Acl,
        [Parameter(Mandatory)][Security.Principal.SecurityIdentifier] $Identity
    )
    try {
        $owner = $Acl.GetOwner([Security.Principal.SecurityIdentifier])
        $rules = @($Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        if (-not $Acl.AreAccessRulesProtected -or -not $owner.Equals($Identity) -or $rules.Count -ne 1) {
            return $false
        }
        $rule = $rules[0]
        return (
            $rule.IdentityReference.Equals($Identity) -and
            $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $rule.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl -and
            -not $rule.IsInherited
        )
    } catch {
        return $false
    }
}

function Set-JoblitPrivateAcl {
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Low')]
    param([Parameter(Mandatory)][string] $Path)
    if ($env:OS -ne 'Windows_NT') { return }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $current = Get-Acl -LiteralPath $Path
    if (Test-JoblitPrivateAcl -Acl $current -Identity $identity) { return }
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $identity,
        [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($rule)
    if (-not $PSCmdlet.ShouldProcess($Path, 'Restrict file ACL to the current user')) { return }
    Set-Acl -LiteralPath $Path -AclObject $acl
    $applied = Get-Acl -LiteralPath $Path
    if (-not (Test-JoblitPrivateAcl -Acl $applied -Identity $identity)) {
        throw (New-JoblitFailure -Code 'PRIVATE_ACL_VERIFY_FAILED' -Message $Path)
    }
}

function Write-JoblitEnvFileAtomic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][System.Collections.IDictionary] $Values
    )
    $directory = Split-Path -Parent $Path
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    if (Test-Path -LiteralPath $Path) {
        $existing = Get-Item -LiteralPath $Path -Force
        if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw (New-JoblitFailure -Code 'UNSAFE_ENV_FILE' -Message $Path)
        }
    }
    $operationId = [guid]::NewGuid().ToString('N')
    $temporary = "$Path.$PID.$operationId.tmp"
    $backup = "$Path.$PID.$operationId.bak"
    $lines = @($Values.Keys | Sort-Object | ForEach-Object { "$_=$($Values[$_])" })
    try {
        [IO.File]::WriteAllLines($temporary, $lines, [Text.UTF8Encoding]::new($false))
        Set-JoblitPrivateAcl -Path $temporary
        if (Test-Path -LiteralPath $Path) {
            Set-JoblitPrivateAcl -Path $Path
            [IO.File]::Replace($temporary, $Path, $backup, $true)
        } else {
            [IO.File]::Move($temporary, $Path)
        }
        Set-JoblitPrivateAcl -Path $Path
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

function Test-JoblitManagedProfile {
    param([Parameter(Mandatory)][string] $ProfileRoot)
    $distributionPath = Join-Path $ProfileRoot 'distribution.yaml'
    $manifestPath = Join-Path $ProfileRoot 'joblit-package-manifest.json'
    if (
        -not (Test-Path -LiteralPath $distributionPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)
    ) { return $false }
    try {
        $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
        $profileName = [IO.Path]::GetFileName([IO.Path]::GetFullPath($ProfileRoot).TrimEnd([IO.Path]::DirectorySeparatorChar))
        $content = [IO.File]::ReadAllText($distributionPath)
        $namePattern = '(?m)^name:\s*[''"]?' + [regex]::Escape($profileName) + '[''"]?\s*$'
        $versionPattern =
            '(?m)^version:\s*[''"]?' +
            [regex]::Escape($script:ManagedProfileVersion) +
            '[''"]?\s*$'
        return (
            $profileName -match '^joblit-[a-f0-9]{16,64}$' -and
            $manifest.schemaVersion -eq 1 -and
            $manifest.package -eq 'joblit-hermes-profile' -and
            $content -match $namePattern -and
            $content -match $versionPattern -and
            $content -match '(?m)^source:\s*.+$' -and
            $content -match '(?m)^installed_at:\s*.+$'
        )
    } catch { return $false }
}

function Get-JoblitInstalledDistributionSource {
    param([Parameter(Mandatory)][string] $ProfileRoot)
    $path = Join-Path $ProfileRoot 'distribution.yaml'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $content = [IO.File]::ReadAllText($path)
    if ($content -notmatch '(?m)^source:\s*(?<value>.+?)\s*$') { return $null }
    return $Matches.value.Trim().Trim('"').Trim("'")
}

function Test-JoblitProfileConfig {
    param([Parameter(Mandatory)][string] $ConfigPath)
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        return [pscustomobject]@{ Valid = $false; Issues = @('config.yaml missing') }
    }
    $content = [IO.File]::ReadAllText($ConfigPath)
    $issues = New-Object System.Collections.Generic.List[string]
    if ($content -notmatch '(?m)^\s*provider:\s*openai-codex\s*$') { $issues.Add('model.provider') }
    if ($content -notmatch '(?m)^\s*openai_runtime:\s*auto\s*$') { $issues.Add('model.openai_runtime') }
    if ($content -notmatch '(?ms)^\s*api_server:\s*\r?\n\s*-\s*no_mcp\s*$') { $issues.Add('platform_toolsets.api_server') }
    if ($content -notmatch '(?ms)^\s*cron:\s*\r?\n\s*-\s*no_mcp\s*$') { $issues.Add('platform_toolsets.cron') }
    if ($content -notmatch '(?m)^\s*memory_enabled:\s*false\s*$') { $issues.Add('memory.memory_enabled') }
    if ($content -notmatch '(?m)^\s*user_profile_enabled:\s*false\s*$') { $issues.Add('memory.user_profile_enabled') }
    if ($content -notmatch '(?ms)^honcho:\s*\r?\n\s*enabled:\s*false\s*$') { $issues.Add('honcho.enabled') }
    if ($content -notmatch '(?ms)^agent:\s*\r?\n {2}disabled_toolsets:\s*\r?\n {4}-\s*all\s*(?:\r?\n)?\z') {
        $issues.Add('agent.disabled_toolsets.all')
    }
    return [pscustomobject]@{ Valid = ($issues.Count -eq 0); Issues = @($issues) }
}

function Test-JoblitPortableArchivePath {
    param([Parameter(Mandatory)][string] $Value)
    if (-not $Value -or $Value.Contains('\') -or $Value.StartsWith('/') -or $Value -match '^[A-Za-z]:' -or $Value.Contains(':')) { return $false }
    $parts = $Value.TrimEnd('/').Split('/')
    if ($parts.Count -eq 0) { return $false }
    foreach ($part in $parts) {
        if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part.EndsWith('.') -or $part.EndsWith(' ')) { return $false }
        if ($part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { return $false }
    }
    return $Value.Normalize([Text.NormalizationForm]::FormC) -ceq $Value
}

function Test-JoblitArchiveEntries {
    [CmdletBinding()]
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute(
        'PSUseSingularNouns',
        '',
        Justification = 'Preserves the published bootstrap module API used by existing installers.'
    )]
    param([Parameter(Mandatory)][string] $ArchivePath)
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $seen = @{}
        $fileCount = 0
        [long] $totalSize = 0
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName
            if (-not (Test-JoblitPortableArchivePath -Value $name)) {
                throw (New-JoblitFailure -Code 'MALICIOUS_ARCHIVE_ENTRY' -Message $name)
            }
            $folded = $name.TrimEnd('/').ToLowerInvariant()
            if ($seen.ContainsKey($folded)) {
                throw (New-JoblitFailure -Code 'ARCHIVE_CASE_COLLISION' -Message $name)
            }
            $seen[$folded] = $true
            $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            $windowsAttributes = ($entry.ExternalAttributes -band 0xFFFF)
            if ($unixType -eq 0xA000 -or ($windowsAttributes -band 0x0400) -ne 0) {
                throw (New-JoblitFailure -Code 'ARCHIVE_LINK_REJECTED' -Message $name)
            }
            if ($name.EndsWith('/')) { continue }
            $fileCount += 1
            $totalSize += $entry.Length
            if ($entry.Length -gt 262144) { throw (New-JoblitFailure -Code 'ARCHIVE_FILE_SIZE_LIMIT' -Message $name) }
            if ($entry.CompressedLength -eq 0 -and $entry.Length -gt 0) { throw (New-JoblitFailure -Code 'ARCHIVE_COMPRESSION_LIMIT' -Message $name) }
            if ($entry.CompressedLength -gt 0 -and ($entry.Length / $entry.CompressedLength) -gt 100) {
                throw (New-JoblitFailure -Code 'ARCHIVE_COMPRESSION_LIMIT' -Message $name)
            }
        }
        if ($fileCount -gt 32) { throw (New-JoblitFailure -Code 'ARCHIVE_FILE_COUNT_LIMIT' -Message ([string] $fileCount)) }
        if ($totalSize -gt 1048576) { throw (New-JoblitFailure -Code 'ARCHIVE_TOTAL_SIZE_LIMIT' -Message ([string] $totalSize)) }
    } finally { $archive.Dispose() }
    return $true
}

function Expand-JoblitVerifiedArchive {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string] $ArchivePath)
    Test-JoblitArchiveEntries -ArchivePath $ArchivePath | Out-Null
    $root = Join-Path ([IO.Path]::GetTempPath()) ("joblit-hermes-" + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($root) | Out-Null
    try {
        [IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $root)
        return [IO.Path]::GetFullPath($root)
    } catch {
        Remove-JoblitTemporaryDirectory -Path $root
        throw
    }
}

function Remove-JoblitTemporaryDirectory {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute(
        'PSUseShouldProcessForStateChangingFunctions',
        '',
        Justification = 'Always removes only a GUID-scoped directory beneath the OS temp root, including during WhatIf verification.'
    )]
    param([Parameter(Mandatory)][string] $Path)
    $resolved = [IO.Path]::GetFullPath($Path)
    $allowedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($allowedParent, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('joblit-hermes-', [StringComparison]::Ordinal)) {
        throw (New-JoblitFailure -Code 'UNSAFE_TEMP_CLEANUP_PATH' -Message $resolved)
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

function Invoke-JoblitPackageVerifier {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][ValidateSet('integrity','digest','production')][string] $Mode,
        [string] $ArchivePath,
        [string] $ExpectedArchiveSha256,
        [switch] $Installed,
        [string] $ExpectedProfileName,
        [string] $ExpectedDistributionSource
    )
    $node = Resolve-JoblitExecutable -Name 'node'
    $arguments = @($script:VerifierScript, '--root', $Root, '--mode', $Mode)
    if ($ArchivePath) { $arguments += @('--archive', $ArchivePath) }
    if ($ExpectedArchiveSha256) { $arguments += @('--expected-archive-sha256', $ExpectedArchiveSha256.ToLowerInvariant()) }
    if ($Installed) {
        $arguments += @('--installed', 'true')
        if (-not $ExpectedProfileName -or -not $ExpectedDistributionSource) {
            throw (New-JoblitFailure -Code 'INSTALLED_VERIFIER_CONTEXT_REQUIRED' -Message 'Expected profile name and distribution source are required.')
        }
        $arguments += @('--expected-profile-name', $ExpectedProfileName, '--expected-distribution-source', $ExpectedDistributionSource)
    }
    $result = Invoke-JoblitProcess -FilePath $node -Arguments $arguments
    try { return ($result.Output | ConvertFrom-Json) }
    catch { throw (New-JoblitFailure -Code 'INVALID_VERIFIER_OUTPUT' -Message $_.Exception.Message) }
}

function Get-JoblitFileSha256 {
    param([Parameter(Mandatory)][string] $Path)
    $stream = [IO.File]::OpenRead($Path)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = $hasher.ComputeHash($stream)
        return (($digest | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

function Assert-JoblitRealDirectory {
    param([Parameter(Mandatory)][string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw (New-JoblitFailure -Code 'REPARSE_POINT_REJECTED' -Message $Path)
    }
}

function Publish-JoblitVerifiedDistribution {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $PackageRoot,
        [Parameter(Mandatory)][string] $ProfileName,
        [Parameter(Mandatory)][ValidateSet('digest','production')][string] $Mode,
        [string] $ArchivePath,
        [string] $ExpectedArchiveSha256
    )
    $hermesHome = Get-JoblitHermesHome
    [IO.Directory]::CreateDirectory($hermesHome) | Out-Null
    Assert-JoblitRealDirectory -Path $hermesHome
    $distributionRoot = Join-Path $hermesHome 'joblit-distributions'
    [IO.Directory]::CreateDirectory($distributionRoot) | Out-Null
    Assert-JoblitRealDirectory -Path $distributionRoot
    $profileDistributionRoot = Join-Path $distributionRoot $ProfileName
    [IO.Directory]::CreateDirectory($profileDistributionRoot) | Out-Null
    Assert-JoblitRealDirectory -Path $profileDistributionRoot

    $current = Get-JoblitDistributionSourceRoot -ProfileName $ProfileName
    $staging = Join-Path $profileDistributionRoot ('.staging-' + [guid]::NewGuid().ToString('N'))
    $backup = Join-Path $profileDistributionRoot ('.previous-' + [guid]::NewGuid().ToString('N'))
    $movedCurrent = $false
    try {
        Copy-Item -LiteralPath $PackageRoot -Destination $staging -Recurse -Force
        Invoke-JoblitPackageVerifier -Root $staging -Mode $Mode -ArchivePath $ArchivePath -ExpectedArchiveSha256 $ExpectedArchiveSha256 | Out-Null
        if (Test-Path -LiteralPath $current -PathType Container) {
            Assert-JoblitRealDirectory -Path $current
            [IO.Directory]::Move($current, $backup)
            $movedCurrent = $true
        }
        [IO.Directory]::Move($staging, $current)
        if ($movedCurrent -and (Test-Path -LiteralPath $backup)) {
            Remove-Item -LiteralPath $backup -Recurse -Force
        }
        return $current
    } catch {
        if ($movedCurrent -and -not (Test-Path -LiteralPath $current) -and (Test-Path -LiteralPath $backup)) {
            [IO.Directory]::Move($backup, $current)
        }
        throw
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    }
}

function Test-JoblitPortAvailable {
    param([Parameter(Mandatory)][int] $Port)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start(); return $true }
    catch { return $false }
    finally {
        try { $listener.Stop() }
        catch { Write-Verbose "Failed to stop the temporary port probe listener: $($_.Exception.Message)" }
    }
}

function Get-JoblitPropertyValue {
    param(
        [AllowNull()][object] $Object,
        [Parameter(Mandatory)][string] $Name
    )
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Test-JoblitApiEndpoint {
    param(
        [AllowNull()][object] $Endpoints,
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][string] $Method,
        [Parameter(Mandatory)][string] $Path
    )
    $endpoint = Get-JoblitPropertyValue -Object $Endpoints -Name $Name
    return (
        $null -ne $endpoint -and
        (Get-JoblitPropertyValue -Object $endpoint -Name 'method') -ceq $Method -and
        (Get-JoblitPropertyValue -Object $endpoint -Name 'path') -ceq $Path
    )
}

function Get-JoblitOpenAiCodexAuthState {
    param([Parameter(Mandatory)][object] $Result)
    if ($Result.ExitCode -ne 0) { return 'Invalid' }
    $output = ([string] $Result.Output) -replace "`e\[[0-?]*[ -/]*[@-~]", ''
    if ($output -match '(?im)^openai-codex:\s+logged in\s*$') { return 'LoggedIn' }
    if ($output -match '(?im)^openai-codex:\s+logged out(?:\s+\(.+\))?\s*$') { return 'LoggedOut' }
    return 'Invalid'
}

function Invoke-JoblitProbe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][int] $Port,
        [Parameter(Mandatory)][string] $ApiKey,
        [Parameter(Mandatory)][string] $ProfileName
    )
    try {
        $base = "http://127.0.0.1:$Port"
        $health = Invoke-RestMethod -Method Get -Uri "$base/health" -TimeoutSec 10
        if ((Get-JoblitPropertyValue -Object $health -Name 'status') -cne 'ok') { throw 'health.status' }
        $headers = @{ Authorization = "Bearer $ApiKey" }
        $capabilities = Invoke-RestMethod -Method Get -Uri "$base/v1/capabilities" -Headers $headers -TimeoutSec 10
        $models = Invoke-RestMethod -Method Get -Uri "$base/v1/models" -Headers $headers -TimeoutSec 10
        $toolsets = Invoke-RestMethod -Method Get -Uri "$base/v1/toolsets" -Headers $headers -TimeoutSec 10
        $auth = Get-JoblitPropertyValue -Object $capabilities -Name 'auth'
        $features = Get-JoblitPropertyValue -Object $capabilities -Name 'features'
        $endpoints = Get-JoblitPropertyValue -Object $capabilities -Name 'endpoints'
        if (
            (Get-JoblitPropertyValue -Object $capabilities -Name 'object') -cne 'hermes.api_server.capabilities' -or
            (Get-JoblitPropertyValue -Object $capabilities -Name 'platform') -cne 'hermes-agent' -or
            (Get-JoblitPropertyValue -Object $capabilities -Name 'model') -cne $ProfileName -or
            (Get-JoblitPropertyValue -Object $auth -Name 'type') -cne 'bearer' -or
            (Get-JoblitPropertyValue -Object $auth -Name 'required') -ne $true -or
            (Get-JoblitPropertyValue -Object $features -Name 'run_submission') -ne $true -or
            (Get-JoblitPropertyValue -Object $features -Name 'run_status') -ne $true -or
            (Get-JoblitPropertyValue -Object $features -Name 'run_stop') -ne $true -or
            -not (Test-JoblitApiEndpoint -Endpoints $endpoints -Name 'health' -Method 'GET' -Path '/health') -or
            -not (Test-JoblitApiEndpoint -Endpoints $endpoints -Name 'models' -Method 'GET' -Path '/v1/models') -or
            -not (Test-JoblitApiEndpoint -Endpoints $endpoints -Name 'runs' -Method 'POST' -Path '/v1/runs') -or
            -not (Test-JoblitApiEndpoint -Endpoints $endpoints -Name 'run_status' -Method 'GET' -Path '/v1/runs/{run_id}') -or
            -not (Test-JoblitApiEndpoint -Endpoints $endpoints -Name 'run_stop' -Method 'POST' -Path '/v1/runs/{run_id}/stop') -or
            -not (Test-JoblitApiEndpoint -Endpoints $endpoints -Name 'toolsets' -Method 'GET' -Path '/v1/toolsets')
        ) { throw 'capabilities' }

        $modelDataProperty = $models.PSObject.Properties['data']
        if ($null -eq $modelDataProperty) { throw 'models.data' }
        $modelData = @($modelDataProperty.Value)
        $invalidModels = @($modelData | Where-Object {
            (Get-JoblitPropertyValue -Object $_ -Name 'object') -cne 'model' -or
            [string]::IsNullOrWhiteSpace([string] (Get-JoblitPropertyValue -Object $_ -Name 'id'))
        })
        $matchingModels = @($modelData | Where-Object {
            (Get-JoblitPropertyValue -Object $_ -Name 'object') -ceq 'model' -and
            (Get-JoblitPropertyValue -Object $_ -Name 'id') -ceq $ProfileName
        })
        if (
            (Get-JoblitPropertyValue -Object $models -Name 'object') -cne 'list' -or
            $invalidModels.Count -gt 0 -or
            $matchingModels.Count -ne 1
        ) {
            throw 'models'
        }

        $toolsetDataProperty = $toolsets.PSObject.Properties['data']
        if (
            (Get-JoblitPropertyValue -Object $toolsets -Name 'object') -cne 'list' -or
            (Get-JoblitPropertyValue -Object $toolsets -Name 'platform') -cne 'api_server' -or
            $null -eq $toolsetDataProperty
        ) { throw 'toolsets' }
        foreach ($toolset in @($toolsetDataProperty.Value)) {
            $name = Get-JoblitPropertyValue -Object $toolset -Name 'name'
            $enabled = Get-JoblitPropertyValue -Object $toolset -Name 'enabled'
            $configured = Get-JoblitPropertyValue -Object $toolset -Name 'configured'
            $tools = @(Get-JoblitPropertyValue -Object $toolset -Name 'tools')
            if (
                [string]::IsNullOrWhiteSpace([string] $name) -or
                $enabled -isnot [bool] -or
                $configured -isnot [bool] -or
                @($tools | Where-Object { $_ -isnot [string] }).Count -gt 0 -or
                ($enabled -eq $true -and $tools.Count -gt 0)
            ) { throw 'toolsets.data' }
        }
        return $true
    } catch {
        if ($_.Exception.Message -match '^API_INCOMPATIBLE:') { throw }
        throw (New-JoblitFailure -Code 'API_INCOMPATIBLE' -Message $_.Exception.Message)
    }
}

function Invoke-JoblitProbeWithRetry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][int] $Port,
        [Parameter(Mandatory)][string] $ApiKey,
        [Parameter(Mandatory)][string] $ProfileName,
        [ValidateRange(1, 20)][int] $MaxAttempts = 6,
        [ValidateRange(0, 10000)][int] $InitialDelayMilliseconds = 500,
        [ValidateRange(0, 10000)][int] $MaxDelayMilliseconds = 4000
    )
    $lastError = $null
    [int] $delayMilliseconds = $InitialDelayMilliseconds
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
        try {
            return Invoke-JoblitProbe -Port $Port -ApiKey $ApiKey -ProfileName $ProfileName
        } catch {
            $lastError = $_.Exception
            if ($attempt -ge $MaxAttempts) { break }
            if ($delayMilliseconds -gt 0) {
                Start-Sleep -Milliseconds $delayMilliseconds
                $delayMilliseconds = [int] [Math]::Min(
                    [long] $delayMilliseconds * 2,
                    [long] $MaxDelayMilliseconds
                )
            }
        }
    }
    throw $lastError
}

function Get-JoblitRecoveryAction {
    param([Parameter(Mandatory)][string] $Category, [string] $ProfileName = '<profile>')
    switch ($Category) {
        'MissingHermes' { return 'Install or update stock Hermes from https://github.com/NousResearch/hermes-agent, then run: hermes --version' }
        'UntrustedPackage' { return 'Re-download the official Joblit package and rerun verification with its published SHA-256 or trusted release signature.' }
        'ProfileDrift' { return "Rerun Install-JoblitHermes.ps1 with the verified package and -ProfileName $ProfileName; add -ForceConfigUpdate only when replacing config." }
        'AuthModelMismatch' { return "hermes -p $ProfileName auth add openai-codex" }
        'GatewayDown' { return "hermes -p $ProfileName gateway install --start-now --start-on-login" }
        'ApiIncompatible' { return "hermes -p $ProfileName gateway restart" }
        default { return "hermes -p $ProfileName gateway status" }
    }
}

function Get-JoblitFailureCategory {
    param([Parameter(Mandatory)][string] $Message)
    if ($Message -match 'MISSING_HERMES|INVALID_HERMES_VERSION') { return 'MissingHermes' }
    if ($Message -match 'SIGNATURE|TRUST|ARCHIVE|PACKAGE|VERIFIER|SOURCE_COMMIT') { return 'UntrustedPackage' }
    if ($Message -match 'UNRELATED_PROFILE|PROFILE_DRIFT|CONFIG') { return 'ProfileDrift' }
    if ($Message -match 'AUTH|PROVIDER|RUNTIME') { return 'AuthModelMismatch' }
    if ($Message -match 'GATEWAY') { return 'GatewayDown' }
    if ($Message -match 'API_|PROBE') { return 'ApiIncompatible' }
    return 'InstallFailed'
}

function Invoke-JoblitHermesInstall {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string] $PackagePath,
        [Parameter(Mandatory)][ValidatePattern('^joblit-[a-f0-9]{16,64}$')][string] $ProfileName,
        [ValidateRange(1024,65535)][int] $Port = 8642,
        [string] $ExpectedArchiveSha256,
        [switch] $Production,
        [bool] $StartOnLogin = $true,
        [switch] $ForceConfigUpdate
    )
    $extractedRoot = $null
    $apiKey = $null
    $newSecret = $false
    try {
        Write-JoblitStatus -State 'Preflight' -Status 'Started' -Message 'Checking stock Hermes and local inputs.'
        $resolvedPackage = (Resolve-Path -LiteralPath $PackagePath -ErrorAction Stop).Path
        $hermes = Resolve-JoblitExecutable -Name 'hermes'
        $version = Get-JoblitHermesVersion -HermesPath $hermes
        if (-not (Test-JoblitVersionAtLeast -Actual $version -Minimum $script:MinimumHermesVersion)) {
            throw (New-JoblitFailure -Code 'OUTDATED_HERMES' -Message "$version is older than $($script:MinimumHermesVersion). Official source: https://github.com/NousResearch/hermes-agent")
        }
        Write-JoblitStatus -State 'Preflight' -Status 'Passed' -Message "Hermes $version; profile $ProfileName."

        Write-JoblitStatus -State 'VerifyPackage' -Status 'Started' -Message 'Verifying package before any Hermes mutation.'
        $isArchive = Test-Path -LiteralPath $resolvedPackage -PathType Leaf
        if ($isArchive) {
            if ([IO.Path]::GetExtension($resolvedPackage) -ine '.zip') { throw (New-JoblitFailure -Code 'UNSUPPORTED_PACKAGE_FORMAT' -Message $resolvedPackage) }
            if (-not $Production -and $ExpectedArchiveSha256 -notmatch '^[a-fA-F0-9]{64}$') {
                throw (New-JoblitFailure -Code 'EXPECTED_ARCHIVE_SHA256_REQUIRED' -Message 'Beta install requires the exact published SHA-256.')
            }
            if (-not $Production) {
                $actualArchiveSha256 = Get-JoblitFileSha256 -Path $resolvedPackage
                if ($actualArchiveSha256 -ne $ExpectedArchiveSha256.ToLowerInvariant()) {
                    throw (New-JoblitFailure -Code 'ARCHIVE_SHA256_MISMATCH' -Message $actualArchiveSha256)
                }
            }
            $extractedRoot = Expand-JoblitVerifiedArchive -ArchivePath $resolvedPackage
            $packageRoot = $extractedRoot
        } elseif (Test-Path -LiteralPath $resolvedPackage -PathType Container) {
            if (-not $Production) { throw (New-JoblitFailure -Code 'BETA_ARCHIVE_REQUIRED' -Message 'Beta digest verification requires the original ZIP archive.') }
            $packageRoot = $resolvedPackage
        } else {
            throw (New-JoblitFailure -Code 'PACKAGE_NOT_FOUND' -Message $resolvedPackage)
        }
        $mode = if ($Production) { 'production' } else { 'digest' }
        $verification = Invoke-JoblitPackageVerifier -Root $packageRoot -Mode $mode -ArchivePath $(if ($isArchive) { $resolvedPackage } else { $null }) -ExpectedArchiveSha256 $ExpectedArchiveSha256
        Write-JoblitStatus -State 'VerifyPackage' -Status 'Passed' -Message "Package $($verification.profileVersion), trust $($verification.trustLevel)."

        Write-JoblitStatus -State 'InspectExistingProfile' -Status 'Started' -Message "Inspecting isolated profile $ProfileName."
        $profileRoot = Get-JoblitProfileRoot -ProfileName $ProfileName
        $profileExists = Test-Path -LiteralPath $profileRoot -PathType Container
        if ($profileExists -and -not (Test-JoblitManagedProfile -ProfileRoot $profileRoot)) {
            throw (New-JoblitFailure -Code 'UNRELATED_PROFILE' -Message "Refusing to replace $profileRoot")
        }
        $persistentSource = Get-JoblitDistributionSourceRoot -ProfileName $ProfileName
        $installedSource = if ($profileExists) { Get-JoblitInstalledDistributionSource -ProfileRoot $profileRoot } else { $null }
        if ($profileExists -and -not $ForceConfigUpdate) {
            $existingConfigPath = Join-Path $profileRoot 'config.yaml'
            $incomingConfigPath = Join-Path $packageRoot 'config.yaml'
            if (
                -not (Test-Path -LiteralPath $existingConfigPath -PathType Leaf) -or
                (Get-JoblitFileSha256 -Path $existingConfigPath) -ne (Get-JoblitFileSha256 -Path $incomingConfigPath)
            ) {
                throw (New-JoblitFailure -Code 'CONFIG_UPDATE_REQUIRES_FORCE' -Message 'Existing config differs from the verified distribution. Review it, then rerun with -ForceConfigUpdate.')
            }
        }
        $occupiedPortBelongsToProfile = $false
        if ($profileExists) {
            $existingEnvPath = Join-Path $profileRoot '.env'
            if (Test-Path -LiteralPath $existingEnvPath -PathType Leaf) {
                try {
                    $existingValues = Read-JoblitEnvFile -Path $existingEnvPath
                    $occupiedPortBelongsToProfile =
                        $existingValues['API_SERVER_HOST'] -eq '127.0.0.1' -and
                        $existingValues['API_SERVER_PORT'] -eq [string] $Port
                } catch { $occupiedPortBelongsToProfile = $false }
            }
        }
        if (-not (Test-JoblitPortAvailable -Port $Port) -and -not $occupiedPortBelongsToProfile) {
            throw (New-JoblitFailure -Code 'PORT_IN_USE' -Message "127.0.0.1:$Port is occupied")
        }
        Write-JoblitStatus -State 'InspectExistingProfile' -Status 'Passed' -Message $(if ($profileExists) { 'Managed Joblit profile found.' } else { 'Fresh isolated profile.' })

        if (-not $PSCmdlet.ShouldProcess($ProfileName, 'Install or update the verified Joblit Hermes profile')) {
            foreach ($state in @('InstallOrUpdate','ConfigureOAuth','WriteLocalEnv','InstallGateway','Probe')) {
                Write-JoblitStatus -State $state -Status 'Skipped' -Message 'WhatIf: no user profile, auth, environment, service, or network state changed.'
            }
            return [pscustomobject][ordered]@{
                endpoint = "http://127.0.0.1:$Port"
                profileName = $ProfileName
                packageVersion = $verification.profileVersion
                trustLevel = $verification.trustLevel
                keyFingerprint = $null
            }
        }

        Write-JoblitStatus -State 'InstallOrUpdate' -Status 'Started' -Message 'Publishing a verified persistent source and invoking official Hermes profile lifecycle.'
        $persistentSource = Publish-JoblitVerifiedDistribution `
            -PackageRoot $packageRoot `
            -ProfileName $ProfileName `
            -Mode $mode `
            -ArchivePath $(if ($isArchive) { $resolvedPackage } else { $null }) `
            -ExpectedArchiveSha256 $ExpectedArchiveSha256
        if (-not $profileExists) {
            $profileArguments = @('profile','install',$persistentSource,'--name',$ProfileName,'--yes')
        } elseif ($installedSource -and (Test-JoblitSamePath -Left $installedSource -Right $persistentSource)) {
            $profileArguments = @('profile','update',$ProfileName)
            if ($ForceConfigUpdate) { $profileArguments += '--force-config' }
            $profileArguments += '--yes'
        } else {
            $profileArguments = @('profile','install',$persistentSource,'--name',$ProfileName,'--force','--yes')
        }
        Invoke-JoblitProcess -FilePath $hermes -Arguments $profileArguments | Out-Null
        if (-not (Test-JoblitManagedProfile -ProfileRoot $profileRoot)) {
            throw (New-JoblitFailure -Code 'PROFILE_INSTALL_MISMATCH' -Message $profileRoot)
        }
        Invoke-JoblitPackageVerifier `
            -Root $profileRoot `
            -Mode $mode `
            -ArchivePath $(if ($isArchive) { $resolvedPackage } else { $null }) `
            -ExpectedArchiveSha256 $ExpectedArchiveSha256 `
            -Installed `
            -ExpectedProfileName $ProfileName `
            -ExpectedDistributionSource $persistentSource | Out-Null
        Write-JoblitStatus -State 'InstallOrUpdate' -Status 'Passed' -Message 'Official Joblit distribution installed from its persistent verified source.'

        Write-JoblitStatus -State 'ConfigureOAuth' -Status 'Started' -Message 'Checking official openai-codex OAuth status.'
        $authStatus = Invoke-JoblitProcess -FilePath $hermes -Arguments @('-p',$ProfileName,'auth','status','openai-codex') -AllowFailure
        $authState = Get-JoblitOpenAiCodexAuthState -Result $authStatus
        if ($authState -eq 'Invalid') {
            throw (New-JoblitFailure -Code 'AUTH_STATUS_INVALID' -Message 'Unable to determine openai-codex authentication status.')
        }
        if ($authState -eq 'LoggedOut') {
            Invoke-JoblitProcess -FilePath $hermes -Arguments @('-p',$ProfileName,'auth','add','openai-codex') | Out-Null
            $authStatus = Invoke-JoblitProcess -FilePath $hermes -Arguments @('-p',$ProfileName,'auth','status','openai-codex') -AllowFailure
            if ((Get-JoblitOpenAiCodexAuthState -Result $authStatus) -ne 'LoggedIn') {
                throw (New-JoblitFailure -Code 'AUTH_NOT_READY' -Message 'openai-codex OAuth did not reach logged-in state.')
            }
        }
        $configCheck = Test-JoblitProfileConfig -ConfigPath (Join-Path $profileRoot 'config.yaml')
        if (-not $configCheck.Valid) { throw (New-JoblitFailure -Code 'PROFILE_CONFIG_DRIFT' -Message ($configCheck.Issues -join ', ')) }
        Write-JoblitStatus -State 'ConfigureOAuth' -Status 'Passed' -Message 'Provider openai-codex; runtime auto.'

        Write-JoblitStatus -State 'WriteLocalEnv' -Status 'Started' -Message 'Writing loopback-only profile environment atomically.'
        $envPath = Join-Path $profileRoot '.env'
        $environmentValues = [ordered]@{}
        if (Test-Path -LiteralPath $envPath -PathType Leaf) {
            $environmentValues = Read-JoblitEnvFile -Path $envPath
            if (-not $environmentValues.Contains('API_SERVER_KEY') -or -not $environmentValues.Contains('API_SERVER_HOST')) {
                throw (New-JoblitFailure -Code 'UNKNOWN_EXISTING_ENV' -Message 'Refusing to overwrite an unmanaged .env.')
            }
            if ($environmentValues['API_SERVER_HOST'] -ne '127.0.0.1') {
                throw (New-JoblitFailure -Code 'PUBLIC_BIND_REJECTED' -Message $environmentValues['API_SERVER_HOST'])
            }
            $apiKey = [string] $environmentValues['API_SERVER_KEY']
            if (-not (Test-JoblitApiKeyStrength -ApiKey $apiKey)) { throw (New-JoblitFailure -Code 'WEAK_EXISTING_API_KEY' -Message 'Existing key is shorter than 32 bytes.') }
        } else {
            $apiKey = New-JoblitApiKey
            $newSecret = $true
        }
        $environmentValues['API_SERVER_ENABLED'] = 'true'
        $environmentValues['API_SERVER_HOST'] = '127.0.0.1'
        $environmentValues['API_SERVER_PORT'] = [string] $Port
        $environmentValues['API_SERVER_KEY'] = $apiKey
        $environmentValues['API_SERVER_MODEL_NAME'] = $ProfileName
        $environmentValues['API_SERVER_CORS_ORIGINS'] = '*'
        Write-JoblitEnvFileAtomic -Path $envPath -Values $environmentValues
        $fingerprint = Get-JoblitKeyFingerprint -ApiKey $apiKey
        Write-JoblitStatus -State 'WriteLocalEnv' -Status 'Passed' -Message "Private environment written; key fingerprint $fingerprint." -Secrets @($apiKey)

        Write-JoblitStatus -State 'InstallGateway' -Status 'Started' -Message 'Installing official per-profile gateway service.'
        $loginArgument = if ($StartOnLogin) { '--start-on-login' } else { '--no-start-on-login' }
        Invoke-JoblitNonInteractiveProcess -FilePath $hermes -Arguments @('-p',$ProfileName,'gateway','install','--start-now',$loginArgument) -Secrets @($apiKey) | Out-Null
        Write-JoblitStatus -State 'InstallGateway' -Status 'Passed' -Message 'Gateway install completed.'

        Write-JoblitStatus -State 'Probe' -Status 'Started' -Message 'Checking liveness and authenticated capabilities.'
        Invoke-JoblitProbeWithRetry -Port $Port -ApiKey $apiKey -ProfileName $ProfileName | Out-Null
        Write-JoblitStatus -State 'Probe' -Status 'Passed' -Message 'Gateway is compatible; no billable run sent.' -Secrets @($apiKey)

        $receipt = [pscustomobject][ordered]@{
            endpoint = "http://127.0.0.1:$Port"
            profileName = $ProfileName
            packageVersion = $verification.profileVersion
            trustLevel = $verification.trustLevel
            keyFingerprint = $fingerprint
        }
        if ($newSecret) {
            [Console]::Out.WriteLine("JOBLIT_API_KEY_ONCE=$apiKey")
        }
        Write-JoblitStatus -State 'EmitConnectionReceipt' -Status 'Passed' -Message 'Non-secret connection receipt ready.' -Secrets @($apiKey)
        return $receipt
    } catch {
        $safeMessage = Protect-JoblitSecretText -Text $_.Exception.Message -Secrets @($apiKey)
        $category = Get-JoblitFailureCategory -Message $safeMessage
        $recovery = Get-JoblitRecoveryAction -Category $category -ProfileName $ProfileName
        Write-JoblitStatus -State $category -Status 'Failed' -Message "$safeMessage Recovery: $recovery" -Secrets @($apiKey)
        throw (New-JoblitFailure -Code $category -Message "$safeMessage Recovery: $recovery")
    } finally {
        if ($extractedRoot) { Remove-JoblitTemporaryDirectory -Path $extractedRoot }
    }
}

function New-JoblitReadinessResult {
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute(
        'PSUseShouldProcessForStateChangingFunctions',
        '',
        Justification = 'Creates and returns an in-memory readiness result; it does not mutate system state.'
    )]
    param([string] $State, [int] $ExitCode, [string] $ProfileName, [string] $Detail)
    return [pscustomobject][ordered]@{
        state = $State
        exitCode = $ExitCode
        detail = Protect-JoblitSecretText -Text $Detail
        recoveryCommand = if ($ExitCode -eq 0) { $null } else { Get-JoblitRecoveryAction -Category $State -ProfileName $ProfileName }
    }
}

function Test-JoblitHermesReadiness {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidatePattern('^joblit-[a-f0-9]{16,64}$')][string] $ProfileName)
    try { $hermes = Resolve-JoblitExecutable -Name 'hermes'; $version = Get-JoblitHermesVersion -HermesPath $hermes }
    catch { return New-JoblitReadinessResult -State 'MissingHermes' -ExitCode 10 -ProfileName $ProfileName -Detail $_.Exception.Message }
    if (-not (Test-JoblitVersionAtLeast -Actual $version -Minimum $script:MinimumHermesVersion)) {
        return New-JoblitReadinessResult -State 'MissingHermes' -ExitCode 10 -ProfileName $ProfileName -Detail "Hermes $version is outdated."
    }
    $profileRoot = Get-JoblitProfileRoot -ProfileName $ProfileName
    if (-not (Test-JoblitManagedProfile -ProfileRoot $profileRoot)) {
        return New-JoblitReadinessResult -State 'ProfileDrift' -ExitCode 30 -ProfileName $ProfileName -Detail 'Managed profile missing or distribution changed.'
    }
    $distributionSource = Get-JoblitDistributionSourceRoot -ProfileName $ProfileName
    $installedSource = Get-JoblitInstalledDistributionSource -ProfileRoot $profileRoot
    if (-not $installedSource -or -not (Test-JoblitSamePath -Left $installedSource -Right $distributionSource)) {
        return New-JoblitReadinessResult -State 'ProfileDrift' -ExitCode 30 -ProfileName $ProfileName -Detail 'Profile distribution source is not the verified persistent Joblit source.'
    }
    try {
        $signaturePath = Join-Path $profileRoot 'joblit-package-manifest.sig.json'
        $mode = if (Test-Path -LiteralPath $signaturePath -PathType Leaf) { 'production' } else { 'integrity' }
        $verification = Invoke-JoblitPackageVerifier `
            -Root $profileRoot `
            -Mode $mode `
            -Installed `
            -ExpectedProfileName $ProfileName `
            -ExpectedDistributionSource $distributionSource
    } catch {
        $state = if ($_.Exception.Message -match 'HASH|SIZE|UNEXPECTED|MISSING') { 'ProfileDrift' } else { 'UntrustedPackage' }
        $code = if ($state -eq 'ProfileDrift') { 30 } else { 20 }
        return New-JoblitReadinessResult -State $state -ExitCode $code -ProfileName $ProfileName -Detail $_.Exception.Message
    }
    $config = Test-JoblitProfileConfig -ConfigPath (Join-Path $profileRoot 'config.yaml')
    $noBundledSkillsPath = Join-Path $profileRoot '.no-bundled-skills'
    if (
        -not $config.Valid -or
        -not (Test-Path -LiteralPath $noBundledSkillsPath -PathType Leaf) -or
        (Get-Item -LiteralPath $noBundledSkillsPath).Length -ne 0
    ) {
        return New-JoblitReadinessResult -State 'ProfileDrift' -ExitCode 30 -ProfileName $ProfileName -Detail (($config.Issues + '.no-bundled-skills') -join ', ')
    }
    $envPath = Join-Path $profileRoot '.env'
    try {
        $values = Read-JoblitEnvFile -Path $envPath
        if (
            $values['API_SERVER_HOST'] -ne '127.0.0.1' -or
            $values['API_SERVER_ENABLED'] -ne 'true' -or
            $values['API_SERVER_MODEL_NAME'] -ne $ProfileName -or
            $values['API_SERVER_CORS_ORIGINS'] -ne '*' -or
            -not (Test-JoblitApiKeyStrength $values['API_SERVER_KEY'])
        ) { throw 'Unsafe API environment.' }
        $port = [int] $values['API_SERVER_PORT']
        if ($port -lt 1024 -or $port -gt 65535) { throw 'Invalid API port.' }
        $apiKey = [string] $values['API_SERVER_KEY']
    } catch {
        return New-JoblitReadinessResult -State 'ProfileDrift' -ExitCode 30 -ProfileName $ProfileName -Detail $_.Exception.Message
    }
    try {
        $authStatus = Invoke-JoblitProcess -FilePath $hermes -Arguments @('-p',$ProfileName,'auth','status','openai-codex') -AllowFailure
        if ((Get-JoblitOpenAiCodexAuthState -Result $authStatus) -ne 'LoggedIn') { throw 'openai-codex is not logged in.' }
    } catch { return New-JoblitReadinessResult -State 'AuthModelMismatch' -ExitCode 40 -ProfileName $ProfileName -Detail $_.Exception.Message }
    try {
        $gateway = Invoke-JoblitProcess -FilePath $hermes -Arguments @('-p',$ProfileName,'gateway','status') -AllowFailure
        if ($gateway.ExitCode -ne 0 -or $gateway.Output -notmatch '(?i)running|active|ready') { throw 'Gateway is not running.' }
    } catch { return New-JoblitReadinessResult -State 'GatewayDown' -ExitCode 50 -ProfileName $ProfileName -Detail $_.Exception.Message }
    try { Invoke-JoblitProbe -Port $port -ApiKey $apiKey -ProfileName $ProfileName | Out-Null }
    catch { return New-JoblitReadinessResult -State 'ApiIncompatible' -ExitCode 60 -ProfileName $ProfileName -Detail (Protect-JoblitSecretText $_.Exception.Message @($apiKey)) }
    return [pscustomobject][ordered]@{
        state = 'Ready'
        exitCode = 0
        profileName = $ProfileName
        endpoint = "http://127.0.0.1:$port"
        profileVersion = $verification.profileVersion
        trustLevel = $verification.trustLevel
        keyFingerprint = Get-JoblitKeyFingerprint -ApiKey $apiKey
        recoveryCommand = $null
    }
}

Export-ModuleMember -Function @(
    'Protect-JoblitSecretText',
    'Write-JoblitStatus',
    'ConvertTo-JoblitVersion',
    'Test-JoblitVersionAtLeast',
    'Resolve-JoblitExecutable',
    'Invoke-JoblitProcess',
    'Get-JoblitHermesVersion',
    'New-JoblitApiKey',
    'Test-JoblitApiKeyStrength',
    'Get-JoblitKeyFingerprint',
    'Get-JoblitHermesHome',
    'Get-JoblitProfileRoot',
    'Get-JoblitDistributionSourceRoot',
    'Test-JoblitSamePath',
    'Read-JoblitEnvFile',
    'Write-JoblitEnvFileAtomic',
    'Test-JoblitManagedProfile',
    'Get-JoblitInstalledDistributionSource',
    'Test-JoblitProfileConfig',
    'Test-JoblitPortableArchivePath',
    'Test-JoblitArchiveEntries',
    'Expand-JoblitVerifiedArchive',
    'Remove-JoblitTemporaryDirectory',
    'Invoke-JoblitPackageVerifier',
    'Get-JoblitFileSha256',
    'Publish-JoblitVerifiedDistribution',
    'Test-JoblitPortAvailable',
    'Get-JoblitOpenAiCodexAuthState',
    'Invoke-JoblitProbe',
    'Get-JoblitRecoveryAction',
    'Invoke-JoblitHermesInstall',
    'Test-JoblitHermesReadiness'
)
