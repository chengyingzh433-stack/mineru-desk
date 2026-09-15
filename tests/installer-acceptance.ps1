param([Parameter(Mandatory=$true)][string]$PipelinePath)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$qaRoot='D:\MinerU安装验收 0.3.1'
$install=Join-Path $qaRoot '客户端'
$workspace=Join-Path $qaRoot 'MinerU-Desk-Data'
if(Test-Path -LiteralPath $qaRoot){throw 'QA directory already exists; do not overwrite'}
if(Test-Path 'HKCU:\Software\MinerUDesk'){throw 'Existing installation registration; isolate test before running'}
New-Item -ItemType Directory -Path $qaRoot | Out-Null
$setup=Join-Path $project 'release-installer\MinerU-Desk-Setup-0.3.1-x64.exe'
$argsLine='/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="'+$install+'" /LOG="'+$qaRoot+'\install.log"'
$p=Start-Process -FilePath $setup -ArgumentList $argsLine -WindowStyle Hidden -PassThru -Wait
if($p.ExitCode -ne 0){throw "Installer exit=$($p.ExitCode)"}
if((Get-ItemProperty 'HKCU:\Software\MinerUDesk').InstallDir -ne $install){throw 'Wrong installation registry path'}
Write-Output 'PASS: actual installer selected Chinese / spaces path'
function Agent([string[]]$command){
  $output=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$install\Codex.ps1" @command
  if($LASTEXITCODE -ne 0){throw ($output -join "`n")}
  return ($output -join "`n" | ConvertFrom-Json)
}
$verified=Agent -command @('verify');if($verified.status -ne 'passed' -or $verified.modelFiles -ne 0){throw 'Manifest verification failed'}
Write-Output ('PASS: hashes '+$verified.checked+' app files / no bundled large models')
$doctor=Agent -command @('doctor');if($doctor.checks.runtime -ne 'passed' -or $doctor.checks.models -ne 'missing'){throw 'Runtime or clean no-model workspace failed'}
Write-Output ('PASS: installed runtime '+$doctor.checks.runtime+' / models '+$doctor.checks.models)
$office=Agent -command @('self-test');if($office.status -ne 'passed'){throw 'Office self-test failed'}
Write-Output 'PASS: offline DOCX, images, source preserved and cache reused'
$missing=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$install\Codex.ps1" self-test --pdf
if($LASTEXITCODE -ne 2 -or (($missing -join "`n" | ConvertFrom-Json).status -ne 'needs-models')){throw 'Missing models were not reported honestly'}
Write-Output 'PASS: PDF without models returns needs-models without downloading'
$request=Join-Path $qaRoot 'import-model.json'
[System.IO.File]::WriteAllText($request,(@{model='pipeline';path=$PipelinePath}|ConvertTo-Json),[System.Text.UTF8Encoding]::new($false))
[void](Agent -command @('request','POST','models/import',$request))
$pdf=Agent -command @('self-test','--pdf');if($pdf.status -ne 'passed'){throw 'PDF self-test failed'}
Write-Output 'PASS: offline PDF, images, source preserved and cache reused'
[void](Agent -command @('stop'))
$env:MINERU_DESK_DATA=Join-Path $workspace 'data'
$env:MINERU_DESK_SMOKE_OUTPUT=Join-Path $qaRoot 'screenshots'
$env:MINERU_DESK_SMOKE_RESULT='1'
$env:MINERU_DESK_SMOKE_IMAGES='1'
try{
 $smoke=Start-Process -FilePath "$install\MinerU Desk.exe" -ArgumentList '--smoke-test' -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput "$qaRoot\desktop.log" -RedirectStandardError "$qaRoot\desktop.err"
 if($smoke.ExitCode -ne 0){throw 'Installed desktop smoke test failed'}
 Write-Output 'PASS: installed desktop launch, converted result and image preview'
}finally{Remove-Item Env:MINERU_DESK_DATA,Env:MINERU_DESK_SMOKE_OUTPUT,Env:MINERU_DESK_SMOKE_RESULT,Env:MINERU_DESK_SMOKE_IMAGES -ErrorAction SilentlyContinue}
$uninstall=Join-Path $install 'unins000.exe'
if((Resolve-Path -LiteralPath $uninstall).Path -ne 'D:\MinerU安装验收 0.3.1\客户端\unins000.exe'){throw 'Unexpected uninstaller path'}
$p=Start-Process -FilePath $uninstall -ArgumentList ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="'+$qaRoot+'\uninstall.log"') -WindowStyle Hidden -PassThru -Wait
if($p.ExitCode -ne 0 -or (Test-Path -LiteralPath "$install\MinerU Desk.exe")){throw 'Uninstall failed'}
if(!(Test-Path -LiteralPath $pdf.markdown) -or !(Test-Path -LiteralPath "$workspace\data\state.json")){throw 'Uninstall removed user data'}
$manifest=Get-Content -LiteralPath "$project\packaging\model-manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($file in $manifest.files){$p=Join-Path $PipelinePath $file.path;if((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256){throw 'Uninstall changed imported model'}}
Write-Output 'PASS: uninstall removed program; data/results retained and imported model unchanged'
Write-Output ('EVIDENCE '+$qaRoot)
