BeforeAll {
    $modulePath = Join-Path $PSScriptRoot '..\JoblitHermes.Common.psm1'
    Import-Module $modulePath -Force
}

Describe 'Test-JoblitHermesReadiness' {
    BeforeEach {
        $script:FixtureRoot = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $env:HERMES_HOME = Join-Path $script:FixtureRoot 'hermes-home'
        $script:ProfileName = 'joblit-0123456789abcdef'
        $script:ProfileRoot = Get-JoblitProfileRoot $script:ProfileName
        New-Item -ItemType Directory -Path $script:ProfileRoot -Force | Out-Null
        $script:DistributionSource = Get-JoblitDistributionSourceRoot $script:ProfileName
        New-Item -ItemType Directory -Path $script:DistributionSource -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $script:ProfileRoot 'distribution.yaml') -Value "name: $($script:ProfileName)`nversion: 0.2.0`nsource: $($script:DistributionSource)`ninstalled_at: '2026-07-16T00:00:00+00:00'"
        Set-Content -LiteralPath (Join-Path $script:ProfileRoot 'joblit-package-manifest.json') -Value '{"schemaVersion":1,"package":"joblit-hermes-profile"}' -Encoding utf8
        Set-Content -LiteralPath (Join-Path $script:ProfileRoot '.no-bundled-skills') -Value '' -NoNewline
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
'@ | Set-Content -LiteralPath (Join-Path $script:ProfileRoot 'config.yaml') -Encoding utf8
        $script:ApiKey = New-JoblitApiKey
        $global:JoblitVerifierApiKey = $script:ApiKey
        $values = [ordered]@{
            API_SERVER_ENABLED = 'true'
            API_SERVER_HOST = '127.0.0.1'
            API_SERVER_PORT = '8642'
            API_SERVER_KEY = $script:ApiKey
            API_SERVER_MODEL_NAME = $script:ProfileName
        }
        Write-JoblitEnvFileAtomic -Path (Join-Path $script:ProfileRoot '.env') -Values $values

        Mock Resolve-JoblitExecutable { return 'fake-hermes' } -ModuleName JoblitHermes.Common
        Mock Get-JoblitHermesVersion { return '0.18.2' } -ModuleName JoblitHermes.Common
        Mock Invoke-JoblitPackageVerifier { return [pscustomobject]@{ profileVersion = '0.2.0'; trustLevel = 'integrity-only' } } -ModuleName JoblitHermes.Common
        Mock Invoke-JoblitProcess {
            param($FilePath, $Arguments, $AllowFailure)
            $joined = $Arguments -join ' '
            if ($joined -match 'model.provider') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex' } }
            if ($joined -match 'model.openai_runtime') { return [pscustomobject]@{ ExitCode = 0; Output = 'auto' } }
            if ($joined -match 'auth status openai-codex') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex: logged in' } }
            if ($joined -match 'gateway status') { return [pscustomobject]@{ ExitCode = 0; Output = 'running' } }
            return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
        } -ModuleName JoblitHermes.Common
        Mock Invoke-JoblitProbe { return $true } -ModuleName JoblitHermes.Common
    }

    AfterEach {
        Remove-Item Env:HERMES_HOME -ErrorAction SilentlyContinue
        Remove-Variable JoblitVerifierApiKey -Scope Global -ErrorAction SilentlyContinue
    }

    It 'returns Ready without writing profile state or exposing the API key' {
        $before = (Get-Item -LiteralPath (Join-Path $script:ProfileRoot '.env')).LastWriteTimeUtc
        $result = Test-JoblitHermesReadiness -ProfileName $script:ProfileName
        $after = (Get-Item -LiteralPath (Join-Path $script:ProfileRoot '.env')).LastWriteTimeUtc

        $result.state | Should -Be 'Ready'
        $result.exitCode | Should -Be 0
        $result.keyFingerprint | Should -Be (Get-JoblitKeyFingerprint $script:ApiKey)
        ($result | ConvertTo-Json) | Should -Not -Match ([regex]::Escape($script:ApiKey))
        $after | Should -Be $before
    }

    It 'returns stable missing Hermes category' {
        Mock Resolve-JoblitExecutable { throw 'MISSING_HERMES: absent' } -ModuleName JoblitHermes.Common
        $result = Test-JoblitHermesReadiness -ProfileName $script:ProfileName
        $result.state | Should -Be 'MissingHermes'
        $result.exitCode | Should -Be 10
    }

    It 'rejects the retired browser wildcard CORS setting' {
        $envPath = Join-Path $script:ProfileRoot '.env'
        $values = Read-JoblitEnvFile -Path $envPath
        $values['API_SERVER_CORS_ORIGINS'] = '*'
        Write-JoblitEnvFileAtomic -Path $envPath -Values $values

        $result = Test-JoblitHermesReadiness -ProfileName $script:ProfileName

        $result.state | Should -Be 'ProfileDrift'
        $result.exitCode | Should -Be 30
    }

    It 'distinguishes untrusted package from profile drift' {
        Mock Invoke-JoblitPackageVerifier { throw 'INVALID_MANIFEST_SIGNATURE' } -ModuleName JoblitHermes.Common
        $untrusted = Test-JoblitHermesReadiness -ProfileName $script:ProfileName
        $untrusted.state | Should -Be 'UntrustedPackage'
        $untrusted.exitCode | Should -Be 20

        Mock Invoke-JoblitPackageVerifier { throw 'FILE_HASH_MISMATCH: SOUL.md' } -ModuleName JoblitHermes.Common
        $drift = Test-JoblitHermesReadiness -ProfileName $script:ProfileName
        $drift.state | Should -Be 'ProfileDrift'
        $drift.exitCode | Should -Be 30
    }

    It 'returns auth/model mismatch when provider selection drifts' {
        Mock Invoke-JoblitProcess {
            param($FilePath, $Arguments)
            if (($Arguments -join ' ') -match 'model.provider') { return [pscustomobject]@{ ExitCode = 0; Output = 'other-provider' } }
            return [pscustomobject]@{ ExitCode = 0; Output = 'auto' }
        } -ModuleName JoblitHermes.Common

        $result = Test-JoblitHermesReadiness -ProfileName $script:ProfileName
        $result.state | Should -Be 'AuthModelMismatch'
        $result.exitCode | Should -Be 40
    }

    It 'rejects a gateway model identity that is not the opaque profile name' {
        $envPath = Join-Path $script:ProfileRoot '.env'
        $values = Read-JoblitEnvFile -Path $envPath
        $values['API_SERVER_MODEL_NAME'] = 'openai-codex'
        Write-JoblitEnvFileAtomic -Path $envPath -Values $values

        $result = Test-JoblitHermesReadiness -ProfileName $script:ProfileName

        $result.state | Should -Be 'ProfileDrift'
        $result.exitCode | Should -Be 30
    }

    It 'requires an explicit logged-in openai-codex status' {
        Mock Invoke-JoblitProcess {
            param($FilePath, $Arguments)
            $joined = $Arguments -join ' '
            if ($joined -match 'model.provider') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex' } }
            if ($joined -match 'model.openai_runtime') { return [pscustomobject]@{ ExitCode = 0; Output = 'auto' } }
            if ($joined -match 'auth status openai-codex') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex: logged out (expired)' } }
            return [pscustomobject]@{ ExitCode = 0; Output = 'running' }
        } -ModuleName JoblitHermes.Common

        $result = Test-JoblitHermesReadiness -ProfileName $script:ProfileName

        $result.state | Should -Be 'AuthModelMismatch'
        $result.exitCode | Should -Be 40
        Assert-MockCalled Invoke-JoblitProbe -Times 0 -ModuleName JoblitHermes.Common
    }

    It 'returns gateway and API categories with exact recovery commands' {
        Mock Invoke-JoblitProcess {
            param($FilePath, $Arguments)
            $joined = $Arguments -join ' '
            if ($joined -match 'model.provider') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex' } }
            if ($joined -match 'model.openai_runtime') { return [pscustomobject]@{ ExitCode = 0; Output = 'auto' } }
            if ($joined -match 'auth status openai-codex') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex: logged in' } }
            return [pscustomobject]@{ ExitCode = 1; Output = 'stopped' }
        } -ModuleName JoblitHermes.Common
        $gateway = Test-JoblitHermesReadiness -ProfileName $script:ProfileName
        $gateway.state | Should -Be 'GatewayDown'
        $gateway.exitCode | Should -Be 50

        Mock Invoke-JoblitProcess {
            param($FilePath, $Arguments)
            $joined = $Arguments -join ' '
            if ($joined -match 'model.provider') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex' } }
            if ($joined -match 'model.openai_runtime') { return [pscustomobject]@{ ExitCode = 0; Output = 'auto' } }
            if ($joined -match 'auth status openai-codex') { return [pscustomobject]@{ ExitCode = 0; Output = 'openai-codex: logged in' } }
            return [pscustomobject]@{ ExitCode = 0; Output = 'running' }
        } -ModuleName JoblitHermes.Common
        Mock Invoke-JoblitProbe { throw "probe failed $global:JoblitVerifierApiKey" } -ModuleName JoblitHermes.Common
        $api = Test-JoblitHermesReadiness -ProfileName $script:ProfileName
        $api.state | Should -Be 'ApiIncompatible'
        $api.exitCode | Should -Be 60
        $api.detail | Should -Not -Match ([regex]::Escape($script:ApiKey))
        $api.recoveryCommand | Should -Be "hermes -p $($script:ProfileName) gateway restart"
    }
}
