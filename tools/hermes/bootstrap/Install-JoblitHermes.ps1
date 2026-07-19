[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [string] $PackagePath,
    [Parameter(Mandatory)] [ValidatePattern('^joblit-[a-f0-9]{16,64}$')] [string] $ProfileName,
    [ValidateRange(1024,65535)] [int] $Port = 8642,
    [string] $ExpectedArchiveSha256,
    [switch] $Production,
    [bool] $StartOnLogin = $true,
    [switch] $ForceConfigUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'JoblitHermes.Common.psm1') -Force

try {
    $receipt = Invoke-JoblitHermesInstall @PSBoundParameters
    [Console]::Out.WriteLine(($receipt | ConvertTo-Json -Depth 4))
    exit 0
} catch {
    [Console]::Error.WriteLine((Protect-JoblitSecretText -Text $_.Exception.Message))
    exit 1
}
