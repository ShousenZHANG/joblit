[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidatePattern('^joblit-[a-f0-9]{16,64}$')] [string] $ProfileName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'JoblitHermes.Common.psm1') -Force

$result = Test-JoblitHermesReadiness -ProfileName $ProfileName
[Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 4))
exit $result.exitCode
