; Build the runtime-only installer with Inno Setup 7 x64.
[Setup]
AppId={{94D99D1B-5058-512F-B4C8-969684CC6451}
AppName=MinerU Desk
AppVersion=0.3.3
SetupIconFile=app-icon.ico
AppPublisher=MinerU Desk community package
DefaultDirName={localappdata}\Programs\MinerU Desk
DefaultGroupName=MinerU Desk
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir=..\release-installer
OutputBaseFilename=MinerU-Desk-Setup-0.3.3-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\MinerU Desk.exe
InfoBeforeFile=安装前说明.txt

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："

[Files]
Source: "..\release-installer\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "installation-check.ps1"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\MinerU Desk"; Filename: "{app}\MinerU Desk.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\MinerU Desk"; Filename: "{app}\MinerU Desk.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autoprograms}\卸载 MinerU Desk"; Filename: "{uninstallexe}"

[Registry]
Root: HKCU; Subkey: "Software\MinerUDesk"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\MinerU Desk.exe"; Description: "打开 MinerU Desk"; Flags: postinstall nowait skipifsilent unchecked

[Code]
function CheckStopped(ScriptFile: String): Boolean;
var ExitCode: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ScriptFile + '" -InstallRoot "' + ExpandConstant('{app}') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
  Result := Result and (ExitCode = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  ExtractTemporaryFile('installation-check.ps1');
  if not CheckStopped(ExpandConstant('{tmp}\installation-check.ps1')) then
    Result := '请先保存编辑并关闭 MinerU Desk，结束转换、下载和后台服务，再继续安装。可在旧安装目录运行 Codex.ps1 stop 停止空闲后台。';
end;

function InitializeUninstall(): Boolean;
begin
  Result := CheckStopped(ExpandConstant('{app}\installation-check.ps1'));
  if not Result then MsgBox('程序或后台服务仍在运行，或无法完成检查。请先结束工作，再从应用设置中的卸载入口重试。', mbError, MB_OK);
end;
