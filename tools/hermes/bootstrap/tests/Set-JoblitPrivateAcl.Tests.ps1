$modulePath = Join-Path $PSScriptRoot '..\JoblitHermes.Common.psm1'
Import-Module $modulePath -Force

Describe 'Write-JoblitEnvFileAtomic replacement' {
    It 'atomically replaces an existing private env file without leaving secret debris' {
        $path = Join-Path $TestDrive 'profile\.env'
        $values = [ordered]@{
            API_SERVER_ENABLED = 'true'
            API_SERVER_HOST = '127.0.0.1'
            API_SERVER_KEY = ('x' * 32)
            API_SERVER_MODEL_NAME = 'joblit-0123456789abcdef'
            API_SERVER_PORT = '8642'
        }

        Write-JoblitEnvFileAtomic -Path $path -Values $values
        $values['API_SERVER_PORT'] = '8643'
        Write-JoblitEnvFileAtomic -Path $path -Values $values

        $read = Read-JoblitEnvFile -Path $path
        if ($read['API_SERVER_PORT'] -ne '8643') { throw 'Replacement content was not persisted.' }
        $debris = @(Get-ChildItem -LiteralPath (Split-Path $path) -Force | Where-Object {
            $_.Name -like '.env.*.tmp' -or $_.Name -like '.env.*.bak'
        })
        if ($debris.Count -ne 0) { throw 'Temporary secret files were not removed.' }
    }
}

Describe 'Set-JoblitPrivateAcl idempotence' {
    It 'does not rewrite an already private ACL' {
        InModuleScope JoblitHermes.Common {
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
            $acl = New-Object Security.AccessControl.FileSecurity
            $acl.SetOwner($identity)
            $acl.SetAccessRuleProtection($true, $false)
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
                $identity,
                [Security.AccessControl.FileSystemRights]::FullControl,
                [Security.AccessControl.AccessControlType]::Allow
            )))
            $global:JoblitPrivateAclFixture = $acl

            try {
                Mock Get-Acl { return $global:JoblitPrivateAclFixture }
                Mock Set-Acl { throw 'SeSecurityPrivilege' }

                Set-JoblitPrivateAcl -Path 'already-private.env'
                Assert-MockCalled Set-Acl -Times 0
            } finally {
                Remove-Variable JoblitPrivateAclFixture -Scope Global -ErrorAction SilentlyContinue
            }
        }
    }
}
