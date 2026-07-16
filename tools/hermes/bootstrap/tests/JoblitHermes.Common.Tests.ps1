BeforeAll {
    $modulePath = Join-Path $PSScriptRoot '..\JoblitHermes.Common.psm1'
    Import-Module $modulePath -Force
}

Describe 'JoblitHermes.Common security primitives' {
    It 'compares Hermes versions without lexical ordering bugs' {
        Test-JoblitVersionAtLeast -Actual 'Hermes 0.18.10' -Minimum '0.18.2' | Should -BeTrue
        Test-JoblitVersionAtLeast -Actual '0.17.99' -Minimum '0.18.2' | Should -BeFalse
    }

    It 'generates independent API keys with at least 32 random bytes' {
        $first = New-JoblitApiKey
        $second = New-JoblitApiKey

        $first | Should -Not -Be $second
        Test-JoblitApiKeyStrength $first | Should -BeTrue
        Test-JoblitApiKeyStrength 'short-secret' | Should -BeFalse
        (Get-JoblitKeyFingerprint $first).Length | Should -Be 16
    }

    It 'redacts direct, env, and bearer forms of a secret' {
        $secret = New-JoblitApiKey
        $text = "value=$secret`nAPI_SERVER_KEY=$secret`nAuthorization: Bearer $secret"

        $safe = Protect-JoblitSecretText -Text $text -Secrets @($secret)

        $safe | Should -Not -Match ([regex]::Escape($secret))
        $safe | Should -Match '\[REDACTED\]'
    }

    It 'writes and replaces an env file atomically while preserving safe values' {
        $path = Join-Path $TestDrive 'profile\.env'
        $values = [ordered]@{
            API_SERVER_ENABLED = 'true'
            API_SERVER_HOST = '127.0.0.1'
            API_SERVER_PORT = '8642'
            API_SERVER_KEY = (New-JoblitApiKey)
            API_SERVER_MODEL_NAME = 'openai-codex'
            SAFE_USER_SETTING = 'preserved'
        }

        Write-JoblitEnvFileAtomic -Path $path -Values $values
        $read = Read-JoblitEnvFile -Path $path

        $read['API_SERVER_HOST'] | Should -Be '127.0.0.1'
        $read['SAFE_USER_SETTING'] | Should -Be 'preserved'
        (Get-ChildItem -LiteralPath (Split-Path $path) -Filter '*.tmp').Count | Should -Be 0
    }

    It 'rejects non-portable archive path <Value>' -TestCases @(
        @{ Value = '../escape' },
        @{ Value = '/absolute' },
        @{ Value = 'C:/drive' },
        @{ Value = 'config.yaml:secret' },
        @{ Value = 'CON/file' },
        @{ Value = 'folder\file' },
        @{ Value = 'folder/../file' }
    ) {
        param($Value)
        Test-JoblitPortableArchivePath -Value $Value | Should -BeFalse
    }

    It 'rejects a traversal entry before archive extraction' {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archivePath = Join-Path $TestDrive 'malicious.zip'
        $stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew)
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
        $archive.CreateEntry('../outside.txt') | Out-Null
        $archive.Dispose()
        $stream.Dispose()

        { Test-JoblitArchiveEntries -ArchivePath $archivePath } | Should -Throw '*MALICIOUS_ARCHIVE_ENTRY*'
    }

    It 'accepts only the zero-tool Joblit config invariants' {
        $config = Join-Path $TestDrive 'config.yaml'
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
'@ | Set-Content -LiteralPath $config -Encoding utf8

        (Test-JoblitProfileConfig -ConfigPath $config).Valid | Should -BeTrue
        (Get-Content -Raw -LiteralPath $config).Replace('memory_enabled: false', 'memory_enabled: true') |
            Set-Content -LiteralPath $config -Encoding utf8
        (Test-JoblitProfileConfig -ConfigPath $config).Valid | Should -BeFalse
    }

    It 'rejects a partial disabled-toolset list instead of accepting stale aliases' {
        $config = Join-Path $TestDrive 'partial-config.yaml'
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
    - memory
'@ | Set-Content -LiteralPath $config -Encoding utf8

        $result = Test-JoblitProfileConfig -ConfigPath $config
        $result.Valid | Should -BeFalse
        $result.Issues | Should -Contain 'agent.disabled_toolsets.all'
    }

    It 'recognizes only explicit openai-codex logged-in status' {
        Get-JoblitOpenAiCodexAuthState ([pscustomobject]@{ ExitCode = 0; Output = 'openai-codex: logged in' }) | Should -Be 'LoggedIn'
        Get-JoblitOpenAiCodexAuthState ([pscustomobject]@{ ExitCode = 0; Output = 'openai-codex: logged out (expired)' }) | Should -Be 'LoggedOut'
        Get-JoblitOpenAiCodexAuthState ([pscustomobject]@{ ExitCode = 1; Output = 'openai-codex: logged in' }) | Should -Be 'Invalid'
        Get-JoblitOpenAiCodexAuthState ([pscustomobject]@{ ExitCode = 0; Output = 'ok' }) | Should -Be 'Invalid'
    }
}

Describe 'Invoke-JoblitProbe' {
    BeforeEach {
        $global:JoblitProbeProfile = 'joblit-0123456789abcdef'
        $global:JoblitProbeKey = New-JoblitApiKey
        $global:JoblitProbeResponses = @{
            '/health' = [pscustomobject]@{ status = 'ok' }
            '/v1/capabilities' = [pscustomobject]@{
                object = 'hermes.api_server.capabilities'
                platform = 'hermes-agent'
                model = $global:JoblitProbeProfile
                auth = [pscustomobject]@{ type = 'bearer'; required = $true }
                features = [pscustomobject]@{ run_submission = $true; run_status = $true; run_stop = $true }
                endpoints = [pscustomobject]@{
                    health = [pscustomobject]@{ method = 'GET'; path = '/health' }
                    models = [pscustomobject]@{ method = 'GET'; path = '/v1/models' }
                    runs = [pscustomobject]@{ method = 'POST'; path = '/v1/runs' }
                    run_status = [pscustomobject]@{ method = 'GET'; path = '/v1/runs/{run_id}' }
                    run_stop = [pscustomobject]@{ method = 'POST'; path = '/v1/runs/{run_id}/stop' }
                    toolsets = [pscustomobject]@{ method = 'GET'; path = '/v1/toolsets' }
                }
            }
            '/v1/models' = [pscustomobject]@{ object = 'list'; data = @([pscustomobject]@{ object = 'model'; id = $global:JoblitProbeProfile }) }
            '/v1/toolsets' = [pscustomobject]@{
                object = 'list'
                platform = 'api_server'
                data = @(
                    [pscustomobject]@{ name = 'terminal'; enabled = $false; configured = $true; tools = @('terminal') },
                    [pscustomobject]@{ name = 'core'; enabled = $true; configured = $true; tools = @() }
                )
            }
        }
        $global:JoblitProbeCalls = [Collections.Generic.List[string]]::new()
        Mock Invoke-RestMethod {
            param($Method, $Uri, $Headers, $TimeoutSec)
            $path = ([uri] $Uri).AbsolutePath
            $global:JoblitProbeCalls.Add("$Method $path $($Headers.Authorization)")
            return $global:JoblitProbeResponses[$path]
        } -ModuleName JoblitHermes.Common
    }

    AfterEach { Remove-Variable JoblitProbeCalls,JoblitProbeProfile,JoblitProbeKey,JoblitProbeResponses -Scope Global -ErrorAction SilentlyContinue }

    It 'validates the fixed read-only API surface without submitting a run' {
        Invoke-JoblitProbe -Port 8642 -ApiKey $global:JoblitProbeKey -ProfileName $global:JoblitProbeProfile | Should -BeTrue

        $global:JoblitProbeCalls.Count | Should -Be 4
        $global:JoblitProbeCalls | Should -Contain 'Get /health '
        $global:JoblitProbeCalls | Should -Contain "Get /v1/capabilities Bearer $($global:JoblitProbeKey)"
        @($global:JoblitProbeCalls | Where-Object { $_ -match '^Post ' }).Count | Should -Be 0
    }

    It 'rejects model identity drift and enabled executable tools' {
        $global:JoblitProbeResponses['/v1/capabilities'].model = 'openai-codex'
        { Invoke-JoblitProbe -Port 8642 -ApiKey $global:JoblitProbeKey -ProfileName $global:JoblitProbeProfile } | Should -Throw '*API_INCOMPATIBLE*'

        $global:JoblitProbeResponses['/v1/capabilities'].model = $global:JoblitProbeProfile
        $global:JoblitProbeResponses['/v1/toolsets'].data[0].enabled = $true
        { Invoke-JoblitProbe -Port 8642 -ApiKey $global:JoblitProbeKey -ProfileName $global:JoblitProbeProfile } | Should -Throw '*API_INCOMPATIBLE*'
    }
}
