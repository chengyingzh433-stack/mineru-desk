!macro customInstall
  WriteRegStr HKCU "Software\MinerUDesk" "InstallDir" "$INSTDIR"
!macroend
!macro customUnInstall
  DeleteRegValue HKCU "Software\MinerUDesk" "InstallDir"
  ; Persistent workspaces are outside INSTDIR; never remove them here.
!macroend
