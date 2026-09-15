; Build the runtime-only installer with Inno Setup 7 x64.
[Setup]
AppId={{94D99D1B-5058-512F-B4C8-969684CC6451}
AppName=MinerU Desk
AppVersion=0.3.1
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
OutputBaseFilename=MinerU-Desk-Setup-0.3.1-x64
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

[Icons]
Name: "{autoprograms}\MinerU Desk"; Filename: "{app}\MinerU Desk.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\MinerU Desk"; Filename: "{app}\MinerU Desk.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\MinerUDesk"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\MinerU Desk.exe"; Description: "打开 MinerU Desk"; Flags: postinstall nowait skipifsilent unchecked

[Code]
