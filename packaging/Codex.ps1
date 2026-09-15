$ErrorActionPreference = 'Stop'
$bundleExe = Join-Path $PSScriptRoot 'app\MinerU Desk.exe'
$agentScript = Join-Path $PSScriptRoot 'app\resources\app\agent.mjs'
if (-not (Test-Path -LiteralPath $bundleExe)) {
    $bundleExe = Join-Path $PSScriptRoot 'MinerU Desk.exe'
    $agentScript = Join-Path $PSScriptRoot 'resources\app\agent.mjs'
}
if (-not (Test-Path -LiteralPath $bundleExe)) { throw 'Extract the entire ZIP before running Codex.ps1.' }
$oldNodeMode = $env:ELECTRON_RUN_AS_NODE
$oldDeskData = $env:MINERU_DESK_DATA
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $packageInfo = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'mineru-desk-bundle.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($packageInfo.distribution -eq 'installer') {
        $env:MINERU_DESK_DATA = Join-Path (Split-Path $PSScriptRoot -Parent) 'MinerU-Desk-Data\data'
    } else { $env:MINERU_DESK_DATA = Join-Path $PSScriptRoot 'data' }
    # Avoid PowerShell's GUI-executable process-tree wait: only wait for this agent.
    function Quote-AgentArgument([string]$Value) {
        return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $bundleExe
    $startInfo.Arguments = ((@($agentScript) + $args) | ForEach-Object { Quote-AgentArgument $_ }) -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
    $agentProcess = New-Object System.Diagnostics.Process
    $agentProcess.StartInfo = $startInfo
    [void]$agentProcess.Start()
    $outputRead = $agentProcess.StandardOutput.ReadToEndAsync()
    $errorRead = $agentProcess.StandardError.ReadToEndAsync()
    $agentProcess.WaitForExit()
    [Console]::Out.Write($outputRead.Result)
    [Console]::Error.Write($errorRead.Result)
    $agentExit = $agentProcess.ExitCode
    $agentProcess.Dispose()
} finally {
    $env:ELECTRON_RUN_AS_NODE = $oldNodeMode
    $env:MINERU_DESK_DATA = $oldDeskData
}
exit $agentExit
