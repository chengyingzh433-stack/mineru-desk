param(
 [Parameter(Mandatory=$true)][int]$ParentProcessId,
 [Parameter(Mandatory=$true)][string]$InstallRoot,
 [Parameter(Mandatory=$true)][ValidateSet('update','uninstall')][string]$Operation,
 [string]$Installer,
 [string]$ExpectedHash
)
$ErrorActionPreference='Stop'
try {
 $process=Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue
 if($process -and -not $process.WaitForExit(60000)){throw '客户端尚未退出，已取消操作。'}
 $root=(Resolve-Path -LiteralPath $InstallRoot).Path
 if(-not (Test-Path -LiteralPath (Join-Path $root 'mineru-desk-bundle.json'))){throw '不是已安装的 MinerU Desk 目录。'}
 $exe=Join-Path $root 'MinerU Desk.exe'
 if($Operation -eq 'update'){
  if($ExpectedHash -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash){throw '安装文件校验失败。'}
  $installArgs=@('/SILENT','/NORESTART','/SP-','/NOCLOSEAPPLICATIONS','/NORESTARTAPPLICATIONS',('/DIR="'+$root+'"'))
  $result=Start-Process -FilePath $Installer -ArgumentList $installArgs -PassThru -Wait
  if($result.ExitCode -ne 0){throw ('安装未完成，退出码：'+$result.ExitCode)}
 } else {
  # The normal Inno confirmation remains visible. Never delete the source,
  # models, external runtimes or workspace ourselves.
  $result=Start-Process -FilePath (Join-Path $root 'unins000.exe') -PassThru -Wait
 }
 if(Test-Path -LiteralPath $exe){Start-Process -FilePath $exe -WorkingDirectory $root -WindowStyle Hidden}
} catch {
 Add-Type -AssemblyName System.Windows.Forms
 [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'MinerU Desk 更新 / 卸载未完成')
 if($exe -and (Test-Path -LiteralPath $exe)){Start-Process -FilePath $exe -WorkingDirectory $root -WindowStyle Hidden}
} finally {
 # Only remove the verified updater-owned download, not any other resources.
 if($Operation -eq 'update' -and $Installer -and $ExpectedHash -match '^[a-f0-9]{64}$'){
  if(Test-Path -LiteralPath $Installer){
   $download=Get-Item -LiteralPath $Installer
   $owned=$download.Name -match '^MinerU-Desk-Setup-\d+\.\d+\.\d+-x64\.exe$' -and $download.Directory.Name -like 'download-*' -and $download.Directory.Parent.Name -eq 'updates'
   $linked=($download.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($download.Directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($download.Directory.Parent.Attributes -band [IO.FileAttributes]::ReparsePoint)
   if($owned -and -not $linked -and (Get-FileHash -LiteralPath $download.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -eq $ExpectedHash){Remove-Item -LiteralPath $download.FullName}
  }
 }
}
