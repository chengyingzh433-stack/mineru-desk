param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference='Stop'
try {
 $prefix=[System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')+'\'
 $found=Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $PID -and $_.Name -notmatch '^(unins\d+|MinerU-Desk-Setup-).*\.exe$' -and (
   ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) -or
   ($_.CommandLine -and ($_.CommandLine.IndexOf(($prefix+'resources\app\server.mjs'),[StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.CommandLine.IndexOf(($prefix+'resources/app/server.mjs'),[StringComparison]::OrdinalIgnoreCase) -ge 0))
  )
 }
 if($found){exit 2}
 exit 0
} catch { exit 3 }
