$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Joblit local assistant'
$form.Size = New-Object System.Drawing.Size(470, 275)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Start the assistant, then return to Tailor to connect.'
$label.SetBounds(24, 24, 410, 45)
$form.Controls.Add($label)
$auto = New-Object System.Windows.Forms.CheckBox
$auto.Text = 'Start when I sign in to Windows'
$auto.SetBounds(24, 80, 405, 28)
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$auto.Checked = $null -ne (Get-ItemProperty -LiteralPath $runKey -Name JoblitCompanion -ErrorAction SilentlyContinue)
$auto.Add_CheckedChanged({
    if ($auto.Checked) {
        $command = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Launch.ps1') + '"'
        New-ItemProperty -LiteralPath $runKey -Name JoblitCompanion -Value $command -PropertyType String -Force | Out-Null
    } else {
        Remove-ItemProperty -LiteralPath $runKey -Name JoblitCompanion -ErrorAction SilentlyContinue
    }
})
$form.Controls.Add($auto)
$start = New-Object System.Windows.Forms.Button
$start.Text = 'Start assistant'
$start.SetBounds(24, 130, 190, 42)
$start.Add_Click({ & (Join-Path $PSScriptRoot 'Launch.ps1'); $label.Text = 'Assistant started. Return to Tailor and click Start & connect.' })
$form.Controls.Add($start)
$stop = New-Object System.Windows.Forms.Button
$stop.Text = 'Stop assistant'
$stop.SetBounds(232, 130, 190, 42)
$stop.Add_Click({
    try {
        $output = & (Join-Path $PSScriptRoot 'node.exe') (Join-Path $PSScriptRoot 'app\app.mjs') --stop 2>&1
        if ($LASTEXITCODE -ne 0) { $label.Text = 'Finish or cancel active tasks in Tailor before stopping.' }
        else { $label.Text = 'Assistant stopped. Start & connect in Tailor to use it again.' }
    } catch { $label.Text = 'Could not stop the assistant. Try again after tasks finish.' }
})
$form.Controls.Add($stop)
$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Model account settings stay in Hermes on this computer.'
$hint.SetBounds(24, 190, 410, 30)
$form.Controls.Add($hint)
[void]$form.ShowDialog()
