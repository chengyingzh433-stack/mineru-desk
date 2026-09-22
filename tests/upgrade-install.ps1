param([Parameter(Mandatory=$true)][string]$OldSetup,[Parameter(Mandatory=$true)][string]$NewSetup)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$qaRoot=Join-Path $project ('.build\upgrade-qa-'+[Guid]::NewGuid().ToString('N'))
$registered=(Get-ItemProperty 'HKCU:\Software\MinerUDesk' -ErrorAction SilentlyContinue).InstallDir
if($registered -or (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{94D99D1B-5058-512F-B4C8-969684CC6451}_is1')){throw 'Existing user installation: do not replace registration during QA'}
if(Test-Path -LiteralPath $qaRoot){throw 'QA directory exists'}
$install=Join-Path $qaRoot 'client'
$workspace=Join-Path $qaRoot 'MinerU-Desk-Data'
New-Item -ItemType Directory -Path $qaRoot | Out-Null
function Setup([string]$File,[string]$Log){
 $arguments='/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="'+$install+'" /LOG="'+(Join-Path $qaRoot $Log)+'"'
 $p=Start-Process -FilePath $File -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
 return $p.ExitCode
}
if((Setup $OldSetup 'old-install.log') -ne 0){throw 'Old install failed'}
if((Get-Content -LiteralPath "$install\resources\app\package.json" -Raw | ConvertFrom-Json).version -ne '0.3.1'){throw 'Old version mismatch'}
foreach($name in @('models','output','data')){
 $dir=Join-Path $workspace $name;New-Item -ItemType Directory -Path $dir -Force | Out-Null
 [IO.File]::WriteAllText((Join-Path $dir 'qa-preserve.txt'),'synthetic preservation sentinel')
}
function StartBackend {
 $env:ELECTRON_RUN_AS_NODE='1'
 try { $p=Start-Process -FilePath "$install\MinerU Desk.exe" -ArgumentList ('"'+$install+'\resources\app\server.mjs"') -WindowStyle Hidden -PassThru } finally {Remove-Item Env:ELECTRON_RUN_AS_NODE}
 for($i=0;$i -lt 100;$i++){
  Start-Sleep -Milliseconds 100
  if(Test-Path -LiteralPath "$workspace\data\connection.json"){
   $c=Get-Content -LiteralPath "$workspace\data\connection.json" -Raw | ConvertFrom-Json
   if($c.pid -eq $p.Id){return @{Process=$p;Connection=$c}}
  }
 }
 throw 'Backend did not start'
}
function StopBackend($entry){
 $c=$entry.Connection
 Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$c.port+'/api/shutdown') -Headers @{Authorization=('Bearer '+$c.token)} -ContentType 'application/json' -Body '{}' | Out-Null
 if(-not $entry.Process.WaitForExit(15000)){throw 'Backend did not stop'}
}
$old=StartBackend
if((Setup $NewSetup 'blocked-update.log') -eq 0){throw 'Installer overwrote a running backend'}
Write-Output 'PASS: installer rejects running old backend'
StopBackend $old
if((Setup $NewSetup 'new-install.log') -ne 0){throw 'Upgrade failed'}
if((Get-Content -LiteralPath "$install\resources\app\package.json" -Raw | ConvertFrom-Json).version -ne '0.3.2'){throw 'New version mismatch'}
foreach($file in @('runtime\python.exe','resources\app\updater.cjs','resources\app\web\app-icon.png','resources\app\packaging\maintenance-runner.ps1','installation-check.ps1')){if(-not(Test-Path -LiteralPath (Join-Path $install $file))){throw ('Missing: '+$file)}}
$new=StartBackend
$c=$new.Connection
$identity=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$c.port+'/api/identity') -Headers @{Authorization=('Bearer '+$c.token)}
if($identity.version -ne '0.3.2' -or -not $identity.installed){throw 'Installed backend identity failed'}
StopBackend $new
Write-Output 'PASS: 0.3.1 -> 0.3.2 in-place upgrade and installed backend'
$uninstaller=(Resolve-Path -LiteralPath "$install\unins000.exe").Path
if(-not $uninstaller.StartsWith(([IO.Path]::GetFullPath($qaRoot)+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Uninstaller escaped QA root'}
$p=Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -PassThru -Wait
if($p.ExitCode -ne 0 -or (Test-Path -LiteralPath "$install\MinerU Desk.exe") -or (Test-Path -LiteralPath "$install\runtime\python.exe")){throw 'Uninstall failed'}
foreach($name in @('models','output','data')){if([IO.File]::ReadAllText((Join-Path $workspace "$name\qa-preserve.txt")) -ne 'synthetic preservation sentinel'){throw 'External data was changed'}}
Write-Output 'PASS: uninstall removes frontend/runtime and preserves external data/models/results'
Write-Output ('EVIDENCE '+$qaRoot)
