Option Explicit
Dim fso, ws, root, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = fso.BuildPath(root, "app\MinerU Desk.exe")
If Not fso.FileExists(exe) Then
 MsgBox "Extract the entire ZIP first. Missing app\MinerU Desk.exe", 16, "MinerU Desk"
 WScript.Quit 1
End If
ws.CurrentDirectory = root
ws.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
ws.Environment("PROCESS").Remove "MINERU_DESK_DATA"
ws.Run Chr(34) & exe & Chr(34), 1, False
