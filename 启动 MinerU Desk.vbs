Set fs = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fs.GetParentFolderName(WScript.ScriptFullName)
exe = root & "\release\win-unpacked\MinerU Desk.exe"
If fs.FileExists(exe) Then
  sh.Run Chr(34) & exe & Chr(34), 1, False
Else
  exe = root & "\node_modules\electron\dist\electron.exe"
  If fs.FileExists(exe) Then
    sh.Run Chr(34) & exe & Chr(34) & " " & Chr(34) & root & Chr(34), 1, False
  Else
    MsgBox "Application files are missing. Run npm install or use the packaged application.", 48, "MinerU Desk"
  End If
End If
