$modulePath = Join-Path $PSScriptRoot '..\JoblitHermes.Common.psm1'
Import-Module $modulePath -Force

Describe 'Invoke-JoblitNonInteractiveProcess environment isolation' {
    It 'sets Hermes non-interactive mode only for the child invocation' {
        InModuleScope JoblitHermes.Common {
            $global:JoblitNonInteractiveCaptures = [Collections.Generic.List[string]]::new()
            try {
                Mock Invoke-JoblitProcess {
                    $global:JoblitNonInteractiveCaptures.Add([string] $env:HERMES_NONINTERACTIVE)
                    return [pscustomobject]@{ ExitCode = 0; Output = 'ok' }
                }

                $env:HERMES_NONINTERACTIVE = 'caller-value'
                Invoke-JoblitNonInteractiveProcess -FilePath 'hermes' -Arguments @('gateway','install') | Out-Null
                if ($env:HERMES_NONINTERACTIVE -ne 'caller-value') { throw 'Existing caller environment was not restored.' }

                Remove-Item Env:HERMES_NONINTERACTIVE -ErrorAction SilentlyContinue
                Invoke-JoblitNonInteractiveProcess -FilePath 'hermes' -Arguments @('gateway','install') | Out-Null
                if (Test-Path Env:HERMES_NONINTERACTIVE) { throw 'Previously absent caller environment was not removed.' }

                if (($global:JoblitNonInteractiveCaptures -join ',') -ne '1,1') {
                    throw "Child invocations were not non-interactive: $($global:JoblitNonInteractiveCaptures -join ',')"
                }
            } finally {
                Remove-Item Env:HERMES_NONINTERACTIVE -ErrorAction SilentlyContinue
                Remove-Variable JoblitNonInteractiveCaptures -Scope Global -ErrorAction SilentlyContinue
            }
        }
    }
}
