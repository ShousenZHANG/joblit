BeforeAll {
    $modulePath = Join-Path $PSScriptRoot '..\JoblitHermes.Common.psm1'
    Import-Module $modulePath -Force
}

Describe 'Invoke-JoblitHermesInstall' {
    BeforeEach {
        $script:FixtureRoot = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:PackageRoot = Join-Path $script:FixtureRoot 'package'
        $env:HERMES_HOME = Join-Path $script:FixtureRoot 'hermes-home'
        New-Item -ItemType Directory -Path $script:PackageRoot -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $script:PackageRoot 'skills\joblit-career-agent\references') -Force | Out-Null
        @'
name: joblit-local-ai
version: 0.1.0
'@ | Set-Content -LiteralPath (Join-Path $script:PackageRoot 'distribution.yaml') -Encoding utf8
        @'
model:
  provider: openai-codex
  openai_runtime: auto
platform_toolsets:
  api_server:
    - no_mcp
  cron:
    - no_mcp
memory:
  memory_enabled: false
  user_profile_enabled: false
honcho:
  enabled: false
agent:
  disabled_toolsets:
    - all
'@ | Set-Content -LiteralPath (Join-Path $script:PackageRoot 'config.yaml') -Encoding utf8
        Set-Content -LiteralPath (Join-Path $script:PackageRoot 'SOUL.md') -Value 'contract' -Encoding utf8
        Set-Content -LiteralPath (Join-Path $script:PackageRoot '.no-bundled-skills') -Value '' -NoNewline
        Set-Content -LiteralPath (Join-Path $script:PackageRoot 'joblit-package-manifest.json') -Value '{"schemaVersion":1,"package":"joblit-hermes-profile"}' -Encoding utf8
        $global:JoblitTestPackageRoot = $script:PackageRoot
        $global:JoblitTestEvents = [Collections.Generic.List[string]]::new()
        $global:JoblitTestCommands = [Collections.Generic.List[string]]::new()

        Mock Resolve-JoblitExecutable { param($Name) return "fake-$Name" } -ModuleName JoblitHermes.Common
        Mock Get-JoblitHermesVersion { return '0.18.2' } -ModuleName JoblitHermes.Common
        Mock Test-JoblitPortAvailable { return $true } -ModuleName JoblitHermes.Common
        Mock Invoke-JoblitPackageVerifier {
            $global:JoblitTestEvents.Add('verify')
            return [pscustomobject]@{ profileVersion = '0.1.0'; trustLevel = 'verified-release' }
        } -ModuleName JoblitHermes.Common
        Mock Invoke-JoblitProbe { return $true } -ModuleName JoblitHermes.Common
        Mock Invoke-JoblitProcess {
            param($FilePath, $Arguments, $Secrets, $AllowFailure)
            $joined = $Arguments -join ' '
            $global:JoblitTestCommands.Add($joined)
            if ($Arguments[0] -eq 'profile' -and $Arguments[1] -eq 'install') {
                $global:JoblitTestEvents.Add('install')
                $sourceRoot = $Arguments[2]
                $nameIndex = [Array]::IndexOf($Arguments, '--name')
                $profileName = $Arguments[$nameIndex + 1]
                $profileRoot = Get-JoblitProfileRoot -ProfileName $profileName
                New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
                Copy-Item -Path (Join-Path $sourceRoot '*') -Destination $profileRoot -Recurse -Force
                @"
name: $profileName
version: 0.1.0
source: $sourceRoot
installed_at: '2026-07-16T00:00:00+00:00'
"@ | Set-Content -LiteralPath (Join-Path $profileRoot 'distribution.yaml') -Encoding utf8
            }
            if ($Arguments[0] -eq 'profile' -and $Arguments[1] -eq 'update') {
                $global:JoblitTestEvents.Add('update')
                $profileName = $Arguments[2]
                $sourceRoot = Get-JoblitDistributionSourceRoot -ProfileName $profileName
                $profileRoot = Get-JoblitProfileRoot -ProfileName $profileName
                Copy-Item -Path (Join-Path $sourceRoot '*') -Destination $profileRoot -Recurse -Force
                @"
name: $profileName
version: 0.1.0
source: $sourceRoot
installed_at: '2026-07-16T00:00:00+00:00'
"@ | Set-Content -LiteralPath (Join-Path $profileRoot 'distribution.yaml') -Encoding utf8
            }
            if ($joined -match 'auth status openai-codex') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex: logged in' } }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        } -ModuleName JoblitHermes.Common
    }

    AfterEach {
        Remove-Item Env:HERMES_HOME -ErrorAction SilentlyContinue
        Remove-Variable JoblitTestPackageRoot, JoblitTestEvents, JoblitTestCommands, JoblitAuthChecks, JoblitProbeAttempts -Scope Global -ErrorAction SilentlyContinue
    }

    It 'verifies before mutation and uses official isolated profile, auth, and gateway commands' {
        $profile = 'joblit-0123456789abcdef'
        $receipt = Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName $profile -Production

        $global:JoblitTestEvents[0] | Should -Be 'verify'
        $global:JoblitTestEvents.IndexOf('install') | Should -BeGreaterThan $global:JoblitTestEvents.IndexOf('verify')
        $persistentSource = Get-JoblitDistributionSourceRoot -ProfileName $profile
        $global:JoblitTestCommands | Should -Contain "profile install $persistentSource --name $profile --yes"
        $global:JoblitTestCommands | Should -Contain "-p $profile auth status openai-codex"
        $global:JoblitTestCommands | Should -Not -Contain "-p $profile auth add openai-codex"
        $global:JoblitTestCommands | Should -Contain "-p $profile gateway install --start-now --start-on-login"
        @($global:JoblitTestCommands | Where-Object { $_ -match '(^|\s)config\s+get(\s|$)' }).Count | Should -Be 0
        Test-Path -LiteralPath $persistentSource -PathType Container | Should -BeTrue
        Test-JoblitSamePath -Left $persistentSource -Right $script:PackageRoot | Should -BeFalse
        $receipt.endpoint | Should -Be 'http://127.0.0.1:8642'
        $receipt.profileName | Should -Be $profile
        $receipt.PSObject.Properties.Name | Should -Not -Contain 'apiKey'
    }

    It 'retries the compatibility probe while the elevated gateway starts asynchronously' {
        $global:JoblitProbeAttempts = 0
        Mock Invoke-JoblitProbe {
            $global:JoblitProbeAttempts += 1
            if ($global:JoblitProbeAttempts -lt 3) { throw 'gateway not listening yet' }
            return $true
        } -ModuleName JoblitHermes.Common
        Mock Start-Sleep {} -ModuleName JoblitHermes.Common

        Invoke-JoblitHermesInstall `
            -PackagePath $script:PackageRoot `
            -ProfileName 'joblit-0011223344556677' `
            -Production | Out-Null

        $global:JoblitProbeAttempts | Should -Be 3
        Assert-MockCalled Start-Sleep -Times 2 -ModuleName JoblitHermes.Common
    }

    It 'writes only loopback managed values and preserves a strong key on rerun' {
        $profile = 'joblit-fedcba9876543210'
        $first = Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName $profile -Production
        $envPath = Join-Path (Get-JoblitProfileRoot $profile) '.env'
        $firstValues = Read-JoblitEnvFile $envPath
        $firstValues['SAFE_USER_SETTING'] = 'keep-me'
        Write-JoblitEnvFileAtomic -Path $envPath -Values $firstValues

        $second = Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName $profile -Production
        $secondValues = Read-JoblitEnvFile $envPath

        $second.keyFingerprint | Should -Be $first.keyFingerprint
        $secondValues['API_SERVER_HOST'] | Should -Be '127.0.0.1'
        $secondValues['API_SERVER_MODEL_NAME'] | Should -Be $profile
        Test-JoblitApiKeyStrength $secondValues['API_SERVER_KEY'] | Should -BeTrue
        $secondValues['SAFE_USER_SETTING'] | Should -Be 'keep-me'
        ($global:JoblitTestCommands | Where-Object { $_ -like 'profile update*' }) | Should -Contain "profile update $profile --yes"
    }

    It 'makes WhatIf verification-only and mutation-free' {
        $profile = 'joblit-aabbccddeeff0011'
        $receipt = Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName $profile -Production -WhatIf

        $global:JoblitTestEvents | Should -Contain 'verify'
        $global:JoblitTestEvents | Should -Not -Contain 'install'
        $global:JoblitTestCommands.Count | Should -Be 0
        Test-Path -LiteralPath (Get-JoblitProfileRoot $profile) | Should -BeFalse
        $receipt.keyFingerprint | Should -BeNullOrEmpty
    }

    It 'requires an explicit archive digest for Beta before extraction or Hermes mutation' {
        $archive = Join-Path $script:FixtureRoot 'profile.zip'
        Set-Content -LiteralPath $archive -Value 'not read' -Encoding utf8

        { Invoke-JoblitHermesInstall -PackagePath $archive -ProfileName 'joblit-1111222233334444' } |
            Should -Throw '*EXPECTED_ARCHIVE_SHA256_REQUIRED*'
        $global:JoblitTestEvents | Should -Not -Contain 'verify'
        $global:JoblitTestEvents | Should -Not -Contain 'install'
    }

    It 'refuses to replace an unrelated existing profile' {
        $profile = 'joblit-9999888877776666'
        $profileRoot = Get-JoblitProfileRoot $profile
        New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $profileRoot 'distribution.yaml') -Value 'name: someone-else'

        { Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName $profile -Production } |
            Should -Throw '*UNRELATED_PROFILE*'
        $global:JoblitTestEvents | Should -Not -Contain 'install'
    }

    It 'uses force-config only with official profile update when explicitly requested' {
        $profile = 'joblit-aaaabbbbccccdddd'
        Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName $profile -Production | Out-Null
        $global:JoblitTestCommands.Clear()

        Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName $profile -Production -ForceConfigUpdate | Out-Null

        ($global:JoblitTestCommands | Where-Object { $_ -like 'profile update*' }) | Should -Contain "profile update $profile --force-config --yes"
        ($global:JoblitTestCommands | Where-Object { $_ -like 'profile install*' -and $_ -like '*--force-config*' }).Count | Should -Be 0
    }

    It 'runs OAuth only when status is explicitly logged out and verifies the result' {
        $global:JoblitAuthChecks = 0
        Mock Invoke-JoblitProcess {
            param($FilePath, $Arguments, $Secrets, $AllowFailure)
            $joined = $Arguments -join ' '
            $global:JoblitTestCommands.Add($joined)
            if ($Arguments[0] -eq 'profile' -and $Arguments[1] -eq 'install') {
                $sourceRoot = $Arguments[2]
                $nameIndex = [Array]::IndexOf($Arguments, '--name')
                $profileName = $Arguments[$nameIndex + 1]
                $profileRoot = Get-JoblitProfileRoot -ProfileName $profileName
                New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
                Copy-Item -Path (Join-Path $sourceRoot '*') -Destination $profileRoot -Recurse -Force
                "name: $profileName`nversion: 0.1.0`nsource: $sourceRoot`ninstalled_at: '2026-07-16T00:00:00+00:00'" |
                    Set-Content -LiteralPath (Join-Path $profileRoot 'distribution.yaml') -Encoding utf8
            }
            if ($joined -match 'auth status openai-codex') {
                $global:JoblitAuthChecks += 1
                $state = if ($global:JoblitAuthChecks -eq 1) { 'logged out' } else { 'logged in' }
                return [pscustomobject]@{ ExitCode = 0; Output = "openai-codex: $state" }
            }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        } -ModuleName JoblitHermes.Common

        $profile = 'joblit-0101010101010101'
        Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName $profile -Production | Out-Null

        $global:JoblitAuthChecks | Should -Be 2
        $global:JoblitTestCommands | Should -Contain "-p $profile auth add openai-codex"
    }

    It 'does not invoke OAuth or gateway after an install command failure' {
        Mock Invoke-JoblitProcess {
            param($FilePath, $Arguments)
            if ($Arguments[0] -eq 'profile') { throw 'COMMAND_FAILED: simulated' }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        } -ModuleName JoblitHermes.Common

        { Invoke-JoblitHermesInstall -PackagePath $script:PackageRoot -ProfileName 'joblit-1234123412341234' -Production } |
            Should -Throw '*COMMAND_FAILED*'
        Assert-MockCalled Invoke-JoblitProbe -Times 0 -ModuleName JoblitHermes.Common
    }
}
